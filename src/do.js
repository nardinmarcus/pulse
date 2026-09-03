// PulseCore —— 单例 Durable Object：建表 / 同步配置 / 拨测 / 状态机 / 聚合 / 通知。
// 词汇见 CONTEXT.md。这是唯一允许写 SQL 与 import cloudflare:sockets 的模块（AGENTS.md）。
import { DurableObject } from 'cloudflare:workers';
import { connect } from 'cloudflare:sockets';
import { CHECKS } from './checks.js';
import { isDue, transition, pauseDecision, resumeDecision, STATUS } from './lib/model.js';
import { hourKey, dayStrip, uptime, series24, summarize } from './lib/rollup.js';
import { buildMessage } from './lib/notify.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS checks(
  slug TEXT PRIMARY KEY, name TEXT, grp TEXT, type TEXT, target TEXT DEFAULT '',
  method TEXT DEFAULT 'GET', accept TEXT DEFAULT '[200]', keyword TEXT DEFAULT '',
  interval_s INTEGER DEFAULT 60, timeout_s INTEGER DEFAULT 10, follow_redirects INTEGER DEFAULT 1,
  enabled INTEGER DEFAULT 1, note TEXT DEFAULT '', push_token TEXT DEFAULT '',
  platform TEXT DEFAULT '', ord INTEGER DEFAULT 0, cfg TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS state(
  slug TEXT PRIMARY KEY, status TEXT DEFAULT 'new', since INTEGER DEFAULT 0,
  fails INTEGER DEFAULT 0, incident_open INTEGER DEFAULT 0,
  last_run INTEGER DEFAULT 0, last_ok INTEGER DEFAULT 0,
  last_ms INTEGER DEFAULT 0, last_code INTEGER DEFAULT 0, last_err TEXT DEFAULT '',
  ping_last INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS samples(
  slug TEXT, ts INTEGER, ok INTEGER, ms INTEGER DEFAULT 0, code INTEGER DEFAULT 0, err TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_samples_slug_ts ON samples(slug, ts);
CREATE TABLE IF NOT EXISTS buckets(
  slug TEXT, hour INTEGER, total INTEGER DEFAULT 0, ups INTEGER DEFAULT 0,
  ms_sum INTEGER DEFAULT 0, ms_n INTEGER DEFAULT 0, ms_max INTEGER DEFAULT 0,
  PRIMARY KEY(slug, hour));
CREATE TABLE IF NOT EXISTS incidents(
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, started INTEGER, ended INTEGER DEFAULT 0,
  cause TEXT DEFAULT '', last_err TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_incidents ON incidents(started);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`;

const RETAIN_SAMPLES_MS = 48 * 3600 * 1000;   // 原始样本 48h
const RETAIN_BUCKETS_MS = 365 * 86400 * 1000; // 小时桶 365d
const RETAIN_INCIDENT_MS = 180 * 86400 * 1000;// 事件 180d
const CONFIRM_FAILS = 2;                      // 确认故障阈值（CONTEXT.md）
const SNAPSHOT_TTL_MS = 20 * 1000;            // 快照缓存

export class PulseCore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this._snapshot = null; // {ts, data}
    this._force = null;    // dev 模拟: Map(slug -> 'ok'|'fail')
  }

  // ── 基础设施 ────────────────────────────────────────────────

  sql() { return this.ctx.storage.sql; }

  ensureSchema() {
    this.sql().exec(SCHEMA);
    // 轻量迁移：v1 表没有 platform 列（已存在则忽略）
    try { this.sql().exec("ALTER TABLE checks ADD COLUMN platform TEXT DEFAULT ''"); } catch { /* 已有该列 */ }
  }

  /** checks-as-code：按 slug 增量同步 src/checks.js 的配置到库。 */
  syncChecks() {
    this.ensureSchema();
    const now = Date.now();
    const rows = [...this.sql().exec('SELECT slug, cfg, push_token FROM checks')];
    const have = new Map(rows.map((r) => [r.slug, r]));
    CHECKS.forEach((c, i) => {
      const cfg = JSON.stringify(normalizeCheck(c));
      const cur = have.get(c.slug);
      if (!cur) {
        const token = c.type === 'push' ? genToken(c.slug) : '';
        this.sql().exec(
          `INSERT INTO checks(slug,name,grp,type,target,method,accept,keyword,interval_s,timeout_s,
             follow_redirects,enabled,note,push_token,platform,ord,cfg,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          c.slug, c.name, c.grp, c.type, c.target || '', c.method || 'GET',
          JSON.stringify(c.accept || [200]), c.keyword || '', c.interval_s || 60, c.timeout_s ?? 10,
          c.follow_redirects === 0 ? 0 : 1, c.enabled === 0 ? 0 : 1, c.note || '', token,
          c.platform || '', i, cfg, now, now);
        this.sql().exec('INSERT OR IGNORE INTO state(slug) VALUES(?)', c.slug);
      } else if (cur.cfg !== cfg) {
        // 配置变了：更新检查字段；push token 保留
        this.sql().exec(
          `UPDATE checks SET name=?,grp=?,type=?,target=?,method=?,accept=?,keyword=?,interval_s=?,
             timeout_s=?,follow_redirects=?,enabled=?,note=?,platform=?,ord=?,cfg=?,updated_at=? WHERE slug=?`,
          c.name, c.grp, c.type, c.target || '', c.method || 'GET',
          JSON.stringify(c.accept || [200]), c.keyword || '', c.interval_s || 60, c.timeout_s ?? 10,
          c.follow_redirects === 0 ? 0 : 1, c.enabled === 0 ? 0 : 1, c.note || '', c.platform || '',
          i, cfg, now, c.slug);
        // 停用/恢复同步进状态机
        const st = this.stateOf(c.slug);
        if (c.enabled === 0 && st.status !== 'paused') this.applyPause(c.slug, st);
        if (c.enabled !== 0 && st.status === 'paused') this.applyResume(c.slug);
      }
    });
  }

  stateOf(slug) {
    const rows = [...this.sql().exec('SELECT * FROM state WHERE slug=?', slug)];
    return rows[0] || { slug, status: 'new', fails: 0, incident_open: 0, last_run: 0 };
  }

  getCheck(slug) {
    const rows = [...this.sql().exec('SELECT * FROM checks WHERE slug=?', slug)];
    return rows[0] || null;
  }

  // ── 拨测主循环（cron 与 DO alarm 双通道，45s 去重，见 tick 顶部）──

  /** alarm 链：每轮结束补上下一个 60s 闹钟。cron 失效时监控自愈（CONTEXT.md Decisions）。
   *  本地 dev（PULSE_DEV=1）不自动上闹钟——smoke 靠 /__scheduled 手动驱动，保确定性。 */
  async ensureAlarm() {
    if (this.env.PULSE_DEV === '1') return;
    try {
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
      }
    } catch { /* alarm 设置失败不影响本轮 */ }
  }

  async alarm() {
    await this.tick();
  }

  async tick() {
    // 双通道去重：TICK_DEDUP_MS（默认 45s）内已跑过则跳过（cron+alarm 并存时不重复探测）
    const dedupMs = Number(this.env.TICK_DEDUP_MS ?? 45_000);
    const meta = [...this.sql().exec("SELECT v FROM meta WHERE k='last_tick'")][0];
    const now0 = Date.now();
    if (dedupMs > 0 && meta && now0 - Number(meta.v) < dedupMs) { await this.ensureAlarm(); return { skipped: true, at: now0 }; }
    this.sql().exec("INSERT INTO meta(k,v) VALUES('last_tick',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", now0);
    await this.ensureAlarm(); // 先上下一轮闹钟再探测：节奏不受本轮探测时长影响

    this.syncChecks();
    const now = Date.now();
    // ping_last 在 state 表（心跳打点时刻），须 join 进来
    const checks = [...this.sql().exec(
      'SELECT c.*, s.ping_last FROM checks c LEFT JOIN state s ON s.slug=c.slug')];
    // 心跳检查每分钟都要判 staleness（不按自身 interval 轮询）；其余到期才探测
    const due = checks.filter((c) => c.type === 'push'
      ? !!c.enabled
      : isDue({ enabled: c.enabled, interval_s: c.interval_s }, { last_run: c.last_run || 0 }, now));

    // 并行探测（免费档 50 子请求内；检查数远小于此）
    const results = await Promise.all(due.map(async (c) => {
      const forced = this._force?.get(c.slug);
      if (forced) this._force.delete(c.slug); // 模拟结果只生效一次
      let r;
      if (forced) { r = forced === 'ok' ? { ok: true, ms: 42, code: 200, err: '' } : { ok: false, ms: 0, code: 0, err: 'simulated failure' }; }
      else if (c.type === 'push') { r = await this.probePush(c, now); }
      else if (c.type === 'tcp') { r = await probeTcp(c); }
      else { r = await probeHttp(c, this.env); }
      return { c, r };
    }));

    for (const { c, r } of results) this.record(c, r, now);
    this.maintain(now);
    this._snapshot = null; // 失效快照
    await this.ensureAlarm(); // 自续 alarm 链
    return { ran: results.length, at: now };
  }

  /** 心跳检查：无外呼，只判 staleness（interval×2 未打点即失败）。从未打点则保持 new。 */
  async probePush(c, now) {
    if (!c.ping_last) return { skip: true, ok: false, ms: 0, code: 0, err: '尚未收到心跳' };
    const staleMs = c.interval_s * 2 * 1000;
    const age = now - c.ping_last;
    if (age > staleMs) return { ok: false, ms: 0, code: 0, err: `心跳超时 ${Math.round(age / 60000)} 分钟未打点` };
    return { ok: true, ms: 0, code: 200, err: '' };
  }

  /** 落一次探测结果：样本 + 状态机 + 桶 + 事件 + 通知。r.skip=不定性（未定性保持 new）。 */
  record(c, r, now) {
    if (r.skip) return;
    const ok = r.ok ? 1 : 0;
    this.sql().exec('INSERT INTO samples(slug,ts,ok,ms,code,err) VALUES(?,?,?,?,?,?)',
      c.slug, now, ok, r.ms || 0, r.code || 0, r.err || '');

    const st = this.stateOf(c.slug);
    const t = transition(
      { status: st.status, fails: st.fails, incidentOpen: !!st.incident_open },
      { ok: !!r.ok }, { confirm: CONFIRM_FAILS });

    this.sql().exec(
      `UPDATE state SET status=?, since=?, fails=?, incident_open=?,
         last_run=?, last_ok=?, last_ms=?, last_code=?, last_err=?, ping_last=?
       WHERE slug=?`,
      t.status, t.status !== st.status ? now : st.since, t.fails,
      t.openIncident ? 1 : (t.closeIncident ? 0 : st.incident_open),
      now, r.ok ? now : st.last_ok, r.ms || 0, r.code || 0, r.err || '',
      c.type === 'push' ? st.ping_last : 0, c.slug);

    // 桶：小时粒度预聚合（失败样本计入 total 不计延迟）
    const h = hourKey(now);
    this.sql().exec(
      `INSERT INTO buckets(slug,hour,total,ups,ms_sum,ms_n,ms_max) VALUES(?,?,1,?,?,?,?)
       ON CONFLICT(slug,hour) DO UPDATE SET
         total=total+1, ups=ups+?, ms_sum=ms_sum+?, ms_n=ms_n+?, ms_max=max(ms_max,?)`,
      c.slug, h, ok,
      ok && r.ms > 0 ? r.ms : 0, ok && r.ms > 0 ? 1 : 0, ok ? r.ms : 0,
      ok, ok && r.ms > 0 ? r.ms : 0, ok && r.ms > 0 ? 1 : 0, ok ? r.ms : 0);

    // 事件与通知
    if (t.openIncident) this.openIncident(c, r, now);
    else if (t.closeIncident) this.closeIncident(c, now, 'recovered');
  }

  openIncident(c, r, now) {
    this.sql().exec('INSERT INTO incidents(slug,started,ended,cause,last_err) VALUES(?,?,0,?,?)',
      c.slug, now, r.err || '探测失败', r.err || '');
    this.notify('open', c, { started: now, cause: r.err || '', last_err: r.err || '' }, now);
  }

  closeIncident(c, now, why) {
    const rows = [...this.sql().exec(
      'SELECT id, started FROM incidents WHERE slug=? AND ended=0 ORDER BY started DESC LIMIT 1', c.slug)];
    if (!rows.length) return;
    const inc = rows[0];
    this.sql().exec('UPDATE incidents SET ended=?, last_err=last_err WHERE id=?', now, inc.id);
    if (why === 'recovered') this.notify('recover', c, { id: inc.id, started: inc.started, ended: now }, now);
  }

  // ── 心跳打点（POST /push/<token>）───────────────────────────

  async pushPing(token) {
    this.syncChecks();
    this.ensureAlarm();
    const rows = [...this.sql().exec('SELECT * FROM checks WHERE push_token=? AND type=?', token, 'push')];
    if (!rows.length) return { ok: false, status: 404, msg: 'unknown token' };
    const c = rows[0];
    const now = Date.now();
    const st = this.stateOf(c.slug);
    this.sql().exec('UPDATE state SET ping_last=? WHERE slug=?', now, c.slug);

    // 打点本身定性：down → 直接按一次成功探测走恢复路径
    if (c.enabled && (st.status === 'down' || st.incident_open)) {
      this.record(c, { ok: true, ms: 0, code: 200, err: '' }, now);
      return { ok: true, status: 200, msg: 'heartbeat accepted · recovered' };
    }
    return { ok: true, status: 200, msg: 'heartbeat accepted' };
  }

  // ── 维护：保留期清理 ─────────────────────────────────────────

  maintain(now) {
    // 每小时（分钟对齐 7 分）做一次清理，省写入
    if (new Date(now).getUTCMinutes() % 15 !== 7) return;
    this.sql().exec('DELETE FROM samples WHERE ts < ?', now - RETAIN_SAMPLES_MS);
    this.sql().exec('DELETE FROM buckets WHERE hour < ?', hourKey(now) - RETAIN_BUCKETS_MS);
    this.sql().exec('DELETE FROM incidents WHERE started < ? AND ended > 0', now - RETAIN_INCIDENT_MS);
  }

  // ── 快照（页面 / API / 徽章共用）────────────────────────────

  async getSnapshot() {
    this.ensureAlarm(); // 页面访问也会养活 alarm 链（fire-and-forget）
    if (this._snapshot && Date.now() - this._snapshot.ts < SNAPSHOT_TTL_MS) return this._snapshot.data;
    this.syncChecks();
    const now = Date.now();
    const checks = [...this.sql().exec('SELECT * FROM checks ORDER BY ord')];
    const out = [];
    for (const c of checks) {
      const st = this.stateOf(c.slug);
      const samples24 = [...this.sql().exec(
        'SELECT ts, ok, ms FROM samples WHERE slug=? AND ts > ? ORDER BY ts', c.slug, now - 86400000)];
      const buckets90 = [...this.sql().exec(
        'SELECT hour, total, ups, ms_sum, ms_n, ms_max FROM buckets WHERE slug=? AND hour > ?',
        c.slug, now - 90 * 86400000)];
      const openInc = [...this.sql().exec(
        'SELECT id, started, cause FROM incidents WHERE slug=? AND ended=0 ORDER BY started DESC LIMIT 1', c.slug)];
      const s = summarize(samples24);
      const buckets24 = buckets90.filter((b) => b.hour > now - 86400000);
      const uptime24 = uptime(buckets24)
        ?? (samples24.length > 0 ? samples24.filter((x) => x.ok).length / samples24.length : null);
      out.push({
        slug: c.slug, name: c.name, grp: c.grp, note: c.note, type: c.type,
        platform: c.platform || '', target: c.type === 'self' ? 'this /health' : c.target,
        interval_s: c.interval_s, enabled: !!c.enabled,
        status: c.enabled ? st.status : STATUS.PAUSED,
        since: st.since || 0, lastRun: st.last_run || 0,
        lastMs: st.last_ok ? st.last_ms : null, lastCode: st.last_code || null,
        lastErr: st.last_err || '',
        uptime24,
        uptime90: uptime(buckets90),
        lat: { p50: s.p50, p95: s.p95, avg: s.avg, n: s.n },
        series24: series24(samples24),
        days90: dayStrip(buckets90, now),
        openIncident: openInc.length ? { id: openInc[0].id, started: openInc[0].started, cause: openInc[0].cause } : null,
        hasPushToken: c.type === 'push',
      });
    }
    const incidents = [...this.sql().exec(
      'SELECT i.id, i.slug, i.started, i.ended, i.cause, i.last_err, c.name FROM incidents i JOIN checks c ON c.slug=i.slug WHERE i.started > ? ORDER BY i.started DESC LIMIT 50',
      now - 30 * 86400000)].map((r) => ({
      id: r.id, slug: r.slug, name: r.name, started: r.started,
      ended: r.ended || null, cause: r.cause, lastErr: r.last_err,
    }));
    const data = { now, checks: out, incidents };
    this._snapshot = { ts: Date.now(), data };
    return data;
  }

  // ── 管理（token 鉴权在 Worker 层）────────────────────────────

  /** 手动驱动一轮拨测（admin「立即拨测」；也用于 cron 观察期的兜底）。 */
  async adminTick() {
    return this.tick();
  }

  async adminList() {
    this.syncChecks();
    const checks = [...this.sql().exec('SELECT slug,name,grp,type,target,interval_s,enabled,push_token,note FROM checks ORDER BY ord')];
    const states = [...this.sql().exec('SELECT slug,status,fails,last_run,last_err,ping_last FROM state')];
    const stMap = new Map(states.map((s) => [s.slug, s]));
    return { now: Date.now(), checks: checks.map((c) => ({ ...c, state: stMap.get(c.slug) || null })) };
  }

  async adminPause(slug, paused) {
    const c = this.getCheck(slug);
    if (!c) return { ok: false, msg: 'no such check' };
    const st = this.stateOf(slug);
    if (paused) {
      this.sql().exec('UPDATE checks SET enabled=0, updated_at=? WHERE slug=?', Date.now(), slug);
      this.applyPause(slug, st);
    } else {
      this.sql().exec('UPDATE checks SET enabled=1, updated_at=? WHERE slug=?', Date.now(), slug);
      this.applyResume(slug);
    }
    this._snapshot = null;
    return { ok: true };
  }

  applyPause(slug, st) {
    const d = pauseDecision({ incidentOpen: !!st.incident_open });
    this.sql().exec('UPDATE state SET status=?, fails=?, incident_open=? WHERE slug=?',
      d.status, d.fails, d.closeIncident ? 0 : st.incident_open, slug);
    if (d.closeIncident) this.closeIncident(this.getCheck(slug), Date.now(), 'paused');
  }

  applyResume(slug) {
    const d = resumeDecision();
    this.sql().exec('UPDATE state SET status=?, fails=? WHERE slug=?', d.status, d.fails, slug);
  }

  /** 立即试跑一次（不落库），返回结果——admin 页「测试」按钮。 */
  async adminTest(slug) {
    const c = this.getCheck(slug);
    if (!c) return { ok: false, msg: 'no such check' };
    const r = c.type === 'tcp' ? await probeTcp(c) : await probeHttp(c, this.env);
    return { ok: !!r.ok, ms: r.ms, code: r.code, err: r.err };
  }

  /** dev 模拟下一次探测结果（PULSE_DEV=1 才暴露）。 */
  async adminSimulate(slug, result) {
    this._force = this._force || new Map();
    if (result === 'clear') this._force.delete(slug);
    else this._force.set(slug, result === 'fail' ? 'fail' : 'ok');
    return { ok: true, pending: [...this._force.entries()] };
  }

  /** dev 把心跳打点时刻回拨 N 分钟（制造 staleness，PULSE_DEV=1 才暴露）。 */
  async adminBackdate(slug, minutes) {
    const ts = Date.now() - minutes * 60000;
    this.sql().exec('UPDATE state SET ping_last=? WHERE slug=?', ts, slug);
    return { ok: true, ping_last: ts };
  }

  /** dev 重置：清库重同步。 */
  async adminReset() {
    this.ensureSchema();
    for (const t of ['samples', 'buckets', 'incidents', 'state', 'checks', 'meta']) {
      this.sql().exec(`DELETE FROM ${t}`);
    }
    this._snapshot = null;
    this.syncChecks();
    return { ok: true };
  }

  // ── 通知 ─────────────────────────────────────────────────────

  async notify(kind, check, incident, now) {
    const env = this.env;
    const channels = [];
    if (env.NOTIFY_WEBHOOK_URL) channels.push(sendWebhook(env.NOTIFY_WEBHOOK_URL));
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) channels.push(sendTelegram(env));
    if (!channels.length) return;
    const { text, payload } = buildMessage({ kind, check: pubCheck(check), incident, now, statusUrl: env.PUBLIC_URL || '' });
    await Promise.allSettled([
      ...channels.map((ch) => ch({ text, payload })),
    ]);
  }
}

// ── 探测实现 ──────────────────────────────────────────────────

function normalizeCheck(c) {
  return {
    slug: c.slug, name: c.name, grp: c.grp, type: c.type, target: c.target || '',
    platform: c.platform || '',
    method: c.method || 'GET', accept: c.accept || [200], keyword: c.keyword || '',
    interval_s: c.interval_s || 60, timeout_s: c.timeout_s ?? 10,
    follow_redirects: c.follow_redirects === 0 ? 0 : 1, enabled: c.enabled === 0 ? 0 : 1,
    note: c.note || '',
  };
}

function pubCheck(c) {
  return { slug: c.slug, name: c.name, type: c.type, target: c.target };
}

function genToken(seed) {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return seed + '-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const UA = 'pulse/0.1 (uptime check; +https://pulse.namooca.com)';

async function probeHttp(c, env) {
  let target = c.target;
  if (c.type === 'self') {
    const base = env?.PUBLIC_URL || 'https://pulse.namooca.com';
    target = base.replace(/\/$/, '') + '/health';
  }
  const accept = JSON.parse(c.accept || '[200]');
  const timeoutMs = Math.max(1, c.timeout_s || 10) * 1000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(target, {
      method: c.method || 'GET',
      redirect: c.follow_redirects ? 'follow' : 'manual',
      signal: ctl.signal,
      headers: { 'user-agent': UA, 'cache-control': 'no-cache' },
    });
    const ms = Date.now() - started;
    if (!accept.includes(res.status)) return { ok: false, ms, code: res.status, err: `HTTP ${res.status}` };
    if (c.keyword) {
      const body = await res.text();
      if (!body.includes(c.keyword)) return { ok: false, ms, code: res.status, err: 'keyword 未命中' };
    }
    return { ok: true, ms, code: res.status, err: '' };
  } catch (e) {
    const msg = e === 'timeout' || e?.name === 'AbortError' ? `timeout >${c.timeout_s}s`
      : (e?.message || String(e)).slice(0, 140);
    return { ok: false, ms: Date.now() - started, code: 0, err: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function probeTcp(c) {
  const m = /^(?:tcp:\/\/)?([a-z0-9.\-]+):(\d{1,5})$/i.exec(c.target || '');
  if (!m) return { ok: false, ms: 0, code: 0, err: 'target 应为 host:port' };
  const timeoutMs = Math.max(1, c.timeout_s || 10) * 1000;
  const started = Date.now();
  let sock;
  try {
    // workers connect() 签名：connect("host:port", options)
    sock = connect(`${m[1]}:${m[2]}`, { secureTransport: 'starttls' });
    const opened = await Promise.race([
      sock.opened.then(() => true),
      new Promise((_, rej) => setTimeout(() => rej('timeout'), timeoutMs)),
    ]);
    if (!opened) throw new Error('not opened');
    return { ok: true, ms: Date.now() - started, code: 0, err: '' };
  } catch (e) {
    const msg = e === 'timeout' ? `timeout >${c.timeout_s}s` : (e?.message || String(e)).slice(0, 140);
    return { ok: false, ms: Date.now() - started, code: 0, err: msg };
  } finally {
    try { sock?.close(); } catch { /* ignore */ }
  }
}

async function sendWebhook(url) {
  return async ({ payload }) => {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify(payload),
    });
  };
}

async function sendTelegram(env) {
  return async ({ text }) => {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
  };
}
