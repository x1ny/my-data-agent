import type { Database } from "bun:sqlite";
import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import { createReadStream } from "node:fs";

export interface ColumnMeta {
  name: string;
  type: "TEXT";
  inferred: "BOOLEAN" | "INTEGER" | "REAL" | "TEXT";
  description: string;
  sampleValues: string[];
  isDate?: boolean;
  nullCount: number;
  cardinality: number;
  rowCount: number;
}

export interface CsvToSqliteOptions {
  delimiter?: string;
  sampleSize?: number;
  scanSize?: number;
  batchSize?: number;
  strict?: boolean;
}

export interface CsvToSqliteResult {
  tableName: string;
  rowCount: number;
  columns: ColumnMeta[];
  sampleRows: Record<string, string | null>[];
  warnings: string[];
  elapsedMs: number;
}

const NULL_PATTERN = /^(null|N\/A|NaN|none|-)$/i;

export async function csvToSqlite(
  db: Database,
  csvPath: string,
  tableName: string,
  options: CsvToSqliteOptions = {},
): Promise<CsvToSqliteResult> {
  const {
    delimiter = ",",
    sampleSize = 10,
    scanSize = 50000,
    batchSize = 5000,
    strict = false,
  } = options;

  const startTime = Date.now();
  const warnings: string[] = [];

  // ========== Pass 1: Type inference ==========
  const rawContent = await Bun.file(csvPath).text();

  const allRows = parseSync(rawContent, {
    columns: true,
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (allRows.length === 0) {
    throw new Error("CSV file is empty");
  }

  const colNames = Object.keys(allRows[0]!);
  const rowCount = allRows.length;
  const scanLimit = scanSize === Infinity ? rowCount : Math.min(scanSize, rowCount);

  const sampleRows: Record<string, string | null>[] = [];

  const columns: ColumnMeta[] = colNames.map((name) => ({
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

  const uniqueSets: Set<string>[] = colNames.map(() => new Set());

  for (let i = 0; i < rowCount; i++) {
    const row = allRows[i]!;

    if (i < sampleSize) {
      const sampleRow: Record<string, string | null> = {};
      for (const col of columns) {
        const val = rawValue(row[col.name]);
        sampleRow[col.name] = (val === "" || NULL_PATTERN.test(val)) ? null : val;
      }
      sampleRows.push(sampleRow);
    }

    for (let c = 0; c < columns.length; c++) {
      const col = columns[c]!;
      const val = rawValue(row[col.name]);

      if (val === "" || NULL_PATTERN.test(val)) {
        col.nullCount++;
        continue;
      }

      uniqueSets[c]!.add(val);

      if (i < scanLimit && col.sampleValues.length < 10 && !col.sampleValues.includes(val)) {
        col.sampleValues.push(val);
      }

      if (i < scanLimit && col.inferred !== "TEXT") {
        col.inferred = updateLevel(col.inferred, val);
      }

      if (col.isDate) {
        if (!val.includes("-") && !val.includes("/") && !val.includes(":")) {
          col.isDate = false;
        } else if (isNaN(Date.parse(val))) {
          col.isDate = false;
        }
      }
    }
  }

  for (let c = 0; c < columns.length; c++) {
    const col = columns[c]!;
    col.cardinality = uniqueSets[c]!.size;
    col.description = buildDescription(col);
  }

  // ========== Pass 2 & 3: Schema + Stream import ==========
  const colIdentifiers = columns.map((col) => `"${col.name}" TEXT`).join(", ");
  db.run(`DROP TABLE IF EXISTS "${tableName}"`);
  db.run(`CREATE TABLE "${tableName}" (${colIdentifiers})`);

  const placeholders = columns.map(() => "?").join(", ");
  const insertStmt = db.prepare(
    `INSERT INTO "${tableName}" VALUES (${placeholders})`,
  );

  const insertTransaction = db.transaction((rows: (string | null)[][]) => {
    for (const vals of rows) {
      insertStmt.run(...vals);
    }
  });

  return new Promise((resolve, reject) => {
    const parser = createReadStream(csvPath).pipe(
      parse({
        columns: true,
        delimiter,
        skip_empty_lines: true,
        relax_column_count: true,
      }),
    );

    let batch: (string | null)[][] = [];
    let importedCount = 0;

    parser.on("data", (row: Record<string, string>) => {
      const vals = columns.map((col) => {
        let val: string | null = rawValue(row[col.name] ?? "");

        if (val === "" || NULL_PATTERN.test(val)) {
          return null;
        }

        if (col.isDate) {
          const d = Date.parse(val);
          if (!isNaN(d)) {
            const iso = new Date(d).toISOString();
            val = iso.replace("T", " ").replace(/\.\d{3}Z$/, "");
          }
        }

        return val;
      });

      batch.push(vals);
      importedCount++;

      if (batch.length >= batchSize) {
        insertTransaction(batch);
        batch = [];
      }
    });

    parser.on("end", () => {
      if (batch.length > 0) {
        insertTransaction(batch);
      }

      resolve({
        tableName,
        rowCount: importedCount,
        columns,
        sampleRows,
        warnings,
        elapsedMs: Date.now() - startTime,
      });
    });

    parser.on("error", (err: Error) => {
      if (strict) {
        reject(err);
      } else {
        warnings.push(`Import error: ${err.message}`);
        resolve({
          tableName,
          rowCount: importedCount,
          columns,
          sampleRows,
          warnings,
          elapsedMs: Date.now() - startTime,
        });
      }
    });
  });
}

function rawValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
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