import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { AgentStep } from "../types";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  steps: Annotation<AgentStep[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  iteration: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),

  loopActive: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
});