import type { Chunk } from "./types";

function findBreakBackward(
  text: string,
  from: number,
  to: number,
): number {
  for (let i = from - 1; i >= to; i--) {
    const ch = text[i]!;
    if (
      ch === "." &&
      (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\n")
    ) {
      return i + 1;
    }
  }

  for (let i = from - 1; i >= to; i--) {
    if (text[i] === "\n") {
      return i + 1;
    }
  }

  for (let i = from - 1; i >= to; i--) {
    if (text[i] === " ") {
      return i + 1;
    }
  }

  return from;
}

export function splitDocument(
  text: string,
  chunkSize: number,
  overlapSize: number,
  verbose: boolean,
): Chunk[] {
  const chunks: Chunk[] = [];
  let pos = 0;
  const len = text.length;

  if (verbose) {
    console.log(`[DocumentSplitter] 开始切分文档: 总长度 ${len} 字符, chunkSize=${chunkSize}, overlap=${overlapSize}`);
  }

  let chunkIndex = 0;
  while (pos < len) {
    const targetBreak = Math.min(pos + chunkSize, len);
    const searchFrom = Math.max(
      pos + 1,
      targetBreak - Math.ceil(chunkSize * 0.3),
    );
    const breakPoint =
      targetBreak === len
        ? len
        : findBreakBackward(text, targetBreak, searchFrom);

    const chunkTextEnd = Math.min(breakPoint + overlapSize, len);
    const chunkLen = chunkTextEnd - pos;

    if (verbose) {
      const breakMethod = breakPoint === targetBreak ? "硬切" : "自然断点";
      console.log(`  [DocumentSplitter] 块#${chunkIndex}: 起始=${pos} 结束=${chunkTextEnd} 长度=${chunkLen} 断点方式=${breakMethod}`);
    }

    chunks.push({
      text: text.slice(pos, chunkTextEnd),
      startIndex: pos,
    });

    chunkIndex++;
    if (breakPoint >= len) break;
    pos = breakPoint;
  }

  if (verbose) {
    console.log(`[DocumentSplitter] 切分完成: 共 ${chunks.length} 个块`);
  }

  return chunks;
}

export function mergeSmallTail(
  chunks: Chunk[],
  text: string,
  chunkSize: number,
  minFraction: number,
  verbose: boolean,
): Chunk[] {
  if (chunks.length <= 1) return chunks;

  const last = chunks[chunks.length - 1]!;
  const tailLength = last.text.length;
  const minSize = chunkSize * minFraction;

  if (tailLength < minSize) {
    if (verbose) {
      console.log(`[DocumentSplitter] 尾部块过小: 长度 ${tailLength} < 最小长度 ${minSize}, 合并到前一个块`);
    }
    const beforeLast = chunks[chunks.length - 2]!;
    const mergedEnd = Math.min(
      beforeLast.startIndex + beforeLast.text.length + tailLength,
      text.length,
    );
    beforeLast.text = text.slice(beforeLast.startIndex, mergedEnd);
    chunks.pop();
  }

  return chunks;
}