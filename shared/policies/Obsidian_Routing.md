# Obsidian Vault Routing

## 目的

把学习系统的正式目录和 AI 草稿目录建立一一对应关系，保证：

- agent 不需要硬编码中文路径；
- 默认只写 `Drafts/AI`，不直接改正式区；
- 每种业务输出都能稳定落到固定板块；
- 后续审批通过后，patch 可以精确指向正式目标文件。

## 当前 live vault

- Vault 路径：`/Users/linqingxuan/Library/Mobile Documents/com~apple~CloudDocs/knowledge-system`
- Draft 根目录：`Drafts/AI`
- Patch 根目录：`Drafts/AI/_patches`
- 正式写入：默认关闭，`allowOfficialWrites = false`

## 路由规则

### `logs`

- 正式区根目录：`日志板块`
- 草稿区根目录：`Drafts/AI/Logs`
- 用途：对话整理、学习日志、周志、月志、随笔草稿

### `knowledge`

- 正式区根目录：`_知识库`
- 草稿区根目录：`Drafts/AI/Knowledge`
- 用途：知识库新增、知识归纳、课程笔记整理、概念卡片草稿

### `taskboard`

- 正式区根目录：`任务榜单记录`
- 草稿区根目录：`Drafts/AI/TaskBoard`
- 用途：任务拆解、任务看板变更、红榜蓝榜皇榜草稿

### `capabilities`

- 正式区根目录：`六维能力记录`
- 草稿区根目录：`Drafts/AI/Capabilities`
- 用途：六维能力评估、增量记录、维度变化说明

### `reputation`

- 正式区根目录：`声望榜单`
- 草稿区根目录：`Drafts/AI/Reputation`
- 用途：声望事件记录、声望变更草稿、评价依据整理

### `strategy`

- 正式区根目录：`_战略板块`
- 草稿区根目录：`Drafts/AI/Strategy`
- 用途：阶段战略研究、战略讨论、方向调整草稿

## 写入规则

1. 对话整理默认走 `logs`
2. 知识整理默认走 `knowledge`
3. 任务状态变动默认走 `taskboard`
4. 能力评估默认走 `capabilities`
5. 声望事件默认走 `reputation`
6. 战略讨论默认走 `strategy`
7. 任何正式区改动，先产出 routed patch，再由你审阅后决定是否提升

## CLI 用法

### 查看路由

```bash
openclaw obsidian-bridge routes
```

### 按业务路由写草稿

```bash
openclaw obsidian-bridge write-routed-draft \
  --route logs \
  --relative-path '2026-03-12/学习状态草稿.md' \
  --text '# 学习状态草稿'
```

### 按业务路由准备正式 patch

```bash
openclaw obsidian-bridge prepare-routed-patch \
  --route knowledge \
  --target-relative-path '3 计算机知识/AI/记忆系统.md' \
  --summary '补充记忆系统路线' \
  --patch-body '## Proposed update'
```
