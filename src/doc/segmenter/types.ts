export interface Segment {
  summary: string;
  startIndex: number;
  endIndex: number;
}

export interface RawSegment {
  summary: string;
  end_str: string;
}

export interface Chunk {
  text: string;
  startIndex: number;
}

export interface SegmenterOptions {
  chunkSize?: number;
  overlap?: number;
  temperature?: number;
  verbose?: boolean;
}

export const DEFAULT_CHUNK_SIZE = 20000;
export const DEFAULT_OVERLAP = 1000;
export const MAX_RETRIES = 3;
export const MIN_CHUNK_FRACTION = 0.2;