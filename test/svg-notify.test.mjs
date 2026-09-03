import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecgPath, sparkline, badge } from '../src/lib/svg.js';
import { buildMessage } from '../src/lib/notify.js';

test('ecgPath: 故障拉平线', () => {
  assert.equal(ecgPath({ w: 720, h: 56, flat: true }), 'M0 34 L720 34');
});

test('ecgPath: 正常轨迹含 R 尖峰（y=6）且终点闭合', () => {
  const d = ecgPath({ w: 720, h: 56 });
  assert.ok(d.startsWith('M0 34 L'));
  assert.ok(d.includes(' 6'), '应有 R 峰 y=6');
  assert.ok(d.endsWith('720 34'));
});

test('sparkline: 空数据输出占位不抛错', () => {
  assert.ok(sparkline([], Date.now()).length > 0);
});

test('sparkline: 画折线、失败点成红点、null 断线', () => {
  const now = 86400000 * 100;
  const pts = [
    { t: now - 3000, ms: 100, ok: true },
    { t: now - 2000, ms: 200, ok: true },
    { t: now - 1000, ms: null, ok: false },
  ];
  const svg = sparkline(pts, now, { w: 132, h: 30 });
  assert.ok(svg.includes('<path'), '应有折线');
  assert.ok(svg.includes('<circle'), '失败点应成圆点');
  const segs = svg.split('M').length - 1;
  assert.equal(segs, 1, '失败点在末尾，前面只有一段连续线');
});

test('sparkline: 中间失败会断线为两段', () => {
  const now = 86400000 * 100;
  const pts = [
    { t: now - 4000, ms: 100, ok: true },
    { t: now - 3000, ms: null, ok: false },
    { t: now - 2000, ms: 150, ok: true },
  ];
  const segs = sparkline(pts, now).split('M').length - 1;
  assert.equal(segs, 2);
});

test('badge: 双格结构并转义', () => {
  const s = badge({ label: 'status', value: 'UP', color: '#337a5b' });
  assert.ok(s.startsWith('<svg'));
  assert.ok(s.includes('fill="#4c4a45"'));
  assert.ok(s.includes('fill="#337a5b"'));
  assert.equal(s.includes('"'), true);
  const evil = badge({ label: 'a"b', value: '<x>' });
  assert.ok(evil.includes('&quot;'));
  assert.ok(evil.includes('&lt;x&gt;'));
});

test('buildMessage: 开事件', () => {
  const m = buildMessage({
    kind: 'open',
    check: { slug: 'blogman', name: 'Blogman', type: 'http', target: 'https://blog.namooca.com' },
    incident: { id: 7, started: Date.UTC(2026, 8, 4, 0, 0), cause: 'HTTP 502', last_err: 'HTTP 502' },
    now: Date.UTC(2026, 8, 4, 0, 5),
    statusUrl: 'https://pulse.namooca.com',
  });
  assert.equal(m.title, '🔴 Blogman 故障');
  assert.ok(m.text.includes('已确认故障'));
  assert.ok(m.text.includes('HTTP 502'));
  assert.equal(m.payload.event, 'incident.opened');
  assert.equal(m.payload.incident.duration_ms, null);
});

test('buildMessage: 恢复带时长', () => {
  const started = Date.UTC(2026, 8, 4, 0, 0);
  const ended = started + 5 * 60000;
  const m = buildMessage({
    kind: 'recover',
    check: { slug: 'blogman', name: 'Blogman', type: 'http', target: '' },
    incident: { id: 7, started, ended },
    now: ended,
  });
  assert.equal(m.title, '🟢 Blogman 恢复');
  assert.ok(m.text.includes('持续 5分00秒'));
  assert.equal(m.payload.event, 'incident.recovered');
  assert.equal(m.payload.incident.duration_ms, 300000);
});
