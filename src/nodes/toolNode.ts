import { ToolMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ToolRegistry } from "../tools/registry";

export async function toolNode(
  state: any,
  config?: RunnableConfig,
) {
  const registry = config?.configurable?.registry as ToolRegistry;

  const messages = state.messages as AIMessage[];
  const lastMessage = messages[messages.length - 1] as AIMessage | undefined;

  if (!lastMessage || !Array.isArray(lastMessage.tool_calls) || lastMessage.tool_calls.length === 0) {
    return { messages: [] };
  }

  const toolMessages: ToolMessage[] = [];
  let observation = "";

  for (const toolCall of lastMessage.tool_calls) {
    const tool = registry.get(toolCall.name);
    if (!tool) {
      toolMessages.push(
        new ToolMessage({
          content: `Error: Tool "${toolCall.name}" not found`,
          tool_call_id: toolCall.id ?? "",
        }),
      );
      continue;
    }

    try {
      const result = await tool.execute(toolCall.args);
      observation += (observation ? "\n" : "") + result;
      toolMessages.push(
        new ToolMessage({
          content: result,
          tool_call_id: toolCall.id ?? "",
        }),
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      observation += (observation ? "\n" : "") + `Error: ${errMsg}`;
      toolMessages.push(
        new ToolMessage({
          content: `Error: ${errMsg}`,
          tool_call_id: toolCall.id ?? "",
        }),
      );
    }
  }

  const steps = [...state.steps];
  if (steps.length > 0) {
    steps[steps.length - 1] = {
      ...steps[steps.length - 1],
      observation,
    };
  }

  return {
    messages: toolMessages,
    steps,
  };
}