#!/usr/bin/env node
/**
 * Example: compute metrics **locally**, then push a short summary to a topic on **your own** ntfy server.
 *
 * ⚠️ This file is **not part of the library** (`package.json` → "files" does not include `examples/`).
 *    The library contains no network code on purpose (`NON-GOALS.md` §4); this is the layer around it,
 *    which is exactly why it lives out here rather than in `src/`.
 *
 * ⚠️ It pushes a **summary, never the records.** A lock screen wants "SRI 74.3 · last 7 nights 70.7";
 *    a nightly dump of raw records is a second copy of your health history sitting on a push server.
 *    Keep the order *read → compute → send a number*, never *send → compute elsewhere*.
 *
 * Usage:
 *   NTFY_URL=https://ntfy.example.com NTFY_TOPIC=sleep node examples/push-ntfy.mjs records.json
 *   node examples/push-ntfy.mjs records.json --dry-run        # print the message, send nothing
 *   node examples/push-ntfy.mjs records.json --holidays data/holidays.json   # add phase / social jetlag
 *
 * Self-hosting ntfy is one command:
 *   docker run -p 80:80 -it binwiederhier/ntfy serve
 * See ../PUSHING-TO-YOUR-PHONE.md for why a self-hosted instance (plus the F-Droid client) is the only
 * configuration that keeps the data to yourself.
 */
import fs from 'node:fs';
import {
  allSleep, mainSleep, computeSRI, sriLastN, computePhase, makeRestJudge, avg, minToClock,
} from '../src/index.js';

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const dryRun = argv.includes('--dry-run');
const holIdx = argv.indexOf('--holidays');
const holidaysPath = holIdx >= 0 ? argv[holIdx + 1] : null;

if (!file) {
  console.error('usage: [NTFY_URL=… NTFY_TOPIC=…] node examples/push-ntfy.mjs <records.json> [--dry-run] [--holidays data/holidays.json]');
  process.exit(2);
}

const BASE = process.env.NTFY_URL;
const TOPIC = process.env.NTFY_TOPIC;
if (!dryRun && (!BASE || !TOPIC)) {
  console.error('未设置 NTFY_URL / NTFY_TOPIC —— 要么设好环境变量，要么加 --dry-run 只看消息内容。');
  process.exit(2);
}

/* ---------- read + compute (the library does this part; it touches no network) ---------- */
const records = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(records) || records.length === 0) {
  console.error('记录文件应当是非空的**标准记录数组**（见 README "Input shape"）。');
  process.exit(2);
}

const all = allSleep(records);
const main = mainSleep(records);
const sriAll = computeSRI(all);
const sri7 = sriLastN(all, main, 7);

const f1 = (x) => (x == null ? 'n/a' : x.toFixed(1));
const lines = [
  `SRI all-time  ${f1(sriAll.sri)}   (${sriAll.days} days / ${sriAll.pairs} pairs)`,
  `SRI last 7    ${f1(sri7.sri)}`,
  `Main sleep    ${Math.round(avg(main.map((m) => m.dur)))} min avg over ${main.length} nights`,
];

if (holidaysPath) {
  const rest = makeRestJudge(JSON.parse(fs.readFileSync(holidaysPath, 'utf8')));
  const phase = computePhase(main, rest.isRest, { windowDays: 30 });
  if (phase && !phase.insufficient) {
    lines.push(`MSFsc ${minToClock(phase.msfsc)}   Social jetlag ${phase.sjl >= 0 ? '+' : ''}${Math.round(phase.sjl)} min`);
  } else {
    lines.push('MSFsc n/a (window needs both work days and free days)');
  }
}

const body = lines.join('\n');
const title = 'Sleep metrics';

/* ---------- send ---------- */
console.log(`--- message (${body.length} bytes) ---\n${body}\n--------------------------------------`);

if (dryRun) {
  console.log('--dry-run：没有发送任何东西。');
  process.exit(0);
}

const url = `${BASE.replace(/\/+$/, '')}/${TOPIC}`;
// ⚠️ ntfy requires **ASCII** header values; the body is UTF-8. Keep non-ASCII text in the body.
const res = await fetch(url, {
  method: 'POST',
  headers: { Title: title, Priority: 'default', Tags: 'sleeping_face' },
  body,
});

// A push that fails silently is worse than no push at all (same principle as `auditRecords()`).
if (!res.ok) {
  console.error(`推送失败：HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`已推送：HTTP ${res.status}（${url}）`);
