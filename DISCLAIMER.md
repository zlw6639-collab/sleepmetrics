# Disclaimer

**Short version: this is a calculator, not a doctor.**

## Not a medical device

This library is **not a medical device**. It is not intended to diagnose, treat, cure, monitor or
prevent any disease or condition, and it has not been reviewed or cleared by any regulator
(FDA, CE, NMPA or any other). Its output is **not medical advice**.

**Do not use it to decide whether to start, stop or change any treatment or medication.** If you
have a sleep concern that matters to you, talk to a clinician — bring your data along, that is what
they are for.

## Your data is probably noisier than you think

Most people feed this library from a **consumer wearable**. Consumer devices estimate sleep and sleep
stages with limited accuracy, and different brands disagree with each other (and with research-grade
actigraphy or polysomnography) about the same night. Practical consequences:

- **SRI** is fairly robust to stage errors (it mostly cares asleep-vs-awake) but sensitive to
  **missing nights** and to the moment the device decided you fell asleep.
- **MSFsc / social jetlag** depend on "bedtime" and "wake time", which each device defines by its own
  rules — a nap, a long lie-in, or taking the watch off all shift the numbers.
- Numbers are comparable **within one device and one routine**, not across devices.

This library reports what your records say. **It cannot tell you whether your records are true.**

## These are population-level metrics, and the norms may not be your population

Every metric here traces to published work (see *References* in the README), but published norms come
from specific samples — often students or office workers in specific countries. Your SRI of 65 does
not mean "bad"; it means "less regular than the average of *that* sample".

Two limits matter in practice:

- **`isRest` defines "free days"** — and the literature's MSFsc assumes the questionnaire definition:
  *a day without an alarm clock*. Shift workers, new parents and freelancers get numbers that are
  mathematically correct and conceptually different. **You supply the definition** (see the README).
- **There is deliberately no "sleep debt" number here.** No accepted algorithm exists for accumulating
  missing sleep, and the two-process-model literature argues against the metaphor. A library that
  invented one would be lying to you in a format that looks precise.

## Questionnaires are not diagnoses (and we ship none)

The library accepts a **chronotype category** from a questionnaire you filled in yourself
(`chronotype(msfsc, { cuts })`, `compareChronotype(...)`) — and that is deliberate: **it implements no
questionnaire at all.**

Published instruments (PSQI, MEQ/rMEQ, ESS, ISI, STOP-BANG, …) carry **copyright and licensing terms**,
and most of them are **clinical screening tools**. Implementing them here would be both a licensing
problem and a step across the "no medical advice" line this document draws.

So: get the instrument from its official source, score it there, and pass the **category** in. Two
cautions:

- **A questionnaire measures preference; a wearable measures behaviour.** They disagree routinely — a
  shift rota, a newborn, or a social life pushes behaviour away from preference. **Disagreement is not
  a finding about your health**, and the library will never present it as one.
- **Never use either side of that comparison to self-diagnose or to change treatment.** If the gap
  bothers you, that is a good question to bring to a clinician.

## Name and affiliation

This is an **independent, non-commercial open-source project**. It is **not affiliated with, endorsed
by, or connected to** any company, product or service that uses a similar name — including the former
`SLEEPMETRICS` trademark (USPTO serial **76389035**, filed 2002 by VivoMetrics, Inc.), whose current
status we were **unable to verify** (the public lookups we tried were geo-blocked or required an API key).

The name was picked because it describes what the library does. **If you hold a mark you believe this
infringes, open an issue and we will rename the package** — that is cheaper for everyone than a dispute.

## No warranty

Provided "as is", without warranty of any kind — see [`LICENSE`](LICENSE) (MIT). You are responsible
for how you use the output and for any decision you make with it.

## Your data stays yours

The library has **no network and no filesystem access**: it takes an array in and returns objects. It
cannot upload anything and carries no telemetry. Any synchronisation, storage or backup you build
around it is your choice — **including the legal obligations that come with handling health data
about other people**. (The CLI in `bin/` is the one component that reads a file you point it at.)

## If you build a product on top of this

You inherit the obligations, not the library. Shipping something that makes health claims typically
requires clinical validation and regulatory clearance in your jurisdiction. See
[`NON-GOALS.md`](NON-GOALS.md) §2 for the direction we would take, and read your local rules.
