import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { Database } from "bun:sqlite";

export function exportTableToCsv(
  db: Database,
  tableName: string,
  outputPath: string,
): void {
  const absPath = path.resolve(outputPath);
  const dir = path.dirname(absPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const rows = db.query(`SELECT * FROM "${tableName}"`).all() as Record<
    string,
    unknown
  >[];

  const columns =
    rows.length > 0
      ? Object.keys(rows[0]!)
      : (
          db
            .query(`PRAGMA table_info("${tableName}")`)
            .all() as { name: string }[]
        ).map((c) => c.name);

  const lines: string[] = [];
  lines.push(columns.map(escapeCsv).join(","));

  for (const row of rows) {
    const values = columns.map((col) => {
      const val = row[col];
      return escapeCsv(val == null ? "" : String(val));
    });
    lines.push(values.join(","));
  }

  Bun.write(absPath, lines.join("\n") + "\n");
}

function escapeCsv(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}