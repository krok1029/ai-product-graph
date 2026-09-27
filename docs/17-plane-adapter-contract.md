# Plane first-create 欄位契約

此 adapter 將已固定的 version 1 Ticket payload 投影為 Plane create DTO，並把 provider 回傳資料轉為 External Work Item Snapshot observation。這兩個純函數不呼叫 HTTP、不讀取 credentials、不修改資料庫；HTTP transport 與明確執行入口由各自的功能票交付。

## Outbound 欄位

`planeCreateFields(request)` 先確認 payload hash、schema version、Ticket owner、source revision 與完整 specification。Title、user story、criteria IDs/text 與陣列項目不可空白；criteria 至少一項且 ID 不重複。Scope／non-goals 可為空陣列，implementation notes 可省略或為空陣列。Provider 必須為 Plane，workspace、container 與 stable idempotency key 不可空白。不符合契約即 throw，不能送出部分內容。

| Plane 欄位 | 來源與規則 |
| --- | --- |
| `name` | Pinned specification title，以 API 純文字原樣送出。 |
| `description_html` | User story、scope、acceptance criteria、non-goals，以及非空 optional implementation notes。每項 criterion 同時保留 stable ID 與文字。 |
| `external_source` | 固定 `ai-product-graph`。 |
| `external_id` | Sync Intent 的 stable idempotency key。 |

Description 中每個使用者字串均 escape `& < > " '`，CRLF／CR／LF 轉為 `<br>`。HTML tags 與 section 標題由 adapter 固定產生。`name` 是純文字欄位，不加入 HTML entities。額外 payload 欄位不會加入 DTO；state、labels、assignees、comments、priority 與所有未宣告欄位均不寫入。

## Inbound observation

`planeItemObservation(value, request)` 要求 request 本身有效，回應為純 JSON object、非空 `id`、兩個 external markers 完全吻合，以及 `project === request.container.containerIdentity`。不符合即回傳 `null`，不能將它當成已找到正確 item。

- `state` 是 string 時保留為 external status，缺漏或 null 為 null；object 等其他格式拒絕。此值不等於內部 Ticket Delivery Status。
- `updated_at` 缺漏為 null；存在時必須為有效含 timezone 的 ISO timestamp，保留原字串，包括微秒與 offset。不製造 token，也不宣稱 timestamp 提供 conditional-write guarantee。
- `url` 僅在為無 credentials 的完整 HTTP(S) URL 時採用；缺漏、不合法或其他 scheme 為 null。保留合法原字串，不依 workspace 猜測 URL。原始不合法 URL 仍留在 snapshot content。
- 完整 response JSON 深複製保存，包含未知 nested fields 與 `__proto__` 等自有 key。Snapshot 不與呼叫端共用可變物件。非 JSON 值、cycle、accessor、非一般 object、稀疏陣列與過深結構拒絕，不靜默遺失或轉換資料。

本 adapter 無法從 markers 推論 provider 已提供 atomic idempotency。重試與 reconciliation 仍依 durable claim 規則；缺少 item 或無法驗證的 observation 不構成 definitely absent。後續 content update、close、reopen 的 HTTP 執行不在此契約內。

## 官方依據

[Create API](https://developers.plane.so/api-reference/issue/add-issue) 列出 `name`、`description_html` 與 external marker fields。[Work item model](https://developers.plane.so/api-reference/issue/overview) 定義 project、state 與 `updated_at` 等資料欄位；未知欄位保持 external-only。

[官方 pinned implementation](https://github.com/makeplane/plane/blob/5f7d92784c403f76284f0f16718f320221dc7fec/apps/api/plane/api/views/issue.py) 在雙 marker filter 下回傳單一 item；[List API](https://developers.plane.so/api-reference/issue/list-issues) 另有一般分頁契約。Transport 必須先辨識外層 response，再將每個候選 item 交給本 observation mapper。來源查核日為 2026-09-27；目前未執行真實 Plane export。
