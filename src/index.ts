import { createAgent } from "./agent";
import { z } from "zod";

const agent = createAgent({
  tools: [
    {
      name: "get_weather",
      description: "获取指定城市的天气信息",
      schema: z.object({
        city: z.string().describe("城市名称，如 '上海'、'北京'"),
      }),
      execute: async ({ city }) => {
        return `${city}的天气：晴天，温度 25°C，湿度 45%`;
      },
    },
  ],
  systemPrompt: "你是一个有用的助手，可以使用工具来回答用户的问题。请用中文回答。",
  maxIterations: 5,
  onStep: (step) => {
    console.log(
      `[Step ${step.iteration}]`,
      step.thought,
      step.action ? ` -> ${step.action.tool}(${JSON.stringify(step.action.input)})` : "",
    );
    if (step.observation) {
      console.log(`  Observation:`, step.observation);
    }
  },
});

const result = await agent.invoke("上海今天天气怎么样？");
console.log("\n最终答案:", result.finalAnswer);