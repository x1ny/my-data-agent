import type { Database } from "bun:sqlite";
import { parse as parseSync } from "csv-parse/sync";
import { rowsToSqlite } from "./rowsToSqlite";
import type { IngestOptions, IngestResult } from "./types";

export interface CsvToSqliteOptions extends IngestOptions {
  delimiter?: string;
}

export async function csvToSqlite(
  db: Database,
  csvPath: string,
  options: CsvToSqliteOptions,
): Promise<IngestResult> {
  const { delimiter = ",", ...ingestOptions } = options;

  const raw = await Bun.file(csvPath).text();
  const rows = parseSync(raw, {
    columns: true,
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (rows.length === 0) {
    throw new Error("CSV file is empty");
  }

  const columnNames = Object.keys(rows[0]!);

  return rowsToSqlite(
    db,
    { rows, columnNames },
    ingestOptions,
  );
}