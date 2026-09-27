import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acceptanceFixture } from "../test-support/result-acceptance-fixture.js";
import { ProductGraphService } from "./product-graph-service.js";

const approvalTime = "2026-09-28T00:00:00.000Z";
let fixture: ReturnType<typeof acceptanceFixture>;

beforeEach(() => {
  fixture = acceptanceFixture();
});

afterEach(() => {
  fixture.database.close();
});

function configuredService(id: string, displayName: string) {
  return new ProductGraphService(fixture.ports, {
    actor: { id, displayName },
    clock: () => new Date(approvalTime)
  });
}

function replacementDraft() {
  const previous = fixture.briefs[0]!;
  const snapshot = fixture.ports.repositoryContextSnapshots.findById(
    previous.repositoryContextSnapshotId
  )!;
  return fixture.service.createImplementationBriefDraft({
    implementationTargetId: previous.implementationTargetId,
    supersedesImplementationBriefId: previous.id,
    repoContext: {
      repositoryName: snapshot.context.repository_name,
      summary: "Replacement context",
      fileList: [],
      moduleNotes: [],
      baselineCommitSha: "abc123",
      hasUncommittedChanges: false
    },
    brief: {
      implementationPlan: ["Implement revised plan"],
      suggestedFilesToInspect: [],
      testStrategy: ["Verify revised plan"],
      risks: [],
      prSummaryDraft: "Revised implementation"
    }
  }).implementationBrief;
}

function actors() {
  return fixture.database.prepare("SELECT * FROM local_actors ORDER BY id").all() as Record<string, unknown>[];
}

function approvalState() {
  return {
    actors: actors(),
    briefs: fixture.database.prepare("SELECT * FROM implementation_briefs ORDER BY id").all(),
    audit: fixture.ports.auditLog.list()
  };
}

describe("Implementation Brief approval Local Actor", () => {
  it("initializes the configured approver on their first approval and preserves the prior actor", () => {
    // 準備：Actor A 建立 replacement draft，Actor B 尚未有任何 approval。
    const draft = replacementDraft();
    const previous = fixture.briefs[0]!;
    const previousActors = actors();
    const target = configuredService("actor-b", "Second reviewer");

    // 執行：Actor B 的第一個操作即為核准。
    const result = target.approveImplementationBrief(draft.id);

    // 驗證：回傳、持久化與 audit 使用同一 server actor 和時間。
    expect(result.implementationBrief).toEqual({
      ...draft,
      reviewStatus: "approved",
      approvedByActorId: "actor-b",
      approvedAt: approvalTime,
      updatedAt: approvalTime
    });
    expect(result.archivedImplementationBriefId).toBe(previous.id);
    expect(fixture.ports.implementationBriefs.findById(draft.id)).toEqual(result.implementationBrief);
    expect(actors()).toEqual([...previousActors, {
      id: "actor-b", display_name: "Second reviewer", metadata_json: "{}",
      created_at: approvalTime, updated_at: approvalTime, archived_at: null
    }]);
    expect(fixture.ports.implementationBriefs.findById(previous.id)).toEqual({
      ...previous, lifecycleStatus: "archived", updatedAt: approvalTime
    });
    expect(fixture.ports.auditLog.list().find(entry => entry.id === result.auditLogId)).toMatchObject({
      actorId: "actor-b", createdAt: approvalTime, action: "implementation_brief.approved",
      entityId: draft.id, afterSummary: {
        implementationBrief: result.implementationBrief,
        archivedImplementationBriefId: previous.id
      }
    });
    expect(fixture.database.pragma("foreign_key_check")).toEqual([]);
  });

  it("refreshes a configured display name without changing historical identity or creation time", () => {
    // 準備：同一 actor 改名，既有 approval 的 identity 與時間必須保留。
    const draft = replacementDraft();
    const previous = fixture.briefs[0]!;
    const previousActor = actors()[0];
    const previousAudit = fixture.ports.auditLog.list();
    const target = configuredService("acceptance-user", "Renamed reviewer");

    const result = target.approveImplementationBrief(draft.id);

    expect(actors()).toEqual([{
      ...previousActor, display_name: "Renamed reviewer", updated_at: approvalTime
    }]);
    expect(result.implementationBrief.approvedByActorId).toBe(previous.approvedByActorId);
    expect(fixture.ports.implementationBriefs.findById(previous.id)).toEqual({
      ...previous, lifecycleStatus: "archived", updatedAt: approvalTime
    });
    expect(fixture.ports.auditLog.list().filter(entry => entry.id !== result.auditLogId)).toEqual(previousAudit);
  });

  it.each([
    { id: "actor-b", displayName: "New reviewer", operation: "insert" },
    { id: "acceptance-user", displayName: "Renamed reviewer", operation: "update" }
  ])("rolls back actor $operation and the complete replacement when the audit write fails", ({ id, displayName }) => {
    // 準備：最後一筆 domain audit 寫入失敗，前面的 actor 與 Brief 寫入也必須回復。
    const draft = replacementDraft();
    const before = approvalState();
    const target = configuredService(id, displayName);
    fixture.database.exec(`CREATE TRIGGER fail_implementation_approval_audit
      BEFORE INSERT ON audit_log
      WHEN NEW.action = 'implementation_brief.approved'
      BEGIN SELECT RAISE(ABORT, 'forced approval audit failure'); END;`);

    expect(() => target.approveImplementationBrief(draft.id)).toThrow("forced approval audit failure");

    expect(approvalState()).toEqual(before);
    expect(fixture.database.pragma("foreign_key_check")).toEqual([]);
    fixture.database.exec("DROP TRIGGER fail_implementation_approval_audit");
    expect(target.approveImplementationBrief(draft.id).implementationBrief).toMatchObject({
      reviewStatus: "approved", approvedByActorId: id, approvedAt: approvalTime
    });
  });
});
