import type { RawSegment, Segment, Chunk } from "./types";

export function mapSegments(
  rawSegments: RawSegment[],
  chunk: Chunk,
  verbose: boolean,
): Segment[] | null {
  const segments: Segment[] = [];
  let cursor = chunk.startIndex;

  for (let i = 0; i < rawSegments.length; i++) {
    const raw = rawSegments[i]!;
    const needle = raw.end_str;
    const localOffset = chunk.text.indexOf(needle);

    if (localOffset === -1) {
      if (verbose) {
        console.log(`  [PositionMapper] 匹配失败 第${i+1}段: end_str="${needle.slice(0, 80)}..." 未在块中找到`);
      }
      return null;
    }

    const absoluteEnd = chunk.startIndex + localOffset + needle.length;

    if (verbose) {
      console.log(`  [PositionMapper] 第${i+1}段 定位成功: start=${cursor} end=${absoluteEnd} offset=${localOffset}`);
    }

    segments.push({
      summary: raw.summary,
      startIndex: cursor,
      endIndex: absoluteEnd,
    });

    cursor = absoluteEnd;
  }

  return segments;
}

export function mapSegmentsFallback(
  rawSegments: RawSegment[],
  chunk: Chunk,
  verbose: boolean,
): Segment[] {
  const segments: Segment[] = [];
  const fallbackEnd = chunk.startIndex + chunk.text.length;
  let cursor = chunk.startIndex;

  if (verbose) {
    console.log(`  [PositionMapper] 使用兜底映射: 所有段落 endIndex 设为块末尾 ${fallbackEnd}`);
  }

  for (const raw of rawSegments) {
    segments.push({
      summary: raw.summary,
      startIndex: cursor,
      endIndex: fallbackEnd,
    });
    cursor = fallbackEnd;
  }

  return segments;
}