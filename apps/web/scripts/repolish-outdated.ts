// Re-polish profile items whose facts predate the current POLISH_RULES_VERSION
// (normalized.rulesVersion missing or older).
//
// Why a script and not the app: a normalizer prompt change only reaches existing
// profiles if their stored facts are regenerated. Doing that from the browser
// meant a background queue racing the paid generation (two-call rule), daily
// budgets and cross-tab bookkeeping. Prod has few users, so one server-side
// pass is simpler and exact. See ADR-0008.
//
// Writes PRODUCTION data. Dry-run by default: it lists what it would change.
//
//   node_modules/.bin/tsx scripts/repolish-outdated.ts            # dry run
//   node_modules/.bin/tsx scripts/repolish-outdated.ts --apply    # write
//   node_modules/.bin/tsx scripts/repolish-outdated.ts --apply --limit 5
//
// Each write is conditional on the row still holding the hash it was read
// with, so a user who edits an item mid-run keeps their newer polish.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { GeminiProfileNormalizer } from '../src/infrastructure/ai/GeminiProfileNormalizer.js';
import { contentHash } from '../src/application/validation/contentHash.js';
import { POLISH_RULES_VERSION } from '../src/infrastructure/ai/prompts/normalizerPrompts.js';
import { buildCallMeta } from '../api/_lib/aiTelemetry.js';
import type { UsageSink } from '../src/infrastructure/ai/usage.js';
import type { ProfileItemContext } from '../src/domain/usecases/NormalizeProfileItemUseCase.js';

function env(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  for (const f of ['.env.local', '.env']) {
    try {
      const line = readFileSync(resolve(process.cwd(), f), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
      const v = line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
      if (v && !/^PLACEHOLDER/i.test(v)) return v;
    } catch { /* next file */ }
  }
  throw new Error(`Missing ${name} in env, .env.local or .env`);
}

type Row = {
  id: string; user_id: string; description: string | null;
  normalized: unknown; normalized_source_hash: string | null; input_mode: string | null;
  guided: Record<string, string> | null;
  [k: string]: unknown;
};

// Guided only when there ARE guided answers: free-text rows added from the
// dashboard drawer carry input_mode='guided' by column default, and were first
// polished as free text — re-polishing them with the guided framing would
// change the prompt that produced them.
const isGuided = (r: Row) =>
  (r.input_mode ?? 'guided') === 'guided' && !!r.guided && Object.values(r.guided).some((v) => String(v ?? '').trim());

const TABLES: Array<{ table: string; select: string; context: (r: Row) => ProfileItemContext }> = [
  { table: 'experiences', select: 'role, company',
    context: (r) => ({ kind: 'experience', title: r.role as string, organization: r.company as string, guided: isGuided(r) }) },
  { table: 'projects', select: 'name, technologies',
    context: (r) => ({ kind: 'project', title: r.name as string, technologies: r.technologies as string, guided: isGuided(r) }) },
  { table: 'extracurriculars', select: 'title, organization',
    context: (r) => ({ kind: 'extracurricular', title: r.title as string, organization: r.organization as string, guided: isGuided(r) }) },
  { table: 'awards', select: 'title, issuer',
    context: (r) => ({ kind: 'award', title: r.title as string, organization: r.issuer as string, guided: isGuided(r) }) },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  if (!(limit > 0)) throw new Error('--limit needs a positive number');

  const db = createClient(env('VITE_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const normalizer = new GeminiProfileNormalizer(env('GEMINI_API_KEY'));

  const work: Array<{ table: string; row: Row; context: ProfileItemContext }> = [];
  for (const t of TABLES) {
    // Paged: PostgREST caps a single select at 1000 rows.
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from(t.table)
        .select(`id, user_id, description, normalized, normalized_source_hash, input_mode, guided, ${t.select}`)
        .not('normalized', 'is', null)
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as unknown as Row[]));
      if (!data || data.length < 1000) break;
    }
    for (const row of rows) {
      const text = (row.description ?? '').trim();
      const version = (row.normalized as { rulesVersion?: number } | null)?.rulesVersion ?? 1;
      // Outdated = older rules AND still describing the current text. An item
      // whose text changed since its polish is the editors' job (save-time
      // polish), not this script's.
      if (text && version < POLISH_RULES_VERSION && row.normalized_source_hash === contentHash(text)) {
        work.push({ table: t.table, row, context: t.context(row) });
      }
    }
  }
  const todo = work.slice(0, limit);
  console.log(`Outdated under rules v${POLISH_RULES_VERSION}: ${work.length} item(s) across ${new Set(work.map((w) => w.row.user_id)).size} user(s). ${apply ? `Re-polishing ${todo.length}.` : 'DRY RUN — pass --apply to write.'}`);
  for (const w of todo) console.log(`  ${w.table.padEnd(16)} ${w.row.id}  user=${w.row.user_id.slice(0, 8)}  "${(w.context.title ?? '').slice(0, 40)}"`);
  if (!apply) return;

  let ok = 0, skipped = 0, failed = 0;
  let costUsd = 0;
  const queue = [...todo];
  // Two at a time: gentle on the per-minute model quota live users share.
  await Promise.all([0, 1].map(async () => {
    for (let w = queue.shift(); w; w = queue.shift()) {
      const text = (w.row.description ?? '').trim();
      try {
        const usage: UsageSink = {};
        const t0 = Date.now();
        const normalized = await normalizer.normalize(text, w.context, usage);
        // Reported by this script, NOT logged to ai_call_log: a row there would
        // count against the user's daily AI caps on the day of the run.
        costUsd += buildCallMeta({ usage, latencyMs: Date.now() - t0, fallbackInputText: text }).costUsd ?? 0;
        if (!normalized.bullets?.length) { failed++; console.warn(`  ✗ ${w.table} ${w.row.id}: empty output`); continue; }
        const { data, error } = await db
          .from(w.table)
          .update({ normalized, normalized_source_hash: contentHash(text) })
          .eq('id', w.row.id)
          .eq('normalized_source_hash', w.row.normalized_source_hash as string)
          .select('id');
        if (error) throw error;
        if (!data?.length) { skipped++; console.log(`  – ${w.table} ${w.row.id}: changed since read, left as is`); continue; }
        ok++;
        console.log(`  ✓ ${w.table} ${w.row.id} (${normalized.bullets.length} facts)`);
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${w.table} ${w.row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }));
  console.log(`Done: ${ok} re-polished, ${skipped} skipped (edited meanwhile), ${failed} failed. AI cost ≈ $${costUsd.toFixed(3)} (not in the admin cost tabs).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
