import OpenAI from "openai";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { AgentStep } from "./types";
import type { ToolRegistry } from "./registry";

const openai = new OpenAI({
  apiKey: process.env["MODEL_API_KEY"],
  baseURL: process.env["MODEL_API_URL"],
});

const MODEL = process.env["MODEL_NAME"] || "gpt-4o-mini";

function getContentText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

const XML_PATTERN = /<tool_call>[\s\S]*?<\/tool_call>/;

const RETRY_PROMPT = `You must respond by calling a tool. Use the \`<tool_call>\` format for each tool call, for example:
\`<tool_call><function=tool_name><parameter=param1>value1</parameter></function></tool_call>\`
If you are ready to provide the final answer, call the \`answer\` tool. Do not output plain text without a tool call.`;

async function callWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  maxRetries: number,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let response = await client.chat.completions.create(params);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const msg = response.choices[0]?.message;
    if (!msg) break;

    if (msg.tool_calls && msg.tool_calls.length > 0) return response;

    const text = (msg as any).reasoning_content || msg.content || "";
    const retryParams = {
      ...params,
      messages: [
        ...(params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]),
        { role: "assistant" as const, content: text },
        {
          role: "user" as const,
          content: RETRY_PROMPT,
        },
      ],
    };
    response = await client.chat.completions.create(retryParams);
  }

  const lastMsg = response.choices[0]?.message;
  if (lastMsg && (!lastMsg.tool_calls || lastMsg.tool_calls.length === 0)) {
    const text = lastMsg.content || (lastMsg as any).reasoning_content || "";
    const fallback = parseXmlToolCalls(text);
    if (fallback) {
      lastMsg.tool_calls = fallback;
    } else {
      throw new Error(
        "Agent failed to call a tool after retries. The model returned plain text without any tool call or valid `<tool_call>` XML.",
      );
    }
  }

  return response;
}

function parseXmlToolCalls(
  text: string,
): OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null {
  if (!XML_PATTERN.test(text)) return null;

  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
  const regex = new RegExp(XML_PATTERN.source, "g");
  let block: RegExpExecArray | null;
  let i = 0;

  while ((block = regex.exec(text)) !== null) {
    const b = block[0];

    const funcMatch = b.match(/<function=(\w+)>/);
    if (!funcMatch) continue;

    const funcName = funcMatch[1]!;
    const params: Record<string, string> = {};

    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramRegex.exec(b)) !== null) {
      params[pm[1]!] = pm[2]!.trim();
    }

    toolCalls.push({
      id: `call_xml_${Date.now()}_${i++}`,
      type: "function" as const,
      function: {
        name: funcName,
        arguments: JSON.stringify(params),
      },
    });
  }

  return toolCalls.length > 0 ? toolCalls : null;
}

export async function llmNode(state: any, config?: RunnableConfig) {
  const systemPrompt = config?.configurable?.systemPrompt as string;
  const temperature = (config?.configurable?.temperature as number) ?? 0.1;
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

  const response = await callWithRetry(
    openai,
    {
      model: MODEL,
      messages: openaiMessages,
      tools: toolDefs.length > 0 ? (toolDefs as any) : undefined,
      temperature,
    },
    5,
  );

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

  let toolCalls = message.tool_calls;

  if (toolCalls && toolCalls.length > 0) {
    const tc = toolCalls[0]!;
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
      toolCalls?.flatMap((tc) => {
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

  const newSteps = [...state.steps, step];

  if (onStep) {
    onStep(step);
  }

  return {
    messages: [aiMessage],
    steps: newSteps,
    iteration,
  };
}
