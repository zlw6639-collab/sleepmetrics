# Reference values — and how to read them without fooling yourself

> ⚠️ **Nothing here is a threshold. None of it is wired into any output of this library.**
> There is no "normal range" in this file, and that is deliberate: *"your value vs the population"* is
> the comparison this project refuses (`NON-GOALS.md` §9) — it implies a threshold, it compares people,
> and the reference numbers are usually measured a **different way** than your device measures you.
>
> This file exists to hand you the **sources**, so that when you see a number quoted somewhere you can
> check *what was actually measured, in whom, and how*. That question is the whole point: as the two
> examples below show, the honest answer to "what do people sleep?" ranges over more than an hour and a
> half depending on the method — and the method is usually left out of the quote.
>
> **What to do instead, in code:** report the user's own history. *"Your last 30 nights sit at the 62nd
> percentile of your own 222 nights"* is descriptive, needs no external number, and implies nothing
> about normal or abnormal.

## 1. How long should adults sleep?

| Source | Statement | Basis | URL |
|---|---|---|---|
| **AASM + SRS 2015** (Watson et al.) | Adults 18–60: **"7 or more hours"** — ⚠️ **there is no upper bound in the original** | Expert consensus (15-member panel, RAND/UCLA, 5,314 papers reviewed) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4442216/ |
| **NSF 2015** (Hirshkowitz et al.) | Younger adults & adults **7–9 h**; older adults **7–8 h** | Expert consensus | https://doi.org/10.1016/j.sleh.2014.12.010 |
| **NSF, updated report** (Hirshkowitz et al., same year) | Some age bands differ from the first paper ⇒ **always state which version** | Expert consensus | https://pubmed.ncbi.nlm.nih.gov/29073398/ |
| **US CDC** (page updated 2024-05-15) | Age table; adults 18–60: **≥7 h** | Agency summary (adults from AASM/SRS 2015; children from NSF 2015 + AASM paediatric 2016) | https://www.cdc.gov/sleep/about/index.html |
| **WHO (2019)** | ⚠️ **No adult sleep-duration recommendation exists.** Its only sleep guidance covers children **under 5** | WHO guideline | https://www.who.int/publications/i/item/9789241550536 |

**The most common misquote in this area:** *"AASM recommends 7–9 hours."* AASM/SRS say **7 or more**,
with no upper bound. **7–9 is the NSF figure** for younger adults and adults; **7–8 is NSF's** for older
adults. (Also note: the National Sleep Foundation at `thensf.org` and the Sleep Foundation at
`sleepfoundation.org` are now *different organisations* — a number on the latter is not automatically an
NSF recommendation.)

## 2. Population sleep duration — the measurement decides the number

| Study | n | Result | Measured by | URL |
|---|---|---|---|---|
| BRFSS 2014 (Liu et al. 2016, MMWR) | 444,306 US adults | 65.2% self-report ≥7 h | **Self-report** (single phone-survey item, whole hours) | https://www.cdc.gov/mmwr/volumes/65/wr/mm6506a1.htm |
| NHANES 2011–2014 (Freeman et al.) | 13,656 (3–80 y) | Mean **6.36 h** (SE 0.02) | **Actigraphy** (ActiGraph GT3X+, ≤7 days, GGIR v3.0.0 + HDCZA) | https://pmc.ncbi.nlm.nih.gov/articles/PMC13137780/ |
| UK Biobank (Windred et al. 2024) | 60,977 (62.8 ± 7.8 y) | **6.77 ± 1.00 h** | **Actigraphy** (Axivity AX3, 7 days, GGIR + sleepreg) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/ |
| HCHS/SOL Sueño (Cespedes et al. 2016) | 2,086 | **Self-report 7.85 h vs actigraphy 6.74 h — the same people** | **Both, in the same subjects** (Actiwatch Spectrum, ~7 nights) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4782764/ |

Two things worth internalising from this table:

1. **Self-report over-estimates, and only weakly tracks the device.** In HCHS/SOL the two differ by
   ~1.1 h, correlated at only **r = 0.43**; each extra hour of self-reported sleep corresponded to just
   **20 minutes** more measured sleep. So self-report numbers (BRFSS, NHIS) **cannot** be compared with
   actigraphy numbers (NHANES, UK Biobank).
2. **The same dataset gives different answers under different pipelines.** Analyses of the *same* NHANES
   2011–2014 actigraphy data report adult medians of **7.83–8.26 h** in one pipeline and a mean of
   **6.36 h** in another (GGIR + HDCZA). That is a gap of over 1.5 h, produced by the sleep-scoring
   algorithm and the definition of the sleep window. ⇒ *"NHANES says people sleep X hours"* is not a
   statement until you name the algorithm, the wear duration, whether naps are included, and the
   subsample (6,089 vs 13,656).

## 3. Sleep regularity (SRI) — there is no "normal range"

| Source | Population | SRI | Measured by | URL |
|---|---|---|---|---|
| Phillips et al. 2017 (the paper that introduced SRI) | 61 Harvard undergraduates, 30 days | **73 ± 11** (range 38–86) | ⚠️ **Sleep diaries** — *not* actigraphy | https://pmc.ncbi.nlm.nih.gov/articles/PMC5468315/ |
| Windred et al. 2024 | 60,977 UK Biobank | Median **81.0** (IQR 73.8–86.3) | Actigraphy (Axivity AX3, 7 days) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/ |
| Fulk et al. 2026 | 71 post-stroke patients | **≈33–38** | Actigraphy | https://doi.org/10.1161/JAHA.125.048392 |
| Fischer, Klerman & Phillips 2021 | Methodology (simulation) | — | Theory + large-scale simulation | https://pmc.ncbi.nlm.nih.gov/articles/PMC8503839/ |

- **These three populations are not on one scale**: a student diary cohort (73), a middle-aged
  accelerometer cohort (81), and a clinical cohort (≈35). Never mix them into a "reference range".
- **The original SRI paper used sleep diaries**, not a device. Many secondary citations say otherwise.
- **SRI is sensitive to implementation choices** — epoch length, missing data, recording duration and
  the scoring algorithm (Fischer et al. 2021 give systematic simulation evidence). That is why this
  library anchors its SRI to a regression test against one frozen real-data window rather than to any
  published "typical value".

## 4. The traps, in one list

1. **AASM is quoted with an upper bound it never had** (7+ h, not 7–9 h).
2. **NSF has two 2015 versions** with different numbers — state which one.
3. **WHO has no adult recommendation at all** (its guidance stops at age 5).
4. **Self-report and device measurements are not interchangeable** (r = 0.43; ~1.1 h apart).
5. **The same actigraphy data yields different means under different pipelines** (>1.5 h apart).
6. **SRI numbers come from different measurement instruments** (diaries vs accelerometers) and are not
   comparable across studies.
7. **Some citations carry corrections.** Lunsford-Avery et al. 2018 (MESA, https://pmc.ncbi.nlm.nih.gov/articles/PMC6154967/)
   has two author corrections (2020, 2021) — cite it with that in mind.

> **For animal sleep — and a demonstration of traps 1–7 applied to another species — see
> [`SLEEP-FACTS.md`](SLEEP-FACTS.md).** It includes the sloth (captive numbers vs wild EEG), the
> elephant (an inactivity estimate, not EEG), and the swift (a widely repeated claim whose study never
> measured sleep at all).

*Everything above was fetched and read directly during compilation (2026-10-14) except where a row says
otherwise; PDF-only sources (e.g. the WHO guideline) are linked but their figures were **not** verified.
A useful verification channel for later maintenance, since publisher sites block automated fetches, is
the Europe PMC REST API: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=…&resultType=core&format=json`.*
