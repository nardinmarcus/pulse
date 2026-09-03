// 状态机与判定 —— 纯函数，node --test 直接测。
// 词汇见 CONTEXT.md：状态四值 up/down/paused/new；确认故障=连续第2次失败。

export const STATUS = { NEW: 'new', UP: 'up', DOWN: 'down', PAUSED: 'paused' };

/** 检查是否到期。首次必跑；500ms 容差防 cron 抖动导致漏跑。 */
export function isDue(check, st, now) {
  if (!check.enabled) return false;
  if (check.enabled === 0) return false;
  if (!st || !st.last_run) return true;
  return now - st.last_run >= check.interval_s * 1000 - 500;
}

/**
 * 一次探测结果推进状态机。
 * @param prev {status, fails, incidentOpen}
 * @param result {ok:boolean}
 * @returns {status, fails, openIncident, closeIncident}
 * 规则：成功→up 并关未决事件；失败即 down（页面诚实优先）；
 *      连续第 confirm 次（默认2）失败才开事件、发通知。
 */
export function transition(prev, result, { confirm = 2 } = {}) {
  const incidentOpen = !!prev.incidentOpen;
  if (result.ok) {
    return { status: 'up', fails: 0, openIncident: false, closeIncident: incidentOpen };
  }
  const fails = (prev.fails || 0) + 1;
  const openIncident = !incidentOpen && fails >= confirm;
  return { status: 'down', fails, openIncident, closeIncident: false };
}

/** 暂停检查。有未决事件则视为放弃：一并关闭（不计恢复时长语义，由 DO 落 cause='paused'）。 */
export function pauseDecision(prev) {
  return { status: 'paused', fails: 0, closeIncident: !!prev.incidentOpen };
}

/** 恢复检查：进入 new，等下一次探测定性。 */
export function resumeDecision() {
  return { status: 'new', fails: 0 };
}

/** 全站横幅：任一 down → incident；全部未定性（new/停用）→ new；否则 operational。 */
export function overall(states) {
  const list = states || [];
  if (list.some((s) => s.status === 'down')) return 'incident';
  if (list.length > 0 && list.every((s) => s.status === 'new' || s.status === 'paused')) return 'new';
  return 'operational';
}
