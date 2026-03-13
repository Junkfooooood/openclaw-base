---
id: task_dispatch_v1
status: active
entry_agent: main
validator_agent: validator
requires_blackboard: true
requires_task_tree_for_complex_tasks: true
formal_write_requires_approval: true
branch_retry_max: 3
---

# Goal
将复杂任务从自然语言请求，转换为可追踪、可分发、可验收、可重试、可熔断的任务树执行流程。

# Required Files
执行本 SOP 前必须参考以下文件：
- `shared/policies/Core_Routing.md`
- `shared/policies/Validation_Rules.md`
- `shared/sop/active/Branch_Handoff_SOP_v1.md`
- `shared/blackboard/temple/blackboard_card.md`
- `shared/schemas/task_tree.schema.json`

# Trigger
当任务满足以下任一条件时，必须进入本 SOP：
- 多输出物
- 多 agent 协作
- 超过 3 个明确步骤
- 涉及正式知识库写入
- 涉及系统执行 / 外发消息 / 设备动作
- 存在依赖关系
- 存在可并行分支
- 明确需要验收、重试或熔断

# Input Standard
进入流程前必须尽量明确：
- 任务目标
- 交付物
- 约束条件
- 是否涉及学习系统
- 是否涉及正式写入
- 是否涉及外部动作
- 是否需要审批

若输入不完整，main 应先补充最小必要假设，并在输出中标明假设。

# Dispatch Steps

## Step 1: 判定复杂任务
main 判断该任务是否满足复杂任务触发条件。
若否，则退出本 SOP，回到简单任务处理。

## Step 2: 创建 Task Tree
在 `shared/runtime/queue/` 创建 Task Tree 文件。
Task Tree 必须至少包含：
- task_id
- title
- mode
- approval_mode
- retry_policy
- branches
- 每个 branch 的 owner / goal / depends_on / route / tool_mode / model_hint / expected_output / acceptance

## Step 3: 创建黑板卡片
在 `shared/blackboard/hot/` 创建对应黑板卡片。
初始状态应至少写明：
- 总任务状态
- 各 branch 初始状态
- 当前负责者
- 下一步
- 相关文件路径

## Step 4: 选择 branch owner
根据 `Core_Routing.md` 选择 owner：
- learning
- curator
- executor
- validator

同时必须为每个 branch 指定 route profile：
- 常规分支：`route=default`
- 战略讨论 / 决策推演 / 复盘总结：`route=strategy_review`

当 branch 使用 `strategy_review` 时，必须同步写入：
- `tool_mode=low_tool`
- `model_hint=deepseek/deepseek-reasoner`
- 如该 branch 仍需要网页/代码/文件动作，必须再拆出新 branch，而不是让 reasoner route 越权执行

## Step 5: 分发执行
在真正交给 owner 前，main 必须先做 handoff：
- 为每个 ready branch 生成 packet
- 将 packet 写入 `shared/runtime/dispatch/<task_id>/<branch_id>.json`
- 将 handoff 事件追加到 `shared/runtime/activity/<task_id>.jsonl`
- 把黑板中的 branch 状态从 `ready` 改为 `assigned`

每个 branch 执行者仅负责：
- 读取任务树
- 读取属于自己的 branch packet
- 读取相关 SOP
- 完成本 branch 输出
- 回写黑板状态

执行者不得：
- 自行宣布最终通过
- 越权修改核心规则
- 越权写正式知识库
- 绕过审批关口

## Step 6: 黑板更新
每次 branch 状态变化必须更新黑板，至少更新：
- updated_at
- current_branch
- Branch Status
- Last Action
- Current Outputs
- Next Step
- blocker（如有）
- retry_count

若 branch 已分发给 owner，则还应保证：
- 对应 packet 路径已可追踪
- activity log 已追加 handoff 记录

## Step 7: validator 验收
branch 产出后，交 validator 进行验收。
validator 只允许输出：
- PASS
- FAIL
- BLOCK

若 FAIL，必须说明失败原因。
若 BLOCK，必须说明阻塞点与人工介入建议。

## Step 8: 重试与熔断
若 validator 判定 FAIL：
- 原 branch owner 进行修复
- branch 的 retry_count +1
- 更新黑板

若某 branch retry_count >= 3：
- branch 状态改为 `blocked`
- 主任务状态改为 `blocked`
- main 向林汇报并请求介入

## Step 9: 汇总与归档
当所有 branch 均通过后：
- main 汇总总结果
- 若涉及正式动作，则等待审批通过
- 任务完成后将完整黑板卡片写入 `archive/`
- 在 `hot/` 保留一份摘要卡，仅保留一句话总结、输出路径和 archive 指针

# Output
主输出至少应包括：
- 当前任务判断
- Task Tree 摘要
- branch 分配情况
- 当前状态
- 风险 / 阻塞
- 是否需要林批准

# Self Check
执行本 SOP 时必须自检：
- 是否把简单任务过度复杂化
- 是否遗漏了依赖关系
- 是否遗漏审批要求
- 是否遗漏黑板创建或更新
- 是否让执行者自己给自己最终验收
- 是否超过边界仍继续执行
