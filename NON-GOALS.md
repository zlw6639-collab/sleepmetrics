# Non-goals — and where to go instead

This project is deliberately small. Everything below is something it will **not** do.
For each one: *why not* — and the direction to take if you actually need it.

> Philosophy: this library is the **downstream end** of a pipeline.
> Data sources, sync, accounts, apps and clinical tools all live *upstream* or *beside* it.
> Keeping that boundary is what makes the library small enough to read, test and trust.

## 1. Cloud sync / accounts

**Why not.** Syncing is a product with servers, auth, migrations and health-data compliance
(GDPR/HIPAA-shaped obligations), and it changes weekly. Metrics change rarely.

**Where instead.** Put sync *upstream*: [Gadgetbridge](https://gadgetbridge.org/),
Health Connect, `ha-zepp` and friends already move data. Your sync layer should end by emitting the
standard record array documented in the README — then this library is your downstream consumer.
If you do build accounts: **encrypt at rest, keep the key on the user's device, and never make a
sleep record readable by the server operator.**

## 2. Medical advice / risk scores

**Why not.** "Your insomnia risk is 63%" is a **medical device** claim. It requires clinical
validation, prospective studies, and regulatory clearance (NMPA / CE / FDA). A metric library
cannot honestly produce it, and a wrong one can hurt someone.

**Where instead.** Find a clinical collaborator and read the validation requirements for digital
sleep tools first (CBT-I literature is a good entry point). This library is happy to be a
*component* of such a product — it just refuses to be the part that gives advice.

## 3. Machine learning / personal prediction

**Why not.** Two independent problems:

- **Sample size.** A wearable gives you a few hundred nights at best, and they are autocorrelated.
  Personal-level prediction is not identifiable from that.
- **Evidence.** Meta-analytic effect sizes for e.g. "activity → sleep" are LOW quality
  (I² ≈ 93%). A black box would hide exactly the uncertainty that matters.

**Where instead.** Start with **transparent rules** (what this project does) and prospective
validation. If you later have a cohort and a pre-registered protocol, an ML layer can sit *beside*
the library — not inside it.

## 4. A web app / UI

**Why not.** The library does not touch the filesystem or the network — that is the whole point.
A UI needs both.

**Where instead.** Build it as a **separate project that imports this library**. It works well for
that: the API is pure functions in, plain objects out.

## 5. Vendor private APIs (Xiaomi / Zepp / …)

**Why not.** Reverse-engineered endpoints break without notice and carry ToS/legal risk. Nobody
wants their metrics library to depend on someone else's undocumented server.

**Where instead.** Use **public exports** — Apple Health export, Gadgetbridge, Health Connect, or a
CSV you maintain yourself — and write a thin **adapter**. Adapters may live in their own packages;
the core stays brand-agnostic.

## 6. Runtime dependencies

**Why not.** `dependencies` is **empty on purpose**, and that is a feature: no supply-chain surface,
no version conflicts, no transitive surprises, auditable in one sitting. There is no "convenient
little helper" worth trading that for.

**Where instead.** If something is genuinely missing, it probably belongs in your adapter or app,
not here.

## 7. Coverage targets and a TypeScript rewrite

**Why not.** In this library the interesting question is never "which lines ran" — it is
"did the numbers stay the same". That is guarded by a regression test, not a percentage. And the
published artifact staying identical to the source you read is a design decision.

**Where instead.** Type declarations, if they ever materialise, will be **hand-written**
(`.d.ts`) — see [`ROADMAP.md`](ROADMAP.md). Never a build chain.

## 8. Questionnaires and clinical scales

**Why not.** The instruments people ask for — PSQI, MEQ/rMEQ, ESS, ISI, STOP-BANG — are **copyrighted
and licensed**, and most are **clinical screening tools**. Shipping them inside a metrics library would
be a licensing problem *and* a step over the "no medical advice" line (see §2 above).

**Where instead.** Get the instrument from its official source and score it there. This library happily
consumes the **result**: pass a category into `chronotype(msfsc, { cuts })` or
`compareChronotype({ activityIndex, questionnaireIndex })` and it will relate the two views — without
owning a questionnaire or drawing a conclusion.

> Worth knowing: `npm search mctq`, `morningness eveningness` and `epworth sleepiness` all return
> **zero** results (checked 2026-10-13), and `chronotype questionnaire` returns form builders. The
> vacuum here is as real as the actigraphy one — which is exactly why the boundary above matters.

## 9. A "sleep score"

**Why not.** Single-number sleep scores are marketing devices: they hide which input moved, invite
comparison between people, and imply a threshold. This library reports dimensions (regularity,
phase, timing) plus the numbers behind each one.

**Also refused on the same grounds (2026-10-14): a "your value vs the population" comparison table.**
It is a single-number score with extra steps — it implies a threshold, it compares people, and the
reference values are usually measured a *different way* than the user's device measures them
(self-report vs actigraphy vs PSG disagree substantially), so the comparison is not even between
like things. It also backfires: a reader who is already anxious about "my resting heart rate rose
2.7 bpm" does not need to be told it is above average.

**Where instead.** Report the user's **own history**: *"your last 30 days sit at the 62nd percentile
of your own 222 days"* is descriptive, needs no external number, and implies nothing about normal or
abnormal. If you need one number for a UI, compute it *in your app* from these dimensions —
and show the components next to it.

---

*If you think one of these belongs in scope after all, open an issue with the evidence (a paper, a
dataset, a regulation) — the bar is deliberately high, but it is not "never".*
