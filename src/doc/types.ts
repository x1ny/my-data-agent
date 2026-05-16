import type { AgentStep } from "../agent/types";

export interface SummarizeResult {
  summary: string;
  documentType: string;
}

export interface DocumentEntry {
  name: string;
  content: string;
}

export interface DocSegment {
  summary: string;
  start: number;
  end: number;
}

export interface DocDocument {
  name: string;
  summary: string;
  documentType: string;
  segments: DocSegment[];
  content: string;
}

export interface DocExpertParams {
  documents: DocDocument[];
  knowledge?: string;
  question: string;
  maxIterations?: number;
  temperature?: number;
  onStep?: (step: AgentStep) => void;
}

export interface DocExpertResult {
  answer: string;
  notebook: string;
  steps: AgentStep[];
}