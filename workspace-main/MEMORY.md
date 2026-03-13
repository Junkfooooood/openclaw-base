# Confirmed Memory

## Identity Facts
- 用户是林。
- 默认协作语言是中文。
- 当前本地长期协作智能体名称为叶红泷。

## Collaboration Preferences
- 面对战略规划，优先让林先给草案，再做补强。
- 若任务存在风险、成本或副作用，必须先说明。
- 处理情绪内容时，原话保留，只做模式分析，不把分析写成事实。
- 复杂任务进入 agent 模式前，应先确保当前版本已留档并可回滚。

## System Facts
- OpenClaw 是当前总入口，外部消息默认先进入 `main`。
- Markdown 是记忆系统的真相层；Redis AMS、Qdrant、Neo4j 是增强层，不得反向覆盖 Markdown。
- Obsidian Vault 当前作为学习系统备份与同步载体，不作为真相层来源；OpenClaw 对其默认采用 draft-first。
- 复杂任务必须经过 Task Tree、黑板、validator 验收、最多 3 次重试、超限熔断。
- 正式知识库、六维能力、战略板块、声望板块写入必须先出草稿或 patch，再经林批准。

## Current Build Focus
- 当前正在补齐第 11 步附近的结构缺口，重点是记忆桥、黑板桥、验证规则和多 agent 工作骨架。
- `memory-bridge` 已完成 Redis AMS / Qdrant / Neo4j 基础联调，下一步是细化冲突治理与更稳健的召回策略。
- `obsidian-bridge` 默认应保持 draft-first，不直接写正式库。
- 已新增轻量 `route review loop`：可通过 validator 对 route plan 做 advisory 级复核，用于后续逐步优化 Conversation-to-Routes SOP。
- 已完成 `Moonshot + Qwen + DeepSeek Chat` 从认证层到 agent 可调度层的接入：当前默认回退链为 `OpenAI Codex -> Kimi -> Qwen -> DeepSeek Chat -> OpenAI`；learning/curator 优先走 Kimi，validator 优先走 Qwen，executor 继续以 Codex 为主。
- 第 8 / 9 / 10 步的管理模式主链已落地为本地状态机：复杂任务先产出 Task Tree JSON，再由 `shared/workflows/bin/task_dispatch_workflow.mjs` 接管 normalize / board-init / dispatch / validate / approval / finalize。
- 已新增 `strategy_review` 低工具 route：默认 `tool_mode=low_tool`、`model_hint=deepseek/deepseek-reasoner`，用于战略讨论、决策推演、复盘总结；需要网页、代码、文件、设备动作时必须拆出新的 `default` branch。
- 已新增 branch handoff 执行层：ready branch 会生成 `shared/runtime/dispatch/<task_id>/<branch_id>.json`，同时把统一格式事件写入 `shared/runtime/activity/<task_id>.jsonl`，并把黑板状态从 `ready` 更新为 `assigned`。

## Pending Configuration Facts
- 学习系统 Obsidian Vault 当前路径为 `/Users/linqingxuan/Library/Mobile Documents/com~apple~CloudDocs/knowledge-system`，作为 live vault 使用，并已写入本地运行配置。
- Redis AMS、Qdrant、Neo4j 已在当前项目里完成基础联调确认。
- 已建立 Obsidian 业务路由基线：`logs / knowledge / taskboard / capabilities / reputation / strategy`，正式目录映射规则见 `shared/policies/Obsidian_Routing.md`。
- 第 15 步当前采用 `heartbeat + cron + Feishu direct` 作为主动陪伴骨架；运行态已改为显式 `heartbeat.session + target + to` 绑定，不再依赖 `last target` 猜测。设备习惯自适应留待第 13 / 14 步接入后再做。
- 新 skill 发现允许自动推荐，不允许自动安装；网络发现与安装边界见 `shared/policies/Skill_Discovery_Safety.md`。
- 已在本地 cron 中挂上 5 个第 15 步任务：早间状态检查、晚间状态检查、午间前沿简报、夜间轻聊天、每周 skill watch。
- 2026-03-12 已完成第 15 步送达验证：Feishu direct session 可正常对话，手动 Feishu 出站测试成功，`cron -> next-heartbeat` 最近一次结果已显示 `channel: feishu`。
- `DeepSeek` 当前通过手动 `models.providers.deepseek` 接入运行配置，而不是依赖自动 provider 注入；已确认 `deepseek/deepseek-chat` 与 `deepseek/deepseek-reasoner` 出现在 runtime `models list` 中。
- `deepseek-reasoner` 已注册但未进入默认工具型 agent 主链；后续若要用于战略推演，应优先在低工具依赖场景单独验证。
- 黑板热冷分层已更新：`finalize` 后完整卡片进入 `shared/blackboard/archive/`，热板仅保留摘要卡和 archive 指针。

## Imported Facts
- openclaw-smoke-20260312：林在 2026-03-12 完成了 Markdown、AMS、Semantic、Graph 四层记忆桥联调。
  - source: manual-smoke-test
  - confidence: 0.98
  - approved_by: linqingxuan
  - committed_at: 2026-03-12T08:09:49.134Z
