import { HumanMessage } from "@langchain/core/messages";
import { ToolRegistry } from "./registry";
import { buildGraph } from "./graph";
import type { CreateAgentConfig, AgentRuntime } from "./types";

export function createAgent(config: CreateAgentConfig): AgentRuntime {
  const registry = new ToolRegistry();
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

    const messages = result.messages;
    const lastMessage = messages[messages.length - 1];

    let finalAnswer = "";
    if (lastMessage) {
      finalAnswer =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
    }

    return {
      finalAnswer,
      steps: result.steps ?? [],
    };
  };

  return { invoke };
}