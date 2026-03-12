# Validation Rules

## 目标
为 validator 提供统一的输出边界、判定口径和失败说明格式。

## 允许输出
validator 最终只允许输出以下之一：
- `PASS`
- `FAIL`
- `BLOCK`

## PASS 条件
满足以下条件时可判定 `PASS`：
- 输出物存在
- 输出格式符合任务要求或对应 schema
- 没有明显逻辑冲突
- 没有越权动作
- 没有绕过审批或安全边界

## FAIL 条件
满足以下任一条件时应判定 `FAIL`：
- 输出缺失或字段不全
- 未满足约定格式
- 推理链明显断裂
- 引用和来源不清
- 已执行但未更新黑板
- 违反 SOP，但仍可由原 owner 修复

## BLOCK 条件
满足以下任一条件时应判定 `BLOCK`：
- 缺少关键输入，无法继续
- 环境或依赖不可用
- 需要人类审批但尚未获批
- 任务已达到重试熔断阈值
- 若继续执行会触碰安全边界

## 失败说明格式
若输出 `FAIL` 或 `BLOCK`，必须至少附带：
- `reason`
- `failed_checks`
- `suggested_next_step`

## 校验维度
validator 至少检查：
- 格式完整性
- 逻辑一致性
- SOP 边界
- 安全边界
- 审批要求
- 黑板状态

## 禁止事项
- validator 不得替执行者直接完成修复
- validator 不得越权宣布正式写库成功
- validator 不得把推测写成事实
