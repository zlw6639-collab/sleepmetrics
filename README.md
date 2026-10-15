# sleepmetrics

Standard sleep metrics in pure JavaScript: **sleep regularity (SRI)** and **circadian phase**
(**MSFsc** / **social jetlag**, SJL).

**Zero runtime dependencies. No build step. No network. No filesystem.** You pass in an array of
sleep records, you get numbers — and the rule + number behind each one.

## What you need to give it

Three fields per record. Everything else is optional:

| field | required | meaning |
|---|---|---|
| `bed` | ✅ | time you got into bed — **epoch seconds** (not milliseconds, not a string) |
| `wake` | ✅ | time you got up — **epoch seconds** |
| `tz` | — | fixed **hours** offset (e.g. `8`); defaults to the `tz` you pass to a function |
| `dur` | — | minutes asleep; derived from `(wake − bed) / 60` when omitted |
| `stages` | — | optional segments — they make SRI more accurate (see the awake-code warning below) |

Two things that silently ruin results if you get them wrong — **`bed`/`wake` must be epoch
*seconds***, and **`tz` is a fixed offset, never an IANA zone** (this library does not know about DST).
Both are documented with measured examples in [`TIMESTAMPS.md`](TIMESTAMPS.md).

## See it move, or run it now

> **The interactive page — <https://zlw6639-collab.github.io/sleepmetrics/>** — recomputes SRI live as
> you drag two sliders. It exists because *"average bedtime and regularity are different axes"* is
> something you have to **watch**: move the *centre* slider and the average moves while SRI holds;
> move the *amplitude* slider and the average holds while SRI falls. It imports this library from a
> CDN and uses **synthetic data only**.

**No data required to see real output** — this builds eight identical nights and prints genuine
results. Save it as `example.mjs` and run `node example.mjs`:

```js
import { allSleep, mainSleep, computeSRI, sriLastN, auditRecords } from 'sleepmetrics'

const tz = 8
const day = (i) => Date.UTC(2026, 2, i) / 1000 - tz * 3600   // 2026-03-NN 00:00 local
const records = Array.from({ length: 8 }, (_, i) => ({
  bed:  day(i + 1) + 1 * 3600,
  wake: day(i + 1) + 9 * 3600,
  tz,
}))

const all  = allSleep(records)    // naps included — SRI uses this
const main = mainSleep(records)   // main sleep only (>180 min) — phase uses this

console.log(auditRecords(records).summary)
console.log(computeSRI(all))
console.log(sriLastN(all, main, 7).sri)
```

It prints (verified 2026-10-15):

```
{ records: 8, days: 8, daysWithoutMainSleep: 0, bySeverity: { error: 0, warn: 0, info: 0 }, ok: true }
{ sri: 100, days: 8, pairs: 7, from: '2026-03-01', to: '2026-03-08', skipped: [] }
100
```

Eight identical nights ⇒ **SRI = 100**. That is the sanity check worth seeing *before* you feed the
library anything real — once this matches, swap in your own `records`.

> 🧩 **TypeScript users**: no `.d.ts` is shipped yet. Enable `allowJs` and you get types straight from
> the JSDoc. A **hand-written** `.d.ts` is item #1 on the [roadmap](ROADMAP.md) — this project will
> not grow a build chain for it. See [Types without a build step](#types-without-a-build-step).

> ⚠️ **Not a medical device, not medical advice.** This library computes research-grade metrics from
> sleep/wake records. It does not diagnose anything and must not be used as a substitute for a
> clinician. Do not make health decisions on your own based on its output.
> **Read [`DISCLAIMER.md`](DISCLAIMER.md)** — it also covers the two things people most often get
> wrong: *how noisy consumer wearable data actually is*, and *what "population-level norm" means*.
>
> 🧾 **Provided as-is, with no maintenance promise.** It is published because the JS ecosystem has
> nothing in this space — not because it is a product. Issues may sit unanswered.

> 🏷 **Independent project.** Not affiliated with, or endorsed by, any company using a similar name —
> see [`DISCLAIMER.md`](DISCLAIMER.md#name-and-affiliation) (it also names the trademark we checked).

## Why this exists

The metrics below are standard in the literature, and both R and Python have mature implementations:

| Ecosystem | Packages |
|---|---|
| R | `mctq` (MSFsc / SJL), `GGIR`, `sleepreg` (SRI), `actiRhythm` |
| Python | `pyActigraphy` |
| **JavaScript** | **— nothing —** |

As of 2026-10, `npm search actigraphy` returns **0** results, and `sleep regularity` returns only
`atomic-sleep`-style delay helpers that have nothing to do with sleep science. This library fills
that one empty cell — nothing more.

## Install

```bash
npm i sleepmetrics
```

Node >= 20. ESM only. **No build step, no transpiler, no postinstall.**

> **A note on the CLI.** `sleepmetrics --help`, and every human-readable CLI output, is currently
> **Chinese-only**. The library API itself is language-neutral (English identifiers; `--json` emits
> English keys). The audience for this package has to write its own data adapter regardless, so a
> translated CLI has not been a priority — and `--json`, the machine-facing path, is unaffected.

## Quick start

```js
import { allSleep, mainSleep, computeSRI, sriLastN, computePhase, makeRestJudge } from 'sleepmetrics'

// records: your own array in the standard shape (see below)
const all  = allSleep(records)   // every sleep episode, naps included — SRI uses this
const main = mainSleep(records)  // main sleep only (>180 min) — phase uses this

computeSRI(all)                       // { sri, days, pairs, from, to, skipped }
sriLastN(all, main, 7)                // last 7 nights (single window anchor — see below)
sriLeaveOneOut(all, main, 7)          // per-day influence: which night drags the index down?

const rest = makeRestJudge(holidaysTable)   // YOU read the JSON; the library never touches fs
computePhase(main, rest.isRest)             // { msw, msf, msfsc, sjl, ... }
```

### Run it right now

**No data required.** This builds eight synthetic nights and prints real output — save it as
`example.mjs` and run `node example.mjs`:

```js
import { allSleep, mainSleep, computeSRI, sriLastN, auditRecords } from 'sleepmetrics'

const tz = 8
const day = (i) => Date.UTC(2026, 2, i) / 1000 - tz * 3600   // 2026-03-NN 00:00 local
const records = Array.from({ length: 8 }, (_, i) => ({
  bed:  day(i + 1) + 1 * 3600,
  wake: day(i + 1) + 9 * 3600,
  tz,
}))

const all  = allSleep(records)    // naps included — SRI uses this
const main = mainSleep(records)   // main sleep only (>180 min) — phase uses this

console.log(auditRecords(records).summary)
console.log(computeSRI(all))
console.log(sriLastN(all, main, 7).sri)
```

It prints (verified 2026-10-15):

```
{ records: 8, days: 8, daysWithoutMainSleep: 0, bySeverity: { error: 0, warn: 0, info: 0 }, ok: true }
{ sri: 100, days: 8, pairs: 7, from: '2026-03-01', to: '2026-03-08', skipped: [] }
100
```

Eight identical nights ⇒ **SRI = 100**. That is the sanity check worth seeing *before* you feed the
library anything real — once this matches, swap in your own `records`.

## Input shape

```js
const records = [
  {
    bed:   1791054060,   // epoch seconds
    wake:  1791084000,   // epoch seconds
    tz:    8,            // optional, hours offset; defaults to the tz you pass to the functions
    dur:   499,          // optional, minutes; derived from (wake-bed)/60 when omitted
    stages: [            // optional; makes SRI more accurate (distinguishes awake from asleep)
      { start: 1791054060, end: 1791055320, state: 2 },  // 2=deep 3=light 4=REM 5=awake
    ],
  },
]
```

Adapters for vendor formats (Xiaomi / Gadgetbridge / Apple Health / CSV) are deliberately **not**
part of this package: mapping someone else's field names is a different job, and each source
changes on its own schedule.

> ⚠️ **Before you write the adapter: `bed`/`wake` are epoch seconds, and getting there is the most
> error-prone step in the pipeline.** [`TIMESTAMPS.md`](TIMESTAMPS.md) covers it with measured examples
> and a verified snippet. The short version: **only a bare `YYYY-MM-DD` parses as UTC** — every other
> form without an offset parses as *local*, so `'2026-03-01'` and `'2026-03-01T00:00'` end up
> **8 hours apart**. Nothing throws; it just moves a night across midnight and changes SRI.
>
> ⚠️ **And those `state` codes are a vendor's private encoding, not a standard.** `2` = deep · `3` = light ·
> `4` = REM · `5` = awake is **Xiaomi's** numbering, not AASM/PSG. Anything else you own that uses 1–5
> (Gadgetbridge exports, some Apple Health exports, a hand-made CSV) will land **inside the valid range
> with a different meaning**, and **no type system can catch that** — `state: 2` is always a legal
> number.
>
> **Map it before you feed it in, and check the awake code first.** SRI only looks at asleep-vs-awake, so
> a deep/light swap does not move it — **the awake code does**. Measured on 10 nights of which 5 had
> night-waking: feeding the AASM numbering (awake = `0`) as if it were this one inflated SRI from
> **93.77 to 97.93 — 4.16 points** — in precisely the situation real wearable data hits most often.
> `auditRecords()` catches out-of-range codes (`stages.unknown-state`) and flags data where **no**
> segment is awake (`stages.no-awake`), but it **cannot** see a silent remapping that stays in range.
> If you are unsure, run `audit` first and read those two rules.

## API

| Function | Returns |
|---|---|
| `allSleep(records)` | normalized episodes, `dur > 0`, sorted by bedtime (naps included) |
| `mainSleep(records, minMinutes = 180)` | episodes with `dur > minMinutes` (strictly greater) |
| `dailyMain(records, minMinutes = 180)` | **the longest episode per wake-day** — a *second* main-sleep convention, deliberately different from `mainSleep()`: this one de-duplicates per day and uses `>=`; `mainSleep()` keeps every qualifying episode and uses `>`. `suggest()` follows this one, phase follows `mainSleep()`. The difference is pinned by `test/records.test.js` — **do not "unify" them** |
| `computeSRI(records, { minDayMinutes = 180, tz })` | `{ sri, days, pairs, from, to, skipped }` |
| `sriLastN(allSegs, mainSegs, w, opts)` | windowed SRI; `w` falsy = all-time |
| `sriLeaveOneOut(allSegs, mainSegs, w, opts)` | 逐日影响度 — `{ sri, days, pairs, out: [{ date, sri, delta, pairs, isolated }] }`。**只在小窗口上有诊断力**：一晚在 n=7 时值 ±11 分，在 n=85 时不到 ±1 分。`delta > 0` = 去掉它 SRI 反而升 = 它拖后腿 |
| `computePhase(records, isRest, { windowDays = 30, tz })` | `{ msw, msf, msfsc, sjl, sjlSc, ... }` |
| `makeRestJudge(table)` | `{ isRest, isHoliday, isMakeupWorkday, isWeekend, missingYears }` |
| `auditRecords(records, opts)` | **data health report** — `{ issues, summary }`；只报告、不修改 |
| `chronotype(msfsc, { cuts, labels })` | 时型分档 —— **切点由你注入**，库不写死任何钟点 |
| `compareChronotype({ activityIndex, questionnaireIndex, labels, tolerance })` | 双口径对比（**行为 vs 问卷**）—— **不实现任何量表**；不一致是常态，输出带免责 |
| `circStats(mins)` | `{ n, mean, sd, R }` —— 圆周均值 / 圆周标准差 / 集中度 |
| `computeIS(values, { perDay })` · `computeIV(values)` | 日间稳定性 / 日内变异性（van Someren 1999）—— ⚠️ **定义在 activity counts 上**：喂真的 counts 得到可比形式，喂睡/醒二值序列得到的是**退化形式**，两者**不可互相比较** |
| `suggest(records, { now, isRest, targetMinutes, latencyMinutes, tz })` | tonight's bedtime, with **every reason and the numbers behind it**; `{ insufficient: true, reason }` when there is no main sleep |
| `nudgeDecision({ nowMinutes, bedtimeMinutes, saidToday, ... })` | the "should tonight's reminder fire" predicate. **Pure and stateless** — remembering "already said today" is *yours* (this project writes it to a local file) |
| `circMean / circDiff / dayOf / dayStartSec / clockMin` | time helpers |
| `minToClock(minutes)` | `'23:50'` style formatting |
| `normalize(records, tz)` · `buildGrid(records, tz)` | the normalizer, and the per-day 24 h grid the metric functions are built on — exported for inspection |
| `dowOf(ds)` · `isWeekend(ds)` · `mod(x, m)` · `avg(a)` · `normalizeNight(m)` · `SEC_PER_DAY` · `MIN_PER_DAY` | lower-level helpers and constants |
| `DEFAULT_TARGET_MINUTES` · `DEFAULT_LATENCY_MINUTES` · `NIGHT_START_MINUTES` · `NIGHT_END_MINUTES` · `LATE_MINUTES` | the defaults `suggest()` / `nudgeDecision()` use — override them per call |
| `DISCLAIMER` | the disclaimer string every advisory return value carries — **pass it through to your user** |

> **Stability, stated honestly:** the rows above the helpers are the API. The last three rows are
> *exported internals* — handy to reuse, but they may change in a minor release without ceremony.

> **A note on the source comments.** Many of them cite a `设计笔记 §N` ("design notes") — an internal
> document that is **not shipped with this package**. Every such citation is immediately followed by the
> rule it refers to, so nothing in the code requires looking it up. Citations to files that *are* shipped
> (`NON-GOALS.md` §5, `README §Semantics`, …) resolve normally.

> **Before trusting any number, run `auditRecords()`.** Dirty data never throws — it just produces
> plausible-looking wrong numbers (a millisecond timestamp, an overlapping episode, a duration that
> exceeds time in bed). The report tells you which record is wrong and why; see
> `test/audit.test.js` for the full checklist.

**Two failure modes, deliberately different.** Dirty elements *inside* an array never throw — missing
fields, `NaN`, millisecond timestamps, `null` slots, a `tz` of `"xx"`, a `dur` of `"abc"` are skipped
or reported, and the metrics degrade to `null` instead of blowing up. But passing something that is
**not an array at all** (`42`, a plain object) *does* throw a `TypeError`: `null` / `undefined` mean
"no data" and yield `[]`, whereas a number is a bug in the calling code — and type errors should be loud.

### `isRest` is *yours* to define

The library never reads a calendar and never assumes a Monday-to-Friday life. `computePhase()` and
`suggest()` take an `isRest(dayString)` callback, and **you decide what counts as a free day**:

| your schedule | pass this |
|---|---|
| typical office week | weekends + statutory holidays (that is what `data/holidays.json` is for) |
| shift / night work | **your own roster** — e.g. "the day after a night shift is not a free day" |
| freelance / no fixed week | whatever your own data says splits your long sleeps from your short ones |

If you have no calendar to lean on, hand it a data-driven rule of your own. A **heuristic** that some
people use — deliberately *not* shipped in the library, because it is not a published convention:

```js
// "free day" = I woke up much later than usual
const isRest = (ds) => wakeMinuteOf(ds) - medianWakeMinute > 90
```

⚠️ Whatever you pass **becomes the definition of "free day"** behind MSFsc and social jetlag. The
literature's numbers — and this library's own regression anchors — assume the *questionnaire*
definition: **a day without an alarm clock**. If your rule differs, read your output with that in mind.

> **Tables, and the country problem**: the bundled `data/holidays.json` is **China (PRC), 2026 only**
> — it is *not* a generic holiday calendar, and its make-up-day rules mean nothing elsewhere.
> See **[HOLIDAYS.md](HOLIDAYS.md)** for the table shape, how to write your own, and why a
> "weekends only" calendar is a one-liner.

## CDN / no-install usage

> **See it move:** the interactive demo at <https://zlw6639-collab.github.io/sleepmetrics/> shows the
> one thing prose keeps failing to convey — **average bedtime and regularity are different axes**.
> Drag the *spread* slider and the average stays pinned while SRI falls from 100 → 0 → negative
> (±180 lands exactly on 0: "indistinguishable from random"). Synthetic data only; the page computes
> with this library straight from a CDN.

Because this is a plain ESM package with **zero dependencies**, it loads straight from a CDN — in a
browser, Deno or Bun — with no build step anywhere:

```html
<script type="module">
  import { allSleep, mainSleep, computeSRI } from 'https://esm.sh/sleepmetrics'
  // records = [...]  // see "Input shape" above
  console.log(computeSRI(allSleep(records)))
</script>
```

Any ESM CDN works (`esm.sh`, jsDelivr's `+esm`, unpkg's `?module`) — there are no runtime imports for
the CDN to resolve, and nothing is fetched at import time.

## Semantics you should not "simplify away"

These are the places where a reasonable-looking rewrite silently produces wrong numbers.
**Each one is pinned by a test that states the rule in its name** — see `test/` (below).

1. **Bedtimes use a circular mean.** The arithmetic mean of 23:50 and 00:10 is 12:00. Cross-midnight
   differences use the circular *shorter* convention (as recommended by the `mctq` authors).
   → `time.test.js`: *"23:50 与 00:10 的均值是 00:00（线性平均会算成 12:00）"*
2. **SRI includes naps** — asleep is asleep.
   → `sri.test.js`: *"小睡必须算进 SRI：它确实进了当天的 24h 序列"*
3. **A day counts only if the person was asleep >= `minDayMinutes` (default 180).** Otherwise a day
   with no main sleep but a 26-minute nap is scored as "awake all day" and drags the index down.
   Pass `{ minDayMinutes: 0 }` to reproduce the naive behaviour.
   → `sri.test.js`: *"只剩 26 分钟小睡的那天被整个剔除"* / *"门槛设 0 ⇒ 复现旧口径"*
4. **One window anchor only.** `sriLastN` anchors on the **last main sleep's wake time**.
   Anchoring on "the last episode of that day" (usually a nap) shifts the whole window by a day.
   → `sri.test.js`: *"锚点取「主睡眠最后一条」—— 拿 allSegs 当锚会让窗口整体前移"*
5. **Main sleep = the longest episode per wake day, `dur > 180`.** Episodes crossing midnight belong
   to their **wake day**.
   → `sri.test.js`: *"中间缺一整晚 ⇒ 不成对、SRI 为 null"*
6. **"7 nights" usually yields 5 pairs, not 6 — and that is not a bug.** The window is the last
   N×24 h before the final main sleep's wake time, so it can span **N or N+1 calendar days**, and only
   **calendar-adjacent days that both pass the `minDayMinutes` gate** form a pair. A day dropped by
   that gate **cuts the chain in two**: the run before it and the run after it each lose one pair.
   Concrete shape — 8 calendar days covered, 1 dropped mid-window ⇒ a 6-day run gives 5 pairs plus a
   leftover isolated day giving 0 ⇒ **5 pairs**. Read `pairs` and `skipped` together: `sri === null`
   means "no adjacent valid day-pair at all", which is a statement about your **data**, not your sleep.
   → `sri.test.js`: *"中间缺一整晚 ⇒ 不成对、SRI 为 null"* / *"LOO：孤立自然日 isolated=true 且 Δ=0"*
   ⚠️ **Short windows jitter — do not read a small drop as a trend.** Measured on real data (222 days),
   **consecutive 7-night windows differ by a median of 2.3 SRI points (p90 = 7.4)** — while the
   leave-one-day-out influence on the *full* 212-day window tops out at **0.7 points**. So a 1–3 point
   drop between two 7-night windows is **the window moving, not the person**. If you want to speak
   about a change in regularity, use a longer window or compare **non-overlapping** blocks — not two
   short ones that share most of their nights.
7. **`tz` is a fixed offset in hours — not a timezone name, and the library has no DST table.**
   `tz` is read **per record**, so the correct way to handle daylight saving is to carry the offset that
   was *actually in force for that record*: a summer night in a region that is `+2` in summer and `+1` in
   winter carries `tz: 2`, its winter counterpart `tz: 1`. What the library will **not** do is work it out
   for you — pass one constant `2` across the transition and those nights are silently an hour off, which
   moves bedtimes and can even move a night to the neighbouring calendar day.
   ⚠️ **This rule has no test pinning it**, unlike 1–6 — it only reproduces in a DST region, and the
   development machine (China, UTC+8 year-round) cannot produce it. That is precisely why it is written
   down here instead of being quietly assumed. The same care applies when handing data to another tool
   (R, Python): convert to **local wall-clock minutes** first, because `as.Date()` in R slices days by
   `tzone` while this library slices by the offset you passed — two different defaults that both look
   fine until they disagree by a day.
8. **SRI's day boundary is ONE reference timezone for the whole window** — and when you omit `tz` it is
   **inferred from the records**, not assumed to be `+8`. SRI compares *the same clock minute, 24 h
   apart*; if one day is cut in London and the next in Fiji, the same minute index is 12 h away and you
   are no longer measuring SRI. Measured on exactly that trip — 01:00→09:00 local in **both** places,
   but a 12 h jump in absolute time — per-record timezones give **SRI = 100.0** ("perfectly regular"),
   while one reference zone gives **33.3 / 47.2 / 55.6** for `tz` = 0 / 8 / 12. To read a trip "in local
   time", pass that zone explicitly: that is *choosing another reference*, not cutting per record.
   ⚠️ **This is not the same "day" as `normalize()`'s `ds`**, and the difference is deliberate: `ds`
   says *which wake-day a record belongs to* (each record's own timezone — correct), while the grid's
   day boundary is *the axis you compare on* (uniform). A stream that mixes timezones falls back to
   `+8` for the grid, and `auditRecords()` flags it (`tz.mixed`) so you can pick one explicitly.
   → `contract.test.js`: *"跨时区旅行：SRI 不许接近满分 —— 那意味着网格按记录各切各的了"*

## Tests are the spec

There is no coverage target here on purpose. What matters in this library is **not** "which lines
ran" but "did the numbers stay the same":

- **Test names are specifications.** Each test name states a rule in plain language; if you change
  behaviour, the name is what you argue with — not a percentage.
- **The one hard gate is the regression test.** `test/regression.test.js` re-runs real (private)
  data and asserts the anchors to 0.05 / 0.5 precision. If it fails, **the extraction broke the
  semantics — fix the code, never the anchor.**
- The regression test **skips** when the private data is absent, so a fresh clone stays green.

```bash
node test/sri.test.js                                # single file (works everywhere)
SLEEPMETRICS_REAL_DATA=/path/to/records.json npm run regression
```

> Note: `npm test` (batch mode) spawns a child process per test file. In some restricted sandboxes
> that fails with `EPERM`; running the files one by one always works.

## Size and performance

- **Published tarball: ~87 kB** (216 kB unpacked, 24 files) — no build output, no dependencies.
  (2026-10-15, `npm pack --dry-run`. Re-measure before quoting a precise figure: this line ships
  **inside** the tarball, so the number moves whenever the docs do.)
- **Pure ESM with no Node-only APIs** (`fs` / `net` / `process` / `Buffer`) ⇒ it also runs in the browser.
- Newest syntax used: `??`, `?.`, and a single `Array.prototype.at` ⇒ Node 16.6+ / browsers from 2022.
  `engines` says `>=20` on purpose (18 is EOL); it is a conservative floor, not a hard requirement.

Measured on a laptop, synthetic records with stages, whole-history calls:

| nights | `computeSRI` (all) | `sriLastN(7)` | `computePhase` | `auditRecords` |
|---|---|---|---|---|
| 100 | 37 ms | 4 ms | <1 ms | 1 ms |
| 1 000 | 344 ms | 3 ms | 1 ms | 2 ms |
| 3 650 (10 years) | 1.3 s | 5 ms | 2 ms | 6 ms |

`computeSRI` is the only call that is O(nights × 1440); the windowed form (`sriLastN`) is what you
normally use and stays in the millisecond range. A bit-packed comparison (~30× faster) is a known
possible optimisation that is **deliberately not taken**: the minute-by-minute loop is the readable
translation of the published formula, and a regression anchor pins its exact output.

## Types without a build step

This package is **plain JavaScript with JSDoc types** — deliberately, so that:

- consumers need no bundler, no `ts-node`, no peerTypeScript;
- the published artifact is the same code you read (no build output to trust);
- **you can still get full editor IntelliSense** — VS Code reads the JSDoc directly.

JSDoc is written on the **public boundary** (exported functions and the record shape); internal
helpers stay lightly annotated on purpose. If you want a type check in your own workflow, run it
without adding anything to this package:

```bash
npx --yes typescript tsc --noEmit --allowJs --checkJs src/*.js
```

No `.d.ts` is shipped yet — that is a **known, deliberate gap**, tracked as item #1 on the
[roadmap](ROADMAP.md). TypeScript consumers can enable `allowJs` and get types from the JSDoc today.
When real demand shows up, the answer is a **hand-written `.d.ts`**, never a build chain.

## What this library deliberately does NOT do

- **No network.** It never makes a request. Fetching data is someone else's layer.
- **No filesystem.** Input is an array, output is an object. (The CLI in `bin/` reads files —
  that is the only place, and it is not part of the library surface.)
- **No brand knowledge.** It does not know Xiaomi from Apple from Gadgetbridge.
- **No invented metrics.** Every number traces to a paper; provenance is in the source comments.
  In particular there is **no "sleep debt = accumulated missing hours"** — there is no accepted
  algorithm for that, and the two-process model literature argues against the metaphor.
- **No causal claims.** Activity and stress correlate with sleep (r ≈ -0.36 / -0.63 in the author's
  own data) and are confounded by holidays. Report facts, not stories.
- **No medical advice.**

## CLI

```bash
node bin/sleepmetrics.js sri   records.json --window 7
node bin/sleepmetrics.js phase records.json --free-days my-days.json   # --holidays is an alias
```

`--free-days` is the flag that answers "what counts as a free day for *me*" — see
[`isRest` is yours to define](#isrest-is-yours-to-define). If the file you pass marks a suspicious share
of days as free (or hardly any), the CLI says so instead of printing numbers that quietly mean nothing.

Add `--json` for machine-readable output.

## Three read-only companions

- **[`REFERENCES.md`](REFERENCES.md)** — recommended durations, population distributions, and cohort SRI
  values, **together with the measurement traps that make most quotes meaningless**: self-report and
  actigraphy differ by ~1.1 h in the *same people* and correlate at only r = 0.43, and the same NHANES
  actigraphy data yields a mean of 6.36 h or a median of 7.83–8.26 h depending on the scoring pipeline.
  **Documentation only — nothing in it is a threshold, and nothing in it is wired into any output.**
- **[`SLEEP-FACTS.md`](SLEEP-FACTS.md)** — six animals whose sleep is genuinely interesting, each with its
  measurement method stated (wild EEG vs an implanted actiwatch vs video observation). Deliberately
  **unconnected** to any metric here: cross-species comparison is three-way incomparable, and it is
  certainly not a diagnosis.
- **[`PUSHING-TO-YOUR-PHONE.md`](PUSHING-TO-YOUR-PHONE.md)** — how to get the numbers onto your phone
  **without handing them to anyone**: which options genuinely keep the data local (self-hosted ntfy or
  Gotify with the F-Droid client, Home Assistant local push, self-hosted Matrix) and which are an
  illusion (every third-party IM webhook — Telegram, Discord, Slack, 飞书, 钉钉, 企业微信 — carries the
  message through the vendor's servers **by construction**; no configuration changes that). Ships with a
  copy-paste example and the rate limits that were actually verified rather than assumed.

All three exist for the same reason this library has a regression gate: **a number without its
measurement method is not a number** — and the pipeline that carries it is part of its meaning too. They
are also the answer to *"why won't this library tell me whether my value is normal?"* — see
[`NON-GOALS.md`](NON-GOALS.md) §9.

## References

- **SRI** — Phillips AJK et al. *Social jetlag, chronotype and cardiometabolic risk.*
  Sci Rep 2017;7:3216. doi:10.1038/s41598-017-03171-4
  Formula as restated in: Lunsford-Avery JR et al. Sci Rep 2018;8:14158, Methods eq. (1).
- **MSFsc / SJL** — Roenneberg T et al. J Biol Rhythms 2003;18(1):80-90 and Curr Biol
  2012;22(10):939-43. Cross-checked against the R package `mctq` documentation.
- **Chinese statutory holidays** — `data/holidays.json` tracks the State Council notice
  (the `source` field records the document number and URL). Missing years degrade to "weekends only"
  and are reported through `missingYears()` rather than silently guessed.

## License

MIT. See `LICENSE`.
