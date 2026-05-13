import { END } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

export function shouldContinue(
  state: any,
  config?: RunnableConfig,
): string {
  const maxIterations =
    (config?.configurable?.maxIterations as number) ?? 10;

  if (state.loopActive && state.iteration < maxIterations) {
    return "toolNode";
  }
  return END;
}