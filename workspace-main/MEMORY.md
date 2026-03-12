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
- 复杂任务必须经过 Task Tree、黑板、validator 验收、最多 3 次重试、超限熔断。
- 正式知识库、六维能力、战略板块、声望板块写入必须先出草稿或 patch，再经林批准。

## Current Build Focus
- 当前正在补齐第 11 步附近的结构缺口，重点是记忆桥、黑板桥、验证规则和多 agent 工作骨架。
- `memory-bridge` 需要先保证分层治理，再接 Redis AMS / Qdrant / Neo4j。
- `obsidian-bridge` 默认应保持 draft-first，不直接写正式库。

## Pending Configuration Facts
- 学习系统 Obsidian Vault 路径尚未写入运行配置。
- Redis AMS、Qdrant、Neo4j 尚未在当前项目里完成联调确认。
