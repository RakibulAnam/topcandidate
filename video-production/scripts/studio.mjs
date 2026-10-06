#!/usr/bin/env node
// npm run studio -- <project> [--port 3017] [--stop]
// Live HyperFrames Studio on the built composition: scrub, play, and hand-tweak without rendering.
// Note: Studio edits land in composition/index.html, which the next `npm run build` regenerates
// from edit.json — tell Claude what you changed so it goes into edit.json.
import { join } from "node:path";
import { HF_BIN, projectDir, parseArgs, runInherit } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
const P = projectDir(args._[0]);
const C = join(P, "composition");
if (args.stop) runInherit(HF_BIN, ["preview", "--stop"], { cwd: C, allowFail: true });
else {
  runInherit("node", [join(import.meta.dirname, "build.mjs"), P]);
  runInherit(HF_BIN, ["preview", "--background", "--port", String(args.port || 3017)], { cwd: C });
  console.log(`\nStudio: http://localhost:${args.port || 3017}/#project/composition\nStop with: npm run studio -- ${args._[0]} --stop\n`);
}
