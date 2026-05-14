import OpenAI from "openai";
import type { RawSegment } from "./types";

declare module "openai" {
  namespace OpenAI {
    namespace Chat {
      interface ChatCompletionCreateParamsNonStreaming {
        enable_thinking?: boolean;
      }
      interface ChatCompletionCreateParamsStreaming {
        enable_thinking?: boolean;
      }
    }
  }
}

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
  baseURL: process.env["OPENAI_BASE_URL"],
});

const MODEL = process.env["OPENAI_MODEL"] || "gpt-4o-mini";

const SYSTEM_PROMPT = `You are a document segmentation expert. Split the provided text into semantic segments and return a JSON array of segments.

CRITICAL RULES:
1. Split at boundaries where the topic, focus, or logical direction clearly changes.
2. Return segments in the EXACT SAME ORDER as they appear in the text — do not reorder.
3. Segments MUST cover the ENTIRE text continuously from beginning to end with NO gaps.
4. Typically produce 3-5 segments per chunk, but adapt to the text's natural structure.
5. Each segment should aim for a length of 10,000 to 20,000 words.MUST not be less than 5,000 words.

For each segment, provide:
- "summary":A high-density, ultra-concise summary (max 30 words). Focus strictly on the "Core Event/Argument" and "Key Outcome." Strip all introductory phrases (e.g., "This section talks about...") and use telegraphic style to ensure maximum information with minimum words.
- "end_str": The LAST 15-30 words of this segment, COPIED VERBATIM from the original text. This is the most important field — it MUST be an exact substring matchable in the source text. Do NOT paraphrase, translate, rewrite, truncate, or modify it in any way. Include all punctuation, spaces, and line breaks exactly as they appear in the original. If the segment ends with a natural sentence boundary, "end_str" should include that final sentence or clause.

Return ONLY a JSON object in this exact format:
{"segments":[{"summary":"...","end_str":"..."},...]}`;

export async function extractSegments(
  chunkText: string,
  temperature: number,
  verbose: boolean,
): Promise<RawSegment[]> {
  if (verbose) {
    console.log(
      `  [SegmentExtractor] 调用LLM: 文本长度=${chunkText.length}, temperature=${temperature}`,
    );
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Split the following text into semantic segments:\n\n${chunkText}`,
      },
    ],
    enable_thinking: false,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response for segment extraction");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Failed to parse LLM response as JSON: ${content.slice(0, 200)}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("segments" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).segments)
  ) {
    throw new Error(
      `LLM response missing "segments" array: ${content.slice(0, 200)}`,
    );
  }

  const arr = (parsed as { segments: unknown[] }).segments;
  const segments: RawSegment[] = [];

  for (const item of arr) {
    if (
      typeof item === "object" &&
      item !== null &&
      "summary" in item &&
      "end_str" in item
    ) {
      const seg = item as { summary: string; end_str: string };
      segments.push({
        summary: String(seg.summary),
        end_str: String(seg.end_str),
      });
    }
  }

  return segments;
}
