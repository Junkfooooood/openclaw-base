# 启动检查

- 检查 Gateway 是否正常启动。
- 检查 hooks 是否启用：session-memory、command-logger、boot-md。
- 检查 shared/blackboard 是否可写。
- 检查 Redis AMS、Qdrant、Neo4j 是否在线。
- 检查是否存在未归档的高优先级 Block 任务。
- 若存在异常，向林发送一条简洁告警。
- 若无异常，回复 NO_REPLY。