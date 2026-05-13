import type { IngestResult } from "../agent/types";

export function formatIngestResult(result: IngestResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`Table: "${result.tableName}"  |  ${result.rowCount} rows  |  ${result.elapsedMs}ms`);

  // Column metadata
  lines.push("");
  lines.push("Columns:");
  lines.push("");

  if (result.columns.length === 0) {
    lines.push("  (none)");
  } else {
    const header = "| Name | Type | Description |";
    const sep = "|------|------|-------------|";
    lines.push(header);
    lines.push(sep);

    for (const col of result.columns) {
      const flags: string[] = [];
      if (col.isDate) flags.push("DATE");
      const typeStr = col.inferred + (flags.length > 0 ? " " + flags.join(",") : "");
      lines.push(
        `| ${col.name} | ${padRight(typeStr, 18)} | ${col.description} |`,
      );
    }
  }

  // Sample rows
  lines.push("");
  lines.push(
    `Sample rows (${result.sampleRows.length}):`,
  );

  if (result.sampleRows.length > 0) {
    const cols = Object.keys(result.sampleRows[0]!);
    const widths = cols.map((col) => {
      let max = col.length;
      for (const row of result.sampleRows) {
        const val = String(row[col] ?? "NULL");
        max = Math.max(max, val.length);
      }
      return max + 2;
    });

    lines.push("");

    // Header
    const header =
      "| " +
      cols.map((col, i) => padRight(col, widths[i]! - 2)).join(" | ") +
      " |";
    const sep =
      "|" +
      widths.map((w) => "-".repeat(w)).join("|") +
      "|";

    lines.push(header);
    lines.push(sep);

    for (const row of result.sampleRows) {
      const cells = cols.map((col, i) => {
        const val = String(row[col] ?? "NULL");
        return padRight(val, widths[i]! - 2);
      });
      lines.push("| " + cells.join(" | ") + " |");
    }
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of result.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  return lines.join("\n");
}

function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}