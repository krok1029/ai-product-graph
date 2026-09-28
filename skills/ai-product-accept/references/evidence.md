# Evidence payload

以下僅列常用的 test execution 與 artifact。所有值必須來自實際觀察；範例文字不能直接當證據。Repository 與 Project 由 Implementation Brief 衍生，不需要重複提交。

## test_execution

必填欄位：`schema_version: 1`、`command`、`status`（`passed`、`failed`、`errored` 或 `cancelled`）、`exit_code`（整數或 null）、`started_at`、`completed_at`（UTC 毫秒格式，例如 `2026-09-27T00:00:00.000Z`）。可選 `summary`、`log_artifact_ref`。時間須有序，passed 的 exit code 須為 0，failed 須非 0。

```json
{
  "ref": "controls-tests",
  "evidence_type": "test_execution",
  "idempotency_key": "<本次實際測試的穩定識別>",
  "payload": {
    "schema_version": 1,
    "command": "<實際 command>",
    "status": "passed",
    "exit_code": 0,
    "started_at": "<實際開始時間>",
    "completed_at": "<實際完成時間>"
  }
}
```

對應 criterion 使用 `evidence_refs: ["controls-tests"]`。不要把 waived、criterion verdict 或 client-computed hash 放進 payload。

## artifact

必填 `schema_version: 1`、`artifact_type`、`name`、`uri`、`content_hash`、`created_at`（UTC 毫秒格式，例如 `2026-09-27T00:00:00.000Z`），可選 `description`。只有確實存在且與本 target repository 相關的檔案或 URL 才能引用。

提交失敗時整筆新 evidence／Result 一起 rollback；格式有效但來源 stale 時仍保存 evidence 與 archived Result。既有資料不被改寫。
