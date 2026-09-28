// 規劃內容與來源確認分開計版，避免重新確認上游時讓未變更的交付失效。
import type { GraphNode } from "../domain/models.js";
import { canonicalizeJson } from "./canonical-json.js";

export function planningContentRevision(node: GraphNode): string | null {
  if (["milestone", "spec"].includes(node.type) && typeof node.metadata.content_revision_id === "string") {
    return node.metadata.content_revision_id;
  }
  // 舊資料沒有內容版本時，保守沿用最後變更版本，不猜測歷史內容。
  return node.lastChangedInGraphRevisionId;
}

export function planningMetadata(
  type: string, metadata: Record<string, unknown>, revisionId: string,
  title: string, description: string | null, previous?: GraphNode
): Record<string, unknown> {
  if (!["milestone", "spec"].includes(type)) return metadata;
  const unchanged = previous && previous.title === title && previous.description === description &&
    previous.metadata.parent_node_id === metadata.parent_node_id &&
    canonicalizeJson(previous.metadata.content ?? null) === canonicalizeJson(metadata.content ?? null);
  return { ...metadata, content_revision_id: unchanged ? planningContentRevision(previous) : revisionId };
}
