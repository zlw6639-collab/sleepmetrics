# Free-day tables

`computePhase()` and `suggest()` take an `isRest(dayString)` callback, and the CLI takes
`--free-days <file.json>` (alias `--holidays`). **The library never reads a calendar and never
assumes a Monday-to-Friday life** — you decide what a free day is. This file is about that table.

## The shape

```json
{
  "2026": {
    "holidays": ["2026-10-01", "..."],
    "workdays": ["2026-10-10", "..."],
    "source":   "…"
  }
}
```

- **`holidays`** — days off **even though they are not weekends**
- **`workdays`** — days you work **even though they are weekends** (make-up days). This is the
  field that fools people.
- **`source`** — optional provenance, for your own records.
- A year **missing** from the table does not throw. It degrades to "weekends only", and
  `missingYears()` exists so the caller can say so out loud — **a quietly wrong MSFsc is worse than
  an error.**

## ⚠️ The bundled `data/holidays.json` is **China (PRC), 2026 only**

It is **not** a generic holiday calendar:

- **PRC statutory holidays + make-up workdays**, **2026 only** (source recorded in the file's own
  `source` field: 国办发明电〔2025〕7号).
- Its make-up-day concept **does not transfer**: `2026-10-10` is a Saturday that China **works** —
  no other country observes that day.

**Outside China, do not use it.** Write your own.

## Writing your own

It is a plain map of two date lists — no API, no dependency, no network. For a **weekends-only**
calendar, pass an empty table and every day is judged purely by weekday:

```bash
echo '{}' > empty.json
sleepmetrics phase records.json --free-days empty.json
```

You can also skip files entirely and inject a predicate — which is the whole point of the design:

```js
// night-shift worker: the day after a night shift is not a free day
const isRest = (ds) => !isPostNightShift(ds) && myRoster[ds] === 'off';
computePhase(mainSleep(records), isRest);
```

## Two warnings the CLI gives you

1. **A year missing from the table** → `⚠️ 缺 2027 年的调休数据 ⇒ 已退化为「只按周末」`.
   Checked over **both ends of the window**: a 30-day window starting in late December runs into
   January, which is exactly where make-up days cluster.
2. **A table that does not fit you** → if fewer than 10% or more than 50% of the window's days are
   free days, it says so.

Both exist for the same reason [NON-GOALS.md](NON-GOALS.md) gives: **a wrong table still produces
beautifully formatted numbers.**

## Keeping the bundled table current

The PRC government publishes the next year's arrangement around **November**. Add a year block in
the same shape; the file's own `_`-prefixed fields restate this in Chinese. Missing a year is safe
(it degrades and warns) — just less accurate.
