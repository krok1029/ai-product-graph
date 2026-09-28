# 整合策略

## 範圍與目前狀態

本文件同時保存已交付能力與後續整合約束，不代表每條流程目前可用。2026-09-28 核對：Plane 已有首次 create／reconciliation、明確 observation、drift history、sync plan／health／termination；主分支另已合併差異拒絕、採用為候選草稿與處置查詢（PR #107／#110／#109）。後續 update/status execution 與完整雙向狀態衝突處理尚未交付。GitHub 專用 adapter 已依同日使用者決策移出必做範圍，改採下述 `gh` 工作方式。其餘擴充依 [roadmap](08-roadmap.md) 選定範圍，本機持續開發與接手仍在驗證。

上述已合併能力不表示原本機 checkout 或既有 MCP process 已載入相同版本，詳見 [進度與版本核對](validation/2026-09-28-project-status.md)。差異已處置、候選已核准、實作已接受與外部同步成功是不同狀態；#94 父 Spec 仍待收尾，但 #95–#97 子票已關閉。

## 整合策略

MCP server 應該擁有 product context 和 graph data；外部系統則負責它們擅長的專門工作流。

本節與下方 External Work Item Ownership 保留已建模的 provider mapping／同步約束；其中 GitHub 多 repository 投影是條件式契約，僅在將來明確選擇建立該整合時適用，不是目前要實作的功能。Agent 直接使用 `gh` 不會自動建立 mapping、Sync Intent 或背景同步義務。

AI Product Graph 是 Ticket 規格、Result Acceptance 與 `done` completion semantics 的權威來源。External Work Item 是外部工具中的同步投影，保留自己的 external status；外部 closed／done 不得直接完成內部 Ticket。

內部 Ticket 已是 `done`、但外部 work item 被重新開啟時，adapter 必須建立 Sync Conflict，不得自動降低內部 Delivery Status。使用者將衝突分類為原 acceptance 無效、新增工作或外部誤操作後，系統才分別執行 Result Revocation、建立 Follow-up Ticket，或重新向外同步關閉。

Adapter 讀取外部 title、description、acceptance criteria 或其他 specification content 時，必須先保存 immutable External Work Item Snapshot。若內容與目前 approved Ticket Revision 不同，建立 Content Drift；外部內容不得直接覆蓋 canonical specification。後續採用外部修改時，先由 agent 判斷是否仍在既有 Spec 範圍內。涉及產品方向或能力變更時先依正常流程修訂 Brief／Milestone／Spec，再以最新 approved Ticket revision 為 base、有效的候選 Spec 來源鏈建立 Ticket Revision Draft，最後走正常 approval。server 驗證階層與版本，不判斷自然語言語意一致；詳細契約由 [Spec #94](https://github.com/krok1029/ai-product-graph/issues/94) 追蹤。

MVP External Export Policy 固定為 `manual_first_export`。核准 Ticket Revision 或 Implementation Target 不會自動在所有已連線 containers 建立 work items；使用者必須明確選擇 owner 與 External Container 執行首次 export。External Work Item mapping 成為 active 後，後續 approved revisions 與適用狀態變更才自動產生 Sync Intents。Project-level auto-export 延後評估。

首次 export 必須綁定 Ticket 的 current approved revision。Plane item 從該 revision 的 Ticket specification 投影；GitHub Issue 只能從該 revision 中 active 且 Repository 符合目標 GitHub container 的 Implementation Target 投影。Create Sync Intent 必須保存精確 `source_ticket_revision_id`。Draft 只能以 Markdown 預覽，不得建立 external item 或 mapping。

新的 Ticket Revision 核准後，adapter 只能在外部 version／ETag／updated timestamp 仍符合最後同步 snapshot 時，自動更新 adapter-managed fields。若外部內容已變或無法驗證，必須建立 Content Drift 並停止覆蓋。Labels、assignees、comments 等 external-only fields 不得修改；各 adapter contract 必須明確宣告 field ownership，未宣告欄位預設為 external-only。

一次內部 approval 可能需要同步 Plane 與多個 GitHub Issues。每個 External Work Item 必須建立獨立、可冪等重試的 Sync Attempt；外部系統不參與內部 transaction。部分同步失敗不得撤銷內部 approval，也不得回滾其他成功項目。Sync Health 由目前應同步 revision／event 與各 active mappings 的最新 attempts 衍生為 `current`、`pending` 或 `failed`。

需要外部副作用的 approval transaction 必須在同一 database transaction 寫入 durable Sync Intents，不得直接呼叫外部 API。Approval commit 後立即回傳成功與衍生的 `sync_health: pending`；同步程序再消費 intents、建立 Sync Attempts，並在服務重啟後繼續處理尚未成功的 intents。

同一 External Work Item 的 intents 必須依 per-mapping sequence 處理。若 Revision A 的 content-update intent 尚未開始，Revision B 的新 intent 可用 `supersedes_sync_intent_id` 指向 A，只送出 B；A 仍保留為歷史。A 已開始時，B 必須等待 A terminal 後再執行。Create、close、reopen 等 lifecycle intents 不得被 content coalescing 省略。Sync Health 只以最新 desired content 與所有必要 lifecycle intents 判定。

若 A 以 failed terminal 結束，B 可直接取代 A 的 content retry requirement，不必先重試過時內容；A 的 failure history 仍保留且不再影響最新 Sync Health。Failed lifecycle intent 則是 ordering barrier，後續 content 或 lifecycle intents 必須等待它成功或被明確解決。

Lifecycle intent 永久無法完成時，使用者只能選擇修復後重試、成功建立 replacement 後切換 mapping，或執行 Sync Mapping Termination。Termination 必須記錄 Decision、理由、actor 與時間，archive mapping 並停止其 pending intents，但不得把 failures 改寫為成功。只有 archived mapping 才從目前 Sync Health 排除。

第一個 integration target 不是 PM 工具，而是透過 MCP 連接 AI agent。

核心架構採用 DDD / ports & adapters。Server 內的 MCP、Plane 與未來 UI 等介面透過 adapter 連到 application layer；GitHub 目前由 client agent 使用 `gh` 操作，再經既有 MCP evidence／Result 入口保存資料，不讓 domain 依賴 GitHub API 或 CLI。

## MCP Clients

初始 use cases：

- 讓 AI agent 建立 projects 和 ideas。
- 讓 AI agent 生成 Product Briefs。
- 讓 AI agent 查詢 graph context。
- 讓 AI agent 生成 tickets。
- 讓 AI agent 建立 implementation briefs。

為什麼先做 MCP：

- 避免在 workflow 被證明前先做 UI。
- 給 agents 結構化、可 tool-call 的產品上下文。
- 讓知識圖譜可以被不同 AI clients 使用。
- 讓產品更貼近 ticket-to-code workflow。

## GitHub

2026-09-28 決策：專用 GitHub adapter 移出必做清單，不列入目前專案完成條件。先使用 `gh` 和既有證據流程，不另建 API 包裝或背景同步。

目前工作方式：

1. Agent 依使用者授權，以 `gh` 查詢或操作 Issue／PR、取得 PR metadata 與修改檔案；需要 commit 基線時查本機 Git。
2. 以已核准 Ticket／Implementation Brief 作為工作脈絡。將實際取得的 PR／commit／測試資料依既有 `pull_request`、`commit`、`test_execution` 或 `artifact` 契約，透過 `submit_work_result` 保存；已有證據可重用 IDs。
3. Result 引用 repository-matched evidence 並逐條說明驗收條件，藉由 Brief／Target 追溯至 Ticket 與規格版本。Issue URL 或輔助關聯只有在現有欄位與契約適用時保存，不捏造新的 evidence type 或把聊天文字當成正式 mapping。
4. PR 合併、Issue 關閉與內部 Result Acceptance 分開；仍由使用者接受產品交付。

`gh` 取得資料與 MCP 保存資料是兩個步驟，不是跨系統原子操作。遇到中斷先查外部現況及內部既有結果，避免盲目重建 Issue／PR 或重送 Result。這個工作方式不宣稱已提供自動 Issue mapping、changed files 的圖譜抽取、webhook 或持續狀態同步。

重新評估的條件：

- 先記錄真實使用中可重現的漏記、重複操作或同步需求及其影響。
- 優先補最小的工作流指引、欄位或查詢；只有既有 `gh` 加 MCP 方式無法合理解決時，才另定 adapter 範圍與驗收條件。
- 本 repository 本身仍以 GitHub Issues 追蹤 Specs／Tickets，遵循 [issue tracker 規則](agents/issue-tracker.md)；這項工程管理安排不需要產品先實作專用 adapter。

## Plane

初始 use cases：

- 匯出 product tickets 到 Plane work items。
- 保存 Plane work item 與內部 Ticket 的映射；Plane item 不直接綁定個別 Repository。
- 把 Plane work item 的一般進度同步為內部 Ticket 的 `planned`、`in_progress` 或 `blocked`，並保留 sync audit event。
- 把 Plane closed／done 保存為 External Work Item 狀態，但不得因此把內部 Ticket 標為 `done`。
- 內部 Ticket 經 Result Acceptance 成為 `done` 後，向 Plane 同步關閉 work item。
- 外部重新開啟已完成 Ticket 的 work item 時建立 Sync Conflict，等待使用者分類，不採 last-write-wins。
- 對已經需要 PM 功能的團隊，讓 Plane 作為專案管理 UI。

為什麼 Plane：

- Open-source project management product。
- 有現代 issue、module、cycle、page model。
- API 和 webhook integration surface 友善。
- 是原規劃選定並已有部分實作的 provider；後續優先順序由真實使用需求決定。

## External Work Item Ownership

- Product／project management work item 對應 Ticket。
- Repository-specific work item 對應單一 Implementation Target。
- Multi-repository Ticket 可同時具有一個 Plane work item，以及每個 target 各自的 GitHub Issue。
- External Work Item 必須透過 `traces_to` 關係連到正確層級，不得讓單一 repository issue 橫跨多個 Implementation Targets。
- External Container 由 provider、workspace／account identity 與 project／repository identity 組成。
- 同一 internal owner 在同一 External Container 最多只能有一個 active work item mapping；不同 providers 或 containers 可各自具有 mapping。
- 首次 export 必須由使用者明確觸發；active mapping 才 enrollment 後續自動同步。
- First export 只接受 current approved Ticket Revision；target-level export 必須驗證 target 屬於該 revision 且 repository identity 相符。
- Create Sync Intent 必須固定 source revision ID；draft export 只產生 Markdown preview，不得產生外部副作用。
- MVP 不提供 Project-level auto-export；連線 External Container 不代表匯出所有 approved owners。
- 外部項目被替換時，archive 舊 mapping 並建立新 mapping，不得原地改寫 external reference 或 internal owner。
- 每次 inbound content sync 保存 External Work Item Snapshot；內容差異建立 Content Drift，不採 last-write-wins。
- 採用外部內容只能建立新的 Ticket Revision Draft，且必須保留來源 snapshot 與 diff。
- Outbound content sync 必須以最後同步 snapshot 執行 optimistic concurrency check；失敗或無法驗證時停止並建立 Content Drift。
- Adapter 只能更新明確宣告的 managed fields；external-only 與未宣告欄位不得修改。
- 每個 External Work Item 使用獨立 Sync Attempt；retry 沿用 logical operation 的穩定 idempotency key。
- Approval 與每個 External Work Item 的 Sync Intent 必須在同一 internal transaction 提交；外部呼叫只在 commit 後執行。
- Pending intents 必須 durable，服務重啟後可恢復處理；不得只使用 in-memory queue。
- 同一 mapping 必須序列化 intents；未開始的 content update 可由新版 intent supersede，但 lifecycle intents 必須保序且不得省略。
- Terminal-failed content update 可由新版 intent 取代，不需先重試；failed lifecycle intent 必須阻擋後續 intents。
- Failed lifecycle intent 不得 silent skip；永久失敗必須由使用者修復、replace 或明確 terminate mapping。
- Mapping termination 必須 archive mapping、保留 intents／attempts／errors，且不得把 failure 偽裝為 success。
- Supersession 以新 intent 指向舊 intent 表示，不得刪除或改寫舊 intent。
- Partial failure 只重試失敗項目，不回滾 internal approval 或其他成功同步。
- Sync Health 必須衍生，不能手動設定，也不能改變內部 Review、Lifecycle 或 Delivery Status。

## Coding Agents

初始 use cases：

- 產生 implementation brief。
- 把選定 ticket handoff 給 Codex 或其他 coding agent。
- 接收 PR URL 和 test result summary。

MVP approach：

- 由 skills 使用 `get_work_context`、`start_implementation` 與 `submit_work_result` 完成本機交付；Markdown handoff 僅按需匯出。
- MCP server 不內建執行 coding agent。
- 之後再加更深的自動化與 PR 回寫。

## Future Integrations

- GitLab
- Linear
- Notion
- Slack
- Figma
- Sentry
- CI systems

## Integration Priority

1. 穩定目前 MCP／skills 的持續開發及跨對話接手。
2. 依實際使用證據補進度與變更查詢缺口。
3. 使用者選定具體 Plane 情境後，才安排後續同步交付。GitHub 先採 `gh` 與既有證據流程，只按已觀察的缺口評估最小補強。
4. 其他文件匯入或團隊回饋整合保持候選，不先安排實作。

新增外部 resolution／mutation tools 與新的 resolution resource 僅註冊於 full；保留現有 core resources，不藉此次規格重訂改動 core 的本機工作流。外部內容差異已處理、候選草稿核准、Result Acceptance 與外部同步成功須分開呈現；任何一項不自動推出其他項成立。
