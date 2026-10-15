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
> It covers 19 items — syntax gate · all 12 test files · the regression anchors · README links ·
> published-tarball contents · the `--json` contract (key set must not change) · zero dependencies and
> no IO imports in `src/` · both `examples/` scripts · the **R cross-check against `mctq`** ·
> **a pack-and-install smoke test** (tarball → clean dir → install → import → compute a minimal result)
> · the local `analyze` / `report` / `rhythm` / `datacheck` scripts and the nudge gate · doc-tree hash
> parity · git cleanliness and tag. Anything **FAIL** must be fixed or explained before publishing —
> the anchors are a hard gate, there is no "close enough".
>
> The steps below are the individual pieces, for when one item fails and you need to dig in.

```powershell
# a) syntax gate first — if this fails, nothing below means anything
node --check bin\sleepmetrics.js

# b) tests, one file at a time (batch `node --test test/` may hit EPERM in a sandbox)
foreach ($f in 'time','records','contract','sri','phase','rest','suggest','audit','rhythm','aside-guard','anchor-synthetic','regression') {
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

**First, get a credential that actually works.** `npm login` uses web auth on npm 11, and on this
machine it silently failed to write `~/.npmrc` — the file kept yesterday's dead token, so *every*
command answered `E401` while looking like a login problem. What worked was a **Granular Access
Token**: npmjs.com → avatar → *Access Tokens* → Generate → permission **Read and write**
(⚠️ the page **defaults to "No access"**, which would fail too), packages: this one.
Then write it yourself — **never paste a token into a chat, an issue or a commit**:

```powershell
npm config set //registry.npmjs.org/:_authToken <token>
npm whoami                 # must print your username BEFORE going further
```

```powershell
npm publish --dry-run      # last look at the tarball contents
npm publish
```

⚠️ **On a restricted PowerShell, `npm` may be blocked outright** —
`npm.ps1 cannot be loaded because running scripts is disabled on this system … PSSecurityException`.
Call `npm.cmd` instead.

`npm publish` needs network access. If the name got taken, it fails with `E403` — rename locally and
retry rather than publishing under a variant silently.

**Afterwards: wait for propagation, then check it the honest way.** Publishing is asynchronous, so
`npm view <pkg>@<version>` can 404 for a minute or two *after* a successful publish. Do **not** test
propagation with a regex over combined output — npm's own error text contains the version number you
are grepping for, so `-match '1\.2\.3'` happily matches *"No match found for version 1.2.3"* and
reports success when nothing is there:

```powershell
npm view sleepmetrics dist-tags --json 2>$null    # {"latest":"0.1.1"} is the only honest signal
```

Then verify a **real install** in an empty directory — the tarball, not the working tree:

```powershell
mkdir $env:TEMP\sm-check; cd $env:TEMP\sm-check
'{ "name": "sm-check", "type": "module", "private": true }' | Set-Content package.json
npm i sleepmetrics
node -e "console.log(require('./node_modules/sleepmetrics/package.json').version)"
```

Finally confirm **the tarball is the artifact you tested**: `npm view <pkg>@<ver> dist.shasum` must
equal the SHA1 of your local `npm pack` output, and `gitHead` must be the commit you pushed.
(For 0.1.1: shasum `a2c0f6dd…`, gitHead `ec4a11a9…` — both matched.)

## 5. Later releases

```powershell
# bump the version in package.json (and CHANGELOG-style notes in the commit message)
node test\regression.test.js
npm pack --dry-run
git commit -am "0.1.1: ..." ; git tag -a v0.1.1 -m "0.1.1" ; git push --follow-tags
npm publish
```

> ⚠️ **On this machine, `git push` needs the proxy flag** (measured 2026-10-15). Inside a *confined*
> shell — an agent sandbox — it also needs a TLS-backend flag. Without either, it fails in a way that
> *looks* like a credential problem and is not:
>
> ```powershell
> # in a normal terminal: this is usually all you need
> git -c http.proxy=http://127.0.0.1:10090 push origin main
>
> # inside a confined shell: add the backend — but expect the credential step to fail anyway (item 3)
> git -c http.proxy=http://127.0.0.1:10090 -c http.sslBackend=openssl push origin main
> ```
>
> Three separate things stack up here, and any one of them alone blocks the push:
>
> 1. **`github.com` is not reachable directly.** DNS resolves and TCP connects, but nothing comes back
>    over HTTPS — while `api.github.com` answers `200`. The Windows system proxy at `127.0.0.1:10090`
>    works. (Read yours from `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` →
>    `ProxyServer`. Command-line tools do **not** pick up the system proxy on their own.)
> 2. **The `schannel` TLS backend cannot start inside a confined shell** —
>    `AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)`. `openssl` works there.
> 3. **Git Credential Manager cannot run inside a confined shell**: it needs a named pipe, which the
>    sandbox refuses (`sh: couldn't create signal pipe, Win32 error 5`). So the push itself has to run
>    in a **normal terminal** — with the flags above, `git push` there (GCM intact, credentials already
>    stored) succeeds, and the remote head matches `HEAD`.
>
> Rule of thumb: if `git push` fails and the message mentions `schannel` or a signal pipe, it is this
> environment — not your credentials.

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
