// 聚合与格式化 —— 纯函数。
// 桶(bucket)是按小时的预聚合行；90 天在线率与按日条带都从桶算，不扫原始样本。
// 显示时区固定 UTC+8（CONTEXT.md「按日条带」）。

export const TZ_OFFSET_MIN = 480;

export function hourKey(ts) {
  return Math.floor(ts / 3600000) * 3600000;
}

export function dayKey(ts, tzMin = TZ_OFFSET_MIN) {
  return Math.floor((ts + tzMin * 60000) / 86400000);
}

/** dayKey（自 1970 起、已含时区偏移的天序号）→ 该日起点 ts（UTC 毫秒） */
export function dayStart(dayNum, tzMin = TZ_OFFSET_MIN) {
  return dayNum * 86400000 - tzMin * 60000;
}

/**
 * 桶行数组 → 按日条带（旧→新），共 days 根，末位是今天。
 * @param buckets [{hour, total, ups, ms_sum, ms_n, ms_max}] hour 为 UTC 毫秒整点
 * @returns [{label:'09-04', ratio:number|null, avg:number|null, total}]
 *   ratio: null=无数据；0–1
 */
export function dayStrip(buckets, now, { days = 90, tzMin = TZ_OFFSET_MIN } = {}) {
  const byDay = new Map();
  for (const b of buckets || []) {
    const d = dayKey(b.hour, tzMin);
    const acc = byDay.get(d) || { total: 0, ups: 0, ms_sum: 0, ms_n: 0 };
    acc.total += b.total || 0;
    acc.ups += b.ups || 0;
    acc.ms_sum += b.ms_sum || 0;
    acc.ms_n += b.ms_n || 0;
    byDay.set(d, acc);
  }
  const today = dayKey(now, tzMin);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = today - i;
    const acc = byDay.get(d);
    const total = acc ? acc.total : 0;
    const ratio = total > 0 ? acc.ups / total : null;
    const avg = acc && acc.ms_n > 0 ? acc.ms_sum / acc.ms_n : null;
    out.push({ label: fmtDay(dayStart(d, tzMin), tzMin), ratio, avg, total });
  }
  return out;
}

/** 桶行 → 90 天在线率；无数据返回 null */
export function uptime(buckets) {
  let total = 0, ups = 0;
  for (const b of buckets || []) { total += b.total || 0; ups += b.ups || 0; }
  return total > 0 ? ups / total : null;
}

/**
 * 原始样本 → 24h 折线点（旧→新），≤ maxPoints 个。
 * ok 样本带 ms；失败样本 ms 为 null（折线在此断开）。
 */
export function series24(samples, { maxPoints = 240 } = {}) {
  const list = samples || [];
  if (list.length === 0) return [];
  const step = Math.ceil(list.length / maxPoints);
  const out = [];
  for (let i = 0; i < list.length; i += step) out.push(pluck(list[i]));
  const last = list[list.length - 1];
  if (out.length === 0 || out[out.length - 1].t !== last.ts) out.push(pluck(last));
  return out;

  function pluck(s) {
    return { t: s.ts, ms: s.ok && s.ms > 0 ? s.ms : null, ok: !!s.ok };
  }
}

/** 延迟概要：p50/p95/avg（只计成功且有耗时的样本） */
export function summarize(samples) {
  const msList = [];
  for (const s of samples || []) if (s.ok && s.ms > 0) msList.push(s.ms);
  if (msList.length === 0) return { p50: null, p95: null, avg: null, n: msList.length };
  msList.sort((a, b) => a - b);
  const p50 = percentile(msList, 0.5);
  const p95 = percentile(msList, 0.95);
  const avg = msList.reduce((a, b) => a + b, 0) / msList.length;
  return { p50, p95, avg, n: msList.length };
}

/** 最近秩百分位；sorted 升序 */
export function percentile(sorted, p) {
  if (!sorted || sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

// ── 格式化 ────────────────────────────────────────────────────

export function fmtUptime(ratio, { blank = '—' } = {}) {
  if (ratio == null) return blank;
  const pct = ratio * 100;
  // 不给「100%」的错觉：≥99.995 也只显示 100.00%？——显示 100%，但 <100 时保留两位
  if (pct >= 99.995) return '100%';
  return pct.toFixed(2) + '%';
}

export function fmtMs(ms, { blank = '—' } = {}) {
  if (ms == null || ms <= 0) return blank;
  if (ms >= 10000) return (ms / 1000).toFixed(1) + 's';
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
  return Math.round(ms) + 'ms';
}

/** 时长 → 「3分12秒」「2小时05分」「4天」 */
export function fmtDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '分' + String(s % 60).padStart(2, '0') + '秒';
  const h = Math.floor(m / 60);
  if (h < 48) return h + '小时' + String(m % 60).padStart(2, '0') + '分';
  const d = Math.floor(h / 24);
  return d + '天' + (h % 24) + '小时';
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** ts → 'MM-DD'（UTC+8） */
export function fmtDay(ts, tzMin = TZ_OFFSET_MIN) {
  const d = new Date(ts + tzMin * 60000);
  return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/** ts → 'MM-DD HH:mm'（UTC+8） */
export function fmtTime(ts, tzMin = TZ_OFFSET_MIN) {
  if (!ts) return '—';
  const d = new Date(ts + tzMin * 60000);
  return pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' +
    pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
