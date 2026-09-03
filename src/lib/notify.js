// 通知消息构造 —— 纯函数。发送在 DO（未配置通道则静默，见 CONTEXT.md「通知」）。
import { fmtDuration, fmtTime } from './rollup.js';

/**
 * @param kind 'open' | 'recover'
 * @returns {title, text, payload} title 用于 Telegram；text 人读；payload 为 webhook JSON
 */
export function buildMessage({ kind, check, incident, now, statusUrl }) {
  const dur = incident?.ended ? fmtDuration(incident.ended - incident.started) : null;
  const cause = incident?.last_err || incident?.cause || '';
  const when = fmtTime(incident?.started);
  const target = check?.target || '';
  const slug = check?.slug || '';
  const name = check?.name || slug;

  let title, verb;
  if (kind === 'open') {
    title = `🔴 ${name} 故障`;
    verb = '已确认故障';
  } else {
    title = `🟢 ${name} 恢复`;
    verb = '已恢复';
  }

  const lines = [
    `${title}`,
    `${verb}${dur ? ` · 持续 ${dur}` : ''}`,
    `开始于 ${when}${cause ? `\n原因: ${cause}` : ''}`,
    target ? `目标: ${target}` : '',
    statusUrl ? `状态页: ${statusUrl}` : '',
  ].filter(Boolean);

  return {
    title,
    text: lines.join('\n'),
    payload: {
      event: kind === 'open' ? 'incident.opened' : 'incident.recovered',
      source: 'pulse',
      check: { slug, name, type: check?.type, target },
      incident: {
        id: incident?.id ?? null,
        started_at: incident?.started ? new Date(incident.started).toISOString() : null,
        ended_at: incident?.ended ? new Date(incident.ended).toISOString() : (kind === 'recover' && now ? new Date(now).toISOString() : null),
        duration_ms: incident?.ended && incident?.started ? incident.ended - incident.started : null,
        cause,
      },
      status_url: statusUrl || null,
      ts: now ? new Date(now).toISOString() : null,
    },
  };
}
