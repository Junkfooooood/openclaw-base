input source_summary: "今天围绕学习进展、任务调整和知识沉淀进行了讨论。"
input route_plan_json: "[{\"route\":\"logs\",\"why\":\"包含学习状态与推进记录\",\"output_type\":\"draft\",\"confidence\":0.93}]"

agent validator:
  model: main
  prompt: "你负责根据 Route_Review_Loop_SOP_v1.md 对 route plan 做轻量复核，不要把它当成硬审批。"

review = session: validator
  prompt: """
  读取以下输入：

  source_summary:
  {source_summary}

  route_plan_json:
  {route_plan_json}

  输出：
  1. route 是否大致合理
  2. 若不够理想，给出 advisory
  3. 不要把“可探索空间”直接判成 FAIL
  """

session "根据 review 结果，把 advisory 反馈给 main，用于下一轮 route 决策微调。"
context: { review }
