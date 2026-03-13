# Memory Governance

## 总原则
记忆系统分为四层：
1. Markdown Memory
2. Working Memory
3. Semantic Memory
4. Graph Memory

其中 Markdown Memory 是最终真相层，其他层为增强层，不得反向覆盖真相层。

---

## Layer 1: Markdown Memory
位置：
- `workspace-main/MEMORY.md`
- `workspace-main/memory/YYYY-MM-DD.md`

职责：
- 保存长期确认事实
- 保存长期协作偏好
- 保存经过确认的重要关系与规则
- 保存可被人工审查和版本管理的记忆

写入规则：
- 只有 main / curator 可提交
- 所有正式写入必须经过审阅或明确规则批准
- 不得把推测写成事实

---

## Layer 2: Working Memory
后端：
- Redis AMS

职责：
- 保存当前会话短期上下文
- 保存最近任务状态
- 保存短期摘要
- 为主动陪伴与连续对话提供近时记忆

写入规则：
- 自动写入允许
- 不视为最终真相
- 可被淘汰、压缩和总结

---

## Layer 3: Semantic Memory
后端：
- Mem0 + Qdrant

职责：
- 保存长期可检索偏好
- 保存经验模式
- 保存稳定的语义知识片段
- 为召回增强提供向量检索

写入规则：
- 允许自动提取
- 高风险事实应先进入 staged memory
- 不得直接覆盖 Markdown 真相层

---

## Layer 4: Graph Memory
后端：
- Neo4j

职责：
- 保存人与人、任务与任务、知识与知识之间的结构关系
- 保存系统板块之间的连接关系
- 为复杂推理和关系检索提供支持

写入规则：
- 只写关系，不写未经确认的事实判断
- 关系更新优先通过 compatibility shim / memory-bridge
- 不直接作为最终事实来源

---

## Bridge 执行规则
- `memory-bridge` 统一负责 Markdown、AMS、Mem0、Neo4j 的编排，不让各层直接互相覆盖
- Mem0 与 Neo4j 的接入必须通过 compatibility shim，避免依赖版本错位导致 bearer/token 误传
- 默认先写 staged 记录；只有无冲突且命中自动同步阈值时，才允许同步到 semantic / graph
- 一旦发现 Markdown 与 semantic / graph 结果相近但不一致，必须进入 `shared/runtime/memory/conflicts/`
- 正式 commit 后，才允许把批准事实回填到 semantic / graph 作为增强层副本
- retrieve 默认应返回 fused results，并明确区分 `truth / enhanced / runtime / pending` 信任层级
- unresolved conflict 命中检索时，必须给出 advisory，提醒优先参考 Markdown truth
- conflict record 应支持 review queue，而不是只把 JSON 丢在目录里无人处理

## 管理记忆补充规则
- Task Tree、branch packet、activity log、branch result、search trace 属于“管理过程记忆”
- 管理过程记忆默认进入 AMS working memory，并采用 7 天 retention
- 管理过程记忆的本地镜像默认写入 `shared/runtime/memory/management/`
- `strategy_review` branch 的高价值结果允许额外同步到 semantic / graph memory
- search trace 默认只进入 working memory，避免把低价值检索噪声灌入长期语义层
- 管理过程记忆不得直接写入 Markdown 真相层，除非后续被人工审阅并上升为正式事实

---

## 记忆写入级别
### Level A：直接进入 Working Memory
适用：
- 当日任务状态
- 临时情绪状态
- 最近一轮对话摘要

### Level B：进入 Semantic Memory
适用：
- 长期偏好
- 重复出现的习惯
- 可检索经验知识

### Level C：进入 Graph Memory
适用：
- 板块关系
- 任务依赖关系
- 人物与知识结构关系

### Level D：进入 Markdown 真相层
适用：
- 已确认长期事实
- 核心偏好
- 核心关系设定
- 正式系统规则

---

## 冲突处理
若新记忆与旧记忆冲突：
1. 不得直接覆盖 Markdown 真相层
2. 进入 staged / conflict 队列
3. 由 main 或 curator 判断：
   - keep old
   - replace
   - merge
   - defer to human

---

## 禁止事项
- 不得把推测写入 Markdown 真相层
- 不得把 Working Memory 当作最终事实
- 不得让 Semantic Memory 自动覆盖正式知识库
- 不得在未确认时把关系推断写成确定关系
