# 使用 Bun 官方提供的轻量级镜像 (Alpine 版本体积更小)
FROM oven/bun:latest

# 设置工作目录
WORKDIR /

COPY ./build/index.js .
ENV NODE_ENV=production

ENV INPUT_DIR=/input
ENV OUTPUT_DIR=/output

# 运行 index.js
# 使用 'bun run' 启动，如果 index.js 依赖于某些 Bun 特性
CMD ["bun", "run", "index.js"]