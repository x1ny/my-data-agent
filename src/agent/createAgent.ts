import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ToolRegistry } from "./registry";
import { buildGraph } from "./graph";
import type { CreateAgentConfig, AgentRuntime } from "./types";

const answerTool = {
  name: "answer",
  description: "Provide the final answer to the user. Call this tool when you have completed your analysis and are ready to output the result.",
  schema: z.object({
    content: z.string().describe("The final answer to the user's question"),
  }),
  execute: async ({ content }: { content: string }) => content,
};

export function createAgent(config: CreateAgentConfig): AgentRuntime {
  const registry = new ToolRegistry();
  registry.register(answerTool);
  for (const tool of config.tools) {
    registry.register(tool);
  }

  const graph = buildGraph(registry);
  const compiledGraph = graph.compile();

  const invoke: AgentRuntime["invoke"] = async (userMessage) => {
    const result = await compiledGraph.invoke(
      { messages: [new HumanMessage(userMessage)] },
      {
        recursionLimit: (config.maxIterations ?? 10) * 2 + 5,
        configurable: {
          systemPrompt: config.systemPrompt,
          maxIterations: config.maxIterations ?? 10,
          temperature: config.temperature ?? 0,
          onStep: config.onStep,
          registry,
        },
      },
    );

    return {
      finalAnswer: result.finalAnswer ?? "",
      steps: result.steps ?? [],
    };
  };

  return { invoke };
}