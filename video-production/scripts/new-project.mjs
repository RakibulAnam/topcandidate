#!/usr/bin/env node
// npm run new -- <name> [--from /path/to/raw.mp4] [--template talking-head] [--brief "…"]
import { chmodSync, constants, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PROJECTS, PROJECT_DIRS, SHARED, ensureDir, writeJSON, parseArgs, die, log } from "./lib/util.mjs";

const args = parseArgs(process.argv.slice(2));
const name = args._[0];
if (!name || !/^[a-z0-9][a-z0-9-_]*$/i.test(name)) die("Usage: npm run new -- <project-name> [--from path/to/video] [--template name] [--brief \"…\"]");
if (!existsSync(join(SHARED, ".setup-done"))) die("Run `npm run setup` first.");

const dir = join(PROJECTS, name);
if (existsSync(join(dir, "project.json"))) die(`Project already exists: ${dir}`);
for (const d of PROJECT_DIRS) ensureDir(join(dir, d));

if (args.from) {
  const src = resolve(args.from);
  if (!existsSync(src)) die(`File not found: ${src}`);
  const dest = join(dir, "input", basename(src));
  copyFileSync(src, dest, constants.COPYFILE_FICLONE); // APFS clone: instant, no extra disk
  chmodSync(dest, 0o444);
  log(`copied ${basename(src)} → input/ (read-only)`);
}

writeJSON(join(dir, "project.json"), {
  name,
  created: new Date().toISOString(),
  template: args.template || null,
  status: "new", // new → ingested → planned → previewed → final
  brief: args.brief || "",
  renders: [],
});

writeFileSync(
  join(dir, "notes/BRIEF.md"),
  `# ${name} — brief\n\n${args.brief || "_Describe what you want: length, platform, tone, hook, CTA. Claude fills the rest in during planning._"}\n\n## Editorial decisions\n\n_Claude records the story/structure decisions here after analysis._\n`,
);
writeFileSync(join(dir, "notes/REVISIONS.md"), `# ${name} — revision log\n\nNewest first. Each entry: request → what changed in edit.json → render.\n`);

console.log(`\n✓ Created projects/${name}/\n\n  1. Drop raw footage into  projects/${name}/input/\n  2. Ask Claude: "Edit projects/${name} into a 35s Reel…"\n     (or run: npm run ingest -- ${name})\n`);
