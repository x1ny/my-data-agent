import OpenAI from "openai";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { AgentStep } from "../types";
import type { ToolRegistry } from "../tools/registry";

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
  baseURL: process.env["OPENAI_BASE_URL"],
});

const MODEL = process.env["OPENAI_MODEL"] || "gpt-4o-mini";

function getContentText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

export async function llmNode(
  state: any,
  config?: RunnableConfig,
) {
  const systemPrompt = config?.configurable?.systemPrompt as string;
  const temperature = (config?.configurable?.temperature as number) ?? 0;
  const onStep = config?.configurable?.onStep as
    | ((step: AgentStep) => void)
    | undefined;
  const registry = config?.configurable?.registry as ToolRegistry;

  const toolDefs = registry.getToolDefs();

  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of state.messages) {
    const type = msg.getType();
    const content = getContentText(msg.content);

    switch (type) {
      case "human":
        openaiMessages.push({ role: "user", content });
        break;
      case "ai": {
        const entry: any = { role: "assistant", content };
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          entry.tool_calls = msg.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          }));
        }
        openaiMessages.push(entry);
        break;
      }
      case "tool":
        openaiMessages.push({
          role: "tool",
          content,
          tool_call_id: msg.tool_call_id,
        });
        break;
    }
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: openaiMessages,
    tools: toolDefs.length > 0 ? (toolDefs as any) : undefined,
    temperature,
  });

  const choice = response.choices[0];
  if (!choice) {
    throw new Error("No response from LLM");
  }

  const message = choice.message;
  const iteration = state.iteration + 1;

  const step: AgentStep = {
    iteration,
    thought: message.content || "",
  };

  if (message.tool_calls && message.tool_calls.length > 0) {
    const tc = message.tool_calls[0]!;
    const func = "function" in tc ? tc.function : undefined;
    if (func) {
      step.action = {
        tool: func.name,
        input: JSON.parse(func.arguments),
      };
    }
  }

  const aiMessage = new AIMessage({
    content: message.content || "",
    tool_calls:
      message.tool_calls?.flatMap((tc) => {
        if (!("function" in tc)) return [];
        return [
          {
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        ];
      }) ?? [],
  });

  const loopActive = !!(message.tool_calls && message.tool_calls.length > 0);

  const newSteps = [...state.steps, step];

  if (onStep) {
    onStep(step);
  }

  return {
    messages: [aiMessage],
    steps: newSteps,
    iteration,
    loopActive,
  };
}