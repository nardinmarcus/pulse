// 冒烟测试：起 wrangler dev → 手动驱动 cron tick → 断言全套行为 → 收尾杀进程。
// 用法：npm run smoke（需先 npm install；本机出网即可）
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'dev-admin-token';
const H = { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' };

let passed = 0, failed = 0;
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name} ${extra}`); }
}

async function until(fn, { timeout = 30000, step = 500, label = '' } = {}) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting: ${label}`);
    await sleep(step);
  }
}

const tick = async () => {
  const res = await fetch(`${BASE}/__scheduled?cron=*+*+*+*+*`);
  if (!res.ok) throw new Error(`__scheduled ${res.status}`);
  return res.text();
};
const status = async () => (await fetch(`${BASE}/api/status`)).json();
const post = async (sub) => (await fetch(`${BASE}/admin/api/${sub}`, { method: 'POST', headers: H })).json();

async function main() {
  console.log('▸ 启动 wrangler dev…');
  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--test-scheduled'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.env.SMOKE_VERBOSE && process.stderr.write(d));
  let stopped = false;
  const stop = () => { if (!stopped) { stopped = true; try { proc.kill('SIGTERM'); } catch {} } };
  process.on('exit', stop);

  try {
    await until(() => fetch(`${BASE}/health`).then((r) => r.ok), { label: 'dev server ready' });
    console.log('▸ server ready\n');

    // 1. 干净起点
    ok((await post('reset')).ok, 'admin/reset 清库重同步');

    // 2. 首屏（全 new）
    let snap = await status();
    ok(snap.checks.length >= 12, `配置同步 checks=${snap.checks.length}`);
    ok(snap.checks.every((c) => c.status === 'new' || c.status === 'paused'), '首探前全部 new（停用项 paused）');
    let html = await (await fetch(`${BASE}/`)).text();
    ok(html.includes('脉搏') && html.includes('AWAITING FIRST PROBE'), '页面渲染等待首探 banner');

    // 3. 第一轮真实拨测
    const r1 = await tick();
    ok(/Ran scheduled/.test(r1), 'tick 触发成功');
    await sleep(300);
    snap = await status();
    const blog = snap.checks.find((c) => c.slug === 'blogman');
    ok(blog?.status === 'up', `blogman up（${blog?.lastMs}ms code=${blog?.lastCode}）`);
    ok(snap.checks.every((c) => c.status !== 'new' || c.type === 'push'), '非心跳检查全部已定性');
    ok(snap.checks.find((c) => c.slug === 'n8n-claw')?.status === 'paused', '停用项为 paused');
    ok(snap.checks.find((c) => c.slug === 'cron-heartbeat')?.status === 'new', '心跳未打点前保持 new');
    html = await (await fetch(`${BASE}/`)).text();
    ok(html.includes('ALL SYSTEMS OPERATIONAL'), '页面横幅正常态');

    // 4. 心跳检查：打点 → up；心跳回拨制造 staleness → down+事件；再打 → 恢复
    const toks = (await post('push-tokens')).tokens;
    const hb = toks.find((t) => t.slug === 'cron-heartbeat');
    ok(!!hb, '心跳 token 已生成');
    let ping = await fetch(`${BASE}/push/${hb.token}`, { method: 'POST' });
    ok(ping.ok, 'POST /push/<token> 200');
    await tick();
    let s2 = await status();
    ok(s2.checks.find((c) => c.slug === 'cron-heartbeat').status === 'up', '打点后 up');
    await post('check/cron-heartbeat/backdate/90'); // 心跳回拨 90 分钟（阈值 = 30min×2）
    await tick(); await tick(); // 第 1 次超时 fail → down，第 2 次 → 事件
    s2 = await status();
    ok(s2.checks.find((c) => c.slug === 'cron-heartbeat').status === 'down', '心跳超时 → down');
    ok(s2.incidents.some((i) => i.slug === 'cron-heartbeat' && !i.ended), '心跳超时事件已开');
    ok(s2.checks.some((c) => c.status === 'down'), '横幅应进入 incident');
    await fetch(`${BASE}/push/${hb.token}`, { method: 'POST' });
    await tick();
    s2 = await status();
    const hb2 = s2.checks.find((c) => c.slug === 'cron-heartbeat');
    ok(hb2.status === 'up', '再打点后恢复 up');
    const hbInc = s2.incidents.find((i) => i.slug === 'cron-heartbeat');
    ok(hbInc && hbInc.ended > 0, '事件已闭合');

    // 5. 模拟 blogman 故障：2 次失败确认 + 恢复
    await post('check/blogman/simulate/fail');
    await tick(); // fail#1 → down
    let s3 = await status();
    ok(s3.checks.find((c) => c.slug === 'blogman').status === 'down', '模拟失败 → down');
    ok(s3.incidents.filter((i) => i.slug === 'blogman' && !i.ended).length === 0, '第 1 次失败未开事件');
    await post('check/blogman/simulate/fail');
    await tick(); // fail#2 → 事件
    s3 = await status();
    ok(s3.incidents.some((i) => i.slug === 'blogman' && !i.ended), '第 2 次失败开事件');
    html = await (await fetch(`${BASE}/`)).text();
    ok(html.includes('INCIDENT IN PROGRESS') && html.includes('1 项服务异常'), '页面横幅故障态');
    ok(/class="row down"/.test(html), '行级 down 样式');

    // 恢复
    await post('check/blogman/simulate/ok');
    await tick();
    s3 = await status();
    const bInc = s3.incidents.find((i) => i.slug === 'blogman');
    ok(s3.checks.find((c) => c.slug === 'blogman').status === 'up', '模拟成功 → up');
    ok(bInc && bInc.ended > 0, '事件闭合（自动恢复）');

    // 6. 徽章
    const bSvg = await (await fetch(`${BASE}/badge/blogman.svg`)).text();
    ok(bSvg.includes('UP'), '状态徽章 UP');
    const uSvg = await (await fetch(`${BASE}/badge/blogman/uptime.svg`)).text();
    ok(uSvg.includes('uptime'), '在线率徽章');

    // 7. admin test（真实试跑）
    const t = await post('check/hub/test');
    ok(t.ok === true && t.ms > 0, `admin/test hub ok ${t.ms}ms`);

    console.log(`\n■ smoke 完成: ${passed} 通过, ${failed} 失败`);
  } catch (e) {
    failed++;
    console.error('\n■ smoke 异常:', e.message);
  } finally {
    stop();
    await sleep(400);
  }
  process.exit(failed ? 1 : 0);
}

main();
