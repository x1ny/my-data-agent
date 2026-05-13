import { segmentDocument } from "./segmenter";
import path from "node:path";

const file = await Bun.file(
  path.join(__dirname, "../input/task_350/context/doc/event.md"),
).text();
const segments = await segmentDocument(file, {
  chunkSize: 60000,
  overlap: 1000,
  verbose: true,
});

console.log(segments);
