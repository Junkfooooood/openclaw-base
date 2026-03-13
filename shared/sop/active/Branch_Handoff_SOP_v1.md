---
id: branch_handoff_v1
status: active
entry_agent: main
requires_blackboard: true
requires_activity_log: true
---

# Goal
把 `dispatch` 识别出的 ready branch，转成可执行、可留痕、可复查的 branch packet。

# Required Files
- `shared/policies/Core_Routing.md`
- `shared/policies/Validation_Rules.md`
- `shared/sop/active/Task_Dispatch_SOP_v1.md`

# Trigger
当复杂任务已经完成以下步骤时进入本 SOP：
- Task Tree 已创建并通过结构校验
- 黑板卡片已初始化
- dispatch 已产出 `ready_branches`

# Handoff Rules
1. 每个 ready branch 必须写成独立 packet。
2. packet 必须写入 `shared/runtime/dispatch/<task_id>/<branch_id>.json`。
3. 每次 handoff 必须追加一条统一格式活动日志到 `shared/runtime/activity/<task_id>.jsonl`。
4. 黑板必须把对应 branch 从 `ready` 更新为 `assigned`。
5. packet 必须至少包含：
   - task_id
   - title
   - branch_id
   - owner
   - route
   - tool_mode
   - model_hint
   - goal
   - depends_on
   - expected_output
   - acceptance
   - task_tree_path
   - blackboard_card_path
   - activity_log_path
   - recommended_invocation

# Strategy Review Special Rule
当 branch 使用 `route=strategy_review` 时：
- packet 必须明确写出 `tool_mode=low_tool`
- packet 必须明确写出默认模型 `deepseek/deepseek-reasoner`
- packet 必须提醒执行者：若发现需要网页、文件、代码或设备动作，应退回 main 拆出新的 `default` branch

# Transparency Rule
所有 branch handoff 留痕必须使用相同字段结构，至少包括：
- timestamp
- task_id
- branch_id
- owner
- route
- tool_mode
- model_hint
- event
- status
- packet_path

# Output
handoff 结束后，至少应能看到：
- packet 文件路径
- activity log 路径
- 黑板已更新为 `assigned`
- 下一步应由哪个 owner 执行

# Self Check
- 是否所有 ready branch 都已生成 packet
- 是否遗漏黑板更新
- 是否遗漏统一活动日志
- 是否让 `strategy_review` branch 越权承担工具执行
