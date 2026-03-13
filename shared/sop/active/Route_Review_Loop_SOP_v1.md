---
id: route_review_loop_v1
status: active
entry_agent: validator
draft_first: true
formal_write_requires_approval: false
hard_constraint: false
---

# 目标

给 `对话 -> route` 分发增加一个轻量复核环节：

- 不是审批闸门；
- 不是强制阻断器；
- 而是一个低成本的“路线是否大致合理”检查。

这个 SOP 的定位是：

- 在 route 分发后，快速判断 route 是否明显失真；
- 把可复用的判断经验逐步沉淀；
- 允许 agent 继续探索更优 route 组合，而不是把规则过早写死。

# 输入

建议输入包含：

- `source_summary`
  - 对原始对话或原始材料的简要总结
- `route_plan`
  - 一个数组，每个元素至少包含：
    - `route`
    - `why`
    - `output_type`
    - `confidence`（可选）

推荐结构：

```json
{
  "task_id": "optional",
  "title": "optional",
  "source_summary": "今天围绕学习阻塞、记忆系统路线和周任务调整进行了讨论。",
  "route_plan": [
    {
      "route": "logs",
      "why": "包含学习状态和阻塞说明",
      "output_type": "draft",
      "confidence": 0.94
    },
    {
      "route": "knowledge",
      "why": "形成了可沉淀的记忆系统路线总结",
      "output_type": "patch",
      "confidence": 0.82
    }
  ]
}
```

# 输出

validator 最终只允许输出：

- `PASS`
- `FAIL`
- `BLOCK`

其中：

- `PASS`
  - route 计划结构完整，且没有明显失真
  - 即使存在轻微优化空间，也不需要阻断
- `FAIL`
  - route 计划本身存在明显问题，但可以修
- `BLOCK`
  - 缺少关键输入，无法判断

# 复核原则

## 1. 先检查结构，不先争论“最优”

优先检查：

- route 名称是否合法
- why 是否存在
- output_type 是否合理
- route_plan 是否为空

不要一上来追求“这是不是绝对最优 route 方案”。

## 2. 默认允许探索

如果某个 route 选择“能说得通，但未必最优”，应倾向：

- `PASS` + advisory

而不是：

- `FAIL`

因为这个 loop 的目标是帮助系统学习，不是提前压死探索空间。

## 3. 只有明显失真才 FAIL

以下情况可判定 `FAIL`：

- route 不存在
- why 为空或完全无法解释
- output_type 不合理
- route_plan 为空但声称已经完成 route 分发
- 多条 route 重复且无区分

## 4. 缺关键输入才 BLOCK

以下情况可判定 `BLOCK`：

- 没有 `source_summary` 且没有足够 route 上下文
- route_plan 缺失，无法判断
- 输入不是合法 JSON 结构

## 5. `logs` 是默认基线，但不是硬约束

如果一轮学习系统对话没有 `logs`：

- 不要自动 `FAIL`
- 只给 advisory：
  - “若本轮对话值得留档，可考虑补 `logs`”

这样既保留了你要的软约束，也给 agent 一个逐步收敛的方向。

# 推荐校验项

1. route 是否属于已知集合
2. why 是否是解释，不是空话
3. confidence 若存在，是否在 `0 ~ 1`
4. output_type 是否属于：
   - `draft`
   - `patch`
   - `suggestion`
5. 是否存在明显重复 route
6. 是否遗漏了最基础的记录建议（advisory 级，不是硬失败）

# 推荐输出格式

```json
{
  "status": "PASS",
  "reason": "route plan is structurally valid and broadly reasonable",
  "failed_checks": [],
  "advisories": [
    "consider adding logs if this conversation should be archived"
  ],
  "suggested_next_step": "continue"
}
```

# 与自迭代的关系

这条 loop 的核心意义不是“纠正每一次 route”，而是：

1. 给 route 决策留下一致的复核口径
2. 让 validator 的反馈可以跨样本比较
3. 当某些 advisory 重复出现时，再回写到 `Conversation_To_Routes_SOP_v1.md`

因此，真正的自迭代路径是：

`对话 -> route 方案 -> route review -> advisory 累积 -> SOP 更新`

而不是：

`对话 -> validator 直接把 route 判死`

当前执行层入口：

- `node shared/workflows/bin/sop_evolution_workflow.mjs ingest-review --sop-id conversation_to_routes_v1 --file <review.json>`
- `node shared/workflows/bin/sop_evolution_workflow.mjs run-loop --sop-id conversation_to_routes_v1 --json`

# 自检清单

- 是否把“可探索空间”误判成 FAIL？
- 是否因为 route 不够完美就过度否定？
- 是否把 logs 当成了硬闸门？
- 是否给出了可执行的下一步，而不是只说“不好”？
