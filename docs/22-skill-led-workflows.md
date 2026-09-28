# Skill 主導的本機工作流

預設 stdio server 使用 `core` profile：23 個 tools、原本的本機 resources，沒有舊 MCP prompts。Skills 負責釐清、生成、程式碼檢查、測試整理與对話；server 保存正式資料、核准紀錄及跨版本驗證。

## 安裝與啟動

```sh
node scripts/install-skills.mjs
pnpm build
pnpm start
```

Installer 將 repository 的 `skills/ai-product-plan`、`skills/ai-product-implement`、`skills/ai-product-accept` 連到 `$CODEX_HOME/skills`，未設定時使用 `~/.codex/skills`。不覆寫既有不同來源的同名 skill。搬移 repository 後需重新設定連結；初次安裝後在新對話使用，必要時重新啟動 client。

既有 MCP server 需重啟才能使用新 profile。若舊 client 使用已移出的 tools/prompts，明確設定：

```sh
AI_PRODUCT_GRAPH_MCP_PROFILE=full pnpm start
```

`full` 提供原本 39 個 tools、六個 prompts 及四個新入口，共 43 個 tools。未知 profile 會在開啟資料庫前失敗。Core 要求 Ticket 來自 Spec，並在 Brief approval 時同步圖譜根節點；full 保留未採用階層之舊專案的操作方式。啟動 profile 本身不遷移使用者規劃資料，也不關閉 active mapping 的 durable enrollment。

## 使用方式

- `$ai-product-plan`：從想法到已核准 tickets，直接在對話審查；不額外要求審查報告。
- `$ai-product-implement`：一次取得工作上下文，保存精簡計畫，沿用已授權的 Ticket 實作範圍開始工作。
- `$ai-product-accept`：一次提交證據與候選結果，取得使用者同意後保存 Acceptance。

一般操作筆記留在對話。Product Brief、Milestone、Spec、Ticket 與交付結果仍是正式可追溯資料；不再為每個步驟要求匯出 Markdown／JSON，只有使用者需要時才匯出。Milestone／Spec 保存與圖譜同步由 agent 自主處理，不另行核准；Product Brief、Ticket Revision 與結果接受保留對話決策。使用者明確授權實作 approved Ticket 後，同範圍技術計畫沿用這份授權，不另外等待一次同意；實質範圍、target 或風險改變仍須展示差異並取得缺少的同意。

## 規劃階層

`Product Brief → Milestone → Spec → Ticket`，詳見 [階層規劃與圖譜同步](23-planning-hierarchy.md)。Core 以 `save_planning_node` 取代 `create_graph_draft_batch`／`approve_graph_draft_batch`，所以 tools 從 24 降為 23。

先定階段成果與退出條件，再把每個 Milestone 拆成 Specs，最後按 Spec 產生可獨立驗證的垂直切片 Tickets。上游變更時保存新 Graph Revision 並顯示 stale descendants；下游需重新比對，不會自動改寫使用者既有內容。

## 新工具契約

### get_work_context

輸入 `{ ticket_id }`。一次讀取 approved Ticket Revision、目前 Product Brief Version、相關 graph，以及各 active target 的 Repository、approved Brief、accepted Result 與最新 active draft `pending_result`。這是同一 transaction 內的唯讀資料，不呼叫 provider；沒有 approved revision 時沿用既有 CONFLICT。

`delivery` 列出 `source_freshness`、`source_problem`、依賴及阻塞的 Ticket IDs、`next_action`，並逐 target 顯示 accepted／pending Result IDs、`criteria_without_evidence` 與 `unsatisfied_criterion_ids`。已有待接受結果時可以沿用，避免盲目重送。來源檢查與 handoff 共用規則，但不包含 repository commit／dirty state；實作前仍須呼叫 `start_implementation`。`get_graph_context.delivery` 提供相同的逐 Ticket 投影及全專案 active Tickets 摘要。

`next_action` 為 `approve_ticket`、`reconcile_sources`、`complete_dependencies`、`resolve_blocker`、`review_result`、`done` 或 `implement`。這是工作提示，不代表已取得使用者接受結果的授權，也不代替最終 command 驗證。舊接受結果與更正草稿可並存，此時顯示草稿的證據缺口與 `review_result`。

### start_implementation

輸入 `{ implementation_brief_id, current_repository_state: { commit_sha, dirty_state_fingerprint? } }`。

先保存具體計畫；使用者已明確授權實作該 approved Ticket 且計畫仍在相同範圍內時，直接呼叫，不另增確認回合。缺少實作授權或計畫實質擴大範圍、target、風險時，須先取得對具體差異的同意。授權由 client 依對話判斷，server 不推論自然語言同意。原子執行該 Brief 的 approval 與 handoff 驗證，回傳與原 handoff 相同的 structured context。已有 approved brief 則只重做 handoff 驗證。失敗不留下新 approval 或 archive 前版的副作用；STALE_HANDOFF 另保存 blocked audit。仍須使用真實 repository baseline，不能自行臆測；實作授權不等於 Result Acceptance。

### submit_work_result

輸入與原 Result submission 相同的 Brief identity、summary、supersedes ID、unfinished items，加上：

- `evidence`：`{ ref, evidence_type, idempotency_key, payload }[]`，預設空陣列。Project／Repository 由 Brief/Target 衍生。
- `observed_evidence_ids`：重用既有 evidence IDs，預設空陣列。
- `criterion_verdicts`：每项包含 `acceptance_criterion_id`、`verdict`（satisfied/unsatisfied）、`reason`、`evidence_refs`（本次 evidence 的 ref）與 `evidence_ids`（既有 IDs）；兩種 references 預設空陣列。

同一呼叫的 refs 必須非空且唯一。程式先保存 evidence、將 refs 換為 canonical IDs，再套用原 Result validation；任一失敗一起 rollback 新資料與 audit。Stale submission 沿用原規則保存 evidence 與 archived draft。每次成功呼叫建立一份新 Result，evidence keys 的冪等性不代表整個 Result submission 可以盲目重試。

回傳 `implementation_result`、`observed_evidence_ids`、`criterion_verdicts`。不接受 `waived`，不建立 Acceptance，不將 Ticket 改成 done；仍用 `accept_implementation_result` 保存使用者最後的接受決定。

## 精簡前後比較

`core-stdio-workflow.test.ts` 在兩個獨立暫存資料庫，回放輕運動計時器的共用控制情境。從同一 approved Ticket 開始，使用一份計畫、四份 evidence 與一次接受：

| 項目 | 原介面 | Core |
| --- | --- | --- |
| 預設 tools | 39 | 23 |
| MCP prompts | 6 | 0，改用 3 個 skills |
| 交付段 tool calls | 9 | 4 |
| 正式 Brief / evidence / Result / Acceptance | 1 / 4 / 1 / 1 | 1 / 4 / 1 / 1 |
| 計畫與結果的使用者決策 | 保留 | 同範圍計畫沿用實作授權；結果仍需接受 |

交付段由「create draft → approve → handoff → 四次 evidence → submit → accept」變成「create draft → start → submit_work_result → accept」。驗證兩邊都到 done、SQLite integrity 正常，重啟後 Acceptance receipt 可回放。

這是同類情境的協定／資料流程測試，並非對使用者現有 timer 重新實作，也不宣稱完成真實使用者時間或 agent 成本量測。人工介入次數及自然語言 skill 表現仍需下一次試用確認。
