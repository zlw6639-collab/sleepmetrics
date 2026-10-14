# Getting timestamps right (before the library ever sees them)

This library takes **epoch seconds** and nothing else. Between your data source and that number sits the
most error-prone step in the whole pipeline — and it fails **silently**. A timestamp that is 8 hours off
does not throw; it moves a night across midnight, which moves which natural day it belongs to, which
changes the day-pairs, which changes SRI.

This page is the mapping guide. Adapters themselves live in `examples/` — the library deliberately does
not know vendor formats (`NON-GOALS.md` §5).

## The one that bites: `'2026-03-01'` and `'2026-03-01T00:00'` are 8 hours apart

Measured on a machine at UTC+8, where `2026-03-01 00:00 (+08:00)` is epoch `1772294400`:

| What you wrote | `Date.parse` returns | Interpreted as | Off by |
|---|---|---|---|
| `'2026-03-01'` | 1772323200 | **UTC** midnight | **+8 h** |
| `'2026-03-01T00:00'` | 1772294400 | **local** midnight | 0 |
| `'2026-03-01 00:00'` (space, not `T`) | 1772294400 | **local** | 0 |
| `'2026/03/01 00:00'` | 1772294400 | **local** | 0 |
| `'2026-03-01T00:00:00Z'` | 1772323200 | UTC, as written | 0 (but it *is* UTC) |
| `'2026-03-01T00:00:00+08:00'` | 1772294400 | UTC+8, as written | 0 |
| `'2026-03-01T00:00:00+0800'` | 1772294400 | UTC+8, as written | 0 |
| `'2026-03-01 00:00:00 +0800'` (Apple Health) | 1772294400 | UTC+8, as written | 0 |
| `'3/1/2026 12:00 AM'` | 1772294400 | **local**, US month/day | 0 |
| `'20260301T000000Z'` | `NaN` | **unparseable** | — |
| `'00:00:00'` | `NaN` | **unparseable** | — |

**Only a bare `YYYY-MM-DD` is treated as UTC.** Every other form without an explicit offset is treated
as **local**. That single rule is why two strings a human reads as the same instant are 8 hours apart,
and why the same CSV can parse "correctly" on your laptop and shift on a CI runner in another region.

## Six rules that keep you out of it

1. **Never let the format decide the timezone.** If a string carries no offset, decide what it means
   yourself and apply it.
2. **Never mix date-only and date-time forms in one column** — they land in different timezones.
3. **Check the unit.** Seconds (what this library wants), milliseconds (JavaScript's own default) and
   microseconds differ by 1000×, and none of them throws. `auditRecords()` flags obvious milliseconds
   (`≥ 1e11`) as `record.epoch-looks-like-ms`, but it **cannot** see a 1000× error that still lands in a
   plausible year.
4. **Excel/CSV may hand you a serial number** like `46082.979` — a fraction of a day since 1899-12-30,
   not an epoch. `new Date(46082.979 * 1000)` silently gives 1970.
5. **Separate date and time fields** (`{ date: '2026-03-01', time: '23:30' }`) need an explicit offset
   to be combined — neither half carries one.
6. **There is no DST table here.** `tz` is a fixed offset in hours (`README.md` §Semantics rule 7). For
   zones that observe DST, resolve the offset **per record** from historical rules.

## A safe pattern

```js
/**
 * Parse a timestamp into epoch seconds **without consulting the host timezone**.
 * Strings that carry an offset are trusted; strings that do not are interpreted in `hoursOffset`.
 * ⚠️ Deliberately does NOT handle US month/day or 12-hour clocks — normalise those at the source.
 */
const toEpoch = (s, hoursOffset) => {
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) return Math.floor(Date.parse(s) / 1000);
  const [d, t = '00:00'] = s.split(/[T ]/);
  const [Y, M, D] = d.split(/[-/]/).map(Number);
  const [h, m] = t.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, h, m) / 1000 - hoursOffset * 3600;
};
```

The `Date.UTC(...) − offset` form is the point: it never reads the host timezone, so the same input
gives the same answer on your laptop, in CI and on a server elsewhere.

```js
// Both of these are wrong in the same way, and neither complains:
new Date('2026-03-01').getTime();      // UTC midnight
new Date('2026/03/01').getTime();      // local midnight
```

## Why it matters more here than elsewhere

SRI compares **the same clock time on consecutive days**. Shift a night by 8 hours and it crosses
midnight, changing which natural day it is counted on (`dayOf(wake, tz)`), which changes the day-pairs.
So a timestamp bug does not surface as an obvious outlier — it surfaces as **a slightly different SRI
that looks completely normal**.

That is the whole reason this page exists: the failure mode is not an error message, it is a plausible
number.
