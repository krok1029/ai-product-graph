# Prompt：Product Brief Generation

## 目的

把釐清後的 idea context 轉成結構化 Product Brief。

## Inputs

- Raw idea
- Clarification answers
- Assumptions
- Open questions

## Output Format

Canonical output 必須是 structured JSON。Markdown 可以由 JSON render 出來，但不是 source of truth。

```json
{
  "product_goal": "",
  "target_users": [],
  "pain_points": [],
  "core_workflows": [],
  "mvp_scope": [],
  "non_goals": [],
  "success_metrics": [],
  "risks": [],
  "open_questions": []
}
```

## Markdown Rendering Sections

- Product Goal
- Target Users
- Pain Points
- Core Workflows
- MVP Scope
- Non-Goals
- Success Metrics
- Risks
- Open Questions

## Rules

- MVP 範圍要窄。
- 不要隱藏不確定性。
- 區分 product goals 和 features。
- 必須包含 non-goals。
