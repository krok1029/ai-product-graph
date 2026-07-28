import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "./app.js";
import { createSqlitePorts } from "./infrastructure/sqlite/repositories.js";

const directory = mkdtempSync(join(tmpdir(), "ai-product-graph-smoke-"));
const databasePath = join(directory, "smoke.sqlite");

try {
  const app = createApp({ databasePath });
  try {
    const project = app.service.createProject({
      name: "Smoke Test Project",
      description: "Phase 1A smoke test"
    });
    const idea = app.service.addIdea({
      projectId: project.project.id,
      content: "Validate the first vertical slice.",
      source: "smoke"
    });
    const projects = app.service.listProjects();
    const loadedIdea = app.service.getIdea(idea.idea.id);
    const auditLog = createSqlitePorts(app.database).auditLog.list();

    assert(projects.projects.length === 1, "Expected one project.");
    assert(
      loadedIdea.idea.projectId === project.project.id,
      "Idea should belong to the created project."
    );
    assert(auditLog.length === 2, "Expected project and idea audit entries.");

    console.log(
      JSON.stringify({
        ok: true,
        databasePath,
        projectId: project.project.id,
        ideaId: idea.idea.id,
        auditLogEntries: auditLog.length
      })
    );
  } finally {
    app.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
