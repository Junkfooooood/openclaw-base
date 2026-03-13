---
name: morning-anchor-briefing
description: Create a Chinese two-host morning briefing on finance and AI using fresh, trustworthy sources or user-provided articles. Use when the user asks for a daily digest, anchor-style readout, or NotebookLM-like dialogue briefing.
metadata: { "openclaw": { "emoji": "🗞️" } }
---

# morning-anchor-briefing

Generate a concise morning digest in the style of two human hosts talking to each other.

## Default Scope

- Default topics: finance and AI.
- Default language: Chinese.
- Default delivery shape: text dialogue, not audio.
- If the user gives articles, summarize those first.
- If no articles are provided, use fresh and trustworthy sources.

## Source Rules

1. Prefer same-day or last-24-hour updates.
2. Prefer primary or widely trusted reporting.
3. Always mention concrete dates when timing matters.
4. Never pad with weak stories just to fill space.
5. If there are not enough good items, produce a short version instead of inventing.

## Output Shape

Return four short blocks:

1. `今日要点`
   - 2 to 4 bullets total.
   - Default balance: finance 1 to 2, AI 1 to 2.

2. `主播对谈`
   - Use `甲：` and `乙：`.
   - 6 to 10 turns.
   - Keep it natural, informed, and easy to read aloud.
   - The two hosts should help each other clarify, not perform empty banter.

3. `林今日可看`
   - 2 to 3 bullets.
   - Explain why these stories matter to Lin specifically.

4. `继续追踪`
   - 1 next step or watchpoint.

## Style Guardrails

- Sound like a sharp morning radio briefing, not a market-screaming show.
- Keep the dialogue compact.
- Avoid fake suspense, filler catchphrases, and exaggerated certainty.
- If there is uncertainty, say so plainly.
- The system may keep a slight literary polish, but clarity is more important than flourish.

## Scheduled Run Guidance

When this skill is triggered by a scheduled morning job:

- Keep the whole reply compact enough for one mobile message.
- If there is no high-value update, say so briefly and skip forced output.
- End with one line that helps Lin decide whether to dig deeper today.
