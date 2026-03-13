# OpenClaw Agent Quickstart

这份文档的目标不是介绍 OpenClaw 本体，而是让进入本仓库的 agent 快速适应这套已经集成好的：

- 人格系统
- 记忆系统
- 管理模式
- 工作流系统
- 安全协议
- 学习系统 / 远程连接 / 主动陪伴

适用对象：

- 新接入的 main agent
- 新开的 subagent
- 未来要维护这套系统的人

## 1. 先理解这套系统的“真相顺序”

本仓库里，信息优先级不是平铺的。

从高到低，应该这样理解：

1. `shared/policies/Immutable_Core.md`
2. `shared/policies/Core_Routing.md`
3. `shared/policies/Memory_Governance.md`
4. `shared/sop/active/*.md`
5. `workspace-main/MEMORY.md`
6. 各 workspace 的 `AGENTS.md / IDENTITY.md / SOUL.md / USER.md / TOOLS.md`
7. 运行态数据：
   - `shared/runtime/*`
   - `agents/*/sessions/*`
   - `cron/jobs.json`
   - `devices/*.json`

一句话：

- **Markdown 规则层和记忆层是“解释系统为什么这样工作”的地方**
- **runtime 目录是“系统刚刚做了什么”的地方**

## 2. 新 agent 的最小读入顺序

无论是 main 还是 subagent，建议都按这个顺序补上下文：

1. `workspace-main/IDENTITY.md`
2. `workspace-main/USER.md`
3. `workspace-main/SOUL.md`
4. `workspace-main/TOOLS.md`
5. `workspace-main/MEMORY.md`
6. `workspace-main/AGENTS.md`
7. `shared/policies/Core_Routing.md`
8. `shared/policies/Memory_Governance.md`
9. 与当前任务最相关的 SOP

若当前用户指令与现有规则 / SOP 冲突，优先再读：

- `shared/sop/active/Conflict_Resolution_SOP_v1.md`

如果是分支 owner，还要再读自己的 workspace：

- `workspace-learning/*`
- `workspace-curator/*`
- `workspace-executor/*`
- `workspace-validator/*`

## 3. 人格系统在哪里

这套人格不是写在一个文件里，而是分层放的：

- `workspace-main/IDENTITY.md`
  - 定义“我是谁”
- `workspace-main/SOUL.md`
  - 定义气质、价值观、表达风格、不可变边界
- `workspace-main/USER.md`
  - 定义“林是谁”、关系是什么、互动目标是什么
- `workspace-main/TOOLS.md`
  - 记录环境特有信息，例如设备名、SSH 主机、房间或硬件别名

修改建议：

- 改人格底色：优先改 `SOUL.md`
- 改身份设定：改 `IDENTITY.md`
- 改对用户关系与沟通方式：改 `USER.md`
- 改环境事实：改 `TOOLS.md`

## 4. 记忆系统在哪里

记忆系统有四层，规则在：

- `shared/policies/Memory_Governance.md`

四层对应实现分别是：

1. Markdown 真相层
   - `workspace-main/MEMORY.md`
   - `workspace-main/memory/YYYY-MM-DD.md`
2. Working Memory
   - Redis AMS
   - 本地镜像：`shared/runtime/memory/management/`
3. Semantic Memory
   - Mem0 + Qdrant
   - 桥接：`extensions/memory-bridge/index.mjs`
   - Python bridge：`shared/bridge/memory_bridge.py`
4. Graph Memory
   - Neo4j
   - compatibility shim：`shared/bridge/mem0_compat.py`

修改建议：

- 改“什么能进入长期记忆”：改 `Memory_Governance.md`
- 改桥接行为：改 `extensions/memory-bridge/index.mjs`
- 改 Mem0 / Neo4j 兼容层：改 `shared/bridge/*.py`
- 改长期确认事实：改 `workspace-main/MEMORY.md`

补充说明：

- `memory-bridge retrieve` 现在会返回 fused results，并区分 `truth / enhanced / runtime / pending`
- unresolved conflict 可以通过 `memory-bridge review-conflicts` 进入人工审查队列

## 5. 管理模式在哪里

管理模式的规则在：

- `shared/policies/Core_Routing.md`
- `shared/sop/active/Task_Dispatch_SOP_v1.md`
- `shared/sop/active/Branch_Handoff_SOP_v1.md`

管理模式的执行层在：

- `shared/runtime/management/task_dispatch_lib.mjs`
- `shared/runtime/management/branch_execution_lib.mjs`
- `shared/runtime/management/branch_validation_lib.mjs`
- `shared/runtime/management/management_memory_bridge.mjs`
- `shared/workflows/bin/task_dispatch_workflow.mjs`

管理模式的运行痕迹在：

- `shared/runtime/queue/`
- `shared/runtime/dispatch/`
- `shared/runtime/activity/`
- `shared/blackboard/hot/`
- `shared/blackboard/archive/`

判断规则：

- 简单任务：main 直接做
- 复杂任务：必须先出 Task Tree，再走黑板、handoff、execute、validate、finalize

## 6. 工作流系统在哪里

工作流系统分两层：

1. 规则层
   - `shared/sop/active/*.md`
   - `shared/policies/*.md`
2. 可执行层
   - `shared/workflows/bin/*.mjs`
   - `extensions/board-sync/index.mjs`
   - `extensions/policy-gate/index.mjs`

当前几个关键入口：

- 复杂任务调度：
  - `node shared/workflows/bin/task_dispatch_workflow.mjs ...`
- 设备与远程操作：
  - `node shared/workflows/bin/remote_ops_workflow.mjs ...`
- SOP 自进化：
  - `node shared/workflows/bin/sop_evolution_workflow.mjs ...`
- 黑板同步：
  - `openclaw board-sync ...`

补充规则：

- 当前指令若和 `Immutable Core` / `Core Routing` / Active SOP 冲突，不得静默处理，应走 `Conflict_Resolution_SOP_v1.md`

## 7. 安全协议在哪里

最关键的安全边界在这些文件：

- `shared/policies/Immutable_Core.md`
- `shared/policies/Core_Routing.md`
- `shared/policies/Memory_Governance.md`
- `shared/policies/Skill_Discovery_Safety.md`

必须记住：

- Markdown 真相层不能被语义层反向覆盖
- 正式知识库写入必须先 draft / patch，再审批
- 外发消息、安装依赖、设备动作、高风险命令都要先过审批或显式确认
- strategy_review route 不应该越权做网页 / 代码 / 文件 / 设备执行

## 8. 学习系统和 Obsidian 在哪里

学习系统的桥在：

- `extensions/obsidian-bridge/index.mjs`
- `shared/policies/Obsidian_Routing.md`

当前业务路由基线：

- `logs`
- `knowledge`
- `taskboard`
- `capabilities`
- `reputation`
- `strategy`

原则：

- Obsidian 是备份与同步层
- 默认 `draft-first`
- 不直接把它当 Markdown 真相层来源

## 9. 主动陪伴和通知在哪里

主动陪伴的规则在：

- `shared/sop/active/Proactive_Companion_SOP_v1.md`

运行层在：

- `cron/jobs.json`
- `openclaw.json` 的 `agents.defaults.heartbeat`
- Feishu channel 配置

如果要改消息节奏、消息类型、送达方式，主要看这三处。

## 10. 远程连接和设备同步在哪里

远程与设备同步当前在：

- `shared/runtime/remote_ops/`
- `shared/workflows/bin/remote_ops_workflow.mjs`

关键脚本：

- `shared/runtime/remote_ops/macbook_dashboard_tunnel.sh`
- `shared/runtime/remote_ops/macbook_push_snapshot.sh`

导出物在：

- `shared/runtime/remote_ops/export/`

如果要改：

- 设备快照逻辑：改 `remote_ops_lib.mjs`
- dashboard tunnel：改 `macbook_dashboard_tunnel.sh`
- MacBook 推送流程：改 `macbook_push_snapshot.sh`

## 11. 新 agent 最容易犯的错

1. 把 runtime 状态当成长期事实
2. 不读 `MEMORY.md` 就直接做复杂任务
3. 跳过 Task Tree，直接让多个 agent 并行乱跑
4. 把 Obsidian 当真相层
5. 把 strategy_review route 用成 executor
6. 没留痕就做正式写入或外发

## 12. 五分钟启动法

如果时间非常紧，只做这几步：

1. 读 `workspace-main/MEMORY.md`
2. 读 `workspace-main/AGENTS.md`
3. 读 `shared/policies/Core_Routing.md`
4. 读 `shared/policies/Memory_Governance.md`
5. 读与你任务最相关的 SOP
6. 去 `shared/runtime/*` 看当前运行状态

这样至少不会脱离这套系统的主轨。
