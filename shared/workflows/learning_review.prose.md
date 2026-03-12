input source_text: "今天的原始记录"

agent learning:
  model: main
  prompt: "你负责根据 Learning_Review_SOP_v1.md 生成日志草稿和状态总结。"

agent validator:
  model: main
  prompt: "你负责检查输出是否遵循 SOP、是否越权、是否把推测写成事实。"

draft = session: learning
  prompt: """
  读取以下原始记录：
  {source_text}

  按 Learning_Review_SOP_v1.md 生成：
  1. 日志草稿
  2. 今日状态总结
  3. 最小下一步建议
  4. 可追加知识点列表
  """

checked = session: validator
  prompt: """
  审核以下输出：
  {draft}

  检查：
  - 是否改写了情绪原文
  - 是否把推测写成事实
  - 是否有越权正式写库倾向
  - 是否结构完整

  输出：
  - PASS / FAIL
  - 修正建议
  """

session "根据 validator 结果，给 main 一个最终可汇报版本。"
context: { draft, checked }