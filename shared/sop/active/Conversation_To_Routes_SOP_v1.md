---
id: conversation_to_routes_v1
status: active
entry_agent: main
primary_agent: main
support_agents:
  - learning
  - curator
  - validator
draft_first: true
formal_write_requires_approval: true
hard_constraint: false
---

# 目标

当林与 OpenClaw 围绕学习系统对话时，给出一个稳定但不僵硬的建议流程，把原始对话整理为：

- 单一路由草稿
- 多路由草稿
- 路由 patch 草稿

本 SOP 的目的不是强制所有对话都走固定模板，而是给 agent 一个默认可复用的拆解方法。若后续通过实践发现更优分发方式，可以迭代本 SOP，而不需要把规则写死在核心提示中。

# 适用范围

适用于以下场景：

- 学习复盘
- 日志整理
- 知识点提炼
- 任务状态更新
- 六维能力变化判断
- 声望事件整理
- 战略讨论沉淀

不适用于以下场景：

- 纯闲聊
- 纯即时问答且不需要留档
- 单纯的系统操作问题
- 明确要求“不写学习系统”的对话

# 可用路由

当前默认 route：

- `logs`
- `knowledge`
- `taskboard`
- `capabilities`
- `reputation`
- `strategy`

正式映射规则以 `shared/policies/Obsidian_Routing.md` 为准。

# 总原则

1. 默认先问：这段对话是否值得进入学习系统？
2. 若值得，默认先写 `logs`，再判断是否需要追加其他 route。
3. 若只形成单一草稿，不要强行拆成多 route。
4. 若涉及正式区修改建议，不直接写正式区，只准备 patch draft。
5. 若存在不确定性，先保守地写 `logs`，把其他 route 建议写入日志草稿中的候选项。
6. 本 SOP 是推荐路径，不是绝对命令；允许 agent 在有充分理由时偏离，但应说明原因。

# 输入

至少具备以下之一：

- 当轮对话
- 一段学习记录
- 一段复盘记录
- 一项任务推进说明
- 一段战略讨论

# 输出物类型

可能输出以下一种或多种：

- `logs` 草稿
- `knowledge` 草稿或 patch 草稿
- `taskboard` 草稿
- `capabilities` 草稿
- `reputation` 草稿
- `strategy` 草稿
- 路由建议说明

# 分流判断

## 先判断是否至少写 `logs`

以下情况默认写 `logs`：

- 对话中出现了学习进展、学习阻塞、情绪波动、节奏变化
- 对话中出现了任务推进或未推进的原因
- 对话中出现了需要后续回顾的个人判断
- 对话中出现了对学习系统结构的修改讨论

## 何时追加 `knowledge`

当对话中出现以下内容时，考虑追加 `knowledge`：

- 新知识点
- 旧知识被重新归纳
- 某个概念、方法、路线被提炼得更清楚
- 某个正式知识库条目应该补充或修订

若已经明确要修改正式知识库，优先产出 `knowledge` patch draft，而不是直接写正式区。

## 何时追加 `taskboard`

当对话中出现以下内容时，考虑追加 `taskboard`：

- 新任务产生
- 任务优先级变化
- 任务状态变化
- 红榜 / 蓝榜 / 皇榜类事项发生变化

## 何时追加 `capabilities`

当对话中出现以下内容时，考虑追加 `capabilities`：

- 六维能力某一维有明显提升或退化迹象
- 出现可归因的能力表现证据
- 某项训练方法对能力成长有清晰影响

## 何时追加 `reputation`

当对话中出现以下内容时，考虑追加 `reputation`：

- 产生了可记分的行动或结果
- 有外部反馈或可量化表现
- 某项行为明显影响长期声望判断

## 何时追加 `strategy`

当对话中出现以下内容时，考虑追加 `strategy`：

- 阶段目标改变
- 路线选择改变
- 资源配置改变
- 对未来 1 到 12 周的策略有新判断

# 执行步骤

1. 读取原始对话。
2. 提取原始事实、原始表达、原始判断。
3. 先形成一份最小 `logs` 草稿判断：
   - 要不要写
   - 如果写，标题是什么
   - 核心内容是什么
4. 再扫描其他 5 个 route 是否有追加价值。
5. 对每个候选 route 给出：
   - `route`
   - `why`
   - `confidence`
   - `output_type`
6. 若只有一个高置信 route，则按单 route 处理。
7. 若多个 route 都成立，则按多输出物处理：
   - `logs` 先写
   - `knowledge / taskboard / capabilities / reputation / strategy` 再分别写对应草稿或 patch
8. 若涉及正式区建议，生成 routed patch draft，不越权写正式区。
9. 若结果明显复杂，交给 Task Dispatch 流程，不在单轮里强行完成全部写入。

# 推荐输出格式

推荐先形成中间结构，再执行写入：

```json
[
  {
    "route": "logs",
    "why": "本轮对话包含学习状态与推进阻塞",
    "confidence": 0.95,
    "output_type": "draft"
  },
  {
    "route": "knowledge",
    "why": "对记忆系统路线形成了可沉淀的新总结",
    "confidence": 0.82,
    "output_type": "patch"
  }
]
```

# 轻量执行建议

若只是单轮对话、输出物不多，可以直接：

1. 先给 route 判断
2. 再调用 `obsidian-bridge` routed 命令写草稿

若已经出现以下任一条件，应升级为复杂任务：

- 多 route 且多文件输出
- 需要 learning / curator / validator 协作
- 需要正式知识库 patch 审阅
- 需要结合历史学习数据做较重分析

# 与自迭代的关系

本 SOP 故意保持“软约束”：

- 它提供默认路径，但不禁止更优路径；
- 它鼓励 agent 在实践中总结更优的 route 组合；
- 如果新的 route 判断方式在多次实践中更稳定，应回写为 SOP 更新，而不是直接写死到不可变核心。

换句话说：

- 路由能力应通过实践迭代增强；
- SOP 是自迭代的收敛器；
- 不是提前把系统锁死的钉子。

# Runtime Learnings

<!-- OPENCLAW: SOP_EVOLUTION_START -->
本节由 SOP 自进化工作流维护。

- updated_at: 2026-03-13T05:00:14.456Z
- source_signal_count: 2
- min_occurrences: 2
- 若对话涉及学习进展、阻塞、节奏变化或值得回顾的判断，应先检查是否至少需要一条 `logs`；缺失时默认给 advisory，而不是直接 FAIL。
- route review 输入若条件允许，应附带 `source_summary`，方便后续比较、复盘与 SOP 收敛。
<!-- OPENCLAW: SOP_EVOLUTION_END -->

# 自检清单

- 是否至少判断过 `logs`？
- 是否把不确定内容保守地留在 `logs`，而不是硬分流？
- 是否把正式区改动降级为 patch draft？
- 是否把情绪分析写成事实了？
- 是否为了“看起来完整”而过度拆分 route？
- 若偏离本 SOP，是否给出理由？
