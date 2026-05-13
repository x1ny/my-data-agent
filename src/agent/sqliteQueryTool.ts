import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { Tool } from "./types";

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_MAX_COLS = 20;
const DEFAULT_MAX_CELL = 500;

export function createSqliteQueryTool(db: Database): Tool {
  return {
    name: "query_sqlite",
    description:
      "Execute a SQL statement against the SQLite database. " +
      "Supports all SQL: SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, PRAGMA, etc. " +
      "SELECT results are auto-limited to 1000 rows unless you specify a LIMIT. " +
      "All table and column names must be wrapped in double quotes if they contain spaces or special characters.",
    schema: z.object({
      sql: z.string().describe("A SQL statement to execute"),
    }),
    execute: async ({ sql }) => {
      return executeSql(db, sql);
    },
  };
}

function executeSql(db: Database, sql: string): string {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  const isWrite =
    upper.startsWith("INSERT") ||
    upper.startsWith("UPDATE") ||
    upper.startsWith("DELETE") ||
    upper.startsWith("CREATE") ||
    upper.startsWith("DROP") ||
    upper.startsWith("ALTER");

  const startTime = Date.now();

  if (isWrite) {
    let stmt;
    try {
      stmt = db.prepare(trimmed);
    } catch (err) {
      return formatError(err instanceof Error ? err.message : String(err));
    }

    try {
      stmt.run();
    } catch (err) {
      return formatError(err instanceof Error ? err.message : String(err));
    }

    const elapsed = Date.now() - startTime;
    return `[OK] Statement executed in ${elapsed}ms`;
  }

  // Read operations
  let stmt;
  try {
    stmt = db.prepare(trimmed);
  } catch (err) {
    return formatError(err instanceof Error ? err.message : String(err));
  }

  let rows: unknown[];
  try {
    rows = stmt.all();
  } catch (err) {
    return formatError(err instanceof Error ? err.message : String(err));
  }

  const elapsed = Date.now() - startTime;

  if (rows.length === 0) {
    return `[OK] 0 rows in ${elapsed}ms\n\n(empty result set)`;
  }

  let truncated = false;
  let totalRows = rows.length;
  if (totalRows > DEFAULT_MAX_ROWS && !upper.includes("LIMIT")) {
    rows = rows.slice(0, DEFAULT_MAX_ROWS);
    truncated = true;
  }

  const columns = Object.keys(rows[0] as object);
  let displayCols = columns;
  let colsTruncated = false;

  if (columns.length > DEFAULT_MAX_COLS) {
    displayCols = columns.slice(0, DEFAULT_MAX_COLS);
    colsTruncated = true;
  }

  const widths = displayCols.map((col) => {
    let max = col.length;
    for (const row of rows) {
      const val = String((row as any)[col] ?? "NULL");
      max = Math.max(max, Math.min(val.length, DEFAULT_MAX_CELL));
    }
    return max + 2;
  });

  const header =
    "| " +
    displayCols.map((col, i) => padRight(col, widths[i]! - 2)).join(" | ") +
    " |";
  const sep =
    "|" +
    displayCols.map((_, i) => "-".repeat(widths[i]!)).join("|") +
    "|";

  const rowLines: string[] = [];
  for (const row of rows) {
    const cells = displayCols.map((col, i) => {
      let val = String((row as any)[col] ?? "NULL");
      if (val.length > DEFAULT_MAX_CELL) {
        val = val.slice(0, DEFAULT_MAX_CELL - 3) + "...";
      }
      return padRight(val, widths[i]! - 2);
    });
    rowLines.push("| " + cells.join(" | ") + " |");
  }

  const parts: string[] = [];
  parts.push(`[OK] ${totalRows} rows in ${elapsed}ms`);
  parts.push("");
  parts.push(header);
  parts.push(sep);
  parts.push(...rowLines);

  if (colsTruncated) {
    parts.push("");
    parts.push(
      `Notice: Showing ${displayCols.length} of ${columns.length} columns. Use specific column names in SELECT.`,
    );
  }

  if (truncated) {
    parts.push("");
    parts.push(
      `Notice: Result auto-limited to ${DEFAULT_MAX_ROWS} rows. Add LIMIT/OFFSET to navigate.`,
    );
  }

  return parts.join("\n");
}

function formatError(message: string): string {
  const lines = [`[ERROR] ${message}`];

  if (message.includes("no such column")) {
    const match = message.match(/no such column: (\S+)/);
    if (match) {
      lines.push(
        `\nHint: Column "${match[1]}" does not exist. Check spelling or use PRAGMA table_info to list columns.`,
      );
    }
  }
  if (message.includes("no such table")) {
    const match = message.match(/no such table: (\S+)/);
    if (match) {
      lines.push(
        `\nHint: Table "${match[1]}" does not exist. Use "SELECT name FROM sqlite_master WHERE type='table'" to list available tables.`,
      );
    }
  }

  return lines.join("\n");
}

function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}