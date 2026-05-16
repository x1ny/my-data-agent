import type { z } from "zod";

export interface Tool<TSchema extends z.ZodSchema = z.ZodSchema> {
  name: string;
  description: string;
  schema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<string>;
}

export interface AgentStep {
  iteration: number;
  thought: string;
  action?: {
    tool: string;
    input: Record<string, unknown>;
  };
  observation?: string;
}

export interface CreateAgentConfig {
  tools: Tool[];
  systemPrompt: string;
  maxIterations?: number;
  temperature?: number;
  onStep?: (step: AgentStep) => void;
}

export interface AgentResult {
  finalAnswer: string;
  steps: AgentStep[];
}

export interface AgentRuntime {
  invoke: (userMessage: string) => Promise<AgentResult>;
}

