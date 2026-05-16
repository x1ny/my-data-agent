import OpenAI from "openai";
import type { SummarizeResult } from "./types";

const EMPTY_RESULT: SummarizeResult = {
  summary: "",
  documentType: "",
};

export async function summarizeDocument(
  content: string,
  maxRetries = 3,
): Promise<SummarizeResult> {
  const openai = new OpenAI({
    apiKey: process.env["MODEL_API_KEY"],
    baseURL: process.env["MODEL_API_URL"],
  });

  const model = process.env["MODEL_NAME"] || "gpt-4o-mini";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
             `You are a professional document summarization assistant. Your task is to analyze the provided document and return a concise summary in a strict JSON format.

The JSON object must contain exactly these fields:
1. "summary": A concise and comprehensive summary written in English (~250 words).
2. "documentType": The classification of the document (e.g., "Report", "Email", "Contract", "Research Paper", "News", "Dialogue Log").

Output only the raw JSON object. Do not include any introductory text, markdown formatting, or explanations.`,
          },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
        enable_thinking: false,
        temperature: 0,
      });

      const text = response.choices[0]?.message?.content;
      if (!text) {
        continue;
      }

      const parsed = JSON.parse(text) as SummarizeResult;


      return {
        summary: String(parsed.summary || ""),
        documentType: String(parsed.documentType || ""),
      };
    } catch {
      // retry
    }
  }

  return EMPTY_RESULT;
}