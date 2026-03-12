| 需要掌握的能力 | 首选实现方式 | 第二选择 | 备注 |
|---|---|---|---|
| 主动与我沟通 | HEARTBEAT + Cron + Feishu | ntfy | 不依赖社区 skill |
| 学习日志整理 | Learning_Review_SOP + learning agent | OpenProse workflow | 先草稿后入库 |
| 知识归纳整理 | curator agent + draft-first | Obsidian bridge | 正式写入需审批 |
| 周冲刺生成 | cron + learning agent | OpenProse | 每周固定触发 |
| 声望自动结算 | curator agent + local plugin | workflow | 先出草稿公式结果 |
| 复杂任务拆解 | Task_Dispatch_SOP + Lobster + llm-task | OpenProse | 先 Task Tree |
| 黑板维护 | board-sync plugin | markdown file tool | 必须统一格式 |
| 长短期记忆 | memory-core + memory-bridge | @mem0/openclaw-mem0（过渡） | Markdown 是源真相层 |
| Obsidian 读写 | obsidian-bridge plugin | 参考 mcp-obsidian / obsidian-mcp-server | 正式库默认只读 |
| 设备通知 | Feishu / ntfy | BlueBubbles | iPhone 先不做关键 node |
| 远程设备执行 | nodes + exec approvals | macOS remote over SSH | 默认 deny，按需放行 |
| 新 skill 搜索 | ClawHub 只做发现 | 本地审查后镜像安装 | 禁止自动安装 |