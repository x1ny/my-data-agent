import { z } from "zod";
import type { Tool } from "./types";

export interface DocumentEntry {
  name: string;
  content: string;
}

interface SearchMatch {
  startIndex: number;
  endIndex: number;
  text: string;
}

function findDoc(docs: DocumentEntry[], docName: string): DocumentEntry {
  const doc = docs.find((d) => d.name === docName);
  if (!doc) {
    throw new Error(
      `Document "${docName}" not found. Available: ${docs.map((d) => d.name).join(", ")}`,
    );
  }
  return doc;
}

export function createDocumentTools(docs: DocumentEntry[]): Tool[] {
  const readDocSchema = z.object({
    doc_name: z.string().describe("Name of the document to read"),
    start: z
      .number()
      .int()
      .min(0)
      .describe("Start character index (inclusive)"),
    end: z
      .number()
      .int()
      .min(0)
      .describe("End character index (exclusive)"),
  });

  const readTool: Tool = {
    name: "read_document",
    description:
      "Read a range of text from a document. Provide doc_name, start index (inclusive) and end index (exclusive). Returns the plain text from start to end-1. Out-of-range indices are automatically clamped.",
    schema: readDocSchema,
    execute: async ({ doc_name, start, end }) => {
      const doc = findDoc(docs, doc_name);
      const len = doc.content.length;

      if (start >= len) {
        return `[INFO] Start index ${start} exceeds document length ${len}. Document has ${len} characters total.`;
      }

      const clampedEnd = Math.min(end, len);
      const text = doc.content.slice(start, clampedEnd);

      const truncated =
        end > len ? `\n\n[NOTE] End index ${end} exceeds document end, clamped to ${len}.` : "";

      return text + truncated;
    },
  };

  const searchDocSchema = z.object({
    doc_name: z.string().describe("Name of the document to search"),
    pattern: z.string().describe("Regular expression pattern"),
  });

  const searchTool: Tool = {
    name: "search_document",
    description:
      "Search a document using a regular expression. Provide doc_name and a regex pattern. Returns all matches with their startIndex, endIndex and matched text as a JSON array.",
    schema: searchDocSchema,
    execute: async ({ doc_name, pattern }) => {
      const doc = findDoc(docs, doc_name);
      let regex: RegExp;

      try {
        regex = new RegExp(pattern, "g");
      } catch {
        return `[ERROR] Invalid regular expression: "${pattern}"`;
      }

      const matches: SearchMatch[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(doc.content)) !== null) {
        matches.push({
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          text: match[0],
        });
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }

      if (matches.length === 0) {
        return `[INFO] No matches found for pattern "${pattern}".`;
      }

      return JSON.stringify(matches, null, 2);
    },
  };

  return [readTool, searchTool];
}