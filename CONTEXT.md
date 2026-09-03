# 脉搏 · Pulse

边缘原生状态页与拨测器：对 namooca 舰队做每分钟拨测，公开状态页 + 故障时间线 + 心跳通知。本文件是领域词汇表；视觉规范见 DESIGN.md，部署与 API 见 README.md。

## Language

### 实体

**检查 (Check)**:
拨测的基本单位。一条配置 = 一个被监控目标。类型三种：HTTP、TCP、心跳。检查以 slug 标识，配置随代码发布（checks-as-code），不在运行时增删。
_Avoid_: 监控项、监控器（monitor）、任务

**探测 (Probe)**:
对一条检查的一次实际执行。HTTP 拨测发一个请求；TCP 拨测握手后立即断开；心跳检查不做外呼，只判 staleness。每次探测产生一条样本。

**样本 (Sample)**:
一次探测的落库记录：`(slug, ts, ok, ms, code, err)`。原始样本保留 48 小时，到期清理。

**状态 (State)**:
检查的当前结论，四值：`up` / `down` / `paused` / `new`。首探前为 `new`；`paused` 表示配置停用。失败一次即 `down`（页面诚实优先）。
_Avoid_: 健康 health、在线 offline

**确认故障 (Confirmed Failure)**:
连续第 2 次失败。首次失败只翻状态，第 2 次失败才开事件、发通知——过滤单次抖动。

**事件 (Incident)**:
一次被确认的故障区间：开于确认故障时刻，闭于首次恢复探测。事件是故障时间线的唯一来源。
_Avoid_: 告警（告警指通知这个动作）

**恢复 (Recovery)**:
`down` → `up` 的迁移。自动闭合未决事件并发恢复通知，附带故障时长。

**心跳 (Push / Heartbeat)**:
反向检查：不在服务端轮询，而是目标主动 `POST /push/<token>` 打点；超过 `interval × 2` 未打点视为失败。适合 n8n 等 cron 任务自证存活。

### 存储与聚合

**桶 (Bucket)**:
按小时的预聚合行：`(slug, hour, total, ups, ms_sum, ms_max)`。90 天在线率与按日条带都从桶算，不扫原始样本。桶保留 365 天。

**按日条带 (Day Strip)**:
状态页上每条检查右侧的 90 根细条，一根一天，按 UTC+8 切日。绿=全天可用，红=有失败，灰=无数据。

**快照 (Snapshot)**:
DO 内存中缓存 20s 的页面聚合视图。页面、API、徽章都读快照，不直查库。

### 通道

**通知 (Notification)**:
事件开启/恢复时向可选通道发的消息。通道两个：通用 webhook（n8n 可接）与 Telegram Bot。未配置则静默。
_Avoid_: 告警、报警、push（push 专指心跳）

**打点 (Ping)**:
心跳检查收到的一次 `POST /push/<token>`。

## Decisions

- 存储：Durable Object + SQLite（单例 `core`），不用 D1/KV——零外部资源，一条 `wrangler deploy` 即完整交付。
- 调度：**DO alarm 链为主**（每轮 tick 先补上下一个 60s 闹钟，链式自续、自愈），Cloudflare Cron 同步注册为冗余；双通道以 `TICK_DEDUP_MS`（默认 45s）去重。alarm 链由 tick/页面访问/打点任一入口养活——即使 cron 哑火、久无访问，一次触达即恢复心跳。
- 配置：checks-as-code，`src/checks.js` 是唯一配置面；改检查 = 改代码重新部署。admin 的 pause/resume 只改本地库，下次部署会被配置覆盖（以防忘改配置）。
- 页面：SSR 单文档，客户端 30s 整体换 `body`，单一渲染函数服务端复用，无框架无构建产物。
