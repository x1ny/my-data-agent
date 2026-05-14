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
    "你是一个专业的文档分析助手。请根据提供的文档内容，准确、简洁地回答用户问题。",
  );
  lines.push("");

  if (documents.length > 0) {
    lines.push("## 可用文档");
    lines.push("");

    for (let d = 0; d < documents.length; d++) {
      const doc = documents[d]!;

      lines.push(`### 文档: ${doc.name}`);
      lines.push(`- 类型: ${doc.documentType}`);
      lines.push(`- 全文摘要: ${doc.summary}`);

      if (doc.segments.length > 0) {
        lines.push("- 分段:");
        lines.push("  | 段 | 字符范围 | 摘要 |");
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
    lines.push("## 背景知识");
    lines.push("");
    lines.push(knowledge);
    lines.push("");
  }

  lines.push("## 工具");
  lines.push("");
  lines.push(
    "- read_document: 阅读文档的指定字符范围。查看分段表中的字符范围来定位。",
  );
  lines.push("- search_document: 用正则搜索文档内容。");
  lines.push(
    "- write_notebook: 写入你的分析规划、推理过程、关键发现。请在开始分析前先写入初步规划。",
  );
  lines.push("- read_notebook: 读取你的推理笔记。");
  lines.push("");

  lines.push("## 要求");
  lines.push("");
  lines.push("- 回答要简洁、准确，直接回应问题");
  lines.push("- 不要输出无关内容");
  lines.push("- 先思考规划并写入notebook，再具体分析文档");

  return lines.join("\n");
}