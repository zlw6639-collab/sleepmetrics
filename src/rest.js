/**
 * 休息日判定 —— **只接受注入的表，自己不读文件**（项目方案 §10.2 硬边界 2）。
 *
 * 为什么要有这一层：休息日 = 周末 − 调休上班 + 法定假日。
 * 这条规则每年都变（国办每年 11 月发次年安排），散在多处迟早「改了两处漏一处」。
 * 库这边只认「表」这个形状，数据从哪来（本机 json / 网络 / 调用方内联）是调用方的事。
 *
 * 表形状：
 *   {
 *     "2026": { holidays: ["2026-10-01", …], workdays: ["2026-10-11", …], source: "…" },
 *   }
 *   holidays = 法定放假日（即使是周中也休）；workdays = 调休上班日（即使是周末也上班）
 *
 * ⚠️ 缺年份**不报错**：退化成「只按周末」，并用 `missingYears()` 让上层能明说
 *   「我不知道这一年的调休」——**悄悄给错建议比报错更坏**。
 */

/** 'YYYY-MM-DD' → 星期几（0=周日 … 6=周六）。用 UTC 正午取，避免宿主时区把日期挪一天 */
export const dowOf = (ds) => new Date(ds + 'T12:00:00Z').getUTCDay();

/** 是否周末（**不考虑调休**） */
export const isWeekend = (ds) => {
  const d = dowOf(ds);
  return d === 0 || d === 6;
};

/**
 * 用一张表造出判定函数族。
 * @param {object} [table] 年份 → { holidays, workdays }
 * @returns {{isRest: (ds:string)=>boolean, isHoliday: Function, isMakeupWorkday: Function, isWeekend: Function, hasYear: Function, missingYears: Function, loadedYears: Function}}
 */
export function makeRestJudge(table = {}) {
  const byYear = new Map();
  for (const [k, v] of Object.entries(table ?? {})) {
    if (!/^\d{4}$/.test(k)) continue;
    byYear.set(k, {
      holidays: new Set(Array.isArray(v?.holidays) ? v.holidays : []),
      workdays: new Set(Array.isArray(v?.workdays) ? v.workdays : []),
    });
  }
  const NONE = { holidays: new Set(), workdays: new Set() };
  const yearOf = (ds) => String(ds).slice(0, 4);
  const info = (ds) => byYear.get(yearOf(ds)) || NONE;

  return {
    isWeekend,
    isHoliday: (ds) => info(ds).holidays.has(ds),
    isMakeupWorkday: (ds) => info(ds).workdays.has(ds),
    /** 休息日：**调休上班优先否决**，否则「法定假日 ∪ 周末」 */
    isRest: (ds) => (info(ds).workdays.has(ds) ? false : info(ds).holidays.has(ds) || isWeekend(ds)),
    hasYear: (ds) => byYear.has(yearOf(ds)),
    /** 给定日期串里哪些年份没录数据（上层用来提示「已退化为只按周末」） */
    missingYears: (dates) => [...new Set((dates ?? []).map(yearOf))].filter((y) => !byYear.has(y)),
    loadedYears: () => [...byYear.keys()].sort(),
  };
}
