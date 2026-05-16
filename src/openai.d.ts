export {};

declare module "openai" {
  namespace OpenAI {
    namespace Chat {
      interface ChatCompletionCreateParamsNonStreaming {
        enable_thinking?: boolean;
      }
      interface ChatCompletionCreateParamsStreaming {
        enable_thinking?: boolean;
      }
    }
  }
}