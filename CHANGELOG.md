# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Numbers are a compatibility surface in this library: **any change that moves one is a minor bump,
> never a patch** (`RELEASE.md` §2).
>
> ⚠️ Two different things are pinned here — do not read one for the other:
> **real-data anchors** `74.108 / 65.972 / 86.03` have not moved since `0.1.0`; the
> **synthetic anchors** have — `0.2.0` deliberately moved the synthetic IS anchor `0.7588 → 0.4228`
> when the missing overall-mean centring was fixed. Each release below says which of the two it touched.

## [0.4.0] — 2026-10-16

> **No number moved.** The regression anchors **74.108 / 65.972 / 86.03** and every synthetic anchor are
> identical to `0.3.1` — confirmed by the anchors and all **14** test files. This release adds a
> **published surface**: hand-written types, a **`sriBootstrap()` entry point**, and the mechanical checks
> that keep both honest, plus **two new `auditRecords()` rules**.
> ⚠️ Note that its parts are **not the same kind of change**: the `.d.ts` pass touched `src/`
> **only in comments**, the bootstrap work **added code** (`src/bootstrap.js`, one new function in
> `sri.js`, one export), and the ghost-segment rules **changed which `ruleId` an existing overlap is
> reported under** — and still moved **no existing number** (the audit output feeds no metric).

### Added

- **★ `sriBootstrap()` — a confidence interval for SRI, resampled in the right unit.** A single SRI number
  invites **false precision** (worst at n = 7), so the interval is now available:
  `{ sri, lo, hi, level, resamples, block, seed, unit, degenerate, ... }`, computed with the **percentile
  method** — SRI is skewed near ±100, where a symmetric "± 1.96 SE" interval would run past the bounds.
  - ⚠️ **The unit of observation is the day-pair, never the epoch.** Epochs inside a night are strongly
    autocorrelated, so an epoch-level bootstrap returns a **fake-narrow** interval that looks authoritative.
    Enforced twice: the result **states its unit** (`unit: 'day-pair'`), and `test/bootstrap.test.js`
    **implements the epoch version as a counter-example** and requires the day-pair interval to be far wider
    (≈5× on the synthetic fixture). It is a *reverse-checked* guard: switching the implementation to the
    epoch unit turns **4 tests red**, that one included.
  - **Deterministic by construction.** The PRNG (mulberry32) is bundled instead of using `Math.random`, so
    the same input gives the same interval — a fact you can write down and a test can pin. `seed` changes
    it, and only it: the point estimate never moves.
  - **Small n gives a wide interval, and that width is the finding** (`ROADMAP.md`'s words) — pinned by a
    test that walks 7 → 14 → all nights and requires the interval to shrink. `block` defaults to 2 because
    **adjacent day-pairs share a day** (their `same` counts are not independent); the *direction* of that
    correction depends on the data — on this fixture i.i.d. resampling comes out **wider** — so it is a
    **dependency-structure** parameter, not a conservativeness knob. Stated, not guessed.
  - **`degenerate: true`** marks fewer than 2 day-pairs: the interval collapses to a point, and that must
    **not** be read as "very certain" (same class of trap as `sriLeaveOneOut`'s `isolated`).
- **CLI: `sri --ci`（＋`--seed N`）** — the interval on the human-readable path, and an `interval` object in
  `--json`. ⚠️ **The machine contract is untouched**: without `--ci` the top-level key set is
  character-for-character what the previous release emitted
  (`schemaVersion,sri,days,pairs,from,to,skipped,window,minDayMinutes` — verified by diffing the old CLI
  output, not assumed), and the interval is **not** duplicated from the top level: `interval` carries only
  `lo / hi / level / unit / resamples / block / seed / degenerate`. `--seed` without `--ci` is a
  **parameter error**, not a silent no-op.
  ✅ `verify-all.ps1` now pins **both** directions so neither can drift silently: **A6** (the key set is
  unchanged without the flag) and **A6b** (exactly one extra key, `interval`, with it).
- **Types**: `SRIBootstrapResult` / `SRIBootstrapOptions` in `sleepmetrics.d.ts`, with `unit: 'day-pair'` as
  a **literal type**, plus three new reverse cases in `test/types/expect-error.ts` (nullable `lo`, a
  required first argument, and an `'epoch'` unit that must not compile).
- **★ Hand-written type declarations — `sleepmetrics.d.ts`.** First-class TypeScript support with **no
  build chain**: the file is source, shipped in the tarball like everything else, and nothing generates
  it. `types` and a `types` condition in `exports` point at it, so consumers need no configuration and
  no `allowJs`.
  - **They were written field by field off the implementation and its tests**, deliberately: a wrong
    declaration is worse than none. `suggest()`'s return shape (the one that had to be read out of the
    code rather than guessed) is a **discriminated union**, as are `PhaseResult` and `NudgeDecision` —
    `if (r.insufficient)` narrows, so the other fields are absent in the type *and* at runtime.
  - **`Record` keeps its typedef name** even though it shadows the built-in `Record<K, V>`; the README
    documents the rename-on-import escape hatch.
  - ⚠️ The declarations follow **the code, not the prose** — and the field-by-field pass is what
    surfaced the drifted descriptions listed under *Fixed* below.
- **`scripts/check-types.mjs` — the type gate**, wired into `verify-all.ps1`. It requires that the
  declared **value** exports match the real module **name for name** (a missing name means consumers get
  no type; an extra one means the types promise something that does not exist at runtime), that every
  `@typedef` in `src/` is mirrored, and that `test/types/` compiles — with `@ts-expect-error` reverse
  cases that must **still** be errors, so a declaration that widens turns the gate red. Non-empty guards
  throughout (`AGENTS.md` 6), and **a missing compiler is a SKIP, not a pass**.
- **★ `sleepmetrics heatmap <records.json> [--window N]`** — a bedtime heatmap for the CLI: one character
  per night, one row per week, so **drift is visible at a glance** instead of inferred from a number.
  - The mapping lives in **`bin/heatmap.js`** (pure functions) rather than in the top-level script, so
    `test/heatmap.test.js` can actually assert it — `bin/sleepmetrics.js` executes on import and cannot
    be imported, and *"the picture looked fine"* is not a specification.
  - ⚠️ **The recorded design trap was real and is now pinned by a test**: bedtimes wrap past midnight, so
    the offset is relative to the **window's circular mean** (`circDiff()`, the shorter convention) and
    never linear onto 00:00–24:00. 23:50 and 00:10 must land in the **same** level — a linear scale would
    separate them by the whole ruler while they are 20 minutes apart.
  - **Missing nights get their own character** (`?`): folding them into the centre level would read as
    "slept right on time". The window anchor is the **last main sleep's wake** — the same one
    `sriLastN()` uses, so there is one anchor rather than two.
  - It **refuses `--json` visibly** rather than ignoring it: the `--json` key sets are a machine contract
    (`AGENTS.md` 4) and they stay clean, while a silent no-op would let a script author believe they got
    JSON.
- **★ Two `auditRecords()` ghost-segment rules — and the criterion they were planned with did not survive
  contact with the data.** `records.ghost-overlap` (two segments overlapping by ≥ **half of the shorter
  one**) and `records.ghost-fragment` (two segments separated by **less than 30 minutes** of wakefulness)
  both key on **time adjacency, never on duration** — a 20-minute nap and a 20-minute midnight leftover are
  indistinguishable by length alone. A heavy overlap is reported by the specific rule **instead of** the
  generic `records.overlap`, so one pair of records never yields two issues.
  - ⚠️ **The roadmap predicted "fragments left behind by a midnight split"; the data says otherwise.**
    Measured on **286 records over 215 wake-days**: this source **does not split at midnight** (all **28**
    cross-midnight segments are ≥ **76** minutes) and **no two segments are adjacent at all** (smallest
    positive gap: **70 minutes**). The planned rule would have fired **zero times** — and could not have
    been validated, which is exactly what the roadmap demanded of any threshold.
  - ✅ **What the data does contain is the false-positive shape, so it became the negative sample:**
    **66 nights** carry 2–3 segments whose gaps are **hours** (the afternoon-nap shape). Both rules fire
    **0 times** across them; the dataset's **only** hit is a genuine one — a night whose two segments
    overlapped by **409 minutes** (the shorter one is 47 minutes long).
  - **The 30-minute cut is therefore not tuned** (there is no positive sample to tune against). It is a
    semantic value with a **40-minute margin** to the smallest real gap. Real data stays on the machine:
    that audit run is one-off, and `test/audit.test.js` pins every case — the negative ones included.
- **★ `examples/records-csv.mjs` — a generic record ↔ CSV adapter** (2026-10-16). Standard records out to
  a CSV you can edit in a spreadsheet, and back. Two properties are **enforced rather than documented**:
  **epoch seconds are the only truth** (the human-readable `bed_iso` / `wake_iso` columns are *ignored*
  on import, deliberately — re-parsing an ISO string is the silent-timezone trap `TIMESTAMPS.md` spends
  a whole page on, and this adapter must not become a new door into it), and **row-count conservation**
  (`in = out + skipped`, a reason per skipped row, **non-zero exit** if anything was skipped — the
  specific failure `ROADMAP.md` names for AI-written parsers).
  Records and stages travel as **two tables** joined by `record_index`, so the round trip is
  **reversible** rather than approximate. ✅ Verified on the private dataset: 286 records + 6488 stages
  round-trip field-for-field (`286 = 286 + 0`). It stays in `examples/` (never in the package) and knows
  **no vendor format**, so `NON-GOALS.md` §5 is untouched.

### Fixed

- **★ Seven places where the prose had drifted from the code** (2026-10-16). Writing the `.d.ts` field by
  field is what surfaced them, and they are the failure mode this project keeps meeting: the
  implementation changed, a *description* did not, and **no assertion can see a sentence**. All seven now
  say what the code does. **None of them moves a number** — every change is a comment or a document.
  - **`AuditIssue.stageIndex` never existed.** `src/audit.js` documented the segment index as
    `stageIndex`, while every rule fills **`stage`** (`{ index, stage }`). The claimed name occurred
    **nowhere else in the repository** — it was never assigned, so a reader following the doc would get
    `undefined`.
  - **`LOOResult.base` never existed.** The implementation returns **`sri`** (and `bin/sleepmetrics.js`
    reads `sri`), in the same sense as `SRIResult.sri`. It is also **`number | null`**, not `number` —
    `null` when no calendar-adjacent valid pair survives.
  - **`AuditSummary.ok` was described as `error`-only.** It is
    `bySeverity.error === 0 && bySeverity.warn === 0`, so **a single `warn` makes it `false`**. Both
    readings are "stricter than nothing", but the description and the code have to say the same thing.
  - **`buildGrid()` returns `null` for a non-array input** — the JSDoc declared only
    `Map<string, Uint8Array>`, so a typed consumer would reach for `.get()` on `null`. That is exactly
    the "plausible-looking wrong thing" this library refuses elsewhere.
  - **`AuditIssue.ds` is documented but never filled.** No rule currently sets it; the typedef now says
    so instead of implying it is there.
  - **README: "passing something that is not an array at all *does* throw a `TypeError`"** — it has not
    behaved that way since 2026-10-14, when the non-array handling was unified to `[]` (array-returning
    functions), `null` (object/number-returning ones) and an `input.not-array` **error** from
    `auditRecords()`. The README now states that, **and** states what does throw: a bad *option*
    (`tz` outside `[−12, +14]` hours), loudly and from every entry point that takes one.
  - **`DISCLAIMER` was claimed on "every advisory return value."** `nudgeDecision()` has never carried
    one. `src/disclaimer.js` and the README API table now say it is **deliberately excluded**, with the
    reason — a gate verdict answers *"should the reminder fire"*, it is not advice about your sleep —
    rather than promising a field that is `undefined` at runtime.

### Documentation

- **README** gained a `### TypeScript` section: what ships, the two things that surprise people
  (discriminated unions, `Record` shadowing), and how the declarations are checked.
- **ROADMAP**: the type-declarations item moved from *Next* to *Done*; the **bootstrap item moved from
  *Next* to *Done** as well, recording what the trap actually cost.
- **README** also gained the `sriBootstrap()` **API row** and a new **Semantics** rule (9): why the interval
  resamples **day-pairs** rather than epochs, why a short window is wide **on purpose**, and why `block` is a
  dependency-structure parameter instead of a conservativeness knob. Its **size line** was re-measured while
  it was open — **~128 kB / 27 files** (it had been quoting ~87 kB / 24 files from 2026-10-15, already stale
  once the type declarations and the heatmap landed).

### Internal

- `src/bootstrap.js` — a generic circular **moving-block** bootstrap (`bootstrapCI`, `mulberry32`,
  `percentile`). **Deliberately not exported**: the unit is not an option, and shipping a "pick your own
  unit" helper would hand callers exactly the rope `ROADMAP.md` warns about. Its return type is inlined
  rather than declared as a named `@typedef` for the same reason — a named type on the published surface
  would imply the function is one.
- `scripts/verify-all.ps1`: A2 runs `test/bootstrap.test.js` (**15** test files after the CSV adapter
  landed), and **A6b** was added to pin the `--ci` key set from the other side (see above). **A8** now
  also exercises the records↔CSV **round trip**, not just "it exports" — "ran" and "did not run" have to
  stay distinguishable.
- `scripts/verify-all.ps1` **now returns an exit code** (2026-10-16). It used to print
  `❌ 3/21 项失败` and still exit **0** — the script contained **no `exit` statement at all** — so nothing
  automated could use it as a gate, and a "gate" nothing can read is not a gate. It now returns **1**
  whenever any item fails and **0** only when every item passes.
  - ⚠️ **`SKIP` counts as a failure**, matching `RELEASE.md` §1: with no TypeScript compiler on the
    machine A11 reports SKIP, and letting that pass would delete the gate rather than satisfy it.
    `Check()` consequently produces only PASS / FAIL — SKIP is passed in as a failure.
  - Known **"expected red"** states, which are *supposed* to fail: `C2a` (uncommitted changes) and
    `C2b` (local ahead of origin). Both must be green before publishing; neither is a false positive.

## [0.3.1] — 2026-10-15

> **No number moved — this is consistency repair only.** The regression anchors
> **74.108 / 65.972 / 86.03** and every synthetic anchor are identical to `0.3.0`. What it fixes is
> **two places that still described the old behaviour** after `0.3.0` changed it — found by an external
> review, which is exactly the failure mode prose-only changes have: nothing fails when they drift.

### Fixed

- **The CLI still said "完全规律 = 100，完全随机 = 0"** while `0.3.0` had already corrected SRI's
  documented range to **−100~100**. The line users actually read (`sri` output) and the `--help` text
  now both state the range and what the negative side means (*worse than chance*, not *worst*).
  The JSDoc was right and the CLI was stale — **the reader-facing copy was the one left behind**.
- **The CHANGELOG contradicted itself.** Its header claimed the anchors "have not moved since 0.1.0",
  while the `0.2.0` entry two screens down records the synthetic IS anchor going **0.7588 → 0.4228**.
  The header now separates the two things that are pinned: **real-data anchors** (unmoved since 0.1.0)
  and **synthetic anchors** (moved once, deliberately, in 0.2.0), and each release says which it touched.
- **`gridTz()`'s compromise value is now named.** When records carry several different timezones (or
  none), SRI locks the whole window to `+8` — that `+8` is **a compromise, not a correct answer**, and
  it was sitting in the code as a bare literal in two places. It is now `LOCK_TZ` with the reasoning
  next to it: there is only one reference timezone to give, no mixed dataset has a right one, so the
  lock is a written-down constant rather than a silent pick of the first timezone seen.

### Tests

- **123 → 124 assertions.** New contract test: **every mention of SRI's range, in `src/sri.js`,
  `bin/sleepmetrics.js` and `README.md`, must say `−100~100`** — so the drift above cannot come back
  as prose (it also asserts the range is actually *stated*, so the check can't pass by saying nothing).
- ⚠️ **A pre-existing bug in the test suite itself, found while adding the above:** the
  "every test file must actually run" self-check read `fs.fs.readFileSync` — `fs` is imported as a
  **default** binding, so it has no `.fs` property and the check would have thrown had it ever reached
  that branch. It was written to guard against orphan test files; it could not have caught one.

## [0.3.0] — 2026-10-15

> **One change in this release can reject input that used to be accepted — deliberate, and it cannot
> move a number.** A `tz` outside **−12…+14 hours** is now refused instead of accepted (see *Changed*).
> The regression anchors **74.108 / 65.972 / 86.03** are byte-for-byte the same as in 0.2.0, and the
> synthetic anchors are unchanged.

### Changed

- **★ `tz` is now range-validated** — `[−12, +14]` hours, the real-world extremes (Baker Island …
  Kiritimati). Previously *any* finite number was accepted, so `tz: 25` or `tz: 480` (minutes passed
  as hours — the single most likely mis-unit here) was taken **literally**, shifting every day
  boundary: day attribution, SRI day-pairs and phase windows all move, **the digits still look like
  numbers, and no assertion can see it**. That is exactly the "quietly wrong" failure this project
  refuses, so it is now a **visible** failure.
  - **Function-level** options (`computeSRI({tz})`, `normalize(recs, tz)`, `computePhase`, `suggest`,
    `auditRecords`, `dayOf`, `gridTz`…) ⇒ **throws `TypeError`**, message naming both the value and
    the allowed range.
  - **Record-level** `record.tz` ⇒ `normalize()` and the SRI grid's inference path **also refuse**;
    `auditRecords()` keeps its "dirty data never throws" contract and reports **`tz.out-of-range` at
    `error` severity** (a new rule) while falling back to the default.
  - One judgement call, shared by all of them: `TZ_MIN` / `TZ_MAX` / `isPlausibleTz()` in `src/time.js`,
    so `resolveTz()` and `auditRecords()` can never drift apart again.
- **`isPlausibleTz(null)` was `true`** while `isPlausibleTz(undefined)` was `false` — because
  `Number(null)` and `Number('')` are both **0**. Left alone, "**not given**" would have quietly become
  "**UTC+0**" while `resolveTz(null)` means "use the default". Now `null` / `undefined` / `''` / `[]`
  are all `false`; numeric strings like `'8'` are still accepted (same convention as record-level `tz`).

### Fixed

- **SRI's documented range said `0~100`; it is `−100~100`.** The formula is `−100 + 200·(same
  fraction)`, and the `−100` term is reachable — a window that swings far enough makes same-clock
  states systematically opposite. **Docs only** (the `SRIResult.sri` JSDoc and the module header);
  **no number changed**. Now pinned by an executable assertion in `test/sri.test.js` that **reaches
  both bounds** (100 for identical days, −100 for exactly complementary ones), so the range cannot
  drift back into prose.

### Docs

- **README first screen rebuilt** — project purpose, a **required-fields table** (what `bed` / `wake`
  / `tz` / `dur` / `stages` are, and that `bed`/`wake` are **epoch seconds**), a **copy-paste example
  with its real output**, and the **interactive-page entry** are now all above the fold. The two
  silent failure modes get named right there, with links.
- **Teaching page on the current CDN version** — `docs/index.html` now imports
  `sleepmetrics@0.2.0` instead of `@0.1`.
  ⚠️ **Verified against the CDN, not assumed:** esm.sh resolves `@0.2.0` (HTTP 200) and the served
  bundle imports and computes — `computeSRI()` on four identical nights returns `100`. That probe
  also shows the flip side of the change above: the published 0.2.0 **accepts `tz: 480`**, which is
  what 0.3.0 rejects.

### Tests

- **115 → 122 assertions**, all values unchanged: `isPlausibleTz` boundaries and type traps
  (`test/time.test.js`), all entries rejecting out-of-range `tz` while `auditRecords()` reports instead
  of throwing (`test/contract.test.js`), the `tz.out-of-range` severity + "in-range values must not be
  caught in the crossfire" pair (`test/audit.test.js`), and the SRI range bounds (`test/sri.test.js`).

## [0.2.0] — 2026-10-15

> **Two changes in this release can move a number — both deliberate.**
>
> 1. **`computeIS()` was missing the overall-mean centring** (see the IS entry under *Fixed*). It affects
>    **every** IS value; the synthetic anchor goes 0.7588 → 0.4228. IV is untouched.
> 2. **The SRI grid timezone is now inferred from the records** when `tz` is not passed (see the SRI entry
>    under *Fixed*). This moves a number **only if** your records carry a `tz` other than `+8` **and** you
>    were relying on the old hard-coded `+8` — then SRI snaps to the correct day boundary. Pass `tz`
>    explicitly and nothing changes.
>
> Under `RELEASE.md` §2 either one makes this a **minor** bump, not a patch. The real-data anchors
> **74.108 / 65.972 / 86.03** and the synthetic SRI / phase anchors are unchanged.
> It also carries `TIMESTAMPS.md`, which missed the 0.1.1 tarball.

### Added

- **`TIMESTAMPS.md`** — the step *before* the library, where things go wrong **silently**. Measured on a
  UTC+8 machine: **only a bare `YYYY-MM-DD` parses as UTC**, while every other offset-less form parses as
  *local* — so `'2026-03-01'` and `'2026-03-01T00:00'` end up **8 hours apart**, which moves a night
  across midnight and changes SRI without raising anything. The page also covers the
  seconds/milliseconds/microseconds trap (none of them throws), Excel serial numbers, split date+time
  fields, the absence of a DST table, and a **verified** `toEpoch` snippet built on
  `Date.UTC(...) − offset` so the host timezone is never consulted.
  ⚠️ **Not in the published 0.1.1 tarball** — it landed after that release (npm has 23 files, the repo
  now has 24). It ships with the next version; this entry exists so that cannot be forgotten.
- **`scripts/pack-smoke.mjs`** (`npm run smoke`) — packs the tarball, installs it into a clean temp
  directory, imports the **installed** package and computes a minimal result. The packaging check in
  `verify-all.ps1` only lists file *names*; it never imports anything, so "every file is present but
  importing it crashes" (a wrong `exports` map, a module missing from `src/`) would sail straight
  through it. This also runs in CI.
  It asserts **existence before values** (are the exports actually functions? does the version read?),
  and one of its assertions is that IS is *centred* — so a regression of the formula fix above cannot
  reach a published tarball unnoticed.
  ⚠️ Windows note: Node refuses to spawn `npm.cmd` directly (`spawnSync npm.cmd EINVAL`, hardened after
  CVE-2024-27980) and `shell: true` triggers `DEP0190`, so the script goes through `cmd.exe`
  explicitly with arguments kept in array form.

### Fixed

- **`auditRecords()` and `normalize()` now share a single record-validity rule** (`recordFaults()`,
  exported from `src/records.js` for the two modules, deliberately **not** re-exported as public API).
  They used to judge separately, with a consequence this library exists to prevent: the audit reported
  `ok: true` for records that `normalize()` then **dropped silently** — `{bed: 0, wake: 1000}` was even
  diagnosed as `dur.too-long`, i.e. the *wrong cause entirely*. The contract now is one sentence:
  **every record `normalize()` drops produces an `error` from `auditRecords()`**, and
  `summary.records` always equals the number of records `normalize()` keeps. New rules:
  `time.bed-not-positive`, `time.wake-not-positive`. Pinned by `test/contract.test.js`, which carries a
  **non-empty guard** so the invariant cannot pass on a degenerated sample.
- **`dur <= 0` has its own rule** (`dur.non-positive`, warn) instead of being filed as "a short nap"
  (`dur.too-short`, info) while `ok` stayed `true`. A negative duration is not *short*, it is
  *impossible* — it needs its own name, not a softer synonym.
- **A non-numeric or non-positive `dur` no longer deletes the whole record.** `normalize()` treats it as
  "not given" and falls back to `(wake - bed) / 60`, which is what `auditRecords()` already did. A dirty
  field used to cost an entire 8-hour sleep episode; now it costs one field. `null` keeps its existing
  "not given" meaning (and is still not read as 0 minutes).
- **`wake <= bed` records no longer enter the audit's counts** (`summary.records` / `days`) — the shared
  rule drops them, exactly as `normalize()` always dropped them downstream. They are still reported, as
  `time.wake-not-after-bed` (error); previously the audit counted them while `normalize()` discarded them.
- **`npm test` never ran `test/contract.test.js`.** Both `npm test` and `scripts/verify-all.ps1` list
  test files explicitly, and CI only runs `npm test` — so a new file is silently outside the gate, green
  locally and non-existent in CI. Added a self-check asserting every `test/*.test.js` appears in
  `npm test` (negative-tested: an orphan file turns it red).
  ⚠️ Found in the same session, same family: **`npm test` chains files with `&&`, so the first failing
  file hides every file after it.** A run that reported "92 pass / 1 fail" had actually never executed
  `anchor-synthetic` or `regression` — the anchors looked fine only because nothing checked them. Run
  the files individually (as `scripts/verify-all.ps1` does) when you need the whole picture.
- **Extreme-but-finite timestamps were the one input *worse* than an exception: they made the library
  not come back.** `normalize()` / `auditRecords()` threw `RangeError: Invalid time value`
  (`new Date(9e18).toISOString()`), and `buildGrid()`'s marking loop — `for (t = …; t < to; t += 60)`,
  iterations ∝ span/60 — took **6717 ms for `wake = 6e8`** (building a 6945-day grid) and would need
  roughly **1.5e14 iterations** for `9e15`. **An exception is visible; a hang is not.** Two rules now
  turn both into *named* errors: `time.not-representable` (outside what `Date` can represent,
  ±8.64e12 epoch seconds) and `time.span-too-long` (a single episode spanning over 24 h).
  `buildGrid()` also guards itself, because it is **exported** and may be called directly with no
  `normalize()` upstream. `stages.span-too-long` reports a stage wider than 24 h that the grid skips —
  the skip is *stated*, not silent. The bound is **24 h**, matching the existing `dur.too-long`
  semantics; real data measures 9.57 h max per record (121 in-window · 284 overall) and 1.3 h per
  stage, so the margin is wide. The bound itself lives in **one** place (`DATE_MAX_SEC`, imported by
  `sri.js` from `records.js`) — a second literal would drift, and one nearly did during this change.
- **Diagnosis order is now part of the contract: report the cause before the consequence.** A
  milliseconds-vs-seconds mistake inflates the span 1000×, and was being reported as *"this episode
  spans 333 days"* — every value legal, the wrong cause named. `time.looks-like-milliseconds` is now
  emitted **first**. This is the same misdiagnosis class as `{bed: 0}` → `dur.too-long` above, and the
  existing test that pinned the millisecond rule caught it within one run.
- **Public entry points now agree on how they treat *configuration* — which is the opposite of how they
  treat *data*.** `normalize(recs, 'xx')` and `computeSRI(recs, {tz: 'xx'})` threw
  `RangeError: Invalid time value` (`'xx' * 3600` → `NaN` → `new Date(NaN).toISOString()`), while
  `auditRecords(recs, null)`, `suggest(recs, null)`, `computeSRI(recs, null)`, `chronotype(v, null)` and
  six more threw `TypeError` — because a default parameter `= {}` covers `undefined` but **not an
  explicit `null`**. Two rules now hold at every entry point:
  - **an options object that is `null` / `undefined` means "not given"** ⇒ defaults apply. That is the
    same meaning `dur: null` already had in `auditRecords()`.
  - **an invalid `tz` throws a `TypeError` that names its caller** (`normalize: tz 必须是有限数…`),
    because `tz` is *configuration*, not data. Invalid **data** still returns `null` / `[]` (the
    existing "don't guess" rule); but a silently substituted timezone computes **a different day
    boundary** — it moves a night across midnight and changes SRI's day-pairs, **and no assertion can
    see it**. Configuration errors fail visibly instead.
  One shared predicate backs all of it (`resolveTz()` in `src/time.js`, deliberately **not** public
  API), including the low-level `dayOf` / `dayStartSec` / `clockMin`, which used to disagree with each
  other (`dayOf` threw; the other two returned `NaN`). Fixed along the way: a function-level `tz` of
  `'8'` was passed through **as a string**, so normalized records carried `tz: '8'` instead of `8`.
  `0` is a valid timezone (UTC) and is still not treated as an empty value.
  ⚠️ **Nothing changed for a *record-level* `tz`**: an invalid one still falls back to the default,
  because that path reports the fallback via `tz.not-a-number` — so the fallback is *visible*. The two
  paths differ on purpose, and both now say so in comments.
  No numbers moved here either: valid calls never reach the new throw branches.
- **SRI's day boundary is now explicitly *one* reference timezone for the whole window — and it is
  inferred from the records when not given.** SRI compares `δ(s_{i,j}, s_{i+1,j})`: *the same clock
  minute, 24 h apart*. If day *i* is cut in London and day *i+1* in Fiji, the same `j` is 12 h off and
  you are no longer measuring SRI. Measured on a trip that was 01:00→09:00 local in **both** places yet
  jumped 12 h in absolute time: **per-record timezones give SRI = 100.0** ("perfectly regular"), while
  one reference zone gives **33.3 / 47.2 / 55.6** for tz = 0 / 8 / 12. So: one zone for the window.
  To read a trip "in local time", pass that zone explicitly — that is *choosing another reference*, not
  cutting per record. The default also stopped being a hard-coded `+8`: a dataset that is entirely
  `tz:-5` and forgets to pass `tz` used to be shifted 13 h **silently**, with SRI still returning a
  plausible-looking number. Mixed timezones fall back to `+8`, and `auditRecords()` still flags them
  (`tz.mixed`).
  ⚠️ This is **not** the same "day" as `normalize()`'s `ds`, and the difference is deliberate: `ds` says
  *which wake-day a record belongs to* (each record's own timezone — correct), while the grid's day
  boundary is *the axis you compare on* (must be uniform). Both definitions now say so.
- **`buildGrid()` no longer means two different things depending on how you call it.** With
  `stages: [null]`, calling it **directly** produced a **0-day grid** (the whole episode vanished), while
  the same record through `normalize()` produced a 1-day grid: `normalize()` filters invalid stages to
  `null` so the grid fell back to `bed..wake`, whereas a non-empty `stages` array took the staging path
  and marked nothing. It now falls back to the whole episode whenever **no** stage was marked. Pinned by
  a test asserting both paths mark the same 480 minutes.
- **`computeIS()` / `computeIV()` return `null` instead of `NaN` on overflow.** Finite inputs are not
  enough: `1e308` squared is `Infinity`, and `Infinity / Infinity` is `NaN` — a value that looks like a
  number. Both now check the result with `Number.isFinite()` and say "cannot compute" instead.
- **`npm test` no longer stops at the first failing file.** It chained files with `&&`, so a failure
  early in the list meant everything after it **never ran** — observed live: a run reporting
  "92 pass / 1 fail" had never executed `anchor-synthetic` or `regression`, so the anchors looked fine
  only because nothing checked them. `scripts/test-all.mjs` runs every file, prints the total, and exits
  non-zero if any failed. It also **discovers** `test/*.test.js` rather than listing them, so a new file
  cannot silently stay outside the gate (the self-check in `test/contract.test.js` now recognises both
  arrangements).
- **README**: the size line claimed 47.6 kB / 115 kB / 19 files; it is **85.3 kB / 210.6 kB / 24 files**
  (measured 2026-10-15, with a note to re-measure). Added a **Run it right now** section — eight
  synthetic nights, copy-paste, with the verified output printed beside it — because the old Quick start
  referenced `records` and `holidaysTable` without defining either.
- **⚠️ `computeIS()` was wrong: its numerator and denominator both omitted the overall-mean centring.
  This is a *numbers-moving* fix.** The formula is `IS = N·Σ_h (x̄_h − x̄)² / (p·Σ_i (x_i − x̄)²)`; the
  implementation computed `N·Σ_h x̄_h² / (p·Σ_i x_i²)` — a ratio of raw second moments instead of
  variances. Four independent lines of evidence:
  1. **Reference implementation**: `cran/nparACT`'s `nparACT_IS()` subtracts the mean. Its IV also
     subtracts — and this library's `computeIV()` matched it **bit-for-bit across four sequences** — so
     the IS version was a transcription slip, not a deliberate alternative convention.
  2. **Internal inconsistency**: this library already centred IV, in the same formula family.
  3. **Math**: without centring, `IS = (c + K) / (d + K)` with `K = N·p·x̄²`, which drifts toward 1 — the
     higher a signal's baseline relative to its variation, the more "perfectly regular" it looks.
  4. **Measured**: on `[1000,1005,1000,995, 1000,995,1000,1005]` — two days whose patterns are exact
     opposites — the old code returned **0.99999** ("perfectly regular"); centred, it returns **0**.

  The synthetic IS anchor moved **0.7588 → 0.4228** (`iv` did not move, because IV was already right).
  That anchor was **taken from the implementation**, so it could only ever guard against drift — it never
  proved the formula. The proof now lives in `test/rhythm.test.js`, as a reference implementation
  transcribed line-by-line from nparACT. The CLI does not expose IS/IV, so only library callers are
  affected. ⚠️ **Per `RELEASE.md` §2 this is a minor bump, not a patch** — any change that moves a
  number is.

> **Numbers.** The real-data anchors **74.108 / 65.972 / 86.03** and the synthetic SRI / phase anchors
> are bit-identical to 0.1.1 — measured before touching anything: across the 121-record real window
> **0 records** carried those defects, and the widest record spans 9.57 h. **Two changes can move a
> number, and both are deliberate**: the **IS** formula (0.7588 → 0.4228, affecting every IS value) and
> the **SRI grid timezone** now being inferred from the records instead of assumed `+8` (affecting only
> datasets whose `tz` is not `+8` *and* which relied on that default). Either one makes this a minor
> bump — see the note at the top of this release.

## [0.1.1] — 2026-10-14

### Added

- **`REFERENCES.md`** — recommended durations, population distributions and cohort SRI values, **each
  row carrying its measurement method**. It leads with the traps rather than the numbers: AASM/SRS say
  *"7 or more hours"* (the ubiquitous *"7–9"* is NSF's figure), self-report and actigraphy differ by
  ~1.1 h in the same subjects (r = 0.43), and identical NHANES actigraphy data yields 6.36 h or
  7.83–8.26 h depending on the scoring pipeline. **Docs only — never wired into output.**
- **`SLEEP-FACTS.md`** — six species whose sleep is genuinely interesting, **each with its measurement
  method stated** (wild EEG · implanted actiwatch · video observation · geolocator), plus a
  "how these numbers go wrong" section. Deliberately unconnected to any metric.
- **`PUSHING-TO-YOUR-PHONE.md`** — the networking layer, kept outside the library. Its centrepiece is a
  **data-flow table**: a webhook *is* an instruction to hand the content to someone else's server, so
  the IM bots cannot satisfy "it stays on my machines" by construction. Only self-hosted ntfy/Gotify
  (F-Droid client), Home Assistant local push and self-hosted Matrix qualify.
- **`CHANGELOG.md`** (this file).
- **`--json` now carries `schemaVersion`** (currently `1`) in all three commands. Without it, anyone
  writing a script against the output gets broken silently by a structural change — exactly the
  failure mode this library refuses. See the compatibility rule below.
- **`examples/export-for-r.mjs`** + **`examples/crosscheck-mctq.R`** — a **timezone-free** hand-off that
  gives R only aggregate inputs (no timestamps), plus the R side that recomputes MSFsc/SJL with `mctq`.
- **`scripts/verify-all.ps1`** — one command, 18 checks: syntax gate, all test files, the regression
  anchors, README links, published-tarball contents, the `--json` contract, zero-deps + no IO imports
  in `src/`, both examples, the R cross-check, the local tooling, doc-tree hash parity and git state.
- **`test/aside-guard.test.js`** — pins that no `aside()` call site may pass a physiological key, and
  that the guard itself still exists (negative-tested: injecting an `hr` key turns it red).
- README §*Semantics* rule 7: **`tz` is a fixed offset in hours, not an IANA zone** — the library has no
  DST table. Explicitly marked as the one rule no test can pin (China has no DST).
- README §*Semantics* now also documents **short-window jitter**: on real data, consecutive 7-night
  windows differ by a **median of 2.3 SRI points (p90 = 7.4)**, while leave-one-day-out influence on the
  full 212-day window tops out at **0.7 points** — so a 1–3 point drop across two short windows is the
  window moving, not the person.
- **`test/anchor-synthetic.test.js`** — an anchor gate that **always runs**: deterministic synthetic
  data (fixed seed), no private data required. Motivated by a real defect — CI's `npm run regression`
  step was **green while never executing** (it skips without private data). It pins the whole pipeline's
  output on that synthetic series (SRI / MSFsc / SJL / IS / IV) and is **negative-tested**: changing an
  anchor by 0.01 turns it red. The regression gate still skips in CI *by design* — it is simply no
  longer the only thing standing there.

### Changed

- **Asides are forbidden on physiological metrics** (heart rate / HRV / SpO₂ / respiration /
  temperature / stress). A playful remark there reads as a medical hint, and that is the most
  anxiety-prone data of all — the flip side of "no medical advice". Enforced by a `PHYSIO_KEYS` guard
  at the top of `aside()` (silent return) plus the test above.
- `package.json`: **`"sideEffects": false`** (pure functions — bundlers can tree-shake safely) and
  **`exports` now includes `"./package.json"`** (some toolchains read it and would otherwise fail with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`).
- `NON-GOALS.md` §9 now also refuses a *"your value vs the population"* comparison table, and states the
  alternative: report the user's **own** history.
- `RELEASE.md` §1 points at `scripts/verify-all.ps1`; the manual steps remain for troubleshooting.
- `src/records.js`: documented the `mainSleep()` vs `dailyMain()` distinction — the former returns **all**
  qualifying episodes (not one per wake day), so using it for per-night trends silently counts daytime
  naps as main sleep.

### Fixed

- **UTF-8 BOM in JSON inputs no longer breaks the CLI.** Windows tooling (Notepad, Excel,
  PowerShell's `Set-Content -Encoding UTF8`) writes a BOM, and `JSON.parse` throws
  `Unexpected token '\uFEFF'` — a failure that *looks like* a corrupt file. `bin/` now strips it at the
  read boundary; the library never reads files, so it has no BOM problem at all. **Negative-tested**:
  removing the strip turns the CLI red on a BOM-prefixed file.
- **`stages: [null]` no longer throws.** `normalize()` filters invalid stage entries and `buildGrid()`
  guards them independently; `auditRecords()` reports them as `stages.missing-time` — so the dirt stays
  **visible but not fatal**.
- **Non-array inputs now behave consistently.** Previously `normalize(42)` threw, while
  `normalize('abc')` and `normalize(null)` returned `[]`. The rule is now explicit and uniform:
  **array-returning functions ⇒ `[]`; object/number-returning functions ⇒ `null`**. `auditRecords()`
  is the deliberate exception — it returns a **diagnostic report** carrying an `input.not-array` error.
- **Regression gate now pins the window *lower* bound** (`FROM = 2026-07-13`). `FREEZE` alone only
  blocked *future* records; back-filling history expanded the all-time window from 85 to 209 days and
  diluted the anchor to 74.303, turning the gate red for no reason. The anchors themselves are
  unchanged — only the取数 window was tightened.
- CLI `--json` output sites now include `schemaVersion` (see above).
- `NON-GOALS.md` §8: **reworded** — `npm search actigraphy` returns this package today (it returned
  nothing before 0.1.0), so the "vacuum" framing was retired. The boundary argument is unchanged, and
  the passage now says explicitly that this is a **catalogue changing, not a territory claimed**:
  **more implementations should follow**, and the boundary is about *what belongs where* — not about who
  got here first.

### Notes

- **R cross-check passed** (mctq 0.3.2 / R 4.6.1): on 222 days of real data, **MSFsc Δ = 0.000000 h and
  SJL Δ = 0.000000 h** (1 s tolerance), and `mctq::sjl()`'s default `method = "shorter"` matches this
  library's circular convention. Scope caveat: this validates the **formula**, not the pipeline.
- The cross-check also **surfaced a branch this library does not have**: when `sd_f <= sd_w` (free days
  *not* longer than work days) mctq skips the correction and returns MSF, while this library always
  computes `SO_f + SD_week/2`. **Deliberately not changed** (the anchors pin the numbers, and without
  alarm information "always free-day form" is the self-consistent choice) — recorded in `src/phase.js`
  as a **known convention difference, not a bug**.
- **`schemaVersion` compatibility rule:** adding a field is backwards-compatible and does **not** bump
  the version (it is noted here instead); **renaming, removing or changing the meaning of a field
  bumps it.** Consumers should check it and fail loudly rather than read a different shape silently.

## [0.1.0] — 2026-10-13

### Added

- First release: SRI (`computeSRI` / `sriLastN` / `sriLeaveOneOut`), circadian phase
  (`computePhase`: MSW / MSF / MSFsc / SJL), the rule-layer suggestion engine (`suggest` /
  `nudgeDecision`), data-health audit (`auditRecords`), IS/IV (`computeIS` / `computeIV`),
  circular statistics (`circStats`), chronotype mapping with caller-supplied cut points, and a CLI
  (`sri` / `phase` / `audit`, human-readable and `--json`).
- **Zero dependencies, no build step**, library core touches neither the filesystem nor the network.
- The regression gate against real (private) data, **which skips when that data is absent**.

[0.1.1]: https://github.com/zlw6639-collab/sleepmetrics/releases/tag/v0.1.1
[0.1.0]: https://github.com/zlw6639-collab/sleepmetrics/releases/tag/v0.1.0
