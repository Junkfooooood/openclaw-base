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
4. 按 branch owner 分发
5. branch 执行结果写入黑板
6. validator 验收
7. 若 FAIL，则回退原 owner 修复
8. 若同一 branch 达到最大重试次数，则熔断
9. main 汇总并向林汇报
10. 任务结束后归档黑板卡片

## Owner Routing
- 学习监督 / 日志整理 / 周冲刺 / 学习建议 → learning
- 知识提炼 / 六维能力增量 / 声望草稿 / 正式库 patch 草稿 → curator
- 网页 / 文件 / 自动化 / 代码 / 设备执行 → executor
- 格式校验 / 逻辑校验 / 风险校验 / SOP 边界校验 → validator

## 黑板规则
凡进入复杂任务流程，必须：
- 在 `shared/blackboard/hot/` 创建对应卡片
- 每次状态变化更新黑板
- 明确写出 branch 状态、当前输出、下一步、阻塞点
- 完成后移动到 `shared/blackboard/archive/`

## Task Tree 规则
Task Tree 必须至少包含：
- task_id
- title
- mode
- branch 列表
- 每个 branch 的 owner
- depends_on
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