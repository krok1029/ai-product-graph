// 將已驗證的變更投影至圖譜；由外層 workflow 管理 transaction 與 revision。
import type { GraphDraftBatch, GraphRevision, GraphDraftBatchChange, GraphNode, GraphNodeType, GraphEdge, GraphRelationType } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";
import { slugify, resolveEndpointId } from "./graph-workflow-helpers.js";
import { planningMetadata } from "./planning-content-revision.js";

export function applyGraphChanges(
  ports: ApplicationPorts,
  idFactory: () => string,
  batch: GraphDraftBatch,
  revision: GraphRevision,
  changes: GraphDraftBatchChange[],
  now: string
) {
  const addedIds: string[]= [];
  const updatedIds: string[]= [];
  const archivedIds: string[]= [];
  const addedNodeIds = new Map<string, string>();

  for (const change of changes) {
    if (change.entityKind !== "node") continue;
    if (change.operation === "add") {
      const id = idFactory();
      const title = String(change.payload.title);
      const node: GraphNode= {
        id,
        projectId: batch.projectId,
        slug: ["product_brief", "milestone", "spec"].includes(change.payload.type as string)
          ? `${slugify(title)}-${id.toLowerCase()}` : slugify(title),
        type: change.payload.type as GraphNodeType,
        title,
        description:
          change.payload.description === null
            ? null
            :String(change.payload.description),
        source: "product_brief",
        sourceRefType: "product_brief_version",
        sourceRefId: batch.sourceProductBriefVersionId,
        lifecycleStatus: "active",
        createdInGraphRevisionId: revision.id,
        lastChangedInGraphRevisionId: revision.id,
        metadata: planningMetadata(String(change.payload.type), change.payload.metadata as Record<string, unknown>,
          revision.id, title, change.payload.description === null ? null : String(change.payload.description)),
        createdAt: now,
        updatedAt: now
      };
      ports.graphNodes.insert(node);
      addedNodeIds.set(change.changeId, node.id);
      addedIds.push(node.id);
    } else if (change.operation === "update") {
      const previous = ports.graphNodes.findById(change.targetId as string)!;
      const metadata = planningMetadata(previous.type,
        (change.payload.metadata ?? previous.metadata) as Record<string, unknown>, revision.id,
        (change.payload.title ?? previous.title) as string,
        change.payload.description === undefined ? previous.description : change.payload.description as string | null,
        previous);
      ports.graphNodes.update(change.targetId as string, {
        ...(change.payload.title !== undefined
          ? { title: change.payload.title as string }
          :{}),
        ...(change.payload.description !== undefined
          ? {
            description: change.payload.description as string|null
          }
          :{}),
        metadata,
        sourceRefId: batch.sourceProductBriefVersionId,
        graphRevisionId: revision.id,
        updatedAt: now
      });
      updatedIds.push(change.targetId as string);
    } else {
      ports.graphNodes.archive(
        change.targetId as string,
        revision.id,
        now
      );
      archivedIds.push(change.targetId as string);
    }
  }

  for (const change of changes) {
    if (change.entityKind !== "edge") continue;
    if (change.operation === "add") {
      const id = idFactory();
      const edge: GraphEdge= {
        id,
        projectId: batch.projectId,
        sourceNodeId: resolveEndpointId(
          change.payload,
          "source",
          addedNodeIds
        ),
        targetNodeId: resolveEndpointId(
          change.payload,
          "target",
          addedNodeIds
        ),
        relationType:
          change.payload.relation_type as GraphRelationType,
        confidence: change.payload.confidence as number|null,
        lifecycleStatus: "active",
        createdInGraphRevisionId: revision.id,
        lastChangedInGraphRevisionId: revision.id,
        metadata: change.payload.metadata as Record<string, unknown>,
        createdAt: now,
        updatedAt: now
      };
      ports.graphEdges.insert(edge);
      addedIds.push(edge.id);
    } else if (change.operation === "update") {
      ports.graphEdges.update(change.targetId as string, {
        ...(change.payload.relation_type !== undefined
          ? {
            relationType:
              change.payload.relation_type as GraphRelationType
          }
          :{}),
        ...(change.payload.confidence !== undefined
          ? {
            confidence: change.payload.confidence as number|null
          }
          :{}),
        ...(change.payload.metadata !== undefined
          ? {
            metadata: change.payload.metadata as Record<string, unknown>
          }
          :{}),
        graphRevisionId: revision.id,
        updatedAt: now
      });
      updatedIds.push(change.targetId as string);
    } else {
      ports.graphEdges.archive(
        change.targetId as string,
        revision.id,
        now
      );
      archivedIds.push(change.targetId as string);
    }
  }

  return { addedIds, updatedIds, archivedIds };
}
