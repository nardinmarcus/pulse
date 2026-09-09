import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let mf;
before(async () => {
  const bundled = await build({
    stdin: { contents: String.raw`
      import { PulseCore } from './src/do.js';
      import app from './src/index.js';
      export class TestCore extends PulseCore {
        async run(which) {
          await this.adminReset();
          if (which === 'config') return [...this.sql().exec("SELECT slug,interval_s,timeout_s FROM checks WHERE slug IN ('rss','nav','vps-tcp') ORDER BY slug")];
          if (which === 'schedule') {
            const now = Date.now();
            this.sql().exec('UPDATE state SET last_run=?', now);
            for (const c of this.sql().exec('SELECT slug FROM checks')) await this.adminSimulate(c.slug, 'ok');
            return this.tick();
          }
          if (which === 'history') {
            const now = Date.now();
            const c = this.getCheck('rss');
            this.sql().exec("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1439) INSERT INTO samples(slug,ts,ok,ms) SELECT 'rss',?-x*60000,1,42 FROM n", now);
            this.sql().exec("INSERT INTO buckets(slug,hour,total,ups,ms_sum,ms_n,ms_max) VALUES('rss',?,1440,1440,60480,1440,42)", Math.floor(now/3600000)*3600000);
            const raw = this.sql();
            let historyReads = 0;
            const measured = { exec: (...args) => {
              const cursor = raw.exec(...args);
              const rows = cursor.toArray();
              if (/SELECT.*FROM (samples|buckets)/is.test(args[0])) historyReads += cursor.rowsRead;
              return { [Symbol.iterator]: () => rows[Symbol.iterator](), toArray: () => rows,
                rowsRead: cursor.rowsRead, rowsWritten: cursor.rowsWritten };
            }};
            this.sql = () => measured;
            const cold = await this.getHistory(c, now);
            const coldReads = historyReads;
            historyReads = 0;
            const hot = await this.getHistory(c, now + 1000);
            const hotReads = historyReads;
            // 新实例共享SQLite，模拟内存快照丢失，不能依赖运行时缓存。
            const restarted = new TestCore(this.ctx, this.env);
            restarted.sql = () => measured;
            historyReads = 0;
            const persisted = await restarted.getHistory(c, now + 1000);
            const restartReads = historyReads;
            await restarted.getSnapshot();
            for (const ck of raw.exec('SELECT slug FROM checks')) await restarted.adminSimulate(ck.slug, ck.slug === 'rss' ? 'fail' : 'ok');
            historyReads = 0;
            await restarted.tick();
            const afterTick = await restarted.getSnapshot();
            const tickHistoryReads = historyReads;
            historyReads = 0;
            const nextBeijingDay = (Math.floor((now + 8*3600000)/86400000) + 1)*86400000 - 8*3600000;
            const nextDay = await restarted.getHistory(c, nextBeijingDay);
            return { cold, hot, persisted, coldReads, hotReads, restartReads, tickHistoryReads,
              status: afterTick.checks.find(x => x.slug === 'rss').status,
              nextDay, nextDayReads: historyReads };
          }
          if (which === 'cleanup') {
            const now = Date.UTC(2026, 8, 7, 12, 7);
            const cutoff = now - 48*3600000;
            this.sql().exec('WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<2879) INSERT INTO samples(slug,ts,ok) SELECT \'fixture\',?+x*60000,1 FROM n', cutoff);
            this.sql().exec("INSERT INTO samples(slug,ts,ok) VALUES('expired',?,1)", cutoff-1);
            this.sql().exec('WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<8759) INSERT INTO buckets(slug,hour) SELECT \'fixture\',?+x*3600000 FROM n', now-365*86400000);
            const raw = this.sql();
            const reads = [];
            this.sql = () => ({ exec: (...args) => {
              const cursor = raw.exec(...args);
              cursor.toArray();
              reads.push({query:args[0], rows:cursor.rowsRead});
              return cursor;
            }});
            this.maintain(now);
            this.sql = () => raw;
            return { reads, remaining: [...raw.exec('SELECT count(*) AS n FROM samples')][0].n };
          }
        }
      }
      export default { async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (!path.startsWith('/test/')) return app.fetch(request, env);
        const which = path.slice('/test/'.length);
        const stub = env.CORE.get(env.CORE.idFromName(which));
        return Response.json(await stub.run(which));
      }};
    `, resolveDir: process.cwd(), sourcefile: 'storage-test-worker.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*'],
  });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-06-01', durableObjects: { CORE: { className: 'TestCore', useSQLite: true } },
    bindings: { PULSE_DEV: '1', TICK_DEDUP_MS: '0' },
  }));
});
after(async () => { await mf?.dispose(); });

async function run(name) {
  const response = await mf.dispatchFetch('http://localhost/test/' + name);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('storage: 配置 interval / timeout 映射到实际数据库字段', async () => {
  assert.deepEqual(await run('config'), [
    { slug: 'nav', interval_s: 3600, timeout_s: 10 },
    { slug: 'rss', interval_s: 3600, timeout_s: 10 },
    { slug: 'vps-tcp', interval_s: 3600, timeout_s: 8 },
  ]);
});

test('storage: tick 尊重数据库 last_run，不重复运行未到期检查', async () => {
  const result = await run('schedule');
  // 唯一 push 检查每轮判定；其余刚运行过，均未到期。
  assert.equal(result.ran, 1);
});

test('storage: 保留期清理只读取过期记录，不扫描48小时样本和全年小时桶', async (t) => {
  const result = await run('cleanup');
  t.diagnostic(JSON.stringify(result.reads));
  assert.equal(result.remaining, 2880);
  for (const { query, rows } of result.reads) {
    assert.ok(rows <= 5, `${query}: rowsRead=${rows}`);
  }
});


test('storage: 历史每天更新一次并跨实例复用，tick即时状态不重读历史', async (t) => {
  const result = await run('history');
  t.diagnostic(JSON.stringify({ cold: result.coldReads, hot: result.hotReads, restart: result.restartReads, tick: result.tickHistoryReads, nextDay: result.nextDayReads }));
  assert.ok(result.coldReads >= 1440);
  assert.equal(result.hotReads, 0);
  assert.equal(result.restartReads, 0);
  assert.deepEqual(result.hot, result.cold);
  assert.deepEqual(result.persisted, result.cold);
  assert.equal(result.status, 'down');
  assert.equal(result.tickHistoryReads, 0);
  assert.ok(result.nextDay.historyUpdatedAt > result.cold.historyUpdatedAt);
  assert.ok(result.nextDayReads > 0);
});


test('storage: production 页面/API/徽章使用每日历史统计且保持响应格式', async () => {
  for (const path of ['/health', '/', '/api/status', '/api/brief', '/badge/rss.svg', '/badge/rss/uptime.svg']) {
    const response = await mf.dispatchFetch('http://localhost' + path);
    assert.equal(response.status, 200, path);
    if (path === '/') assert.match(await response.text(), /History updated daily/);
    if (path === '/api/status') {
      const snapshot = await response.json();
      assert.equal(snapshot.checks.length, 29);
      assert.ok(snapshot.checks.every(c => c.historyUpdatedAt > 0 && c.days90.length === 90));
    }
    if (path === '/api/brief') assert.equal((await response.json()).checks.length, 29);
  }
});
