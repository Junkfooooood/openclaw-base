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

## Pending Configuration Facts
- 学习系统 Obsidian Vault 当前路径为 `/Users/linqingxuan/Library/Mobile Documents/com~apple~CloudDocs/knowledge-system`，作为 live vault 使用，并已写入本地运行配置。
- Redis AMS、Qdrant、Neo4j 已在当前项目里完成基础联调确认。
- 已建立 Obsidian 业务路由基线：`logs / knowledge / taskboard / capabilities / reputation / strategy`，正式目录映射规则见 `shared/policies/Obsidian_Routing.md`。

## Imported Facts
- openclaw-smoke-20260312：林在 2026-03-12 完成了 Markdown、AMS、Semantic、Graph 四层记忆桥联调。
  - source: manual-smoke-test
  - confidence: 0.98
  - approved_by: linqingxuan
  - committed_at: 2026-03-12T08:09:49.134Z
