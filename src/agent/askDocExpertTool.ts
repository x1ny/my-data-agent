import { z } from "zod";
import type { Tool } from "./types";
import { invokeDocExpertAgent, type DocDocument } from "./invokeDocExpertAgent";

export function createAskDocExpertTool(documents: DocDocument[], knowledge?: string): Tool {
  return {
    name: "ask_doc_expert",
    description:
      "Ask the document expert a question. The expert will read and search the provided documents to answer. " +
      "Use this when you need to find specific information, extract data points, or answer questions based on document content.",
    schema: z.object({
      question: z.string().describe("Question to ask the document expert"),
    }),
    execute: async ({ question }) => {
      const result = await invokeDocExpertAgent({
        documents,
        knowledge,
        question,
        maxIterations: 50,
        temperature: 0,
      });
      return result.answer;
    },
  };
}