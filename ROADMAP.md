# Roadmap

This project is intentionally small. What follows is the **whole** plan — no dates are promised,
and the last section lists what will **not** happen.

## Next


- [ ] **Adapters** — generic JSON → CSV first; vendor formats only when somebody actually asks.
- [ ] **A "write your own adapter with a local AI" prompt template** (2026-10-14).
      Vendor exports are frequently **gigabytes** — far too large to paste into a web chat — while a
      local IDE agent (Cursor / Claude Code) can read them **in a streaming pass** and emit the standard
      record array. That turns "please support my watch" into a task the user finishes in one evening.
      ⚠️ **Documentation only — never a bundled adapter.** No brand may enter the repository
      (`NON-GOALS.md` §5), so the template must be **format-agnostic**: standard record shape in, the
      user's own sample file as the only brand-specific input.
      ⚠️ **The real risk is silent data loss.** An AI-written parser that quietly drops rows yields
      numbers that look perfectly fine — precisely what `auditRecords()` exists to catch. So the template
      must *require* three self-checks: **row-count conservation** (in = out + explicitly counted skips),
      one run of `auditRecords()`, and one run of `computeSRI()` that does **not** return `null`.


## Done

- [x] **Cross-check the numbers against an R implementation.**
      `mctq` (MSFsc / SJL) is the reference implementation for the phase formulas. Today we verify against
      *hand-computed* cases plus one frozen real-data anchor; an independent cross-check would be stronger
      evidence. (R is not installed on this machine — being installed manually, as of 2026-10-14.)
      **Scope: phase only, not SRI.** `sleepreg` needs Rtools to compile, and its counts/diary conventions
      can never be bit-identical to this library's binary δ + local gates (180-minute valid day, single
      window anchor) — so when they disagree there is **no way to tell who is wrong**. MSFsc/SJL admits a
      clean comparison because `mctq::msf_sc()` consumes *aggregates*, not records.
      ✅ **Prerequisite done (2026-10-14): the exchange format exists** — `examples/export-for-r.mjs` emits
      the aggregate inputs and nothing else. Do **not** hand raw timestamps to R: `as.Date(POSIXct)` slices
      days by `tzone` (system default — often UTC) while this library slices by a **fixed offset**; the two
      defaults differ **silently**, and the only symptom is a one-day shift in *which night a record
      belongs to* — which then moves MSFsc/SJL. Hand over **numbers**, so the timezone question is settled
      once, locally, before either side sees the data.
      ⚠️ **This checks the formula, not the pipeline** — identical aggregates isolate the published
      equation, which is the only thing a second implementation can actually adjudicate. State that when
      reporting the result.
      ⚠️ **Known convention gap, not a bug:** mctq returns `NA` for MSFsc when free days are alarm-driven
      (`alarm_f = TRUE`). A wearable cannot tell, so this library **always** computes the free-day form —
      reconcile that before calling any difference a discrepancy.
      ⚠️ **Decide the verdict rule first:** unequal numbers ⇒ **investigate the convention, never nudge the
      regression anchors** (74.108 / 65.972 / 86.03). The artefact is **one-off evidence**: real data does
      not leave the machine and does not enter CI or the published package.
      ⚠️ **Related limitation, same root:** `tz` here is a **fixed offset, not an IANA zone** — the
      library does not know about DST. A DST region is off by an hour on transition days. China has no
      DST, so **this machine can never catch that bug** ⇒ it has to be *documented*, not tested away.
      ✅ **Result (2026-10-14 · mctq 0.3.2 / R 4.6.1):** on 222 days of real data the two
      implementations agree **exactly** — MSFsc Δ = 0.000000 h, SJL Δ = 0.000000 h (tolerance 1 s) —
      and mctq::sjl()'s default method = "shorter" matches this library's circular convention.
      ⚠️ **The cross-check also surfaced a branch this library does not have:** when sd_f <= sd_w
      (free days *not* longer than work days) mctq **skips the correction** and returns MSF, while this
      library always computes SO_f + SD_week/2. The two disagree on such data; ours happened to fall
      in the sd_f > sd_w branch. **Deliberately not changed** — the anchors pin the numbers, and
      without alarm information "always free-day form" is the self-consistent choice.
      Tools: `examples/export-for-r.mjs` + `examples/crosscheck-mctq.R`.
- [x] **`suggest()` — the rule engine.** Every suggestion carries a `ruleId` plus the numbers that
      triggered it; **no invented metrics** (no "sleep debt", no 90-minute cycles).
- [x] **`nudgeDecision()`** — the "should tonight's reminder fire" gate, as a pure predicate.
- [x] **`auditRecords()`** — data health report (dirty data never throws; it just lies quietly).
- [x] **`circStats()`** (mean · circular SD · concentration `R`) · **`chronotype()`** ·
      **`compareChronotype()`** — all with caller-supplied cut points: no single clock time fits every
      population, and no questionnaire is shipped.
- [x] **CLI** — `sri` / `phase` / `audit`, human-readable and `--json`.
- [x] **CI** — ubuntu + windows × node 20/22/24, including the README-links-must-ship check.
- [x] **`computeIS()` / `computeIV()`** — interdaily stability & intradaily variability
      (van Someren 1999). They take a **generic numeric series**, so callers holding real activity
      counts get the comparable form. The **counts-vs-binary caveat lives in the source and is pinned
      by a test** (`rhythm.test.js`) — a warning that can be silently deleted is not a warning.
- [x] **`sriLeaveOneOut()`** — leave-one-day-out influence: *which night is dragging the index down?*
      SRI decomposes into day-pairs, so dropping one day only removes the pairs that touch it —
      **no full recompute, and the result is exact** (cross-checked in `sri.test.js` against literally
      deleting that day and re-running).
      ⚠️ **It is a small-window tool.** One night is worth **±11 points at n=7** but **under ±1 point
      at n=85** — on a long window the deltas *look* like noise, and that is the correct reading.
      `isolated: true` marks a day that participates in **no pair at all**: dropping it cannot change
      anything, and that must **not** be read as "this night was regular". CLI: `--influence`.
- [x] **Confidence intervals for SRI (bootstrap)** (2026-10-16) — `sriBootstrap()`:
      `{ sri, lo, hi, level, resamples, block, seed, unit, degenerate, ... }`, **percentile method** (SRI is
      skewed near ±100, where a symmetric interval would run past the bounds) and a **bundled PRNG** so the
      same input always yields the same interval — a fact you can write down and a test can pin.
      ✅ **The recorded trap was the whole design.** The unit of observation is the **day-pair**, never the
      epoch: epochs within a night are autocorrelated, so an epoch-level bootstrap returns a
      **fake-narrow** interval that looks authoritative. Two things enforce it — the result **states its
      unit** (`unit: 'day-pair'`), and `test/bootstrap.test.js` **implements the epoch version as a
      counter-example** and requires the day-pair interval to be far wider (≈5× on the synthetic fixture).
      The guard was **reverse-checked**: switching the implementation to the epoch unit turns 4 tests red,
      that one included.
      ✅ **Wide at small n, and that width is the finding** — pinned by a test that walks 7 → 14 → all
      nights and requires the interval to shrink. `block` defaults to 2 because adjacent day-pairs **share a
      day**; the correction's *direction* depends on the data (measured: i.i.d. resampling comes out wider
      on this fixture), so it is a **dependency-structure** parameter, not a conservativeness knob — that
      was stated after measuring, not assumed.
      `degenerate: true` marks < 2 day-pairs (the interval collapses — **not** "very certain").
      CLI: `sri --ci [--seed N]`; `--json` gains `interval` **only when asked**, so the key set is unchanged.
- [x] **Disclaimer** — `DISCLAIMER.md` (6 sections) + `DISCLAIMER` on every advisory return value.
- [x] **Asides are forbidden on physiological metrics** (2026-10-14) — heart rate / HRV / SpO₂ /
      respiration / temperature / stress. A playful remark there reads as a **medical hint**, and that is
      the most anxiety-prone data of all; it is the flip side of "no medical advice" (`NON-GOALS.md` §2).
      Enforced twice over: a `PHYSIO_KEYS` guard at the top of `aside()` (silent return, not a softer
      line), plus `test/aside-guard.test.js`, which pins both *"no call site may pass a physiological
      key"* and *"the guard itself still exists"* — and it is **negative-tested**: injecting an `hr` key
      turns it red.
- [x] **`REFERENCES.md` — curated authoritative sources** (2026-10-14). Recommended durations,
      population distributions and cohort SRI values, **each row carrying its measurement method**.
      The file leads with the traps rather than the numbers, because the traps are the finding:
      **AASM/SRS 2015 says "7 or more hours"** and the ubiquitous *"AASM recommends 7–9"* is a misquote
      of NSF; self-report and actigraphy differ by **~1.1 h in the same subjects** (r = 0.43); and the
      *same* NHANES actigraphy data yields a mean of 6.36 h or a median of 7.83–8.26 h depending on the
      scoring pipeline. WHO has **no adult sleep-duration recommendation at all** (guidance stops at
      age 5). **Docs only — never wired into output**: rendering it as "your value vs the population" is
      the comparison `NON-GOALS.md` §9 refuses, and the alternative is stated there (the user's **own**
      history: *"your last 30 nights sit at the 62nd percentile of your own 222"*).
- [x] **`SLEEP-FACTS.md` — animal sleep, as true fun** (2026-10-14). Six species, **each with its
      measurement method stated** (wild EEG · implanted actiwatch · video observation · geolocator), plus
      a "how these numbers go wrong" section covering captivity inflation, behaviour-vs-EEG confusion,
      and inference hardening into fact. Deliberately **unconnected to any metric** — cross-species
      comparison is three-way incomparable. It keeps the swift **as a warning**: the popular
      "sleeps in flight" claim comes from a study that never measured sleep.
- [x] **`PUSHING-TO-YOUR-PHONE.md` + `examples/push-ntfy.mjs`** (2026-10-14) — the networking layer,
      deliberately kept **outside** the library. Its centrepiece is a **data-flow table**: a webhook *is*
      an instruction to hand the content to someone else's server, so Telegram / Discord / Slack /
      飞书 / 钉钉 / 企业微信 **cannot** satisfy "it stays on my machines" **by construction** — no
      configuration changes that. Only self-hosted ntfy/Gotify (with the F-Droid client, which bypasses
      FCM), Home Assistant local push (WebSocket, not APNs/FCM) and self-hosted Matrix qualify.
      It also records the gap nobody ships: **the data end and the push end both exist, the middle
      (read → compute → POST) is yours to write** — shipped as a copy-paste example with `--dry-run`.
      Rate limits are split into **verified** (ntfy.sh: 60-message burst then 1 per 5 s, messages cached
      12 h; Slack: ~1 msg/s per channel, 16 KB hard limit, 429 + `Retry-After`) and an explicit
      **not-verified** list, because quoting an unread limit is how a pipeline truncates silently.
- [x] **Interactive teaching page + GitHub Pages** (2026-10-15) — `docs/index.html`, deployed by
      `.github/workflows/pages.yml`. Two sliders (*centre* and *amplitude*) recompute SRI live, because
      *"average bedtime and regularity are different axes"* is something you have to **watch**: move the
      centre slider and the average moves while SRI holds; move the amplitude slider and the average
      holds while SRI falls. It imports the real library from a CDN (zero build) and uses **synthetic
      data only** (the page is public) — with **computed** values throughout; the hand-drawn prototype
      it came from had one of its five points off by 0.32.
- [x] **Hand-written type declarations (`sleepmetrics.d.ts`)** (2026-10-16). First-class TypeScript
      support with **no build chain**: the file is source, exactly like the rest of the tarball, and
      nothing generates it (`RELEASE.md` §6). `types` plus a `types` condition in the `exports` map point
      at it, so `import { computeSRI } from 'sleepmetrics'` is typed with **no configuration and no
      `allowJs`**.
      ⚠️ **Written field by field off the implementation and its tests** — a wrong declaration is worse
      than none, so `suggest()`'s return shape was read out of the code rather than guessed. That pass is
      also what makes the prose drift visible: the audit issue's segment index is really **`stage`**
      (the typedef said `stageIndex` — a name that occurs nowhere else in the repo), `LOOResult` carries
      **`sri`** (not `base`), `AuditSummary.ok` is `false` on a **`warn`** too (not only on an `error`),
      and `buildGrid()` returns **`null`** for a non-array input (the JSDoc said `Map`). The declarations
      follow **the code**, and every divergence is flagged in place rather than smoothed over.
      ✅ **Two decisions worth keeping:**
      · **Discriminated unions wherever "not enough data" is possible** — `PhaseResult` / `SuggestResult`
        / `NudgeDecision`. `if (r.insufficient)` really narrows, so the other fields are absent in the
        type *and* at runtime; "optional" would invite reading `undefined` as a number.
      · **`Record` keeps its typedef name** even though it shadows the built-in `Record<K, V>` — the
        README documents the rename-on-import escape hatch instead of renaming the library's most
        important shape.
      ✅ **Checked mechanically, not by trust:** `scripts/check-types.mjs` (wired into `verify-all.ps1`)
      compares the declared **value** exports against the real module **name for name**, requires every
      `@typedef` in `src/` to be mirrored, and compiles `test/types/` — whose reverse cases are
      `@ts-expect-error` lines that must **still** be errors (widen a declaration and they become unused
      directives ⇒ red). A missing compiler is a **SKIP, not a pass**.
- [x] **ASCII bedtime heatmap for the CLI** (2026-10-16). `sleepmetrics heatmap <records.json>
      [--window N]` — one character per night, one row per week, so **drift is visible at a glance**
      instead of inferred from a number.
      ✅ **The mapping lives in `bin/heatmap.js`, not in the top-level script, so it can be tested**:
      `bin/sleepmetrics.js` executes on import and cannot be imported, and *"the picture looked fine"*
      is not a specification.
      ⚠️ **The recorded trap was the whole reason for that split.** Bedtimes wrap past midnight, so the
      offset is measured **relative to the window's circular mean** via `circDiff()` (shorter
      convention) — never linearly onto 00:00–24:00. The guard is a **test**, not a comment: 23:50 and
      00:10 must land in the **same** level. A linear scale would place them at opposite ends of the
      ruler while they are 20 minutes apart, inventing a regime change that never happened.
      ✅ Three further decisions: **missing nights get their own character** (`?`) — folding them into
      the centre level would read as "slept right on time"; the window anchor is the **last main
      sleep's wake**, the same one `sriLastN()` uses (one anchor, not two); and the command **refuses
      `--json` visibly** instead of ignoring it, because `--json`'s key set is a machine contract
      (`AGENTS.md` 4) and a silent no-op would let a script author believe they got JSON.

## Later / on demand

- **`toEpoch()` as a strict, exported parser?** `TIMESTAMPS.md` ships a **verified** snippet
  (`Date.UTC(...) − offset`, which never consults the host timezone). Promoting it into the library
  would give every adapter a safe default, and it would **not** violate "the library does not know vendor
  formats" (`NON-GOALS.md` §5): it parses **timestamps**, not **sources** — it takes ISO-with-offset or
  an explicit `hoursOffset`, and never guesses from the format.
  ⚠️ **The open question is adoption, not correctness**: a parser that *rejects* an offset-less
  `YYYY-MM-DD` pushes people straight back to raw `Date.parse`, which is worse. Whatever ships has to be
  **easier than the unsafe thing**, not merely safer than it.
- Gadgetbridge export adapter
- Apple Health export adapter
- **String-typed stage states** (`'deep' | 'light' | 'rem' | 'awake'`, numeric codes kept for
  compatibility). Motivated by what `test/audit.test.js` now pins: numeric codes **inside** the valid
  range can be **semantically wrong**, and nothing can detect it — `state: 4` is a legal number whether
  it means REM here or "awake" somewhere else. `stages.no-awake` catches most awake-code mismatches
  indirectly (they surface as "there is no 5 anywhere"), but a string union would make the whole class
  impossible. ⚠️ Accept **both** forms for at least one minor version, and never guess what a bare
  number meant.
- **Hour-of-day attribution of SRI loss.** SRI accumulates per epoch, so it can be decomposed:
  *"76% of your irregularity loss comes from 01:00–03:00."* Pure arithmetic, no theory risk, and it
  pairs with `--influence` (which **night**) to give *which night + which hours*. ⚠️ Same discipline as
  `sriLeaveOneOut`: report the decomposition, never a threshold.
- **Regularity × duration quadrant plot.** One point per week (x = mean duration, y = SRI) makes
  *"slept enough but irregularly"* vs *"regular but too short"* visible at a glance; ASCII suffices.
  Same family as the bedtime heatmap, different question.
- **Three-way cross-implementation check** (JS ↔ R ↔ Python). Phase is already verified against R's
  `mctq`; add Python's `pyActigraphy`, and R's `sleepreg` if Rtools ever appears. ⚠️ Same caveat that
  closed the SRI half of the R check: **a disagreement you cannot adjudicate is not evidence** — only
  compare quantities whose conventions are stated on *both* sides.
- **Zenodo DOI.** `CITATION.cff` already exists; wiring Zenodo gives every release a DOI at zero code
  cost on the GitHub side. For a library whose pitch is "these are research metrics", it is the
  cheapest formality available.
- ❌ **Not planned, stated here so nobody re-litigates it:**
  an **activity-counts mode** — the README already warns that binary and counts conventions are not
  comparable, so shipping both would *manufacture* incomparable numbers; and a **population percentile
  for SRI** — `REFERENCES.md` opens with "no thresholds here, not one", and a percentile would break
  precisely that promise.

## Explicitly not planned

> Each of these comes with its **reasoning** and a "where to go instead" — see
> [`NON-GOALS.md`](NON-GOALS.md). That file exists so nobody has to rediscover the boundary the hard way.

- **A TypeScript rewrite or a build step.** Plain JS + JSDoc is deliberate: the published artifact
  is the source you read.
- **Network or filesystem access inside the library.** Fetching, syncing and vendor-specific
  parsing belong to a different layer (the CLI in `bin/` is the one exception, and it is not part
  of the library surface).
- **Medical advice, diagnosis, or causal claims.** Population-level research metrics only.
- **Invented metrics** — sleep-debt accumulation, 90-minute cycles, "light exposure moves your
  bedtime by N hours". Every number must trace to a paper; provenance lives in the source comments.
- **Coverage targets.** Test names are the specification and the regression gate is the one hard
  assertion. "Which lines ran" is not a goal here.
- **Optional runtime dependencies.** `dependencies` stays empty.

## Maintenance posture

Published **as-is, with no maintenance promise**. Issues may sit unanswered. Use it, fork it,
vendor it — MIT.

### If this stops being maintained

That promise is meant literally, so here is what to do when you need to move on:

- **Your data was never here.** The library does not read files, write files or touch the network —
  every input arrives through *your* adapter. There is no export step to perform, because there is
  nothing to export *from*.
- **The formulas are the portable part.** SRI is Phillips et al. 2017 (*Sci Rep* 7:3216); MSFsc/SJL
  follow Roenneberg's MCTQ, and this implementation was cross-checked against R's `mctq` down to
  0.000000 h. Any of those sources is a safer long-term dependency than a JS package — including
  this one.
- **The numbers are pinned.** `test/regression.test.js` (private data) and
  `test/anchor-synthetic.test.js` (deterministic synthetic data, runs anywhere) fix the expected
  outputs, so a fork can tell within seconds whether it still computes the same thing.
- **Vendoring is expected, not a fallback.** The published tarball **is** the source: 24 files (0.2.0),
  zero dependencies, no build step, no postinstall. Copy them in, keep the ones you use, and there is no
  upgrade treadmill to fall off.
