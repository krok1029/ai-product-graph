// 追溯只在 root 所屬 Project 內讀取；BFS 保留最短路徑，避免循環造成無限展開。
import { ApplicationError } from "../domain/errors.js";
import type { GraphEdge } from "../domain/models.js";
import type { ApplicationPorts } from "./ports.js";

export type NodeTraceInput = {
  nodeId: string;
  direction?: "incoming" | "outgoing" | "both";
  maxDepth?: number;
};

type TracePath = { nodeIds: string[]; edgeIds: string[] };

export class NodeTraceReads {
  constructor(private readonly ports: ApplicationPorts) {}

  getNode(nodeId: string) {
    const node = this.ports.graphNodes.findById(nodeId);
    if (!node) throw new ApplicationError("NOT_FOUND", "GraphNode was not found.", { nodeId });
    return { node };
  }

  getTrace(input: NodeTraceInput) {
    const direction = input.direction ?? "both";
    const maxDepth = input.maxDepth ?? 3;
    if (!["incoming", "outgoing", "both"].includes(direction) ||
        !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 10) {
      throw new ApplicationError("VALIDATION_ERROR", "Trace requires a valid direction and integer max_depth from 0 to 10.");
    }
    const { node: root } = this.getNode(input.nodeId);
    const nodes = new Map(this.ports.graphNodes.list(root.projectId, "active")
      .filter(node => node.projectId === root.projectId).map(node => [node.id, node]));
    const paths = new Map<string, TracePath>([[root.id, { nodeIds: [root.id], edgeIds: [] }]]);
    const traversed = new Map<string, GraphEdge>();
    const adjacency = new Map<string, { next: string; edge: GraphEdge }[]>();
    const candidates = this.ports.graphEdges.list(root.projectId, "active")
      .filter(edge => edge.projectId === root.projectId && nodes.has(edge.sourceNodeId) && nodes.has(edge.targetNodeId))
      .sort(byId);
    for (const edge of candidates) {
      if (direction !== "incoming") addNeighbor(edge.sourceNodeId, edge.targetNodeId, edge);
      if (direction !== "outgoing") addNeighbor(edge.targetNodeId, edge.sourceNodeId, edge);
    }
    const queue = [root.id];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      const path = paths.get(current)!;
      if (root.lifecycleStatus !== "active" || path.edgeIds.length >= maxDepth) continue;
      for (const { next, edge } of adjacency.get(current) ?? []) {
        traversed.set(edge.id, edge);
        if (paths.has(next)) continue;
        paths.set(next, { nodeIds: [...path.nodeIds, next], edgeIds: [...path.edgeIds, edge.id] });
        queue.push(next);
      }
    }
    return {
      root,
      nodes: queue.map(id => id === root.id ? root : nodes.get(id)!).sort(byId),
      edges: [...traversed.values()].sort(byId),
      paths: [...paths.entries()].sort(([left], [right]) => compareIds(left, right)).map(([, path]) => path)
    };

    function addNeighbor(from: string, next: string, edge: GraphEdge) {
      const neighbors = adjacency.get(from) ?? [];
      neighbors.push({ next, edge });
      adjacency.set(from, neighbors);
    }
  }
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byId(left: { id: string }, right: { id: string }) {
  return compareIds(left.id, right.id);
}
