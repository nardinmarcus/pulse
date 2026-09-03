import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDue, transition, pauseDecision, resumeDecision, overall } from '../src/lib/model.js';

const ck = (enabled = 1, interval_s = 60) => ({ enabled, interval_s });

test('isDue: 未跑过必到期', () => {
  assert.equal(isDue(ck(), null, 1000), true);
  assert.equal(isDue(ck(), { last_run: 0 }, 1000), true);
});

test('isDue: 间隔内不到期，含 500ms 容差', () => {
  const now = 60000;
  assert.equal(isDue(ck(), { last_run: now - 59_600 }, now), true);   // 容差内
  assert.equal(isDue(ck(), { last_run: now - 59_000 }, now), false);  // 差 1s
  assert.equal(isDue(ck(), { last_run: now - 61_000 }, now), true);
});

test('isDue: 停用不到期', () => {
  assert.equal(isDue(ck(0), null, 1000), false);
});

test('transition: 成功 → up', () => {
  const t = transition({ status: 'new', fails: 0, incidentOpen: false }, { ok: true });
  assert.deepEqual(t, { status: 'up', fails: 0, openIncident: false, closeIncident: false });
});

test('transition: 失败一次即 down，但不开事件', () => {
  const t = transition({ status: 'up', fails: 0, incidentOpen: false }, { ok: false });
  assert.equal(t.status, 'down');
  assert.equal(t.fails, 1);
  assert.equal(t.openIncident, false);
});

test('transition: 连续第 2 次失败开事件', () => {
  const t = transition({ status: 'down', fails: 1, incidentOpen: false }, { ok: false });
  assert.equal(t.fails, 2);
  assert.equal(t.openIncident, true);
});

test('transition: 已开事件不重复开', () => {
  const t = transition({ status: 'down', fails: 5, incidentOpen: true }, { ok: false });
  assert.equal(t.openIncident, false);
  assert.equal(t.fails, 6);
});

test('transition: 恢复关事件', () => {
  const t = transition({ status: 'down', fails: 3, incidentOpen: true }, { ok: true });
  assert.deepEqual(t, { status: 'up', fails: 0, openIncident: false, closeIncident: true });
});

test('transition: 自定义确认阈值', () => {
  const a = transition({ status: 'up', fails: 1, incidentOpen: false }, { ok: false }, { confirm: 3 });
  assert.equal(a.openIncident, false);
  const b = transition({ status: 'down', fails: 2, incidentOpen: false }, { ok: false }, { confirm: 3 });
  assert.equal(b.openIncident, true);
});

test('pauseDecision: 停用并关闭未决事件', () => {
  assert.deepEqual(pauseDecision({ incidentOpen: true }), { status: 'paused', fails: 0, closeIncident: true });
  assert.deepEqual(pauseDecision({ incidentOpen: false }), { status: 'paused', fails: 0, closeIncident: false });
});

test('resumeDecision: 恢复后回 new', () => {
  assert.deepEqual(resumeDecision(), { status: 'new', fails: 0 });
});

test('overall: 任一 down → incident', () => {
  assert.equal(overall([{ status: 'up' }, { status: 'down' }]), 'incident');
});

test('overall: 全 new → new', () => {
  assert.equal(overall([{ status: 'new' }, { status: 'new' }]), 'new');
});

test('overall: paused/new 混合非全 new → operational', () => {
  assert.equal(overall([{ status: 'new' }, { status: 'paused' }, { status: 'up' }]), 'operational');
  assert.equal(overall([]), 'operational');
});

test('overall: 全部未定性（new+paused）→ new', () => {
  assert.equal(overall([{ status: 'new' }, { status: 'paused' }]), 'new');
  assert.equal(overall([{ status: 'paused' }, { status: 'paused' }]), 'new');
});
