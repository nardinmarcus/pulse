// 检查配置 —— 唯一配置面（checks-as-code）。
// 改这里 = 改监控，重新 `npm run deploy` 生效；DO 会按 slug 增量同步。
//
// type:
//   http  轮询 URL。method 默认 GET；accept 为可接受状态码；keyword 存在时校验响应体包含
//   tcp   connect(host, port) 握手即断，测的是端口可达
//   push  反向心跳：目标主动 POST /push/<token>，超 interval×2 未打点视为失败
//   self  拨测 Pulse 自己的 /health（部署域变更不用改配置）
//
// 字段: slug* name* grp* type* target* interval(秒) timeout(秒,默认10)
//       method accept[] keyword follow_redirects(默认1) note enabled(默认1)

export const CHECKS = [
  // ── Content ────────────────────────────────────────────────
  {
    slug: 'blogman', name: 'Blogman', grp: 'Content',
    type: 'http', target: 'https://blog.namooca.com',
    method: 'HEAD', interval: 60,
    note: '博客 · Cloudflare Workers',
  },
  {
    slug: 'quickshare', name: 'QuickShare', grp: 'Content',
    type: 'http', target: 'https://quickshare.namooca.com',
    method: 'HEAD', interval: 60,
    note: '文件分享',
  },
  {
    slug: 'newsnow', name: 'NewsNow', grp: 'Content',
    type: 'http', target: 'https://newsnow.namooca.com',
    method: 'HEAD', interval: 60,
    note: '聚合热榜',
  },
  {
    slug: 'imagebed', name: 'ImageBed', grp: 'Content',
    type: 'http', target: 'https://image.namooca.com',
    method: 'HEAD', interval: 60,
    note: '图床',
  },
  {
    slug: 'layout-atlas', name: 'Layout Atlas', grp: 'Content',
    type: 'http', target: 'https://layout.namooca.com',
    method: 'HEAD', interval: 60,
    note: '版式图鉴 · 静态站',
  },
  {
    slug: 'hub', name: 'Namoo Hub', grp: 'Content',
    type: 'http', target: 'https://hub.namooca.com',
    method: 'HEAD', interval: 60,
    note: '工具入口',
  },

  // ── Network ────────────────────────────────────────────────
  {
    slug: 'vps-tcp', name: 'VPS 端口', grp: 'Network',
    type: 'tcp', target: 'rn.namooca.com:443',
    interval: 60, timeout: 8,
    note: 'rn · TCP 443 握手',
  },
  {
    slug: 'panel', name: '1Panel', grp: 'Network',
    type: 'http', target: 'https://rn.namooca.com',
    method: 'HEAD', interval: 120,
    note: 'VPS 面板',
  },

  // ── Automation ─────────────────────────────────────────────
  {
    slug: 'n8n-hf', name: 'n8n (HF)', grp: 'Automation',
    type: 'http', target: 'https://nardinmarcus-n8n-free.hf.space',
    method: 'GET', interval: 300, timeout: 15,
    note: 'Hugging Face 托管 · 冷启动较慢',
  },
  {
    slug: 'n8n-claw', name: 'n8n (ClawCloud)', grp: 'Automation',
    type: 'http', target: 'https://n8n-mfbiygza.ap-southeast-1.clawcloudrun.com',
    method: 'GET', interval: 300, timeout: 20,
    // 2026-09-04 建站当晚探测超时（免费档休眠？），先停用；恢复后把 enabled 改 1
    enabled: 0,
    note: 'ClawCloud 托管 · 休眠待验证，暂停用',
  },
  {
    slug: 'cron-heartbeat', name: 'Cron 心跳', grp: 'Automation',
    type: 'push', interval: 1800, timeout: 0,
    note: '示例心跳：n8n 定时任务每 30min POST /push/<token> 即视为存活。token 见 /admin',
  },

  // ── API ────────────────────────────────────────────────────
  {
    slug: 'jmapi', name: 'JMAPI', grp: 'API',
    type: 'http', target: 'https://jmapi.namooca.com',
    method: 'GET', accept: [200, 401], interval: 60,
    note: 'API 网关 · 401 即存活',
  },
  {
    slug: 'newapi', name: 'NewAPI', grp: 'API',
    type: 'http', target: 'https://newapi.namooca.com',
    method: 'GET', interval: 120, timeout: 15,
    // 2026-09-04 建站当晚连接失败，先停用；修好后把 enabled 改 1
    enabled: 0,
    note: 'API 网关 · 建站当晚不通，暂停用',
  },

  // ── Platform ───────────────────────────────────────────────
  {
    slug: 'pulse-self', name: 'Pulse 自身', grp: 'Platform',
    type: 'self',
    method: 'GET', interval: 60,
    note: '拨测器自监控 /health',
  },
];
