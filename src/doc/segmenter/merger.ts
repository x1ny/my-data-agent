import type { Segment } from "./types";

export function mergeSegments(segments: Segment[], verbose: boolean): Segment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.startIndex - b.startIndex);
  const filtered = sorted.filter((s) => s.endIndex > s.startIndex && s.summary.length > 0);

  if (verbose) {
    const removed = segments.length - filtered.length;
    console.log(`[SegmentMerger] 合并完成: 输入 ${segments.length} 段 → 排序后输出 ${filtered.length} 段${removed > 0 ? ` (去除 ${removed} 个空段)` : ""}`);
  }

  return filtered;
}