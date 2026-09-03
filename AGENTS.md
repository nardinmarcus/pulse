# Pulse — agent 协作须知

## 是什么
边缘原生状态页与拨测器（Cloudflare Worker + Durable Object/SQLite），监控 namooca 舰队。领域词汇见 CONTEXT.md，视觉规范见 DESIGN.md。

## 结构
```
src/index.js    Worker 入口: fetch 路由 + scheduled(cron) → DO tick
src/do.js       PulseCore 单例 DO: 建表/同步配置/拨测/状态机/聚合/通知
src/checks.js   检查配置（唯一配置面, checks-as-code）
src/page.js     SSR 状态页（单渲染函数, 客户端 30s 换 body）
src/lib/        纯函数: model(状态机) rollup(聚合) svg(心电线/折线/徽章) notify(消息构造)
test/           node --test 纯函数测试
scripts/smoke.mjs  wrangler dev 冒烟(启 dev → 断言 → 关)
```

## 硬约束
- 纯函数一律进 `src/lib/`，不许碰 `fetch`/SQL/DO——node --test 直接测。
- `src/do.js` 是唯一允许 import `cloudflare:sockets` 和写 SQL 的地方。
- 页面渲染只在服务端一份（`src/page.js` render），客户端脚本只做 body 替换与走秒，禁止出现第二份模板。
- 新增检查改 `src/checks.js`，不改 DO。
- 中文注释优先；文案中英对照制式见 DESIGN.md §5。
- 本地端口用 8791（8787 留给 namoo-hub）。
- `.dev.vars` / `.secrets/` 永不入库。

## 冒烟
`npm run smoke`：起 wrangler dev（自动选端口 8791）→ `/__scheduled` 手动驱动 tick → 断言页面/API/徽章/push/模拟故障 → 结束杀进程。
