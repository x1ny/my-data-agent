import { END, StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { llmNode } from "./llmNode";
import { toolNode } from "./toolNode";
import { shouldContinue } from "./shouldContinue";
import type { ToolRegistry } from "./registry";

export function buildGraph(registry: ToolRegistry) {
  const graph = new StateGraph(AgentState)
    .addNode("llmNode", llmNode)
    .addNode("toolNode", toolNode)
    .addEdge("__start__", "llmNode")
    .addConditionalEdges("llmNode", shouldContinue, {
      toolNode: "toolNode",
      [END]: END,
    })
    .addEdge("toolNode", "llmNode");

  return graph;
}