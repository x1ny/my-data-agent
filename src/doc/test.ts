import { segmentDocument } from "./segmenter";
import path from "node:path";
import { summarizeDocument } from "./summarizeDocument";
import { invokeDocExpertAgent } from "./invokeDocExpertAgent";


console.time('summarizeDocument');
const file = await Bun.file(
  path.join(__dirname, "../../input/task_350/context/doc/event.md"),
).text();
const summary = await summarizeDocument(file);
console.log(summary);
console.timeEnd('summarizeDocument');
console.time('segmentDocument');

const segments = await segmentDocument(file, {
  chunkSize: 60000,
  overlap: 1000,
  verbose: true,
});

console.log(segments);
console.timeEnd('segmentDocument');

const knowledge = await Bun.file(
  path.join(__dirname, "../../input/task_350/context/knowledge.md"),
).text();

console.time('invokeDocExpertAgent');
const answer = await invokeDocExpertAgent({
  documents: [
    {
      name: "event.md",
      summary: summary.summary,
      documentType: summary.documentType,
      content: file,
      segments: segments.map((s) => ({
        summary: s.summary,
        start: s.startIndex,
        end: s.endIndex,
      })),
    },
  ],
  knowledge: knowledge,
  question: "女子足球发展怎么样了?",
});
console.timeEnd('invokeDocExpertAgent');
console.log(answer);