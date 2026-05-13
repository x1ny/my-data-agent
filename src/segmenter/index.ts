import { splitDocument, mergeSmallTail } from "./splitter";
import { extractSegments } from "./extractor";
import { mapSegments, mapSegmentsFallback } from "./positionMapper";
import { mergeSegments } from "./merger";
import type { Segment, SegmenterOptions, Chunk } from "./types";
import {
  DEFAULT_CHUNK_SIZE,
DEFAULT_OVERLAP,
  MAX_RETRIES,
  MIN_CHUNK_FRACTION,
} from "./types";

export type { Segment, SegmenterOptions } from "./types";

async function processChunk(
  chunk: Chunk,
  chunkIndex: number,
  totalChunks: number,
  temperature: number,
  verbose: boolean,
): Promise<Segment[]> {
  if (verbose) {
    console.log(`\n[ProcessChunk] 处理块 #${chunkIndex+1}/${totalChunks}: 起始=${chunk.startIndex}, 长度=${chunk.text.length}`);
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (verbose) {
      console.log(`  [ProcessChunk] 第 ${attempt+1}/${MAX_RETRIES} 次LLM调用`);
    }

    const rawSegments = await extractSegments(chunk.text, temperature, verbose);

    if (rawSegments.length === 0) {
      if (verbose) {
        console.log(`  [ProcessChunk] LLM返回空段落列表, 重试...`);
      }
      continue;
    }

    const mapped = mapSegments(rawSegments, chunk, verbose);
    if (mapped) {
      if (verbose) {
        console.log(`  [ProcessChunk] 第 ${attempt+1} 次尝试成功: 定位 ${mapped.length} 个段落`);
      }
      return mapped;
    }

    if (verbose) {
      console.log(`  [ProcessChunk] 位置映射失败, 准备重试...`);
    }
  }

  if (verbose) {
    console.log(`  [ProcessChunk] ${MAX_RETRIES}次重试全部失败, 使用兜底映射`);
  }

  const rawSegments = await extractSegments(chunk.text, temperature, verbose);
  return mapSegmentsFallback(rawSegments, chunk, verbose);
}

export async function segmentDocument(
  text: string,
  options: SegmenterOptions = {},
): Promise<Segment[]> {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    overlap = DEFAULT_OVERLAP,
    temperature = 0,
    verbose = false,
  } = options;

  if (!text || text.trim().length === 0) {
    return [];
  }

  const overlapSize = overlap;

  let chunks = splitDocument(text, chunkSize, overlapSize, verbose);
  chunks = mergeSmallTail(chunks, text, chunkSize, MIN_CHUNK_FRACTION, verbose);

  const allSegments: Segment[] = [];
  const totalChunks = chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const segments = await processChunk(chunk, i, totalChunks, temperature, verbose);
    allSegments.push(...segments);
  }

  if (verbose) {
    console.log(`\n[DocumentSegmenter] 全部分块处理完成, 原始段数=${allSegments.length}`);
  }

  return mergeSegments(allSegments, verbose);
}