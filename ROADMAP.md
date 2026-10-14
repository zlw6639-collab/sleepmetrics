# Roadmap

This project is intentionally small. What follows is the **whole** plan — no dates are promised,
and the last section lists what will **not** happen.

## Next


- [ ] **Hand-written type declarations (`sleepmetrics.d.ts`).**
      JSDoc already gives editor IntelliSense, and TypeScript consumers can enable `allowJs` to get
      types from it. A hand-written `.d.ts` is the next step for first-class TS support.
      ⚠️ **It will be hand-written. This project will not grow a TypeScript build chain** — the
      published artifact staying identical to the source you read is a design decision, not an
      accident.
      ✅ **Prerequisite done (2026-10-14): the typedefs now exist.** An external review found **zero**
      `@typedef`s — JSDoc said only `Array<object>`, so the *standard record shape* lived in prose alone
      and there was nothing concrete for a `.d.ts` to mirror. Now declared next to the code they
      describe: `Record` / `Stage` / `NormalizedRecord` (records.js) · `SRIResult` / `LOOEntry` /
      `LOOResult` (sri.js) · `PhaseResult` (phase.js) · `ISResult` / `IVResult` (rhythm.js) ·
      `AuditIssue` / `AuditSummary` / `AuditResult` (audit.js) · `CircStats` (time.js) ·
      `RestJudge` (rest.js).
      ⚠️ **Still deliberately untyped: `suggest()`'s return shape** — its fields have to be read off the
      implementation and its tests, not guessed. A wrong typedef is worse than none. Do that in the
      `.d.ts` pass, field by field.
- [ ] **ASCII bedtime heatmap for the CLI.** One character per night — rows = weeks, columns = days —
      so drift is visible at a glance instead of inferred from a number.
      ⚠️ **Design trap**: bedtimes wrap past midnight, so map them **circularly** (relative to the
      window's circular mean), **not linearly onto 00:00–24:00** — otherwise 23:50 and 00:10 land at
      opposite ends of the scale despite being 20 minutes apart. Missing nights need their own
      character, and this stays on the human-readable path only (`--json` stays clean).
- [ ] **Confidence intervals for SRI (bootstrap).** A single number invites false precision,
      especially at n = 7 nights.
      ⚠️⚠️ **Statistical trap — never resample epochs.** Epochs within a night are strongly
      autocorrelated, so an epoch-level bootstrap yields a **fake-narrow** interval that looks
      authoritative. **Resample whole days (or day-pairs)**: the unit of observation for SRI is the
      *transition between successive days*, not the minute. Ship it only with that unit stated — and
      expect wide intervals at small n, because **that width is the finding**.
- [ ] **Ghost-segment rules for `auditRecords()`** — flag sleep episodes that are not plausible
      *standalone* episodes: fragments left behind by a midnight split, and impossible holes or
      overlaps inside a night.
      ⚠️ **The hard part is the criterion, not the code**: a 13-minute fragment from a midnight split
      and a genuine 13-minute nap are **identical by duration alone**. So the rule has to lean on
      **time adjacency** (a fragment that touches its neighbour) rather than on length. Any threshold
      must be validated against real data for false positives — and real data never ships
      (`test/fixtures/synthetic.mjs` only).
- [ ] **A single-page browser demo (GitHub Pages).** The library is zero-dependency ESM and touches
      neither fs nor network, so it runs in a browser straight from a CDN (see *CDN / no-install
      usage* in the README).
      ⚠️ **Never demo with real sleep data** — synthetic fixtures only. The page is public, and the
      `.gitignore` treating `raw/` as radioactive applies to anything derived from it too.
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
- **Interactive teaching page** — the existing "single-page demo" item, but with a concrete shape: a
  **draggable demo** (two sliders = two bedtimes, SRI recomputed live) teaches *"average bedtime and
  regularity are different axes"* faster than any prose, because the reader can watch the average stay
  put while SRI falls. A hand-drawn prototype already exists (5 groups, same 00:00 mean, SRI 100 → −28.3;
  **four of its five values reproduce exactly, one is off by 0.32** — use computed values in the shipped
  page). Zero-dependency ESM is what makes this cheap: one `import` from a CDN, no build.
  ⚠️ **Synthetic data only** — the page is public.
- **Three-way cross-implementation check** (JS ↔ R ↔ Python). Phase is already verified against R's
  `mctq`; add Python's `pyActigraphy`, and R's `sleepreg` if Rtools ever appears. ⚠️ Same caveat that
  closed the SRI half of the R check: **a disagreement you cannot adjudicate is not evidence** — only
  compare quantities whose conventions are stated on *both* sides.
- **Zenodo DOI.** `CITATION.cff` already exists; wiring Zenodo gives every release a DOI at zero code
  cost on the GitHub side. For a library whose pitch is "these are research metrics", it is the
  cheapest formality available.
- **A "if I stop maintaining this" note.** The README already promises no maintenance. Saying **what to
  migrate to** and **how to get your data out** is more honest than silence — and that kind of honesty
  is exactly what makes a dependency safe to adopt.
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
- **Vendoring is expected, not a fallback.** The published tarball **is** the source: 23 files, zero
  dependencies, no build step, no postinstall. Copy them in, keep the ones you use, and there is no
  upgrade treadmill to fall off.
