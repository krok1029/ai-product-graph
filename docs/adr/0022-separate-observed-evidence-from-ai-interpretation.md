# ADR 0022：分離 Observed Evidence 與 AI Interpretation

## Status

Accepted

## Context

ADR 0007 規定 AI 生成內容採用 draft first。Implementation Result 同時可能包含兩種性質不同的資料：commit SHA、pull request identity、test execution result 等由 client 或 integration 回報的機器事實，以及 AI 對這些證據產生的摘要、影響判讀與 Acceptance Criterion Verdict。

如果所有資料都必須人工核准後才能寫入 canonical graph，使用者會被迫逐項核准可驗證的機器紀錄。如果 AI interpretation 與機器事實一起直接成為 canonical，AI 的錯誤判讀又會繞過 draft-first review gate。

## Options Considered

### A：所有 Evidence 與 Interpretation 都先進入 Draft

優點：

- 所有外部輸入都經過一致的人類審查。
- Canonical graph 不會自動接受任何新資料。

缺點：

- 使用者必須核准大量機器可驗證的事實。
- Commit、PR 與 test records 無法即時進入追溯 graph。
- Evidence ingestion workflow 摩擦過高。

### B：所有 Evidence 與 Interpretation 都直接 Canonical

優點：

- Automation 程度最高。
- Implementation Result 可立即使用。

缺點：

- AI 摘要與 verdict 可能直接污染 canonical data。
- 違反 ADR 0007 的 draft-first 原則。
- 機器事實與語意判讀無法區分。

### C：Observed Evidence 直接 Canonical，Interpretation 先 Draft

優點：

- 可驗證機器事實能快速進入 graph。
- AI 判讀仍保留人類 review gate。
- Canonical evidence 與 accepted result 維持不同語意。

缺點：

- Evidence ingestion 必須驗證來源、格式與引用完整性。
- Domain model 需要區分 evidence 與 interpretation lifecycle。

## Decision

採用選項 C：在單人 MVP 中，由本機 MCP client 提供，且通過格式、repository identity 與引用完整性驗證的 commit SHA、pull request identity、test execution result 等機器紀錄，可以立即作為 Observed Evidence 寫入 canonical graph，不需要內容 approval。

Observed Evidence 只表示系統已保存一項可追溯的 client 回報；它不表示該事實已由獨立來源驗證、相關實作已被使用者接受、acceptance criterion 已滿足或 Ticket 已完成。MVP 不建立 Evidence Source 註冊或 assurance level；擴展至多人或外部 integrations 前，必須重新決定來源信任模型。

AI 對 Observed Evidence 產生的摘要、影響判讀與 Acceptance Criterion Verdict 都屬於 Evidence Interpretation，必須先成為 draft，經使用者接受後才可參與 Result Acceptance。

## Rationale

- Draft-first 應保護需要判斷的 AI 內容，而不是增加所有機器資料的人工確認成本。
- 分離 evidence 與 interpretation，可同時保留 ingestion 效率與產品意圖的審查邊界。
- Canonical evidence 不等於 accepted outcome，能避免 graph presence 被誤讀成 completion。

## Trade-offs

- 接受 evidence ingestion path 具有直接 canonical write 權限。
- 接受 server 與 adapters 必須執行較嚴格的來源及引用驗證。
- 接受 resources 與 UI 必須清楚顯示 observed、interpreted 與 accepted 的差異。

## Consequences

- Result source 已 stale 時，格式與引用有效的 Observed Evidence 仍可保存；對應 Implementation Result 必須是不可接受的 archived draft。

- Domain model 必須分離 Observed Evidence 與 Evidence Interpretation。
- Evidence ingestion tools 必須驗證 repository identity、evidence identity 與引用完整性。
- Observed Evidence 寫入後必須保留來源與 audit record，且不得因 interpretation 被拒絕而刪除。
- AI 產生的 summary 與 criterion verdict 必須維持 draft，直到使用者接受。
- Result Acceptance 仍必須符合 ADR 0020 與 ADR 0021，不得因 evidence 已 canonical 而自動完成 Ticket。
- 多人使用或外部 integrations 不得沿用單人 MVP 的隱含信任，必須先新增來源識別與信任決策。
