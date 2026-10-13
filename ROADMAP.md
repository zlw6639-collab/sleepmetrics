# Roadmap

This project is intentionally small. What follows is the **whole** plan — no dates are promised,
and the last section lists what will **not** happen.

## Next

- [ ] **Cross-check the numbers against an R implementation.**
      `mctq` (MSFsc / SJL) and `sleepreg` (SRI) are the reference implementations for these formulas.
      Today we verify against *hand-computed* cases plus one frozen real-data anchor; an independent R
      cross-check would be stronger evidence. (No R on this machine yet.)
- [ ] **Hand-written type declarations (`sleepmetrics.d.ts`).**
      JSDoc already gives editor IntelliSense, and TypeScript consumers can enable `allowJs` to get
      types from it. A hand-written `.d.ts` is the next step for first-class TS support.
      ⚠️ **It will be hand-written. This project will not grow a TypeScript build chain** — the
      published artifact staying identical to the source you read is a design decision, not an
      accident.
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

## Done

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

## Later / on demand

- Gadgetbridge export adapter
- Apple Health export adapter
- `npm publish` — one command; the library is already usable straight from source

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
