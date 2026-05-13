import type { Database } from "bun:sqlite";
import type { AdapterOutput, ColumnMeta, IngestOptions, IngestResult, Inferred } from "./types";

const NULL_PATTERN = /^(null|N\/A|NaN|none|-)$/i;

export async function rowsToSqlite(
  db: Database,
  input: AdapterOutput,
  options: IngestOptions,
): Promise<IngestResult> {
  const {
    tableName,
    sampleSize = 10,
    scanSize = 50000,
    batchSize = 5000,
    strict = false,
  } = options;

  const startTime = Date.now();
  const warnings: string[] = [];
  const { rows, columnNames } = input;

  if (rows.length === 0) {
    throw new Error("No rows to import");
  }

  const rowCount = rows.length;
  const scanLimit = scanSize === Infinity ? rowCount : Math.min(scanSize, rowCount);
  const sampleRows: Record<string, string | null>[] = [];

  // === Pass 1: Initialize column tracking ===
  const columns: ColumnMeta[] = columnNames.map((name) => ({
    name,
    type: "TEXT" as const,
    inferred: "BOOLEAN" as const,
    description: "",
    sampleValues: [],
    isDate: true,
    nullCount: 0,
    cardinality: 0,
    rowCount,
  }));

  const uniqueSets: Set<string>[] = columnNames.map(() => new Set());
  const colIndexMap = new Map(columnNames.map((n, i) => [n, i]));

  // === Pass 1: Scan rows for inference ===
  for (let i = 0; i < rowCount; i++) {
    const row = rows[i]!;

    if (i < sampleSize) {
      const sampleRow: Record<string, string | null> = {};
      for (const name of columnNames) {
        const val = row[name];
        sampleRow[name] = toSampleValue(val);
      }
      sampleRows.push(sampleRow);
    }

    for (let c = 0; c < columnNames.length; c++) {
      const colName = columnNames[c]!;
      const col = columns[c]!;
      const val = row[colName];

      if (isNullish(val)) {
        col.nullCount++;
        continue;
      }

      const strVal = typeof val === "string" ? val : String(val);
      uniqueSets[c]!.add(strVal);

      if (i < scanLimit && col.sampleValues.length < 10 && !col.sampleValues.includes(strVal)) {
        col.sampleValues.push(strVal);
      }

      if (i < scanLimit && col.inferred !== "TEXT" && col.inferred !== "JSON") {
        col.inferred = processValue(col.inferred, val);
      }

      if (col.isDate) {
        col.isDate = checkIsDate(val, strVal);
      }
    }
  }

  // Finalize metadata
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c]!;
    col.cardinality = uniqueSets[c]!.size;
    if (col.nullCount === col.rowCount) {
      col.isDate = false;
      col.inferred = "TEXT";
    }
    col.description = buildDescription(col);
  }

  // === Pass 2: Schema ===
  const colIdentifiers = columnNames.map((n) => `"${n}" TEXT`).join(", ");
  db.run(`DROP TABLE IF EXISTS "${tableName}"`);
  db.run(`CREATE TABLE "${tableName}" (${colIdentifiers})`);

  const placeholders = columnNames.map(() => "?").join(", ");
  const insertStmt = db.prepare(
    `INSERT INTO "${tableName}" VALUES (${placeholders})`,
  );

  const columnsForInsert = columns;

  const insertTransaction = db.transaction((batch: (string | null)[][]) => {
    for (const vals of batch) {
      insertStmt.run(...vals);
    }
  });

  // === Pass 3: Batch insert ===
  let batch: (string | null)[][] = [];
  let importedCount = 0;

  for (let i = 0; i < rowCount; i++) {
    const row = rows[i]!;
    const vals = columnNames.map((colName, c) => {
      const colMeta = columnsForInsert[c]!;
      let val = row[colName];

      if (colMeta.isDate && typeof val === "string" && val !== "" && !NULL_PATTERN.test(val)) {
        const d = Date.parse(val);
        if (!isNaN(d)) {
          val = new Date(d).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
        }
      }

      return toDbValue(val);
    });

    batch.push(vals);
    importedCount++;

    if (batch.length >= batchSize) {
      insertTransaction(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    insertTransaction(batch);
  }

  return {
    tableName,
    rowCount: importedCount,
    columns,
    sampleRows,
    warnings,
    elapsedMs: Date.now() - startTime,
  };
}

// ===== Value helpers =====

function isNullish(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string") {
    const s = val.trim();
    return s === "" || NULL_PATTERN.test(s);
  }
  return false;
}

function toSampleValue(val: unknown): string | null {
  if (isNullish(val)) return null;
  if (typeof val === "string") return val;
  return String(val);
}

function checkIsDate(val: unknown, strVal: string): boolean {
  if (isNullish(val)) return true; // null doesn't break date assumption
  if (typeof val !== "string") return false;
  if (!strVal.includes("-") && !strVal.includes("/") && !strVal.includes(":")) {
    return false;
  }
  if (isNaN(Date.parse(strVal))) return false;
  return true;
}

function toDbValue(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return JSON.stringify(val); // object/array
}

// ===== Type inference =====

function processValue(current: Inferred, val: unknown): Inferred {
  if (isNullish(val)) return current;

  const valType = typeof val;

  if (valType === "string") {
    const s = val as string;
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        JSON.parse(s);
        return current === "JSON" ? "JSON" : "TEXT";
      } catch {
        // fall through
      }
    }
    if (current === "JSON") return "TEXT";
    return updateLevel(current, s);
  }

  if (valType === "number") {
    if (current === "BOOLEAN") {
      const num = val as number;
      if (num === 0 || num === 1) return "BOOLEAN";
      return Number.isInteger(num) ? "INTEGER" : "REAL";
    }
    if (current === "INTEGER") {
      return Number.isInteger(val as number) ? "INTEGER" : "REAL";
    }
    if (current === "REAL") return "REAL";
    return Number.isInteger(val as number) ? "INTEGER" : "REAL";
  }

  if (valType === "boolean") {
    if (current === "BOOLEAN") return "BOOLEAN";
    return "TEXT";
  }

  if (valType === "object") {
    if (current === "JSON") return "JSON";
    return "TEXT";
  }

  return current;
}

function updateLevel(
  current: "BOOLEAN" | "INTEGER" | "REAL" | "TEXT",
  val: string,
): "BOOLEAN" | "INTEGER" | "REAL" | "TEXT" {
  if (current === "BOOLEAN") {
    if (/^(true|false|yes|no)$/i.test(val)) return "BOOLEAN";
    current = "INTEGER";
  }

  if (current === "INTEGER") {
    if (/^-?\d+$/.test(val)) return "INTEGER";
    if (/^(true|false|yes|no)$/i.test(val)) return "TEXT";
    if (/^-?\d+(\.\d+)?$/.test(val)) return "REAL";
    return "TEXT";
  }

  if (current === "REAL") {
    if (/^-?\d+(\.\d+)?$/.test(val)) return "REAL";
    return "TEXT";
  }

  return "TEXT";
}

// ===== Description building =====

function buildDescription(col: ColumnMeta): string {
  const parts: string[] = [];

  if (col.nullCount > 0) {
    const pct = ((col.nullCount / col.rowCount) * 100).toFixed(0);
    parts.push(`${pct}% missing`);
  }

  switch (col.inferred) {
    case "BOOLEAN":
      parts.unshift("Likely Boolean (true/false)");
      break;
    case "INTEGER":
      parts.unshift("Integer values");
      break;
    case "REAL":
      parts.unshift("Floating point numbers");
      break;
    case "JSON":
      parts.unshift("JSON string");
      break;
    case "TEXT": {
      if (col.isDate) {
        parts.unshift("Date values");
      } else if (col.cardinality <= 20 && col.cardinality > 0) {
        parts.unshift(`Categorical (${col.cardinality} unique values)`);
      } else if (col.sampleValues.length > 0) {
        parts.unshift("Text values");
      } else {
        parts.unshift("All null");
      }
      break;
    }
  }

  return parts.join(", ");
}