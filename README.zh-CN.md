<div align="center">

# 脉搏 · Pulse

**边缘原生的舰队状态页与拨测器 —— 一个 Worker，零外部资源。**

每分钟拨测、故障时间线、心跳通知，全部跑在一个 Cloudflare Worker 里；不需要服务器，不需要数据库实例。

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20Durable%20Objects-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Live](https://img.shields.io/badge/live-pulse.namooca.com-c73a24)](https://pulse.namooca.com)

[English](README.md) · [简体中文](README.zh-CN.md)

<img src="assets/readme/home-dark.png" alt="Pulse 状态页（暗色）" width="860">

</div>

---

脉搏用自己的方式看护自托管舰队：**checks-as-code**，每分钟从 Cloudflare 边缘发起拨测，配一张凌晨四点也看得清的公开状态页。状态存放在 Durable Object 内置的 SQLite 里——不用 D1、不用 KV、不建任何外部资源。拨测器、存储、调度、页面，一条 `wrangler deploy` 全部交付。

调度是自愈的：每轮拨测先补上下一个 60 秒的 DO alarm，心跳链自己养活自己，cron 哑火也不停摆；同时注册的 cron 并行冗余，45 秒去重窗口保证两条通道不打架。

<img src="assets/readme/incident-dark.png" alt="故障态" width="860">

## 功能

- **四种检查类型** —— `http`（状态码 / 关键字 / 重定向策略）、`tcp`（`connect()` 握手即断）、`push`（反向心跳：目标主动打点 `/push/<token>`，超 2× 间隔视为失联）、`self`（脉搏监控自己）
- **诚实的状态** —— 失败一次即翻 `down`（页面不撒谎）；但**事件与通知**要连续第 2 次失败才开，滤掉单次抖动。恢复时自动闭合事件，通知附带故障时长
- **公开状态页** —— SSR、中英双语、纸墨主题，唯一的图形修辞是一条手绘感心电线，故障时拉平转红；30 秒自动刷新（整体换 `body`），零框架，禁用 JS 也能看
- **90 天按日条带 + 24 小时延迟折线** —— 原始样本留 48h，小时桶滚 365 天，查询永远便宜；全部按 UTC+8 切日
- **通知** —— 通用 webhook（payload 对 n8n 友好）与 Telegram Bot，均可选；事件开启与恢复时发送
- **徽章** —— `GET /badge/<slug>.svg`（状态）与 `/badge/<slug>/uptime.svg`（90 天在线率），shields-flat 风格，缓存 5 分钟
- **管理页** —— `/admin`，token 鉴权：暂停/恢复、立即试跑、手动拨测、心跳 token
- **免维护** —— 存储自动滚动清理（样本 48h、桶 365 天、事件 180 天），无需照看

## 快速开始

需要 Node ≥ 20。

```bash
git clone https://github.com/nardinmarcus/pulse.git
cd pulse
npm install
cp .dev.vars.example .dev.vars
npm run dev        # http://localhost:8791
```

改 [`src/checks.js`](src/checks.js)——唯一配置面——然后上线：

```bash
npx wrangler deploy                                  # worker + 自定义域 + 触发器
npx wrangler secret put ADMIN_TOKEN                  # 开启 /admin
```

可选 secret：`NOTIFY_WEBHOOK_URL`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`、`PUBLIC_URL`。

## 检查配置

```js
// src/checks.js
{
  slug: 'blogman', name: 'Blogman', grp: 'Content',
  type: 'http', target: 'https://blog.namooca.com',
  method: 'HEAD', interval: 60,        // 秒；另有 timeout、accept[]、keyword、follow_redirects
  note: '博客 · Cloudflare Workers',
},
{ slug: 'vps-tcp', type: 'tcp',  target: 'rn.namooca.com:443', interval: 60 },
{ slug: 'cron-job', type: 'push', interval: 1800 },  // n8n 定时任务每 30min 打点一次
```

停用的检查以 `enabled: 0` 随代码发布——页面灰显、不探测。`wrangler dev` 下有 `PULSE_DEV=1` 专属的调试入口：模拟下一次探测结果、回拨心跳时刻，故障路径可以随时演示、随时测试。

## API

| 路由 | 用途 |
|---|---|
| `GET /` | 状态页（SSR HTML） |
| `GET /api/status` | 完整快照 JSON（检查 / 折线 / 事件） |
| `GET /health` | 自监控存活端点 |
| `GET /badge/<slug>.svg` · `/badge/<slug>/uptime.svg` | shields 风格徽章 |
| `POST /push/<token>` | 心跳打点（GET 也可） |
| `POST /admin/api/*` | `list` · `tick` · `check/<slug>/pause|resume|test` · `push-tokens` —— `Authorization: Bearer <ADMIN_TOKEN>` |

## 状态是怎么存的

```text
探测 ──► 样本 (48h) ──► 小时桶 (365d) ──► 90 天条带 · 在线率
      └─► 状态机 ──► 事件（第 2 次失败自动开、恢复自动关）──► 通知
```

单写者 Durable Object（`PulseCore`）统管建表、配置同步、拨测、状态机、聚合与通知。页面、API、徽章都读同一份 20 秒内存快照。

## 验证

```bash
npm test          # 35 个单元测试 —— 状态机 / 聚合 / SVG / 通知
npm run smoke     # 起 wrangler dev，手动驱动 tick，端到端断言 28 项行为
```

## 说明

- [CONTEXT.md](CONTEXT.md) 是领域词汇表，[DESIGN.md](DESIGN.md) 是视觉规范——与本舰队其他项目同一套约定。
- 免费档友好：~15 条检查的规模下，cron/alarm 调用、DO 请求与存储、子请求量都低于限额一个数量级。
- © 2026 Namoo · [English](README.md)

<div align="center">

<img src="assets/readme/home.png" alt="Pulse 状态页（亮色）" width="860">

</div>
