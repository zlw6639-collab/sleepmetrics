# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Numbers are a compatibility surface in this library: **any change that moves one is a minor bump,
> never a patch** (`RELEASE.md` §2). The regression anchors are **74.108 / 65.972 / 86.03** and they
> have not moved since 0.1.0.

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
