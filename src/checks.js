// 检查配置 —— 唯一配置面（checks-as-code）。
// 改这里 = 改监控，重新 `npm run deploy` 生效；DO 会按 slug 增量同步。
// 台账来源（2026-09-04 三渠道盘点）：Cloudflare（CT 日志 + Workers/Pages）、
// VPS 23.238.7.202（SSH docker/systemd/openresty）、Vercel（响应头 x-vercel-* 指纹）。
//
// type:
//   http  轮询 URL。method 默认 GET；accept 为可接受状态码；keyword 存在时校验响应体包含
//   tcp   connect(host, port) 握手即断，测的是端口可达
//   push  反向心跳：目标主动 POST /push/<token>，超 interval×2 未打点视为失败
//   self  拨测 Pulse 自己的 /health（部署域变更不用改配置）
//
// platform: cloudflare | vercel | vps —— 展示用，状态页与 hub 徽标标注部署平台
// 字段: slug* name* grp* type* target* platform interval(秒) timeout(秒,默认10)
//       method accept[] keyword follow_redirects(默认1) note enabled(默认1)

export const CHECKS = [
  // ── Content ────────────────────────────────────────────────
  {
    slug: 'blogman', name: 'Blogman', grp: 'Content', platform: 'cloudflare',
    type: 'http', target: 'https://blog.namooca.com',
    method: 'HEAD', interval: 60,
    note: '博客 · Cloudflare Workers',
  },
  {
    slug: 'quickshare', name: 'QuickShare', grp: 'Content', platform: 'vercel',
    type: 'http', target: 'https://quickshare.namooca.com',
    method: 'HEAD', interval: 60,
    note: '文件分享 · Vercel',
  },
  {
    slug: 'newsnow', name: 'NewsNow', grp: 'Content', platform: 'cloudflare',
    type: 'http', target: 'https://newsnow.namooca.com',
    method: 'HEAD', interval: 60,
    note: '聚合热榜 · Cloudflare',
  },
  {
    slug: 'imagebed', name: 'ImageBed', grp: 'Content', platform: 'cloudflare',
    type: 'http', target: 'https://image.namooca.com',
    method: 'HEAD', interval: 60,
    note: '图床 · Cloudflare Workers',
  },
  {
    slug: 'layout-atlas', name: 'Layout Atlas', grp: 'Content', platform: 'cloudflare',
    type: 'http', target: 'https://layout.namooca.com',
    method: 'HEAD', interval: 60,
    note: '版式图鉴 · CF Pages',
  },
  {
    slug: 'hub', name: 'Namoo Hub', grp: 'Content', platform: 'cloudflare',
    type: 'http', target: 'https://hub.namooca.com',
    method: 'HEAD', interval: 60,
    note: '工具入口 · Worker',
  },
  {
    slug: 'rss', name: 'Namoo Reader', grp: 'Content', platform: 'vps',
    type: 'http', target: 'https://rss.namooca.com',
    method: 'GET', interval: 120,
    note: 'RSS 阅读器 · VPS Docker',
  },

  // ── Design ─────────────────────────────────────────────────
  {
    slug: 'icon', name: 'Icon', grp: 'Design', platform: 'cloudflare',
    type: 'http', target: 'https://icon.namooca.com',
    method: 'HEAD', interval: 120,
    note: 'App 图标编译器 · CF',
  },
  {
    slug: 'taste', name: 'Design Studio', grp: 'Design', platform: 'cloudflare',
    type: 'http', target: 'https://taste.namooca.com',
    method: 'HEAD', interval: 120,
    note: '设计工作室页 · CF',
  },
  {
    slug: 'prompt-optimizer', name: '提示词优化器', grp: 'Design', platform: 'vercel',
    type: 'http', target: 'https://prompt-optimizer.nardinmarcus.top',
    method: 'HEAD', interval: 120,
    note: 'Prompt Optimizer · Vercel',
  },

  // ── Nav ────────────────────────────────────────────────────
  {
    slug: 'nav', name: 'Nav', grp: 'Nav', platform: 'cloudflare',
    type: 'http', target: 'https://nav.nardinmarcus.top',
    method: 'HEAD', interval: 300,
    note: '网址导航 · CF',
  },
  {
    slug: 'navi', name: 'Nav (Vercel)', grp: 'Nav', platform: 'vercel',
    type: 'http', target: 'https://navi.nardinmarcus.top',
    method: 'HEAD', interval: 300,
    note: '同款导航 · Vercel 双部署',
  },
  {
    slug: 'navigation', name: '导航模板', grp: 'Nav', platform: 'cloudflare',
    type: 'http', target: 'https://navigation.nardinmarcus.top',
    method: 'HEAD', interval: 300,
    note: '导航模板站 · CF',
  },

  // ── Network ────────────────────────────────────────────────
  {
    slug: 'vpn-node', name: 'VPN Node', grp: 'Network', platform: 'cloudflare',
    type: 'http', target: 'https://vpn.nardinmarcus.top',
    method: 'HEAD', accept: [200, 404], interval: 120,
    note: '代理 Worker · 根路径 404 即存活',
  },
  {
    slug: 'vpn-edgetunnel', name: 'EdgeTunnel', grp: 'Network', platform: 'cloudflare',
    type: 'http', target: 'https://vpn-edgetunnel.nardinmarcus.top',
    method: 'HEAD', interval: 120,
    note: '隧道 Worker',
  },
  {
    slug: 'vpn-ipv6', name: 'IPv6 Tunnel', grp: 'Network', platform: 'cloudflare',
    type: 'http', target: 'https://ipv6.nardinmarcus.top',
    method: 'HEAD', interval: 120,
    note: 'IPv6 隧道 Worker',
  },
  {
    slug: 'vps-tcp', name: 'VPS 端口', grp: 'Network', platform: 'vps',
    type: 'tcp', target: 'rn.namooca.com:443',
    interval: 60, timeout: 8,
    note: '23.238.7.202 · TCP 443 握手',
  },
  {
    slug: 'panel', name: '1Panel', grp: 'Network', platform: 'vps',
    type: 'http', target: 'https://rn.namooca.com',
    method: 'HEAD', interval: 120,
    note: 'VPS 面板 · openresty',
  },

  // ── Automation ─────────────────────────────────────────────
  {
    slug: 'n8n-hf', name: 'n8n (HF)', grp: 'Automation', platform: 'other',
    type: 'http', target: 'https://nardinmarcus-n8n-free.hf.space',
    method: 'GET', interval: 300, timeout: 15,
    note: 'Hugging Face 托管 · 冷启动较慢',
  },
  {
    slug: 'n8n-claw', name: 'n8n (ClawCloud)', grp: 'Automation', platform: 'other',
    type: 'http', target: 'https://n8n-mfbiygza.ap-southeast-1.clawcloudrun.com',
    method: 'GET', interval: 300, timeout: 20,
    // 2026-09-04 建站当晚探测超时（免费档休眠？），先停用；恢复后把 enabled 改 1
    enabled: 0,
    note: 'ClawCloud 托管 · 休眠待验证，暂停用',
  },
  {
    slug: 'cron-heartbeat', name: 'Cron 心跳', grp: 'Automation', platform: 'other',
    type: 'push', interval: 1800, timeout: 0,
    note: 'n8n 定时任务每 30min POST /push/<token> 即视为存活。token 见 /admin',
  },

  // ── API ────────────────────────────────────────────────────
  {
    slug: 'jmapi', name: 'JMAPI', grp: 'API', platform: 'vps',
    type: 'http', target: 'https://jmapi.namooca.com',
    method: 'GET', accept: [200, 401], interval: 60,
    note: '生图 API · VPS Docker 直连',
  },
  {
    slug: 'newapi', name: 'NewAPI', grp: 'API', platform: 'vps',
    type: 'http', target: 'https://newapi.namooca.com',
    method: 'GET', interval: 120, timeout: 15,
    // 盘点：DNS→VPS 且容器在跑（127.0.0.1:3000），外部连不通——openresty 路由/防火墙待查。
    // 故意 enabled：状态页就是要让这种事可见。修好后它自己变绿。
    note: 'API 网关 · 容器在跑但外部不通，待查',
  },

  // ── Infra（VPS 上的基础设施/内部服务）────────────────────────
  {
    slug: 'derp', name: 'DERP 中继', grp: 'Infra', platform: 'vps',
    type: 'http', target: 'https://derp.namooca.com',
    method: 'GET', interval: 120,
    note: 'Tailscale DERP · derper.service',
  },
  {
    slug: 'bridge', name: 'WeChat Bridge', grp: 'Infra', platform: 'vps',
    type: 'http', target: 'https://bridge.namooca.com',
    method: 'GET', accept: [200, 401], interval: 120,
    note: 'blogman 微信桥 · 401 即存活',
  },
  {
    slug: 'umami', name: 'Umami', grp: 'Infra', platform: 'vps',
    type: 'http', target: 'https://umami.namooca.com',
    method: 'HEAD', interval: 120,
    note: '访问统计 · VPS Docker 经 CF 代理',
  },
  {
    slug: 'sub2api', name: 'Sub2API', grp: 'Infra', platform: 'vps',
    type: 'http', target: 'https://sub2api.namooca.com',
    method: 'GET', interval: 120,
    // 盘点当晚 502：openresty 在、上游不在。故意 enabled，修好后自己变绿。
    note: '订阅转换 · 上游 502 待修',
  },
  {
    slug: 'proxy', name: 'Proxy', grp: 'Infra', platform: 'vps',
    type: 'http', target: 'https://proxy.namooca.com',
    method: 'GET', interval: 120, timeout: 15,
    // 盘点当晚连接失败，用途待确认（DNS→VPS）。enabled 保持可见。
    note: '用途待确认 · 连接失败',
  },

  // ── Platform ───────────────────────────────────────────────
  {
    slug: 'pulse-self', name: 'Pulse 自身', grp: 'Platform', platform: 'cloudflare',
    type: 'self',
    method: 'GET', interval: 60,
    note: '拨测器自监控 /health',
  },
];

// 台账备注（不入 checks，盘点结论存档）：
// - namooca.com 根域名：无响应（未配站点或故意空置），未建检查
// - image.nardinmarcus.top：CT 记录在案但已死（老图床），现役图床是 image.namooca.com
// - hermes-gateway.service：VPS systemd 服务，无公网端点，无法拨测
// - 3x-ui（0.0.0.0:8443）：公开状态页不公示基础设施端口，未建检查
