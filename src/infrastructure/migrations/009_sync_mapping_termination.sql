CREATE TABLE sync_mapping_terminations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  mapping_id TEXT NOT NULL UNIQUE REFERENCES external_work_item_mappings(id),
  decision_id TEXT NOT NULL UNIQUE REFERENCES decisions(id)
);

CREATE TABLE sync_mapping_termination_intents (
  termination_id TEXT NOT NULL REFERENCES sync_mapping_terminations(id),
  sync_intent_id TEXT NOT NULL UNIQUE REFERENCES sync_intents(id),
  PRIMARY KEY (termination_id, sync_intent_id)
);

CREATE TRIGGER sync_mapping_terminations_no_update BEFORE UPDATE ON sync_mapping_terminations
BEGIN SELECT RAISE(ABORT, 'sync mapping terminations are immutable'); END;
CREATE TRIGGER sync_mapping_terminations_no_delete BEFORE DELETE ON sync_mapping_terminations
BEGIN SELECT RAISE(ABORT, 'sync mapping terminations are immutable'); END;
CREATE TRIGGER sync_mapping_termination_intents_no_update BEFORE UPDATE ON sync_mapping_termination_intents
BEGIN SELECT RAISE(ABORT, 'stopped sync intent membership is immutable'); END;
CREATE TRIGGER sync_mapping_termination_intents_no_delete BEFORE DELETE ON sync_mapping_termination_intents
BEGIN SELECT RAISE(ABORT, 'stopped sync intent membership is immutable'); END;
CREATE TRIGGER terminated_mapping_decisions_no_update BEFORE UPDATE ON decisions
WHEN EXISTS (SELECT 1 FROM sync_mapping_terminations WHERE decision_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'sync mapping termination decisions are immutable'); END;
CREATE TRIGGER terminated_mapping_decisions_no_delete BEFORE DELETE ON decisions
WHEN EXISTS (SELECT 1 FROM sync_mapping_terminations WHERE decision_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'sync mapping termination decisions are immutable'); END;
