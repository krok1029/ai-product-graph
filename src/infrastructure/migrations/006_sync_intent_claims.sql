-- Claim 是執行協調歷史，不修改 immutable Sync Intent。
CREATE TABLE sync_intent_claims (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_intent_id TEXT NOT NULL REFERENCES sync_intents(id),
  claim_token TEXT NOT NULL UNIQUE,
  worker_id TEXT NOT NULL CHECK (length(trim(worker_id)) > 0),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES sync_attempts(id),
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > claimed_at),
  invocation_started_at TEXT,
  invocation_kind TEXT CHECK (invocation_kind IN ('create', 'reconcile')),
  requires_reconciliation INTEGER NOT NULL CHECK (requires_reconciliation IN (0, 1)),
  released_at TEXT
);
CREATE UNIQUE INDEX sync_intent_one_open_claim
  ON sync_intent_claims(sync_intent_id) WHERE released_at IS NULL;
CREATE INDEX sync_intent_claim_history ON sync_intent_claims(sync_intent_id, sequence);
