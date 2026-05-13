import type { z } from "zod";

export interface Tool<TSchema extends z.ZodSchema = z.ZodSchema> {
  name: string;
  description: string;
  schema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<string>;
}

export interface AgentStep {
  iteration: number;
  thought: string;
  action?: {
    tool: string;
    input: Record<string, unknown>;
  };
  observation?: string;
}

export interface CreateAgentConfig {
  tools: Tool[];
  systemPrompt: string;
  maxIterations?: number;
  temperature?: number;
  onStep?: (step: AgentStep) => void;
}

export interface AgentResult {
  finalAnswer: string;
  steps: AgentStep[];
}

export interface AgentRuntime {
  invoke: (userMessage: string) => Promise<AgentResult>;
}

// === Data Ingestion Types ===

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