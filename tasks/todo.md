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

## Phase 5 · GitHub（2026-09-04）

- [x] 5.1 推送 github.com/nardinmarcus/pulse（public，随舰队其他仓库惯例；推送前扫过无真实密钥）

## Phase 6 · 三渠道盘点 + hub 集成（2026-09-04）

- [x] 6.1 台账盘点：CT 日志（namooca.com 17 子域 + nardinmarcus.top 10）· SSH VPS（docker/systemd/openresty）· Vercel 指纹（x-vercel-* 响应头；CLI token 失效改走此路）
- [x] 6.2 新增 12 条检查（icon/taste/rss/prompt-optimizer/nav×3/vpn×3/derp/bridge/umami/sub2api/proxy），共 29 条；`platform` 字段（cloudflare/vercel/vps）入库 + 页面徽标
- [x] 6.3 checks 表加 platform 列（ALTER 迁移）；/api/brief 增加 type/platform 供 hub 匹配
- [x] 6.4 hub 集成：全量 TOOLS（21 项）+ 卡片状态点 + 舰队健康卡（18/19，点击直达脉搏）+ ⌘K 状态点与 Pulse 入口 + 60s 静默刷新；30s 服务端缓存、失败降级
- [x] 6.5 hub 上线验收：绿/红双态、palette 搜索、真实数据 18/19

## 盘点结论（2026-09-04 存档）

- **真实故障 3 件**（都指向 VPS openresty）：newapi→HTTP 526（CF→源站证书无效，容器本身在跑 :3000）；proxy→HTTP 525（SSL 握手失败，用途待确认）；sub2api→502（openresty 在、上游不在）
- namooca.com 根域名无响应（未配站点/空置）；image.nardinmarcus.top 已死（老图床，现役为 image.namooca.com）；n8n-claw 休眠（ClawCloud 免费档）
- 无法拨测：hermes-gateway（systemd，无公网端点）、3x-ui（:8443，公开状态页不公示基础设施端口）
- nav / navi 为同一导航页双部署（CF / Vercel）
- Vercel CLI token 失效，如需列 Vercel 项目清单需 `vercel login` 重登

## Backlog

- [ ] 通知通道实测（TELEGRAM_BOT_TOKEN / NOTIFY_WEBHOOK_URL 配置后发真消息）
- [ ] 维护窗口（planned maintenance 不算故障）
- [ ] n8n 把 Cron 心跳打点接真（token 在 /admin）
- [ ] newapi / n8n-claw 修复后把 src/checks.js 里 enabled 改 1
- [ ] 事件备注（ack + root cause 手工标注）
- [ ] 多地域拨测（多 Worker 部署 + 来源标记）——若单边缘误报成为实际问题再做

## 2026-09-07 · Durable Objects rows_read 超额修复

- [x] 邮件与线上定位：唯一 namespace pulse_PulseCore；清理计划 SCAN samples；rss/nav 实际均60s。
- [x] 清理时间索引与 interval/timeout/last_run 修复 → verify: 真实 workerd SQL rowsRead 与调度回归测试。
- [x] 按用户选择，历史统计北京时间每日按需更新并持久化，状态保持20s快照 → verify: 同日/跨日/重启缓存与即时状态测试。
- [x] 测试与部署：40/40，部署版本 155a2ccc-8f5f-479a-9ef1-c78696893347。
- [ ] 生产恢复验收 → BLOCKED: /api/status HTTP 500 与 Data Studio 同时报 Exceeded allowed rows read in Durable Objects free tier；需额度重置或用户确认升级。独立测试代理完成RED，但独立终审因代理额度不可用未完成；已人工检查diff。

验证：真实 workerd 回归 RED→GREEN；清理样本读取 2881→2 行，同日/重建实例/tick 后历史读取 0 行。`npm test` 40/40；`wrangler deploy --dry-run` 通过。部署前检查仅涉及本次额度修复5个文件。

生产状态（2026-09-07）：代码提交 bcbec36 已推送 origin/main；未升级套餐。当前免费额度已耗尽，按平台每日00:00 UTC规则下一次重置为北京时间2026-09-08 08:00。线上索引、间隔、每日统计及探测自续仍需恢复后核验，不能把部署成功当作服务已恢复。

## 2026-09-08 · 额度恢复复查

- [x] 北京时间18:11复查：首页、/api/status、/api/brief、两种RSS徽章均HTTP 200；29项检查，rss=120s、nav=300s。
- [x] 两次观测中blogman.lastRun由1788862216310推进至1788862276304（约60秒），historyUpdatedAt保持1788827897007，确认探测自续与每日历史缓存。
- [x] 当前100%生产版本仍为155a2ccc-8f5f-479a-9ef1-c78696893347；保留免费计划，本轮未部署或升级。
- 当前接口已恢复；08:10仍报额度错误的原因尚未证实。线上索引未另行查询，全天额度趋势未验收；不得将本次恢复解释为未来不会再超额。
