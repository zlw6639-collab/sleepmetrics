# Fun facts — six animals, and how we actually know

> These are **facts about animals**, each with its source. They live here because they are genuinely
> interesting — **not** because they say anything about your sleep.
>
> ⚠️ **This file is deliberately not connected to any metric, report line or suggestion in this
> library.** Comparing a human's sleep against another species' numbers is **three-way incomparable**:
> different measurement (wearable vs EEG vs behaviour), different architecture (single-phase vs
> polyphasic), different timescale. It is fun. It is not a comparison, and it is certainly not a
> diagnosis. (See `NON-GOALS.md` §9 for why this library refuses cross-person — let alone
> cross-species — comparisons.)
>
> **Read the "How these numbers go wrong" section at the end before you quote any of them.** Every fact
> below is here *because* its measurement method is stated.

## 1. Brown-throated three-toed sloth — 9.63 h/day, in the wild

The famous "sloths sleep 16–20 hours" comes from **captive** animals. The first **wild** EEG recording
(deployed in a Panamanian rainforest, with the animals unrestrained) found **9.63 h/day** — more than
six hours less.

**Measured by:** field EEG (the real thing, in the wild).
**Source:** Rattenborg et al. 2008, *Biol Lett* 4(4):402–405 —
https://pmc.ncbi.nlm.nih.gov/articles/PMC2610152/

*Why it's here:* it is the cleanest example of captivity inflating a sleep number, and of EEG being
worth the trouble.

## 2. African elephant — about 2 h/day

Two wild female elephants in Botswana averaged **~2 h of sleep per day**, concentrated around
02:00–06:00 — the shortest daily total recorded for any mammal. They went to sleep lying down only
every 3–4 days, and one individual went **46 h without sleeping** on five occasions, with no visible
rebound.

**Measured by:** an **actiwatch implanted under the trunk's skin** plus GPS/gyroscope collars — this is
an *inactivity* estimate, **not EEG**.
**Source:** Gravett et al. 2017, *PLoS ONE* 12(3):e0171903 —
https://pmc.ncbi.nlm.nih.gov/articles/PMC5382951/

*Why it's here:* a spectacular number whose method is **not** the same as the sloth's above — the two
cannot be placed side by side.

## 3. Giraffe — 4.6 h/day, of which REM is under 5%

Eight zoo giraffes slept **4.6 h/day** in total, with paradoxical (REM-equivalent) sleep making up only
**4.7%** of it. Sleep was fragmented — most lying bouts lasted under 11 minutes — and split between
night bouts and daytime naps.

**Measured by:** **behavioural observation** (152 nights of continuous time-lapse video; REM inferred
from posture and phasic events). **No EEG.**
**Source:** Tobler & Schwierin 1996, *J Sleep Res* 5(1):21–32 —
https://doi.org/10.1046/j.1365-2869.1996.00010.x

*Why it's here:* it shows how far a behaviour-only estimate can get, and how small a REM share can be.

## 4. Bottlenose dolphin — one brain hemisphere at a time

Dolphins show **unihemispheric slow-wave sleep**: one hemisphere produces slow waves while the other
stays awake, and the animal can keep one eye open. In mother–calf pairs, "resting at the surface"
disappeared entirely for at least the first two months post-partum, with 97–100% of time spent swimming
in formation.

**Measured by:** EEG-based findings for the hemisphere asymmetry, plus behavioural monitoring of the
mother–calf pairs (3 pairs, birth to 13 months).
**Source:** Lyamin et al. 2007, *Physiol Behav* 92(4):725–733 —
https://pmc.ncbi.nlm.nih.gov/articles/PMC8142817/

*Why it's here:* it is the most concrete reminder that "sleep" is not one thing across species.

## 5. Draughtsboard shark — "sharks don't sleep" is dead, but the EEG case is still open

The claim that sharks never sleep has been overturned: this species shows sleep-like states (behavioural
quiescence, relaxed posture, reduced responsiveness, lowered metabolic rate), and muscle tone decreases
across active → quiet waking → sleep. However, the **electrophysiological correlates could not be
reproducibly established** — 7-channel EEG was unstable both while swimming and while asleep.

**Measured by:** behaviour + video + accelerometry, with EEG/EMG/EOG attempted (and not settled).
**Source:** Lesku et al. 2024, *J Exp Zool A* 341(10):1121–1129 —
https://pmc.ncbi.nlm.nih.gov/articles/PMC11579818/

*Why it's here:* it is an honest "we don't know yet" — and a good antidote to confident trivia.

## 6. Common swift — ten months airborne, and **nobody has measured its sleep**

Swifts stay airborne for roughly **10 months** without landing. That part is solid. What is *not* solid
is the popular conclusion "so they sleep while flying": **that study did not measure sleep at all.**
"In-flight sleep" is an inference, not an observation.

**Measured by:** light-level geolocators (flight/landing patterns only — no sleep recording).
**Source:** Hedenström et al. 2016, *Curr Biol* 26(22):3066–3070 —
https://doi.org/10.1016/j.cub.2016.09.014

*Why it's here:* it is the single most-repeated animal-sleep "fact" that has no sleep measurement
behind it. It is kept in this list **as a warning**, not as a fact about sleep.

---

## How these numbers go wrong

Four failure modes, all of them common in popular science writing:

1. **Captivity inflates.** The sloth's 16–20 h came from captive animals; the wild EEG gave 9.63 h. Zoo
   and lab conditions change both sleep amount and its fragmentation.
2. **Behaviour is not EEG.** The elephant's 2 h is an *inactivity* estimate from an implanted
   actiwatch; the giraffe's 4.6 h is video observation. Both are legitimate work — but neither is
   electrophysiological sleep, and mixing them with EEG numbers produces nonsense.
3. **Inference hardens into fact.** "Swifts sleep in flight" has no sleep measurement behind it at all.
4. **Some numbers have no traceable source.** Cat (12–16 h), dog (12–14 h) and bat (19–20 h) are quoted
   everywhere, but the underlying observations are mostly small captive samples from the 1960s–80s
   using sleep criteria that predate today's standards. They are therefore **deliberately absent** from
   this file — see Campbell & Tobler 1984 (https://doi.org/10.1016/0149-7634(84)90054-X) and
   Siegel 2008 (https://doi.org/10.1016/j.tins.2008.02.001) if you want the historical frame, and
   Frank 2025 (https://doi.org/10.1016/j.jsmc.2024.10.005) for why behaviour-only definitions inflate
   the list of "animals that sleep".

> If you want **human** reference values (recommended durations, population distributions, SRI in
> cohorts — along with the measurement traps that make most quotes meaningless), see
> [`REFERENCES.md`](REFERENCES.md).
