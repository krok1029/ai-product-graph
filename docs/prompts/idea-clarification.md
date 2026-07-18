# Prompt：Idea Clarification

## 目的

把模糊想法轉成結構化問題和 assumptions。

## Inputs

- Raw idea
- Existing notes
- Optional target user
- Optional constraints

## Output Format

```json
{
  "summary": "",
  "assumptions": [],
  "clarification_questions": [],
  "possible_positioning": [],
  "risks": []
}
```

## Rules

- 先問問題，再規劃 implementation。
- 清楚標記 assumptions。
- 優先使用具體 user scenarios。
- 這個階段不要生成 tickets。
