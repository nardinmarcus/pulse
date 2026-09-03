// SSR 状态页 —— 唯一渲染函数（AGENTS.md：客户端零模板，仅做 body 替换与走秒）。
// 视觉规范见 DESIGN.md：纸墨体系、发丝线分区、心电线是唯一图形修辞。
import { ecgPath, sparkline } from './lib/svg.js';
import { esc } from './lib/html.js';
import { fmtUptime, fmtMs, fmtDuration, fmtTime } from './lib/rollup.js';

const TZ_MIN = 480;

function clock(ts) {
  const d = new Date(ts + TZ_MIN * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const GROUP_EN = {
  Content: 'CONTENT', Design: 'DESIGN', Nav: 'NAV', Network: 'NETWORK',
  Automation: 'AUTOMATION', API: 'API', Infra: 'INFRA', Platform: 'PLATFORM',
};

const PLATFORM_TAG = { cloudflare: 'CF', vercel: 'VERCEL', vps: 'VPS', other: '' };

const stripClass = (d) =>
  d.ratio == null ? 'n' : d.ratio >= 0.999 ? 'u' : d.ratio >= 0.95 ? 'w' : 'd';

function row(c, now) {
  const status = c.status;
  const title = status === 'down' && c.lastErr
    ? `最近错误：${c.lastErr}`
    : status === 'up' && c.since
      ? `自 ${fmtTime(c.since, TZ_MIN)} 起正常`
      : '';
  const bars = c.days90.map((d) => {
    const t = d.ratio == null
      ? `${d.label} · 无数据`
      : `${d.label} · ${fmtUptime(d.ratio)}${d.avg ? ` · ${fmtMs(d.avg)}` : ''}`;
    return `<i class="${stripClass(d)}" title="${esc(t)}"></i>`;
  }).join('');

  const spark = c.type === 'push'
    ? `<span class="chip">心跳</span>`
    : `<svg viewBox="0 0 132 30" width="132" height="30" aria-hidden="true">${sparkline(c.series24, now)}</svg>`;

  const host = c.type === 'push' ? '定期打点' : esc(c.target.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  const plat = PLATFORM_TAG[c.platform] || '';

  return `<div class="row ${esc(status)}" title="${esc(title)}">
  <div class="who">
    <span class="dot"></span>
    <span class="id"><b>${esc(c.name)}</b><small>${esc(c.note)}</small></span>
  </div>
  <span class="host">${host}${plat ? ` <i class="plat">${plat}</i>` : ''}</span>
  <span class="metric m90"><label>90日</label><b>${fmtUptime(c.uptime90)}</b></span>
  <span class="metric mlat"><label>延迟</label><b>${c.lastMs != null ? fmtMs(c.lastMs) : '—'}</b></span>
  <span class="spark">${spark}</span>
  <span class="strip" role="img" aria-label="90 天每日在线条带">${bars}</span>
</div>`;
}

function incidentsSection(incidents) {
  const items = (incidents || []).map((i) => {
    const dur = i.ended ? fmtDuration(i.ended - i.started) : '进行中';
    const range = i.ended
      ? `${fmtTime(i.started, TZ_MIN)} – ${fmtTime(i.ended, TZ_MIN)}`
      : `${fmtTime(i.started, TZ_MIN)} –`;
    return `<li>
  <span class="dot down"></span>
  <div class="inc">
    <div class="l1"><b>${esc(i.name)}</b><span class="cause">${esc(i.cause || i.lastErr || '')}</span></div>
    <span class="range">${range} · ${dur}</span>
  </div>
</li>`;
  }).join('');
  const body = items
    ? `<ol class="inc-list">${items}</ol>`
    : `<p class="empty">近 30 日无事件 · no incidents in the last 30 days</p>`;
  return `<section class="sect"><h2>近 30 日事件 <span class="en">INCIDENTS · 30D</span></h2>${body}</section>`;
}

export function renderPage(snap) {
  const now = snap.now;
  const down = snap.checks.filter((c) => c.status === 'down');
  const allNew = snap.checks.length > 0
    && snap.checks.every((c) => c.status === 'new' || c.status === 'paused');

  const banner = down.length > 0
    ? { cls: 'bad', zh: `${down.length} 项服务异常`, en: 'INCIDENT IN PROGRESS' }
    : allNew
      ? { cls: 'new', zh: '等待首次探测', en: 'AWAITING FIRST PROBE' }
      : { cls: 'ok', zh: '全部系统运转正常', en: 'ALL SYSTEMS OPERATIONAL' };

  const ecgD = ecgPath({ w: 720, h: 56, flat: banner.cls === 'bad' });

  const groups = [];
  for (const c of snap.checks) {
    let g = groups.find((x) => x.name === c.grp);
    if (!g) { g = { name: c.grp, rows: [] }; groups.push(g); }
    g.rows.push(row(c, now));
  }
  const groupsHtml = groups.map((g) => `<section class="sect"><h2>${esc(g.name)} <span class="en">${GROUP_EN[g.name] || ''}</span></h2>${g.rows.join('')}</section>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f3ec">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#161514">
<meta name="description" content="Namoo 舰队状态页 · edge-native uptime for the namooca fleet">
<title>脉搏 · Pulse — Namoo Fleet Status</title>
<style>
:root{
  --paper:#f6f3ec; --ink:#23201b; --muted:rgba(35,32,27,.55);
  --hair:rgba(35,32,27,.16); --hair-soft:rgba(35,32,27,.09);
  --ok:#337a5b; --down:#b0402f; --warn:#b07d2e; --pause:#8a8578;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Noto Sans SC","Segoe UI",sans-serif;
  --serif:"Songti SC","STSong","Noto Serif SC",ui-serif,Georgia,serif;
}
@media (prefers-color-scheme: dark){ :root{
  --paper:#161514; --ink:#e6e1d7; --muted:rgba(230,225,215,.6);
  --hair:rgba(230,225,215,.15); --hair-soft:rgba(230,225,215,.08);
  --ok:#4ba583; --down:#d26a58; --warn:#c99a4b; --pause:#928d81;
}}
*{box-sizing:border-box}
html{background:var(--paper)}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font:15px/1.55 var(--sans);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.wrap{max-width:1080px; margin:0 auto; padding:0 24px}
a{color:var(--ok); text-decoration:none}

/* ── masthead ── */
.mast{display:flex; align-items:baseline; justify-content:space-between; padding:34px 0 10px}
.wordmark{display:flex; align-items:baseline; gap:14px}
.wordmark .zh{font-family:var(--serif); font-size:34px; font-weight:700; letter-spacing:.06em}
.wordmark .en{font-family:var(--mono); font-size:10.5px; letter-spacing:.22em; color:var(--muted)}
.updated{font-family:var(--mono); font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums}
.updated.stale{color:var(--warn)}

/* ── ecg ── */
.ecg{margin:2px 0 0}
.ecg svg{display:block; width:100%; height:56px}
.ecg path{fill:none; stroke:var(--ok); stroke-width:1.5; vector-effect:non-scaling-stroke}
.ecg path.flat{stroke:var(--down); animation:breathe 3s ease-in-out infinite}
/* 画出动画由客户端脚本按真实路径长度设置 dasharray/offset（Chrome 对 pathLength×CSS dasharray 不兼容） */
@keyframes breathe{0%,100%{opacity:1} 50%{opacity:.55}}

/* ── banner ── */
.banner{display:flex; align-items:baseline; gap:12px;
  border-top:1px solid var(--hair); border-bottom:1px solid var(--hair);
  padding:13px 2px; margin-top:6px; font-size:15px; font-weight:600}
.banner .en{font-family:var(--mono); font-size:10px; font-weight:400; letter-spacing:.2em; color:var(--muted)}
.banner.ok{color:var(--ok)}
.banner.bad{color:var(--down); background:color-mix(in srgb, var(--down) 7%, transparent);
  border-color:color-mix(in srgb, var(--down) 35%, var(--hair))}
.banner.new{color:var(--muted)}

/* ── sections ── */
.sect{margin-top:30px}
.sect h2{font-size:12px; font-weight:600; letter-spacing:.1em; color:var(--muted);
  border-bottom:1px solid var(--hair); padding-bottom:8px; margin:0 0 2px}
.sect h2 .en{font-family:var(--mono); font-size:9.5px; font-weight:400; letter-spacing:.22em; margin-left:10px; opacity:.75}

/* ── check row ── */
.row{display:grid; align-items:center; column-gap:18px;
  grid-template-columns:minmax(140px,1fr) minmax(0,200px) 64px 64px 132px 273px;
  grid-template-areas:"who host m90 mlat spark strip";
  padding:11px 2px; border-bottom:1px solid var(--hair-soft)}
.row:hover{background:var(--hair-soft)}
.row.paused{opacity:.45}
.who{grid-area:who; display:flex; align-items:center; gap:11px; min-width:0}
.who .id{display:flex; flex-direction:column; min-width:0}
.who b{font-size:15px; font-weight:600; line-height:1.3}
.who small{font-size:11.5px; color:var(--muted); line-height:1.35;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.dot{width:8px; height:8px; border-radius:50%; flex:none; background:var(--pause)}
.row.up .dot{background:var(--ok)}
.row.down .dot{background:var(--down); animation:pulse 1.6s ease-out infinite}
.row.new .dot{background:transparent; border:1.5px solid var(--pause)}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--down) 45%, transparent)}
  100%{box-shadow:0 0 0 9px transparent}}
.host{grid-area:host; font-family:var(--mono); font-size:11.5px; color:var(--muted);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.host .plat{font-style:normal; font-size:8.5px; letter-spacing:.14em; color:var(--muted);
  border:1px solid var(--hair); border-radius:2px; padding:0 3px; margin-left:6px; opacity:.8}
.metric{display:flex; flex-direction:column; align-items:flex-end; gap:1px}
.metric label{font-family:var(--mono); font-size:9.5px; letter-spacing:.14em; color:var(--muted)}
.metric b{font-family:var(--mono); font-size:13.5px; font-weight:500; font-variant-numeric:tabular-nums}
.metric.m90{grid-area:m90}.metric.mlat{grid-area:mlat}
.spark{grid-area:spark; display:flex; justify-content:flex-end}
.spark svg{display:block}
.chip{font-family:var(--mono); font-size:10px; letter-spacing:.12em; color:var(--muted);
  border:1px solid var(--hair); border-radius:2px; padding:1px 6px}
.strip{grid-area:strip; display:flex; gap:1px; height:8px}
.strip i{flex:1; min-width:0; background:var(--ok); border-radius:.5px}
.strip i.w{background:var(--warn)} .strip i.d{background:var(--down)}
.strip i.n{background:var(--hair)}

/* ── incidents ── */
.inc-list{list-style:none; margin:0; padding:0}
.inc-list li{display:flex; gap:13px; align-items:flex-start; padding:11px 2px; border-bottom:1px solid var(--hair-soft)}
.inc-list .dot{margin-top:7px}
.inc .l1{display:flex; gap:10px; align-items:baseline; flex-wrap:wrap}
.inc b{font-size:14px}
.inc .cause{font-family:var(--mono); font-size:12px; color:var(--down)}
.inc .range{font-family:var(--mono); font-size:11.5px; color:var(--muted); font-variant-numeric:tabular-nums}
.empty{font-size:13px; color:var(--muted); padding:14px 2px; border-bottom:1px solid var(--hair-soft)}

/* ── footer ── */
footer{border-top:1px solid var(--hair); margin-top:38px; padding:16px 0 44px;
  display:flex; justify-content:space-between; gap:12px;
  font-size:12px; color:var(--muted)}
footer .dotlink{color:var(--muted); font-weight:700}

/* ── responsive ── */
@media (max-width:1120px){
  .row{grid-template-columns:minmax(140px,1fr) 64px 64px 132px 200px;
    grid-template-areas:"who m90 mlat spark strip"}
  .host{display:none}
  .strip{height:7px}
}
@media (max-width:760px){
  .wrap{padding:0 16px}
  .mast{padding-top:26px}
  .wordmark .zh{font-size:28px}
  .wordmark .en{display:none}
  .updated{font-size:10px}
  .row{grid-template-columns:1fr auto auto;
    grid-template-areas:"who m90 mlat" "strip strip strip";
    row-gap:8px; padding:12px 2px}
  .spark{display:none}
  .strip{height:6px}
  .banner{font-size:14px}
}
@media (prefers-reduced-motion: reduce){
  .ecg path,.row.down .dot{animation:none}
}
</style>
<script>
(function(){
  var t0 = Date.now(), ts = ${now};
  function tick(){
    var el = document.querySelector('.updated');
    if(!el) return;
    var s = Math.max(0, Math.round((Date.now()-t0)/1000));
    el.querySelector('.ago').textContent = s < 8 ? '刚刚' : (s < 90 ? s + ' 秒前' : Math.round(s/60) + ' 分钟前');
    el.classList.toggle('stale', s > 95);
  }
  function drawEcg(){
    var p = document.querySelector('.ecg path');
    if(!p || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var L = p.getTotalLength();
    p.style.transition = 'none';
    p.style.strokeDasharray = L + ' ' + L;
    p.style.strokeDashoffset = L;
    p.getBoundingClientRect(); // 强制 reflow 后再过渡
    p.style.transition = 'stroke-dashoffset 1.4s ease-out';
    p.style.strokeDashoffset = '0';
  }
  drawEcg();
  setInterval(tick, 1000);
  setInterval(async function(){
    try{
      var res = await fetch(location.href, {cache:'no-store'});
      if(!res.ok) return;
      var doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      if(doc.body){ document.body.replaceWith(doc.body); drawEcg(); }
    }catch(e){/* 离线保旧图 */}
  }, 30000);
})();
</script>
</head>
<body>
<div class="wrap">
  <header class="mast">
    <div class="wordmark"><span class="zh">脉搏</span><span class="en">PULSE · FLEET STATUS</span></div>
    <div class="updated" data-ts="${now}">${clock(now)} · <span class="ago">刚刚</span></div>
  </header>
  <div class="ecg" aria-hidden="true">
    <svg viewBox="0 0 720 56" preserveAspectRatio="none"><path class="${banner.cls === 'bad' ? 'flat' : ''}" d="${ecgD}"/></svg>
  </div>
  <div class="banner ${banner.cls}"><span>${esc(banner.zh)}</span><span class="en">${banner.en}</span></div>
  <main>
    ${groupsHtml}
    ${incidentsSection(snap.incidents)}
  </main>
  <footer>
    <span>每分钟自 Cloudflare 边缘探测 · 每 30 秒自动刷新 · UTC+8</span>
    <span><a class="dotlink" href="/admin" title="admin">·</a> © 2026 Namoo</span>
  </footer>
</div>
</body>
</html>`;
}
