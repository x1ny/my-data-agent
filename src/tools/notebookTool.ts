import { z } from "zod";
import type { Tool } from "../agent/types";

export interface NotebookTools {
  readNotebook: Tool;
  writeNotebook: Tool;
}

export function createNotebookTools(initialContent = ""): NotebookTools {
  let content = initialContent;

  const readNotebook: Tool = {
    name: "read_notebook",
    description: "Read the current contents of the notebook",
    schema: z.object({}),
    execute: async () => (content.length > 0 ? content : "(empty notebook)"),
  };

  const writeNotebook: Tool = {
    name: "write_notebook",
    description:
      "Write content to the notebook. Use 'overwrite' to replace everything, or 'append' to add to the end.",
    schema: z.object({
      content: z.string().describe("Content to write"),
      mode: z
        .enum(["overwrite", "append"])
        .describe("overwrite: replace all content; append: add to the end"),
    }),
    execute: async ({ content: c, mode }) => {
      if (mode === "overwrite") {
        content = c;
      } else {
        content = content + (content.length > 0 ? "\n" : "") + c;
      }
      return `[OK] ${mode === "overwrite" ? "Overwritten" : "Appended"} — ${content.length} chars total`;
    },
  };

  return { readNotebook, writeNotebook };
}