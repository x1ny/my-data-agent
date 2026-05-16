export type DataRow = Record<string, unknown>;

export type Inferred = "BOOLEAN" | "INTEGER" | "REAL" | "TEXT" | "JSON";

export interface ColumnMeta {
  name: string;
  type: "TEXT";
  inferred: Inferred;
  description: string;
  sampleValues: string[];
  isDate?: boolean;
  nullCount: number;
  cardinality: number;
  rowCount: number;
}

export interface AdapterOutput {
  rows: DataRow[];
  columnNames: string[];
}

export interface IngestOptions {
  tableName: string;
  sampleSize?: number;
  scanSize?: number;
  batchSize?: number;
  strict?: boolean;
}

export interface IngestResult {
  tableName: string;
  rowCount: number;
  columns: ColumnMeta[];
  sampleRows: Record<string, string | null>[];
  warnings: string[];
  elapsedMs: number;
}

export interface FlattenOptions {
  separator?: string;
  maxDepth?: number;
  arrayHandling?: "stringify" | "ignore";
}