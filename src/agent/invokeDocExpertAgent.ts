import { createAgent } from "./createAgent";
import { createDocumentTools, type DocumentEntry } from "./createDocumentTools";
import { createNotebookTools } from "./notebookTool";
import type { AgentStep } from "./types";

export interface DocSegment {
  summary: string;
  start: number;
  end: number;
}

export interface DocDocument {
  name: string;
  summary: string;
  documentType: string;
  segments: DocSegment[];
  content: string;
}

export interface DocExpertParams {
  documents: DocDocument[];
  knowledge?: string;
  question: string;
  maxIterations?: number;
  temperature?: number;
  onStep?: (step: AgentStep) => void;
}

export interface DocExpertResult {
  answer: string;
  notebook: string;
  steps: AgentStep[];
}

export async function invokeDocExpertAgent(
  params: DocExpertParams,
): Promise<DocExpertResult> {
  const { documents, knowledge, question, maxIterations, temperature, onStep } =
    params;

  const docEntries: DocumentEntry[] = documents.map((doc) => ({
    name: doc.name,
    content: doc.content,
  }));

  const docTools = createDocumentTools(docEntries);
  const { readNotebook, writeNotebook } = createNotebookTools();

  const systemPrompt = buildDocSystemPrompt(documents, knowledge);

  const agent = createAgent({
    tools: [...docTools, readNotebook, writeNotebook],
    systemPrompt,
    maxIterations: maxIterations ?? 30,
    temperature: temperature ?? 0,
    onStep,
  });

  const { finalAnswer, steps } = await agent.invoke(question);

  const notebook: string = await readNotebook.execute({});

  return { answer: finalAnswer, notebook, steps };
}

function buildDocSystemPrompt(
  documents: DocDocument[],
  knowledge?: string,
): string {
  const lines: string[] = [];

  lines.push(
    "You are a professional document analysis assistant. Please provide accurate and concise answers to user questions based on the content of the provided documents.",
  );
  lines.push("");

  if (documents.length > 0) {
    lines.push("## Available Documents");
    lines.push("");

    for (let d = 0; d < documents.length; d++) {
      const doc = documents[d]!;

      lines.push(`### Document: ${doc.name}`);
      lines.push(`- Type: ${doc.documentType}`);
      lines.push(`- Full Text Summary: ${doc.summary}`);

      if (doc.segments.length > 0) {
        lines.push("- Segments:");
        lines.push("  | Segment | Character Range | Summary |");
        lines.push("  |----|----------|------|");
        for (const seg of doc.segments) {
          lines.push(
            `  | ${seg.start}-${seg.end} | ${seg.summary}`,
          );
        }
      }

      lines.push("");
    }
  }

  if (knowledge) {
    lines.push("## Background Knowledge");
    lines.push("");
    lines.push(knowledge);
    lines.push("");
  }

  lines.push("## Tools");
  lines.push("");
  lines.push(
    "- read_document: Read the any specified character range of the document. View the character range in the segment table to locate.",
  );
  lines.push("- search_document: Use regular expressions to search the document content.");
  lines.push(
    "- write_notebook: Write your analysis plan, reasoning process, and key findings. Please write the preliminary plan before starting the analysis.",
  );
  lines.push("- read_notebook: Read your reasoning notebook.");
  lines.push("");

  lines.push("## Requirements");
  lines.push("");
  lines.push("- Answer should be concise, accurate, and directly respond to the question");
  lines.push("- Do not output irrelevant content");
  lines.push("- First think about planning and write into the notebook, then analyze the documents in detail");

  lines.push("### Tool Usage Strategy:");
  lines.push("1. **Initial Planning**: First, write your overall plan in the notebook.");
  lines.push("2. **Reading First**: Prioritize using `read_document` to read large sections (up to 10,000 characters per call). This is the preferred way to understand the content.");
  lines.push("3. **Iterative Reading**: If the answer is not in the first chunk, continue reading subsequent chunks.");
  lines.push("4. **Regex as Fallback**: Use `search_document` only when you need to locate specific keywords across a vast document or after initial broad reading fails to pinpoint the answer.");

  return lines.join("\n");
}