#!/usr/bin/env Rscript
# 用 mctq（MSFsc / SJL 的参考实现）复算，与 sleepmetrics 的聚合量逐项对照。
#
# 用法（先由 export-for-r.mjs 产出 CSV）：
#   node examples/export-for-r.mjs records.json --holidays data/holidays.json --window 400 --csv phase-inputs.csv
#   Rscript examples/crosscheck-mctq.R phase-inputs.csv
#
# ⚠️ 判据先定：**数值不等 ⇒ 先查口径，绝不为对齐改回归锚点**（74.108 / 65.972 / 86.03）。
# ⚠️ 只有**聚合量**过界 —— 本脚本不收任何时间戳；时区问题已在 JS 侧那次转换里 settle 掉。
# ⚠️ 它验的是「**发布的公式我们实现对了吗**」，不是「整条管线对不对」（喂同一套 msf/sd_* 是把
#    下游隔离出来，这是刻意的取舍）。
# ⚠️ mctq 0.3.2 的真实约束（2026-10-14 实测，别按记忆调用）：
#      msf 必须是 `hms`，sd_* 必须是 `lubridate::duration`，**不接受裸数字**；
#      长度必须一致（向量化）；`alarm_f = TRUE` 时 MSFsc 返回 **NA**。

suppressMessages({
  library(mctq); library(hms); library(lubridate)
})

argv <- commandArgs(trailingOnly = TRUE)
if (length(argv) < 1) stop("usage: Rscript crosscheck-mctq.R <phase-inputs.csv>")

d <- read.csv(argv[1], stringsAsFactors = FALSE)
kv <- setNames(as.list(d$value), d$metric)
g <- function(k) {
  # ⚠️ 先判 NULL 再判 NA —— 否则「缺这一行」会报成 `argument is of length zero`，
  #    看不出到底缺的是哪个指标（2026-10-14 真踩过）。
  if (is.null(kv[[k]])) stop(sprintf("CSV 里没有 `%s` —— 现有 metric：%s",
                                     k, paste(names(kv), collapse = ", ")))
  v <- suppressWarnings(as.numeric(kv[[k]]))
  if (is.na(v)) stop(sprintf("CSV 里 `%s` 不是数字：%s", k, kv[[k]]))
  v
}
h_of <- function(x) as.numeric(x) / 3600   # hms 与 duration 的 as.numeric 都是**秒**

cat("=== mctq 交叉验证 ===\n")
cat("mctq 版本:", as.character(packageVersion("mctq")), "\n")
cat("msf_sc 签名: "); print(args(mctq::msf_sc))
cat("sjl   签名: "); print(args(mctq::sjl))

so_w <- g("so_w"); so_f <- g("so_f")
sd_w <- g("sd_w"); sd_f <- g("sd_f"); sd_week <- g("sd_week")
msw_js <- g("msw"); msf_js <- g("msf"); msfsc_js <- g("msfsc"); sjl_js <- g("sjl")
alarm_f <- toupper(as.character(kv[["alarm_f"]])) == "TRUE"

# [0] 先验一个简单关系：MSF 是否 = SO_f + SD_f/2（我方就是这么算的）
cat(sprintf("\n[0] MSF 关系：JS 给出 %.6f h ｜ SO_f + SD_f/2 = %.6f h ｜ 差 %.6f h\n",
            msf_js, so_f + sd_f / 2, msf_js - (so_f + sd_f / 2)))

# [0b] mctq 会走哪个分支？—— 分支不同，差异就是**预期的**，不是 bug
# ⚠️ R 的 `else` 不能像别的语言那样裸换行（`Rscript` 逐行解析会报 unexpected 'else'）
#    ⇒ 必须用 `{}` 包起来。2026-10-14 踩过。
if (alarm_f) {
  branch <- "alarm_f = TRUE ⇒ 返回 NA"
} else if (sd_f <= sd_w) {
  branch <- "sd_f <= sd_w ⇒ MSFsc 直接等于 MSF（**不校正**）"
} else {
  branch <- "sd_f > sd_w ⇒ MSF − (SD_f − SD_week)/2（展开 = SO_f + SD_week/2）"
}
cat(sprintf("[0b] 本机数据走的分支：%s\n", branch))
cat(sprintf("     SD_w %.6f h ｜ SD_f %.6f h ｜ SD_week %.6f h\n", sd_w, sd_f, sd_week))

# [1] mctq 复算
r_msfsc <- mctq::msf_sc(
  msf = hms::as_hms(msf_js * 3600),
  sd_w = lubridate::dhours(sd_w),
  sd_f = lubridate::dhours(sd_f),
  sd_week = lubridate::dhours(sd_week),
  alarm_f = alarm_f
)
r_sjl <- mctq::sjl(
  msf = hms::as_hms(msf_js * 3600),
  msw = hms::as_hms(msw_js * 3600)
)

# [2] 逐项对照
cmp <- function(label, js_h, r_obj, tol_h) {
  if (length(r_obj) == 0 || is.na(r_obj)) {
    cat(sprintf("%-8s JS %10.6f h ｜ mctq %10s ｜ %s\n", label, js_h, "NA", "mctq 返回 NA（alarm_f 分支）"))
    return(invisible(NULL))
  }
  rh <- h_of(r_obj)
  delta <- rh - js_h
  verdict <- if (abs(delta) <= tol_h) "一致 ✓" else "**不一致**"
  cat(sprintf("%-8s JS %10.6f h ｜ mctq %10.6f h ｜ 差 %+9.6f h ｜ %s\n", label, js_h, rh, delta, verdict))
}
cat("\n[2] 对照\n")
cmp("MSFsc", msfsc_js, r_msfsc, 1 / 3600)     # 容差 1 秒
cmp("SJL", sjl_js, r_sjl, 1 / 3600)

cat("\n⚠️ 手算复核（与实现无关，纯算术）：\n")
cat(sprintf("   SO_f + SD_week/2 = %.6f + %.6f/2 = %.6f h\n", so_f, sd_week, so_f + sd_week / 2))
cat(sprintf("   MSF − MSW        = %.6f − %.6f   = %.6f h\n", msf_js, msw_js, msf_js - msw_js))
cat("\n⚠️ 口径差（预期内，别当 bug）：mctq 在 `sd_f <= sd_w` 时**不校正**（直接返回 MSF），\n")
cat("   本库恒按 `SO_f + SD_week/2` 算。若本机数据落进那个分支，差异是设计差异，不是实现错误。\n")
cat("⚠️ 另有一条已知差异：`alarm_f`（自由日靠闹钟醒 ⇒ mctq 返回 NA）。手环判断不了闹钟，本库恒按自由日算。\n")
