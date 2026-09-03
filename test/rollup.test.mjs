import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hourKey, dayKey, dayStart, dayStrip, uptime, series24, summarize,
  percentile, fmtUptime, fmtMs, fmtDuration, fmtDay, fmtTime,
} from '../src/lib/rollup.js';

const H = 3600000, D = 86400000;

test('hourKey/dayKey/dayStart 自洽（UTC+8）', () => {
  const ts = Date.UTC(2026, 8, 4, 3, 25, 0); // 09-04 03:25Z = 北京 11:25
  assert.equal(hourKey(ts), Date.UTC(2026, 8, 4, 3, 0, 0));
  // 北京日起点 = UTC 前一日 16:00
  assert.equal(dayStart(dayKey(ts)), Date.UTC(2026, 8, 3, 16, 0, 0));
  assert.equal(dayStart(dayKey(Date.UTC(2026, 8, 4, 15, 59))), Date.UTC(2026, 8, 3, 16, 0, 0));
});

test('dayKey 切日在 UTC+8 的早八点', () => {
  // UTC 15:59 还是前一天；UTC 16:00 起是新的一天（北京 0 点）
  const before = Date.UTC(2026, 8, 4, 15, 59);
  const after = Date.UTC(2026, 8, 4, 16, 0);
  assert.equal(dayKey(after) - dayKey(before), 1);
});

test('dayStrip: 比例、空数据、标签、90 根', () => {
  const now = Date.UTC(2026, 8, 4, 6, 0);
  const buckets = [
    { hour: now - 2 * H, total: 100, ups: 99, ms_sum: 5000, ms_n: 99, ms_max: 90 },
    { hour: now - 1 * H, total: 60, ups: 30, ms_sum: 600, ms_n: 30, ms_max: 40 },
  ];
  const days = dayStrip(buckets, now, { days: 7 });
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.label), ['08-29', '08-30', '08-31', '09-01', '09-02', '09-03', '09-04']);
  // 两个桶都在 UTC 04:00/05:00 = 北京 09-04 → 都落今天；今天 160 探 129 成功
  assert.equal(days[6].ratio, 0.80625);
  assert.ok(Math.abs(days[6].avg - 5600 / 129) < 1e-9);
  assert.equal(days[5].ratio, null);
  assert.equal(days[0].total, 0);
});

test('uptime: 无数据 null', () => {
  assert.equal(uptime([]), null);
  assert.equal(uptime([{ total: 3, ups: 2 }]), 2 / 3);
});

test('series24: 降采样 ≤240 且保末点', () => {
  const samples = [];
  for (let i = 0; i < 1000; i++) samples.push({ ts: i * 60000, ok: true, ms: 100 });
  samples.push({ ts: 1000 * 60000, ok: false, ms: 0 });
  const pts = series24(samples, { maxPoints: 240 });
  assert.ok(pts.length <= 241, `len=${pts.length}`);
  assert.equal(pts[pts.length - 1].ok, false);
  assert.equal(pts[pts.length - 1].ms, null);
});

test('series24: 空样本', () => {
  assert.deepEqual(series24([]), []);
});

test('percentile: 最近秩', () => {
  const list = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(list, 0.5), 50);
  assert.equal(percentile(list, 0.95), 95);
  assert.equal(percentile([], 0.9), null);
});

test('summarize: 只计成功且有耗时样本', () => {
  const s = summarize([
    { ok: true, ms: 100 }, { ok: true, ms: 200 }, { ok: true, ms: 300 },
    { ok: false, ms: 0 }, { ok: true, ms: 0 },
  ]);
  assert.deepEqual(s, { p50: 200, p95: 300, avg: 200, n: 3 });
  assert.equal(summarize([]).p50, null);
});

test('fmtUptime', () => {
  assert.equal(fmtUptime(null), '—');
  assert.equal(fmtUptime(1), '100%');
  assert.equal(fmtUptime(0.9999), '99.99%');
  assert.equal(fmtUptime(0.99856), '99.86%');
});

test('fmtMs', () => {
  assert.equal(fmtMs(null), '—');
  assert.equal(fmtMs(0), '—');
  assert.equal(fmtMs(999), '999ms');
  assert.equal(fmtMs(1000), '1.00s');
  assert.equal(fmtMs(12345), '12.3s');
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(59_000), '59秒');
  assert.equal(fmtDuration(60_000), '1分00秒');
  assert.equal(fmtDuration(3600_000), '1小时00分');
  assert.equal(fmtDuration(90_000_000), '25小时00分');
  assert.equal(fmtDuration(180_000_000), '2天2小时');
});

test('fmtDay/fmtTime 走 UTC+8', () => {
  assert.equal(fmtTime(Date.UTC(2026, 8, 3, 16, 30)), '09-04 00:30');
  assert.equal(fmtDay(Date.UTC(2026, 8, 3, 16, 0)), '09-04');
  assert.equal(fmtTime(0), '—');
});
