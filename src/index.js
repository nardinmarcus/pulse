// Worker 入口：fetch 路由 + scheduled(cron)。数据一律经 RPC 进单例 PulseCore（CONTEXT.md）。
import { PulseCore } from './do.js';
import { renderPage } from './page.js';
import { badge } from './lib/svg.js';
import { esc } from './lib/html.js';
import { fmtUptime } from './lib/rollup.js';

export { PulseCore };

const STATUS_COLOR = { up: '#337a5b', down: '#b0402f', paused: '#8a8578', new: '#777777' };
const STATUS_LABEL = { up: 'UP', down: 'DOWN', paused: 'PAUSED', new: 'NEW' };

const core = (env) => env.CORE.get(env.CORE.idFromName('core'));

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    try {
      // ── 公开面 ──
      if (path === '/' && method === 'GET') {
        const snap = await core(env).getSnapshot();
        return new Response(renderPage(snap), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
      }

      if (path === '/health') {
        return json({ ok: true, ts: Date.now() });
      }

      if (path === '/api/status' && method === 'GET') {
        return json(await core(env).getSnapshot());
      }

      // ── 徽章 ──
      let m = /^\/badge\/([a-z0-9-]+)(?:\/(uptime))?\.svg$/i.exec(path);
      if (m && method === 'GET') {
        const snap = await core(env).getSnapshot();
        const c = snap.checks.find((x) => x.slug === m[1].toLowerCase());
        if (!c) return new Response('not found', { status: 404 });
        const svg = m[2]
          ? badge({ label: 'uptime (90d)', value: fmtUptime(c.uptime90), color: STATUS_COLOR[c.status] })
          : badge({ label: 'status', value: STATUS_LABEL[c.status] || '?', color: STATUS_COLOR[c.status] });
        return new Response(svg, {
          headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            'cache-control': 'public, max-age=300',
          },
        });
      }

      // ── 心跳打点 ──
      m = /^\/push\/([a-z0-9-]+)$/i.exec(path);
      if (m && (method === 'POST' || method === 'GET')) {
        const r = await core(env).pushPing(m[1].toLowerCase());
        return json({ ok: r.ok, msg: r.msg }, r.status);
      }

      // ── 管理 ──
      if (path === '/admin' && method === 'GET') {
        if (!env.ADMIN_TOKEN) return new Response(adminOffHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
        return new Response(adminHtml(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (path.startsWith('/admin/api/') && method === 'POST') {
        if (!env.ADMIN_TOKEN) return json({ ok: false, msg: 'admin disabled (set ADMIN_TOKEN)' }, 404);
        if (!authed(req, env.ADMIN_TOKEN)) return json({ ok: false, msg: 'unauthorized' }, 401);
        return handleAdmin(path, core(env), env);
      }

      return json({ ok: false, msg: 'not found' }, 404);
    } catch (e) {
      console.error('fetch error', path, e);
      return json({ ok: false, msg: 'internal error', detail: String(e?.message || e).slice(0, 200) }, 500);
    }
  },

  async scheduled(ctrl, env) {
    try {
      await core(env).tick();
    } catch (e) {
      console.error('tick failed', e);
    }
  },
};

// ── 管理路由（token 鉴权）────────────────────────────────────

async function handleAdmin(path, stub, env) {
  const sub = path.replace('/admin/api/', '');

  if (sub === 'list') return json(await stub.adminList());
  if (sub === 'tick') return json(await stub.adminTick());

  let m = /^check\/([a-z0-9-]+)\/(pause|resume|test)$/.exec(sub);
  if (m) {
    if (m[2] === 'pause') return json(await stub.adminPause(m[1], true));
    if (m[2] === 'resume') return json(await stub.adminPause(m[1], false));
    return json(await stub.adminTest(m[1]));
  }

  if (sub === 'push-tokens') {
    const list = await stub.adminList();
    return json({
      ok: true,
      tokens: list.checks.filter((c) => c.push_token).map((c) => ({ slug: c.slug, name: c.name, token: c.push_token })),
    });
  }

  // 仅本地（PULSE_DEV=1）暴露：模拟下一次探测结果 / 心跳回拨 / 重置
  if (env.PULSE_DEV === '1') {
    m = /^check\/([a-z0-9-]+)\/simulate\/(ok|fail|clear)$/.exec(sub);
    if (m) return json(await stub.adminSimulate(m[1], m[2]));
    m = /^check\/([a-z0-9-]+)\/backdate\/(\d+)$/.exec(sub);
    if (m) return json(await stub.adminBackdate(m[1], Number(m[2])));
    if (sub === 'reset') return json(await stub.adminReset());
  }

  return json({ ok: false, msg: 'unknown admin route' }, 404);
}

function authed(req, token) {
  const h = req.headers.get('authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url).searchParams.get('key') || '';
  return given === token;
}

// ── 管理页（utilitarian mono）────────────────────────────────

function adminOffHtml() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>脉搏 · admin</title>
<body style="font-family:ui-monospace,monospace;max-width:560px;margin:80px auto;padding:0 20px;color:#555">
<p>admin 未开启。设置环境变量 <code>ADMIN_TOKEN</code> 后可用：</p>
<pre>echo "你的token" | npx wrangler secret put ADMIN_TOKEN</pre>
</body>`;
}

function adminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>脉搏 · admin</title>
<style>
:root{--paper:#161514;--ink:#e6e1d7;--hair:rgba(230,225,215,.15);--muted:rgba(230,225,215,.6);
  --ok:#4ba583;--down:#d26a58;--mono:ui-monospace,Menlo,monospace}
@media (prefers-color-scheme: light){:root{--paper:#f6f3ec;--ink:#23201b;--hair:rgba(35,32,27,.16);
  --muted:rgba(35,32,27,.55);--ok:#337a5b;--down:#b0402f}}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font:13px/1.5 var(--mono);margin:0;padding:28px 20px 60px}
.wrap{max-width:860px;margin:0 auto}
h1{font-size:15px;letter-spacing:.1em}
table{border-collapse:collapse;width:100%;margin-top:14px}
td,th{border-bottom:1px solid var(--hair);padding:7px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:400;font-size:11px;letter-spacing:.08em}
.st{font-weight:700}.st.up{color:var(--ok)}.st.down{color:var(--down)}
button{font:12px var(--mono);background:none;color:var(--ink);border:1px solid var(--hair);
  border-radius:3px;padding:3px 9px;cursor:pointer;margin-right:4px}
button:hover{border-color:var(--muted)}
button:disabled{opacity:.4;cursor:default}
#token{font:13px var(--mono);background:none;color:var(--ink);border:1px solid var(--hair);border-radius:3px;padding:5px 8px;width:260px}
.note{color:var(--muted);font-size:11px;margin-top:18px}
pre{white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--muted)}
.tok{user-select:all}
</style>
</head>
<body><div class="wrap">
<h1>脉搏 · ADMIN</h1>
<div>
  <input id="token" type="password" placeholder="ADMIN_TOKEN">
  <button onclick="saveTok()">保存</button>
  <span id="authState"></span>
</div>
<div id="out">…</div>
<p class="note">探测立即试跑不改数据 · pause/resume 只改本地库（下次部署会被 src/checks.js 覆盖）· 心跳 token 用于 n8n 定时任务 POST /push/&lt;token&gt;</p>
</div>
<script>
const $ = (s) => document.querySelector(s);
const tok = () => localStorage.getItem('pulse-admin') || '';
async function api(sub, opts) {
  const res = await fetch('/admin/api/' + sub, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + tok(), 'content-type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { $('#authState').textContent = 'token 无效'; throw new Error('401'); }
  return res.json();
}
function saveTok() { localStorage.setItem('pulse-admin', $('#token').value.trim()); load(); }
async function load() {
  if (!tok()) { $('#authState').textContent = '先填 token'; return; }
  $('#authState').textContent = '';
  let data;
  try { data = await api('list'); } catch (e) { return; }
  const rows = data.checks.map((c) => {
    const st = c.state || {};
    return '<tr>' +
      '<td><span class="st ' + esc(st.status || 'new') + '">' + esc(st.status || 'new') + '</span></td>' +
      '<td><b>' + esc(c.name) + '</b><br><span style="color:var(--muted)">' + esc(c.slug) + ' · ' + esc(c.type) + (c.type === 'push' ? ' · ' + Math.round(c.interval_s / 60) + 'min' : '') + '</span></td>' +
      '<td>' + esc(c.target || '—') + '</td>' +
      '<td>' + (c.enabled ? '<button onclick="act(\\'' + c.slug + '\\',\\'pause\\')">pause</button>' : '<button onclick="act(\\'' + c.slug + '\\',\\'resume\\')">resume</button>') +
      '<button onclick="act(\\'' + c.slug + '\\',\\'test\\')">test</button></td>' +
      '<td style="color:var(--muted)">' + esc(st.last_err || '') + '</td>' +
      '</tr>';
  }).join('');
  $('#out').innerHTML = '<table><tr><th>状态</th><th>检查</th><th>目标</th><th>操作</th><th>最近错误</th></tr>' + rows + '</table>' +
    '<div id="pushbox"></div><div id="testout"></div>';
  const toks = await api('push-tokens');
  $('#pushbox').innerHTML = toks.tokens.length
    ? '<h1 style="margin-top:26px">心跳 TOKEN</h1><table>' + toks.tokens.map((t) =>
      '<tr><td>' + esc(t.name) + '</td><td class="tok">' + esc(t.token) + '</td>' +
      '<td><pre>curl -X POST https://' + location.host + '/push/' + esc(t.token) + '</pre></td></tr>').join('') + '</table>'
    : '';
}
async function act(slug, what) {
  const r = await api('check/' + slug + '/' + what);
  $('#testout').innerHTML = '<pre>' + esc(JSON.stringify(r)) + '</pre>';
  if (what !== 'test') load(); else if (r && r.slug !== undefined) load();
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
load();
</script>
</body></html>`;
}
