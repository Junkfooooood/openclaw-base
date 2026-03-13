# Core Routing

## 目标
定义系统内复杂任务的进入条件、分发顺序、owner 选择、黑板要求、验收流与熔断规则。

## 外部入口
- 所有外部消息默认进入 main。
- 只有 main 可以直接向林做最终汇报。
- 其他 agent 不直接对外承担最终输出职责，除非被明确授权。

## 简单任务
满足以下条件时，可视为简单任务，由 main 直接处理：
- 单一输出物
- 不需要多个 agent 协作
- 不超过 3 个明确步骤
- 不涉及正式知识库写入
- 不涉及系统执行 / 外发消息 / 设备动作
- 不存在明显依赖关系或并行分支

## 复杂任务触发条件
满足以下任一条件，即视为复杂任务，必须进入 Task Dispatch 流程：
- 多输出物
- 多 agent 协作
- 超过 3 个明确步骤
- 涉及正式知识库写入
- 涉及系统执行 / 外发消息 / 设备动作
- 存在依赖关系
- 存在可并行分支
- 存在明确的验收 / 重试 / 熔断需求

## 复杂任务的强制顺序
复杂任务必须按以下顺序执行：
1. main 读取本文件与 Task_Dispatch_SOP_v1.md
2. 创建 Task Tree
3. 创建黑板卡片
4. 生成 branch handoff packet 并写统一活动日志
5. 按 branch owner 分发
6. branch 执行结果写入黑板
7. validator 验收
8. 若 FAIL，则回退原 owner 修复
9. 若同一 branch 达到最大重试次数，则熔断
10. main 汇总并向林汇报
11. 任务结束后归档黑板卡片

## Owner Routing
- 学习监督 / 日志整理 / 周冲刺 / 学习建议 → learning
- 知识提炼 / 六维能力增量 / 声望草稿 / 正式库 patch 草稿 → curator
- 网页 / 文件 / 自动化 / 代码 / 设备执行 → executor
- 格式校验 / 逻辑校验 / 风险校验 / SOP 边界校验 → validator

## Route Profiles
- 默认 branch 走 `route=default`，`tool_mode=standard`
- 战略讨论 / 决策推演 / 复盘总结 / 长链反思 branch 应优先走 `route=strategy_review`
- `strategy_review` 的默认约束：
  - `tool_mode=low_tool`
  - `model_hint=deepseek/deepseek-reasoner`
  - `visibility=transparent_summary`
  - 不直接承担正式写库、外发消息、设备执行
- `strategy_review` 可由 `main` 承担总 synthesis，也可由 `validator` 承担复核型 branch；若需要网页、代码、文件动作，应拆出新的 `default` branch 交给 `executor`

## 黑板规则
凡进入复杂任务流程，必须：
- 在 `shared/blackboard/hot/` 创建对应卡片
- 每次状态变化更新黑板
- 明确写出 branch 状态、当前输出、下一步、阻塞点
- 完成后完整记录进入 `shared/blackboard/archive/`
- 热板保留一份摘要卡，至少包含一句话总结、输出路径和 archive 指针

## Handoff Packet 规则
- 所有 ready branch 必须生成 packet，路径为 `shared/runtime/dispatch/<task_id>/<branch_id>.json`
- 所有 handoff 事件必须统一追加到 `shared/runtime/activity/<task_id>.jsonl`
- packet 必须包含：
  - owner
  - route
  - tool_mode
  - model_hint
  - goal
  - expected_output
  - acceptance
  - task_tree_path
  - blackboard_card_path
  - recommended_invocation
- 黑板中的 ready branch 一旦生成 packet，状态应改为 `assigned`

## Task Tree 规则
Task Tree 必须至少包含：
- task_id
- title
- mode
- branch 列表
- 每个 branch 的 owner
- depends_on
- route
- tool_mode
- model_hint
- expected_output
- acceptance
- retry_policy
- approval_mode

## 验收规则
- branch 执行者不能给自己做最终验收
- 所有复杂任务 branch 必须经过 validator
- validator 只允许输出：PASS / FAIL / BLOCK
- FAIL 必须附失败原因
- BLOCK 必须附阻塞点与人工介入建议

## 重试与熔断
- 单一 branch 最大重试次数：3
- 任一 branch 达到 3 次失败后，branch 状态改为 `blocked`
- 主任务状态改为 `blocked`
- main 必须向林说明：
  - 卡住的是哪个 branch
  - 失败原因
  - 当前已有输出
  - 需要林介入的点

## 审批关口
以下动作必须在正式执行前由 main 发起审批：
- 正式知识库写入
- 外发消息
- 安装插件 / skill / 依赖
- 高风险系统执行
- 修改核心规则
- 跨受保护路径写入
