// SVG 构造 —— 纯函数：心电线、24h 折线、徽章。词汇见 DESIGN.md §1（心电线是唯一图形修辞）。
import { esc } from './html.js';

/**
 * 心电轨迹 path。flat=false：含 P-QRS-T 的重复心拍；flat=true：拉平直线（故障态）。
 * pathLength=1 归一化，供 CSS 画出动画（dashoffset 1→0）。
 */
export function ecgPath({ w = 720, h = 56, flat = false } = {}) {
  const mid = Math.round(h * 0.6);
  if (flat) return `M0 ${mid} L${w} ${mid}`;
  const beat = 90;
  const pts = [];
  pts.push([0, mid]);
  for (let x = 0; x < w; x += beat) {
    const o = (dx, dy) => [x + dx, mid + dy];
    pts.push(o(18, 0));            // 平段
    pts.push(o(21, -3)); pts.push(o(24, 0));   // P 波
    pts.push(o(32, 0));
    pts.push(o(34, 4));            // Q
    pts.push(o(37, -mid + 6));     // R 尖峰（顶到 y=6）
    pts.push(o(40, 12));           // S
    pts.push(o(43, 0));            // 回基线
    pts.push(o(56, 0));
    pts.push(o(60, -3)); pts.push(o(64, -5)); pts.push(o(68, -2)); // T 波
    pts.push(o(72, 0));
  }
  pts.push([w, mid]);
  pts.sort((a, b) => a[0] - b[0]);
  return 'M' + pts.map(([x, y]) => `${x} ${y}`).join(' L');
}

/**
 * 24h 延迟折线（不画坐标轴）。
 * @param pts [{t, ms, ok}] 旧→新；ms=null 为失败点
 * @param windowMs 固定 24h 时间窗，让历史稀疏期如实留白
 * @returns <svg> 内部元素字符串；调用方自备 <svg> 外壳与 viewBox
 */
export function sparkline(pts, now, { w = 132, h = 30, windowMs = 86400000, okColor = 'var(--ok)', downColor = 'var(--down)' } = {}) {
  const t0 = now - windowMs;
  const msList = pts.filter((p) => p.ms != null).map((p) => p.ms);
  if (pts.length === 0 || msList.length === 0) return `<rect x="0" y="${h - 1}" width="2" height="1" fill="none"/>`;
  const max = Math.max(...msList);
  const X = (t) => ((t - t0) / windowMs) * w;
  const Y = (ms) => h - 3 - (ms / max) * (h - 6);

  let d = '';
  let pen = false;
  for (const p of pts) {
    if (p.ms == null) { pen = false; continue; }
    d += (pen ? ' L' : ' M') + X(p.t).toFixed(1) + ' ' + Y(p.ms).toFixed(1);
    pen = true;
  }
  const fails = pts.filter((p) => !p.ok).map((p) =>
    `<circle cx="${X(p.t).toFixed(1)}" cy="${h - 1.5}" r="1.6" fill="${downColor}"/>`).join('');
  return `<path d="${d}" fill="none" stroke="${okColor}" stroke-width="1.4" stroke-linejoin="round"/>${fails}`;
}

/** shields-flat 风格徽章。 */
export function badge({ label, value, color = '#337a5b' }) {
  const f = (s) => Math.round(6.2 * String(s).length + 12);
  const lw = f(label), vw = f(value), W = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">` +
    `<title>${esc(label)}: ${esc(value)}</title>` +
    `<clipPath id="r"><rect width="${W}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${lw}" height="20" fill="#4c4a45"/>` +
    `<rect x="${lw}" width="${vw}" height="20" fill="${color}"/>` +
    `</g>` +
    `<g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="10.5" text-anchor="middle">` +
    `<text x="${lw / 2}" y="14" textLength="${lw - 10}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>` +
    `<text x="${lw + vw / 2}" y="14" textLength="${vw - 10}" lengthAdjust="spacingAndGlyphs">${esc(value)}</text>` +
    `</g></svg>`;
}
