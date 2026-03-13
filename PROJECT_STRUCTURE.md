# .openclaw Project Structure

这份文档用于回答三个问题：

1. `.openclaw` 里每个功能板块在哪
2. 它是通过什么实现的
3. 如果要改，你应该改哪一层

## 1. 顶层结构总览

### `workspace-main/`

作用：

- main agent 的人格、用户关系、主记忆、工作规则

关键文件：

- `workspace-main/IDENTITY.md`
- `workspace-main/SOUL.md`
- `workspace-main/USER.md`
- `workspace-main/TOOLS.md`
- `workspace-main/MEMORY.md`
- `workspace-main/AGENTS.md`
- `workspace-main/BOOT.md`
- `workspace-main/BOOTSTRAP.md`

你要改什么就改哪里：

- 人格设定：`IDENTITY.md` / `SOUL.md`
- 用户关系：`USER.md`
- 环境事实：`TOOLS.md`
- 长期确认记忆：`MEMORY.md`
- main 的工作纪律：`AGENTS.md`
- 启动自检：`BOOT.md`
- 会话接管强制校准：`BOOTSTRAP.md`

### `workspace-learning/` `workspace-curator/` `workspace-executor/` `workspace-validator/`

作用：

- 四个分工 agent 的独立工作区人格与职责说明

你要改：

- 某个 agent 的职责边界：改对应 workspace 的 `AGENTS.md`
- 某个 agent 的人格风格：改对应 workspace 的 `IDENTITY.md / SOUL.md`

### `agents/`

作用：

- 各 agent 的运行态状态、会话和模型配置镜像

典型内容：

- `agents/<agent>/agent/auth-profiles.json`
- `agents/<agent>/agent/models.json`
- `agents/<agent>/sessions/*.jsonl`

注意：

- 这里主要是运行态，不是长期规则层
- 看运行轨迹可以读它，改系统规则不要优先改它

### `skills/`

作用：

- OpenClaw 可复用能力模块，也就是系统里的“五行物”

当前重点内容：

- `morning-anchor-briefing/`
  - 金融与 AI 双主播晨报能力
- 其他已 ready 的 skill
  - 由 `openclaw skills list` 盘点

你要改：

- 某个 skill 的提示词、流程和边界：改对应目录下的 `SKILL.md`
- 新增 skill：在 `skills/` 下新建目录，并补 `SKILL.md`

### `media/`

作用：

- 可被 OpenClaw 消息通道直接读取的本地媒体目录

当前重点内容：

- `media/audio_briefing/`
  - 晨报音频外发前的本地落盘位置

注意：

- 这里是发送介质层，不是长期知识层
- 运行样本默认不入库，只保留占位目录

## 2. 配置层

### `openclaw.json`

作用：

- 当前机器的真实运行配置

内容通常包括：

- gateway
- channels
- models
- plugins
- heartbeat

你要改：

- 本机真实端口、token、provider、插件开关、heartbeat、channel

注意：

- 这是 live config
- 含密钥和运行态信息
- 不作为团队共享真相层

### `openclaw.template.json`

作用：

- 版本化的脱敏模板配置

你要改：

- 希望未来换机器也能复现的默认结构
- provider 模板
- plugin 模板
- heartbeat 模板

原则：

- 先改 live config 做验证
- 验证稳定后，再把可复现部分沉到 template

补充：

- `hooks.internal.entries.bootstrap-extra-files` 现用于会话 bootstrap 时强制注入人格/记忆文件

## 3. 扩展层

### `extensions/memory-bridge/`

作用：

- 把 Markdown / AMS / Mem0 / Neo4j 串起来

实现：

- `index.mjs`
- `openclaw.plugin.json`

你要改：

- 记忆桥的 CLI / tool 行为
- staged / commit / retrieve 逻辑
- fused retrieval / conflict review queue
- 插件 schema

### `extensions/obsidian-bridge/`

作用：

- 把学习系统 Vault 接到 OpenClaw

实现：

- `index.mjs`
- `openclaw.plugin.json`

你要改：

- 路由写入逻辑
- draft / patch 行为
- route alias
- Obsidian 工具接口

### `extensions/board-sync/`

作用：

- 复杂任务黑板卡的创建、更新、归档

实现：

- `index.mjs`

你要改：

- 黑板卡的 init / update / finalize 行为

### `extensions/policy-gate/`

作用：

- Task Tree 校验
- validator / approval
- 管理模式的结构化规则执行

实现：

- `index.mjs`

你要改：

- 验收规则
- route / task tree 结构校验
- 审批前置逻辑

## 4. 共享规则层

### `shared/policies/`

作用：

- 系统长期规则和不可变边界

关键文件：

- `Immutable_Core.md`
- `Core_Routing.md`
- `Memory_Governance.md`
- `Obsidian_Routing.md`
- `Skill_Discovery_Safety.md`

你要改：

- 长期制度、边界、路由规则、安全规则

注意：

- 这是规则层，不是执行实现层

### `shared/sop/active/`

作用：

- 当前生效 SOP

关键文件：

- `Task_Dispatch_SOP_v1.md`
- `Branch_Handoff_SOP_v1.md`
- `Conflict_Resolution_SOP_v1.md`
- `Conversation_To_Routes_SOP_v1.md`
- `Proactive_Companion_SOP_v1.md`
- `Strategy_Review_Route_SOP_v1.md`
- `Route_Review_Loop_SOP_v1.md`

你要改：

- 具体操作流程
- 谁先做什么
- 自检规则
- runtime learnings 托管区

区分：

- `policies` 说的是“边界”
- `sop` 说的是“步骤”

### `shared/schemas/`

作用：

- 结构化输入输出 schema

你要改：

- Task Tree 的字段定义
- validator 期望结构

## 5. 共享执行层

### `shared/runtime/management/`

作用：

- 管理模式状态机的核心实现

关键文件：

- `task_dispatch_lib.mjs`
- `branch_execution_lib.mjs`
- `branch_validation_lib.mjs`
- `management_memory_bridge.mjs`
- `openclaw_session_lib.mjs`

你要改：

- 复杂任务状态推进
- branch 状态推导
- validator 链路
- 管理记忆同步

### `shared/runtime/sop_evolution/`

作用：

- SOP 自进化的运行时执行层

关键产物：

- `signals/`
- `reports/`
- `drafts/`
- `shadow_tests/`
- `activations/`

你要改：

- signal 聚合口径
- runtime learnings 草案生成逻辑
- shadow test / activation 规则

### `shared/workflows/bin/`

作用：

- 可直接运行的 workflow CLI 入口

关键文件：

- `task_dispatch_workflow.mjs`
- `remote_ops_workflow.mjs`
- `sop_evolution_workflow.mjs`

你要改：

- 把多个 runtime 动作组合成一条真正可执行命令

### `shared/runtime/`

作用：

- 运行态数据与产物

主要子目录：

- `queue/`
  - Task Tree 快照
- `dispatch/`
  - branch packet / result / validation
- `activity/`
  - branch 生命周期 jsonl
- `memory/`
  - 管理记忆镜像
- `audio_briefing/`
  - 双主播晨报稿件 inbox、渲染中间产物生成入口
- `git_sync/`
  - GitHub `openclaw-base` 的同步脚本与模板
- `remote_ops/`
  - 远程设备同步、dashboard 导出、学习看板导出
- `sop_evolution/`
  - SOP signal / report / draft / shadow test / activation 运行产物
- `smoke/`
  - smoke test 产物

你要改：

- 一般不直接改这里的产物
- 需要改行为时，应改生成这些产物的上游实现

## 6. Blackboard 与知识沉淀

### `shared/blackboard/hot/`

作用：

- 当前活跃任务卡 / 摘要卡

### `shared/blackboard/archive/`

作用：

- 完整归档卡

你要改：

- 改卡片格式或归档逻辑：去改 `board-sync` 或 `task_dispatch_lib`
- 不要把这里当主逻辑实现层

### `chatlog/`

作用：

- 每轮对话留档

你要改：

- 一般不改旧记录
- 每轮结束追加新记录

## 7. 记忆桥与 Python 兼容层

### `shared/bridge/`

作用：

- Python 侧的记忆桥、兼容层

关键文件：

- `memory_bridge.py`
- `mem0_compat.py`

你要改：

- Mem0 / Neo4j / Qdrant 编排
- Python 侧兼容逻辑

## 8. 远程连接 / 设备 / 主动陪伴

### `shared/runtime/remote_ops/`

作用：

- MacBook <-> Mac mini 远程连接辅助
- 浏览器 / app 使用数据快照
- workflow HTML / Markdown / ICS 导出

关键文件：

- `remote_ops_lib.mjs`
- `macbook_dashboard_tunnel.sh`
- `macbook_push_snapshot.sh`
- `README.md`

### `shared/runtime/audio_briefing/`

作用：

- 晨间双主播读报的音频执行层

关键文件：

- `host_dialogue_audio.mjs`
- `inbox/`

你要改：

- 双主播音色与合成参数
- 稿件格式要求
- 渲染后发送逻辑

### `shared/runtime/git_sync/`

作用：

- 重大文档改动即时同步与每日 GitHub 兜底同步

关键文件：

- `openclaw_git_sync.sh`
- `com.linqingxuan.openclaw-git.plist`

### `devices/`

作用：

- OpenClaw 设备配对状态

关键文件：

- `paired.json`
- `pending.json`

### `cron/jobs.json`

作用：

- 主动陪伴 / 学习监督的定时任务

当前重点 job：

- `openclaw-daily-git-sync`
  - 每天 `00:00` 自动同步 GitHub `openclaw-base`
- `morning-anchor-briefing`
  - 每天 `08:30` 生成并发送晨间双主播音频读报

### `feishu/` 与 `channels`

作用：

- 外部通知与 direct session 送达

## 9. 如果你要改某类功能，应该从哪开始

### 改人格 / 关系 /风格

先看：

- `workspace-main/IDENTITY.md`
- `workspace-main/SOUL.md`
- `workspace-main/USER.md`

### 改长期记忆规则

先看：

- `shared/policies/Memory_Governance.md`
- `workspace-main/MEMORY.md`
- `extensions/memory-bridge/index.mjs`

### 改复杂任务管理模式

先看：

- `shared/policies/Core_Routing.md`
- `shared/sop/active/Task_Dispatch_SOP_v1.md`
- `shared/runtime/management/*.mjs`
- `shared/workflows/bin/task_dispatch_workflow.mjs`

### 改学习系统写入 / 路由

先看：

- `shared/policies/Obsidian_Routing.md`
- `extensions/obsidian-bridge/index.mjs`

### 改 agent 验收 / 安全边界

先看：

- `extensions/policy-gate/index.mjs`
- `shared/policies/*.md`
- `shared/sop/active/*.md`

### 改远程访问 / MacBook 数据接入 / dashboard 导出

先看：

- `shared/runtime/remote_ops/remote_ops_lib.mjs`
- `shared/workflows/bin/remote_ops_workflow.mjs`

### 改主动陪伴和通知节奏

先看：

- `shared/sop/active/Proactive_Companion_SOP_v1.md`
- `cron/jobs.json`
- `openclaw.json` heartbeat 配置

### 改晨报音频生成与外发

先看：

- `skills/morning-anchor-briefing/SKILL.md`
- `shared/runtime/audio_briefing/host_dialogue_audio.mjs`
- `cron/jobs.json`

### 改 GitHub 自动同步规则

先看：

- `shared/runtime/git_sync/openclaw_git_sync.sh`
- `cron/jobs.json`
- `workspace-main/MEMORY.md`

## 10. 修改原则

改任何功能时，先判断你是在改哪一层：

1. 规则层
2. SOP 层
3. 执行层
4. 运行态产物层

大多数情况下：

- **应该改 1 / 2 / 3**
- **不应该直接改 4**

如果你直接改 runtime 产物，通常只能修当前一轮，不能真正改变系统行为。
