# Pulse · 脉搏 — 任务清单

> 边缘原生状态页与拨测器：Cloudflare Workers + Durable Object(SQLite)，监控 namooca 舰队
> 决策：零外部资源（不用 D1/KV）· checks-as-code · SSR 单渲染函数 · DO alarm 链自愈调度 · 纸墨主题（同 layout-atlas）

## Phase 1 · 骨架（2026-09-03 深夜）

- [x] 1.1 舰队可达性摸底：11 服务探活（发现 newapi 不通、ClawCloud n8n 休眠 → 默认停用并注明）
- [x] 1.2 仓库脚手架 + 房规文档（CONTEXT.md 词汇表 / DESIGN.md 视觉规范 / AGENTS.md）
- [x] 1.3 纯函数层：model（状态机）· rollup（桶聚合/按日条带/百分位/格式化）· svg（心电线/折线/徽章）· notify（消息构造）
- [x] 1.4 单元测试 35 项全绿（node --test，零依赖）

## Phase 2 · 核心（同夜）

- [x] 2.1 PulseCore 单例 DO：SQLite 六表 · checks-as-code 增量同步 · 并行探测（http/tcp/push/self）
- [x] 2.2 状态机：失败即 down；连续第 2 次失败开事件；恢复自动闭合+通知；心跳未打点前保持 new
- [x] 2.3 小时桶 ON CONFLICT 聚合 + 48h/365d/180d 保留期清理
- [x] 2.4 Worker 路由：SSR 页 · /api/status · /health · 徽章×2 · /push/<token> · /admin（token 鉴权）
- [x] 2.5 dev 调试面（PULSE_DEV=1）：模拟探测结果 / 心跳回拨 / 重置
- [x] 2.6 smoke 28 项端到端断言全绿（wrangler dev + /__scheduled 手动驱动）

## 记录（Phase 2 教训）

- workers `connect()` 签名是 `connect("host:port", options)`——三参调用报 SocketOptions 类型错
- Chrome 不认 pathLength×CSS stroke-dasharray 组合：心电画出动画改为客户端 getTotalLength() 实测长度
- `/__scheduled`（--test-scheduled）返回纯文本，不是 JSON
- 部署前写死 .dev.vars 缺失会导致 admin 全系 404，smoke 首批失败即是此因

## Phase 3 · 视觉验收（同夜）

- [x] 3.1 六态截图走查：light/dark × 正常/故障 × 桌面/390px
- [x] 3.2 修正：mobile masthead 换行（≤760px 隐藏 .en）、故障心电线呼吸下限 .4→.55
- [x] 3.3 README 资产：home.png / home-dark.png / incident-dark.png / mobile.png

## Phase 4 · 上线（2026-09-04 凌晨）

- [x] 4.1 `wrangler deploy` 一次通过：pulse.namooca.com（custom domain）+ cron 注册
- [x] 4.2 ADMIN_TOKEN secret 已设（token 在 .secrets/admin-token.txt，已 gitignore）
- [x] 4.3 **cron 触发器注册但哑火**（tail 2.5 分钟零 scheduled 事件）→ 改造为 **DO alarm 链自愈调度**：
      每轮 tick 先补下一个 60s 闹钟；tick/页面访问/打点任一入口都会养活链路；
      cron 并行冗余，`TICK_DEDUP_MS`(45s) 去重。生产实测 17:22:30→17:23:30→17:24:30 精准 60s 自续
- [x] 4.4 生产验收：/api/status 全绿（blogman 边缘 296ms）· vps-tcp 握手 150ms · 徽章/health 200
- [x] 4.5 README ×2（中英）+ 手动 tick 管理路由

## Backlog

- [ ] 通知通道实测（TELEGRAM_BOT_TOKEN / NOTIFY_WEBHOOK_URL 配置后发真消息）
- [ ] 维护窗口（planned maintenance 不算故障）
- [ ] n8n 把 Cron 心跳打点接真（token 在 /admin）
- [ ] newapi / n8n-claw 修复后把 src/checks.js 里 enabled 改 1
- [ ] 事件备注（ack + root cause 手工标注）
- [ ] 多地域拨测（多 Worker 部署 + 来源标记）——若单边缘误报成为实际问题再做
