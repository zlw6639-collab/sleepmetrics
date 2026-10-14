# Releasing

Everything a maintainer needs to cut a release. Written for this machine (Windows + `pwsh`), but the
steps are portable.

## 0. The one hard rule

> **The regression gate is not negotiable.** If `test/regression.test.js` fails, the extraction broke
> the semantics — **fix the code, never the anchors** (74.1 / 66.0 / +86, see the top of that file).

## 1. Verify locally

> **One command runs every check:**
> ```powershell
> pwsh -File scripts\verify-all.ps1
> ```
> It covers 18 items — syntax gate · all 10 test files · the regression anchors · README links ·
> published-tarball contents · the `--json` contract (key set must not change) · zero dependencies and
> no IO imports in `src/` · both `examples/` scripts · the **R cross-check against `mctq`** · the local
> `analyze` / `report` / `rhythm` / `datacheck` scripts and the nudge gate · doc-tree hash parity ·
> git cleanliness and tag. Anything **FAIL** must be fixed or explained before publishing —
> the anchors are a hard gate, there is no "close enough".
>
> The steps below are the individual pieces, for when one item fails and you need to dig in.

```powershell
# a) syntax gate first — if this fails, nothing below means anything
node --check bin\sleepmetrics.js

# b) tests, one file at a time (batch `node --test test/` may hit EPERM in a sandbox)
foreach ($f in 'time','records','sri','phase','rest','suggest','audit','rhythm','aside-guard','regression') {
  node "test\$f.test.js" | Select-String 'pass |fail '
}

# c) the gate, on real data (private — not in the repo)
node test\regression.test.js          # anchors: 74.108 / 65.972 / 86.03

# d) exactly what will ship, and how big it is
npm pack --dry-run
```

Checklist before you continue:

- [ ] every test file reports `fail 0`
- [ ] regression prints the anchors (or **skips** because the private data is absent — that is fine)
- [ ] `npm pack --dry-run` shows the files you expect (SRC · DATA · BIN · the four `.md` · LICENSE)
- [ ] **every internal link in `README.md` resolves inside the published file list**
      (`files` in `package.json`) — otherwise the link 404s on npm

## 2. Version

[SemVer](https://semver.org/), and this library is pre-1.0:

| change | bump |
|---|---|
| breaking API change | `0.x` → `0.(x+1).0` |
| new metric / new option, backwards compatible | `0.x.y` → `0.x.(y+1)` |
| docs, fixes, refactor with identical numbers | `0.x.y` → `0.x.(y+1)` |

⚠️ **Any change that moves a number is a minor-or-major bump, never a patch** — downstream users may
have built thresholds on it. The regression gate exists to make that visible.

## 3. First release: git + GitHub

```powershell
cd E:\ai\sleepmetrics

git init -b main
git add .
git status                 # ← read this list. `.gitignore` must be doing its job:
                           #    raw/ · mi-auth.json · *.log must NOT appear
git commit -m "sleepmetrics 0.1.0: SRI + circadian phase + suggestions + data audit"

# create an empty repo on GitHub named `sleepmetrics` (no README, no .gitignore), then:
git remote add origin https://github.com/<you>/sleepmetrics.git
git push -u origin main
git tag -a v0.1.0 -m "0.1.0" && git push origin v0.1.0
```

Then fill in the placeholders in `package.json` **before publishing to npm**:

```jsonc
"repository": { "type": "git", "url": "git+https://github.com/<you>/sleepmetrics.git" },
"homepage": "https://github.com/<you>/sleepmetrics#readme",
"bugs": { "url": "https://github.com/<you>/sleepmetrics/issues" },
"author": "<you>"
```

## 4. Publish to npm

```powershell
npm login                  # once per machine
npm whoami                 # confirm you are logged in as the right account
npm publish --dry-run      # last look at the tarball contents
npm publish                # 0.1.0 → public
```

`npm publish` needs network access (a proxy/VPN may be required outside this machine). If the name got
taken between now and then, `npm publish` fails with `E403` — rename locally and retry rather than
publishing under a variant silently.

**Afterwards**: `npm view sleepmetrics` should show your version, and a fresh install in an empty
directory should work:

```powershell
mkdir $env:TEMP\sm-check; cd $env:TEMP\sm-check
'{ "name": "sm-check", "type": "module", "private": true }' | Set-Content package.json
npm i sleepmetrics
node -e "import('sleepmetrics').then(m => console.log(Object.keys(m).length, 'exports'))"
```

## 5. Later releases

```powershell
# bump the version in package.json (and CHANGELOG-style notes in the commit message)
node test\regression.test.js
npm pack --dry-run
git commit -am "0.1.1: ..." ; git tag -a v0.1.1 -m "0.1.1" ; git push --follow-tags
npm publish
```

## 6. Things this project will never do at release time

- **no build step** — the published artifact is the source you read
- **no dependencies** — `dependencies` stays `{}` (adding one is a design change, not a release step)
- **no postinstall** — never
- **no telemetry** — never
- **no `.d.ts` build chain** — if types ever ship, they are hand-written (see `ROADMAP.md`)

## 7. If something goes wrong

- **bad publish** (wrong files, broken import): `npm unpublish sleepmetrics@<version>` works within
  **72 hours** and only if nothing depends on it; otherwise publish a fixed patch immediately.
- **numbers moved unexpectedly**: stop, read `test/regression.test.js`, and check whether it was your
  change or the *input data* (the gate freezes the window at 2026-10-12 for exactly this reason).
- **a README link 404s on npm**: the target file is missing from `files` in `package.json`. Add it and
  publish a patch.
