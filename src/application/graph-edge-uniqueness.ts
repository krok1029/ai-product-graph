import type { GraphDraftBatchChange, GraphEdge } from "../domain/models.js";
import { graphConflict } from "./graph-workflow-helpers.js";

// 先投影整批套用後的 active edges，再比較唯一性，避免合法交換或替代依賴排列順序。
export function validateFinalEdgeUniqueness(
  activeEdges: GraphEdge[],
  changes: GraphDraftBatchChange[]
) {
  const edgeChanges = changes.filter(change => change.entityKind === "edge" && !change.conflict);
  const groups = new Map<string, GraphDraftBatchChange[][]>();
  const addProjection = (source: string, target: string, relation: string, owners: GraphDraftBatchChange[]) => {
    const key = JSON.stringify([source, target, relation]);
    const group = groups.get(key) ?? [];
    group.push(owners);
    groups.set(key, group);
  };

  for (const edge of activeEdges) {
    const mutations = edgeChanges.filter(change => change.targetId === edge.id);
    if (mutations.some(change => change.operation === "archive")) continue;
    const relations = new Set(mutations.flatMap(change =>
      typeof change.payload.relation_type === "string" ? [change.payload.relation_type] : []));
    if (relations.size > 1) {
      for (const change of mutations) {
        change.conflict = graphConflict("AMBIGUOUS_EDGE_UPDATE",
          "Multiple updates assign different relations to the same GraphEdge.", { targetId: edge.id });
      }
      continue;
    }
    const relation = [...relations][0] ?? edge.relationType;
    addProjection(`node:${edge.sourceNodeId}`, `node:${edge.targetNodeId}`, relation, mutations);
  }
  for (const change of edgeChanges.filter(change => change.operation === "add")) {
    const endpoint = (prefix: "source" | "target") =>
      typeof change.payload[`${prefix}_node_id`] === "string"
        ? `node:${String(change.payload[`${prefix}_node_id`])}`
        : `change:${String(change.payload[`${prefix}_change_id`])}`;
    addProjection(endpoint("source"), endpoint("target"), String(change.payload.relation_type), [change]);
  }

  const unchangedConflicts: Record<string, unknown>[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const conflict = graphConflict("DUPLICATE_EDGE",
      "The resulting graph contains equivalent active GraphEdges.", { key });
    const owners = group.flat();
    for (const change of owners) change.conflict = conflict;
    // 舊資料若已重複，即使本批沒有修改該 edge，也不可核准另一個不一致的 revision。
    if (owners.length === 0) unchangedConflicts.push({ change_id: null, ...conflict });
  }
  return unchangedConflicts;
}
