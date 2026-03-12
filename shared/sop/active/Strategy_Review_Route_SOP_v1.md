---
id: strategy_review_route_v1
status: active
entry_agent: main
preferred_model: deepseek/deepseek-reasoner
tool_mode: low_tool
---

# Goal
把战略讨论、复盘总结、决策推演这类“高推理、低工具依赖”的 branch 收敛到统一 route，避免它们和网页抓取、代码执行、文件改写混在同一个 branch 里。

# Trigger
当 branch 满足以下任一条件时，应优先考虑使用 `route=strategy_review`：
- 目标是做战略推演、长期规划、方案取舍
- 目标是做阶段复盘、复核失误、总结经验
- 目标是把历史数据与上下文综合成判断，而不是直接执行动作
- 产出物主要是结论、假设、风险图谱、决策建议，而不是代码或文件修改

# Required Shape
进入本 route 的 branch 至少应满足：
- `route = strategy_review`
- `tool_mode = low_tool`
- `model_hint = deepseek/deepseek-reasoner`
- `visibility = transparent_summary`

# Allowed Actions
strategy_review branch 允许：
- 汇总历史事实
- 组织战略问题框架
- 生成决策选项与比较
- 进行复盘、归因、教训提炼
- 输出建议、假设、风险、下一步思路

# Disallowed Actions
strategy_review branch 不允许直接承担以下动作：
- 网页抓取
- 文件落盘
- 正式写库
- 设备动作
- 系统执行
- 外发消息

若任务仍需要上述动作，必须新拆 `route=default` branch，再交给对应 owner。

# Output Contract
该 route 的输出至少应包含：
- 当前判断
- 核心依据
- 主要不确定性
- 风险点
- 建议下一步

# Validation Notes
validator 对该 route 的检查重点：
- 是否低工具
- 是否没有偷渡执行动作
- 是否把推测和事实混写
- 是否需要再拆出 executor / curator branch
