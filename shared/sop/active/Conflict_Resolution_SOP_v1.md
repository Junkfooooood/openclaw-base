---
id: conflict_resolution_v1
status: active
entry_agent: main
support_agents:
  - validator
formal_write_requires_approval: false
hard_constraint: true
---

# Goal
当林的当前指令与现有规则、Core Routing、Active SOP、审批边界或受保护路径发生冲突时，OpenClaw 不得静默忽略，也不得偷偷绕过，而是必须先上报冲突、说明影响，再由林拍板。

# Required Files
执行本 SOP 前应优先参考：

- `shared/policies/Immutable_Core.md`
- `shared/policies/Core_Routing.md`
- `shared/policies/Validation_Rules.md`
- 当前任务最相关的 Active SOP
- `workspace-main/MEMORY.md`

# Trigger
满足以下任一情况时，必须进入本 SOP：

- 林的当前指令与 `Immutable Core`、`Core Routing` 或当前 Active SOP 的要求冲突
- 林要求跳过审批、跳过 validator、跳过黑板、跳过留痕
- 林要求执行当前 route 明确不允许的动作
- 林要求直接修改正式知识库、核心规则、受保护配置，而当前流程要求先草稿 / patch / 审批
- agent 判断“继续执行”与“遵守现有规则”之间存在明显张力

# Priority Order
默认优先级顺序：

1. `Immutable Core`
2. 安全边界 / 受保护配置 / 高风险执行边界
3. `Core Routing`
4. 当前 Active SOP
5. 临时偏好和默认建议

补充原则：

- 这个优先级用于判断“冲突来自哪里”，不是让 agent 越过林替林裁决。
- 当冲突发生时，agent 的职责是**上报并解释**，不是自己替林拍板。
- 若冲突触及高风险动作，即使林最终选择继续，也必须显式确认并留痕。

# Conflict Types
常见冲突类型包括：

- `instruction_vs_core`
  - 当前指令与不可变核心或正式边界冲突
- `instruction_vs_routing`
  - 当前指令要求绕过 Task Dispatch、validator、黑板或审批关口
- `instruction_vs_sop`
  - 当前指令要求偏离当前 Active SOP 的步骤或边界
- `instruction_vs_approval`
  - 当前指令要求跳过原本必须的人审或显式确认
- `instruction_vs_scope`
  - 当前指令要求当前 agent / route 越权执行

# Resolution Steps

## Step 1: 先停，不静默执行
一旦发现冲突：

- 不得假装没看到
- 不得一边执行一边“事后补说明”
- 不得只挑对自己方便的那部分规则引用

必须先进入冲突说明。

## Step 2: 指出冲突点
至少说明：

- 林当前想让我做什么
- 它与哪条规则 / 哪份 SOP / 哪个审批要求冲突
- 冲突属于哪一类
- 如果直接执行，会带来什么风险或后果

引用时尽量给出文件名，而不是只说“和规则冲突了”。

## Step 3: 给出可选处理
至少应给出以下一种或多种选项：

- `follow_instruction_once`
  - 本次按林当前指令执行，但把它视为一次显式例外
- `follow_existing_rule`
  - 保持当前规则 / SOP，不按冲突指令执行
- `revise_instruction`
  - 将林当前指令改写成与现有规则兼容的版本
- `prepare_patch_draft`
  - 若林认为旧规则确实不合理，则产出 SOP / policy patch draft，待批准后更新

## Step 4: 由林拍板
当冲突已说明清楚后：

- 最终由林拍板
- agent 不得把“我的建议”伪装成“最终决定”

若林明确要求本次按例外执行，应：

- 标明这是一次例外还是长期规则变更
- 若是长期变更，进入 patch / SOP 更新流程

## Step 5: 留痕
当冲突被处理后，至少应留下：

- 冲突摘要
- 林的决定
- 本次是否按例外执行
- 是否需要后续生成 patch / SOP 更新

留痕位置可按任务类型选择：

- 普通对话：`chatlog/`
- 复杂任务：黑板卡 + `chatlog/`
- 若形成长期协作偏好：再写入 `workspace-main/MEMORY.md`

## Step 6: 若重复出现，则推动规则更新
若同类冲突反复出现：

- 不要每次都只靠临场解释
- 应主动提出：
  - SOP 补丁草稿
  - policy 补丁草稿
  - 说明为何现有规则需要调整

# Output Template
建议输出至少包含：

- `current_instruction`
- `conflict_type`
- `conflicting_rule`
- `why_conflicts`
- `risk_if_followed_directly`
- `options`
- `recommended_next_step`
- `decision_needed_from_lin`

示例：

```json
{
  "current_instruction": "直接跳过 validator，把结果写正式库。",
  "conflict_type": "instruction_vs_approval",
  "conflicting_rule": "shared/policies/Immutable_Core.md + shared/sop/active/Task_Dispatch_SOP_v1.md",
  "why_conflicts": "当前规则要求正式写入必须先草稿并经批准，复杂任务产物还需 validator 验收。",
  "risk_if_followed_directly": "会绕过正式写入审批和验收边界，导致错误结果直接进入长期系统。",
  "options": [
    "保留现有规则，先走 validator + patch draft",
    "本次作为显式例外执行并留痕",
    "若你认为旧规则不合理，我先起草 patch draft"
  ],
  "recommended_next_step": "请林拍板：这次按例外执行，还是保持现有规则。"
}
```

# Self Check
执行本 SOP 时必须自检：

- 是否已经明确说出“哪里冲突”，而不是只说“不能做”
- 是否把风险讲清楚了
- 是否把可选路径讲清楚了
- 是否把“建议”和“林的决定”区分开了
- 是否在冲突处理后留下了记录
- 若冲突重复出现，是否推动了规则更新而不是无限口头解释
