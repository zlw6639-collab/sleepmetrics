# verify-all.ps1 —— 发布前全面验证（一条命令跑完）
#
# 用法：pwsh -File scripts\verify-all.ps1
#
# 覆盖三块：
#   A 库侧   —— 语法门 / 全部测试 / 回归锚点 / 链接门 / 发布物内容 / CLI 契约 / 零依赖与无 IO / examples / R 交叉 / 打包安装 smoke / 类型声明门
#   B 本机侧 —— analyze / report / rhythm / datacheck / 催睡闸门
#   C 仓库与文档 —— 文档两侧哈希一致 / git 干净且与远端同步 / 知识库入库
#
# ⚠️ 只读为主；唯一的写入是 report.mjs 重生成那份滚动文档（内容相同）。
# ⚠️ 判据来自 RELEASE.md 与 AGENTS.md：**回归锚点不达标 = 一律 FAIL**，没有"差不多"。

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$results = New-Object System.Collections.ArrayList
function Check($name, $ok, $detail) {
  [void]$results.Add([pscustomobject]@{ 项目 = $name; 结果 = $(if ($ok) { 'PASS' } else { 'FAIL' }); 说明 = $detail })
}

Push-Location $root
Write-Host "=== A. 库侧（$root） ===" -ForegroundColor Cyan

# A1 语法门 —— bin/ 不被测试加载，所以这一步不能省（AGENTS.md 第 6 条）
$srcFiles = @(Get-ChildItem src, bin, examples, scripts -Recurse -Include *.js, *.mjs -ErrorAction SilentlyContinue)
$syntaxBad = @()
foreach ($f in $srcFiles) { node --check $f.FullName 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $syntaxBad += $f.Name } }
Check 'A1 语法门' ($syntaxBad.Count -eq 0) "$($srcFiles.Count) 个文件，失败 $(($syntaxBad -join ','))"

# A2 全部测试
$tests = @('time', 'records', 'contract', 'sri', 'bootstrap', 'phase', 'rest', 'suggest', 'audit', 'rhythm', 'heatmap', 'aside-guard', 'anchor-synthetic', 'regression')
$testBad = @()
foreach ($t in $tests) { node "test\$t.test.js" > $null 2>&1; if ($LASTEXITCODE -ne 0) { $testBad += $t } }
Check 'A2 测试' ($testBad.Count -eq 0) "$($tests.Count) 个文件，失败 $(($testBad -join ','))"

# A3 回归锚点（硬门）
$reg = node test\regression.test.js 2>&1 | Out-String
$anchorOk = ($reg -match '74\.108') -and ($reg -match '65\.972') -and ($reg -match '86\.03')
Check 'A3 回归锚点' $anchorOk '74.108 / 65.972 / 86.03'

# A4 README 链接门
node scripts\check-links.mjs > $null 2>&1
Check 'A4 链接门' ($LASTEXITCODE -eq 0) 'README 内部链接都在 files 里'

# A5 发布物内容
$pack = (npm pack --dry-run 2>&1 | Out-String)
$pFiles = [regex]::Match($pack, 'total files:\s*(\d+)').Groups[1].Value
$pSize = [regex]::Match($pack, 'package size:\s*([\d.]+ \w+)').Groups[1].Value
$need = @('README.md', 'REFERENCES.md', 'SLEEP-FACTS.md', 'PUSHING-TO-YOUR-PHONE.md', 'ROADMAP.md', 'NON-GOALS.md', 'DISCLAIMER.md', 'HOLIDAYS.md', 'LICENSE', 'src/index.js', 'bin/sleepmetrics.js', 'sleepmetrics.d.ts')
$packMissing = @($need | Where-Object { $pack -notmatch [regex]::Escape($_) })
Check 'A5 发布物内容' ($packMissing.Count -eq 0) "$pFiles 文件 / $pSize；缺 $(($packMissing -join ','))"

# A6 --json 是机器契约（键集合不许变）
$rec = 'E:\ai\_tmp\_sm2\records_full.json'
$jsonOk = $false; $keys = '(未跑)'
if (Test-Path $rec) {
  node bin\sleepmetrics.js sri $rec --json > "$env:TEMP\v_sri.json" 2>&1
  $keys = (node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.env.TEMP+'/v_sri.json','utf8'))).join(','))" 2>&1)
  $jsonOk = ($keys -eq 'schemaVersion,sri,days,pairs,from,to,skipped,window,minDayMinutes')
  $jsonNote = "schemaVersion=$($keys -split ',' | Where-Object { $_ -eq 'schemaVersion' } | Measure-Object | Select-Object -ExpandProperty Count)"
}
Check 'A6 --json 契约' $jsonOk $keys

# A6b `--ci` 的**增量**契约 —— A6 钉住"不带 --ci 时一字不变"，这里钉住"带 --ci 时只多一个 interval"。
#     ⚠️ 两边都要钉：只测一边的话，新增字段会**悄悄**混进默认输出（AGENTS.md 规矩 4），
#        或者 interval 里混进与顶层重复的字段（两个来源迟早漂）。
$ciOk = $false; $ciKeys = '(未跑)'
if (Test-Path $rec) {
  node bin\sleepmetrics.js sri $rec --ci --json > "$env:TEMP\v_sri_ci.json" 2>&1
  $ciKeys = (node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.env.TEMP+'/v_sri_ci.json','utf8'))).join(','))" 2>&1)
  $ciInner = (node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(process.env.TEMP+'/v_sri_ci.json','utf8')).interval).join(','))" 2>&1)
  $ciOk = ($ciKeys -eq 'schemaVersion,sri,days,pairs,from,to,skipped,window,minDayMinutes,interval') `
    -and ($ciInner -eq 'lo,hi,level,unit,resamples,block,seed,degenerate')
  $ciKeys = "$ciKeys ｜ interval: $ciInner"
}
Check 'A6b --ci 增量契约' $ciOk $ciKeys

# A7 零依赖 + 库本体不碰 fs/网络
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$deps = @($pkg.dependencies.PSObject.Properties).Count
$ioImports = @(Select-String -Path src\*.js -Pattern "from '(node:)?(fs|net|http|https|child_process|dns|tls|worker_threads)'" -ErrorAction SilentlyContinue)
Check 'A7 零依赖/无 IO' (($deps -eq 0) -and ($ioImports.Count -eq 0)) "dependencies=$deps；src 里的 IO import=$($ioImports.Count)"

# A8 examples 能跑
$exOk = $false; $exDetail = '(未跑)'
if (Test-Path $rec) {
  node examples\export-for-r.mjs $rec --holidays data\holidays.json --window 400 > $null 2>&1; $e1 = $LASTEXITCODE
  node examples\push-ntfy.mjs $rec --dry-run > $null 2>&1; $e2 = $LASTEXITCODE
  $exOk = ($e1 -eq 0) -and ($e2 -eq 0)
  $exDetail = "export-for-r=$e1 · push-ntfy(--dry-run)=$e2"
}
Check 'A8 examples' $exOk $exDetail

# A9 R 交叉（mctq）
$rscript = (Get-ChildItem 'C:\Program Files\R' -Filter Rscript.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if ($rscript -and (Test-Path $rec)) {
  node examples\export-for-r.mjs $rec --holidays data\holidays.json --window 400 --csv "$env:TEMP\v_phase.csv" > $null 2>&1
  $rout = (& $rscript examples\crosscheck-mctq.R "$env:TEMP\v_phase.csv" 2>&1 | Out-String)
  $rOk = ($rout -match 'MSFsc') -and ($rout -match '一致 ✓') -and ($rout -notmatch '\*\*不一致\*\*')
  Check 'A9 R 交叉 (mctq)' $rOk 'MSFsc / SJL 逐位一致'
} else {
  Check 'A9 R 交叉 (mctq)' $false 'Rscript 未找到或真实数据缺失'
}

# A10 打包安装 smoke test —— A5 只列**文件名**，它不 import 任何东西；
#     "文件都在、一 import 就崩"（exports 映射写错、漏了 src 里被 import 的模块）只有**真装一次**才知道。
node scripts\pack-smoke.mjs > $null 2>&1
Check 'A10 打包安装 smoke' ($LASTEXITCODE -eq 0) 'tarball → 干净目录安装 → import → 算一条最小结果'

# A11 类型声明门 —— 手写的 sleepmetrics.d.ts 必须与真实导出**一字不差**，且 test/types/ 能编译
#     （正向用例要过，反向用例靠 @ts-expect-error 自证"类型真的在拦错"）。
#     ⚠️ 本机没装 TypeScript 时它是 **SKIP，不是通过** —— 与 A9 的 R 交叉同一规矩：
#        「没跑」和「跑过了」必须看得出来是两件事。
$typeOut = node scripts\check-types.mjs 2>&1 | Out-String
$typeCode = $LASTEXITCODE
Check 'A11 类型声明门' ($typeCode -eq 0) $(if ($typeCode -eq 2) {
  'SKIP：本机没找到 tsc —— 装 typescript 或设 SLEEPMETRICS_TSC 后重跑'
} else {
  (($typeOut.Trim() -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1) -replace '^\[types\] ', '')
})
Pop-Location

Write-Host "=== B. 本机侧（mifit） ===" -ForegroundColor Cyan
Push-Location 'E:\ai\mifit'
$b = @{}
foreach ($pair in @(@('analyze.mjs', 'B1 analyze'), @('report.mjs', 'B2 report'), @('rhythm.mjs', 'B3 rhythm IS/IV'), @('datacheck.mjs', 'B4 datacheck'))) {
  node $pair[0] > $null 2>&1
  Check $pair[1] ($LASTEXITCODE -eq 0) ''
}
node analyze.mjs --now > "$env:TEMP\v_now.txt" 2>&1
$nowOk = ($LASTEXITCODE -eq 0) -and ((Get-Content "$env:TEMP\v_now.txt" -Raw) -match '\[now\]')
Check 'B5 催睡闸门' $nowOk ((Get-Content "$env:TEMP\v_now.txt" -Raw).Trim() -split "`n" | Select-Object -First 1)
Pop-Location

Write-Host "=== C. 仓库与文档 ===" -ForegroundColor Cyan
Push-Location $root

# C1 文档两侧（权威地 vs 知识库副本）逐文件哈希
$diff = @()
$authDir = 'E:\大肥鱼\文档'
$mirrorDir = 'E:\ai\_kb_src\文档'
if ((Test-Path $authDir) -and (Test-Path $mirrorDir)) {
  Get-ChildItem $authDir -Filter *.md -Recurse | ForEach-Object {
    $rel = $_.FullName.Substring($authDir.Length).TrimStart('\')
    $m = Join-Path $mirrorDir $rel
    if (-not (Test-Path $m)) { $diff += "$rel 缺副本" }
    elseif ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $m).Hash) { $diff += "$rel 内容不同" }
  }
  Get-ChildItem $mirrorDir -Filter *.md -Recurse | ForEach-Object {
    $rel = $_.FullName.Substring($mirrorDir.Length).TrimStart('\')
    if (-not (Test-Path (Join-Path $authDir $rel))) { $diff += "$rel 权威地没有" }
  }
}
Check 'C1 文档两侧一致' ($diff.Count -eq 0) $(if ($diff.Count) { $diff -join '; ' } else { "两棵树逐文件哈希一致" })

# C2 git 干净 + 与远端同步 + tag
$st = (git status --short 2>&1 | Out-String).Trim()
Check 'C2a 工作区干净' ([string]::IsNullOrWhiteSpace($st)) $(if ($st) { ($st -split "`n" | Select-Object -First 3) -join '; ' } else { '' })
$sb = (git status -sb 2>&1 | Select-Object -First 1)
$tags = (git tag -l 2>&1) -join ' '
Check 'C2b 与远端同步' ($sb -notmatch 'ahead|behind') $sb
Check 'C2c tag' ($tags -match 'v0\.1\.1') $tags
Pop-Location

Write-Host "`n=== 汇总 ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
$bad = @($results | Where-Object { $_.结果 -eq 'FAIL' })
if ($bad.Count -eq 0) {
  Write-Host "✅ 全部通过（$($results.Count) 项）" -ForegroundColor Green
} else {
  Write-Host "❌ $($bad.Count)/$($results.Count) 项失败：" -ForegroundColor Red
  $bad | ForEach-Object { Write-Host ("   - " + $_.项目 + "  " + $_.说明) -ForegroundColor Red }
}
