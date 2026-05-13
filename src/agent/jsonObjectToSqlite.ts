import type { Database } from "bun:sqlite";
import { flattenObject } from "./flattenObject";
import { rowsToSqlite } from "./rowsToSqlite";
import type { DataRow, FlattenOptions, IngestOptions, IngestResult } from "./types";

export interface JsonObjectToSqliteOptions extends IngestOptions {
  flatten?: FlattenOptions;
}

export async function jsonObjectToSqlite(
  db: Database,
  records: Record<string, unknown>[],
  options: JsonObjectToSqliteOptions,
): Promise<IngestResult> {
  const { flatten, ...ingestOptions } = options;

  if (!Array.isArray(records)) {
    throw new Error("records must be an array of objects");
  }

  if (records.length === 0) {
    throw new Error("No records to import");
  }

  // Flatten + schema merge
  const flatRows: DataRow[] = [];
  const columnSet = new Set<string>();

  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;

    const flat = flattenObject(record, flatten ?? {});
    flatRows.push(flat);

    for (const key of Object.keys(flat)) {
      columnSet.add(key);
    }
  }

  const columnNames = Array.from(columnSet);

  return rowsToSqlite(
    db,
    { rows: flatRows, columnNames },
    ingestOptions,
  );
}