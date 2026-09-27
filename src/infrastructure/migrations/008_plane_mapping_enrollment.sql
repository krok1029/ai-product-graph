-- 同 mapping 的不可變 outbox sequence 不可重用，包含 archived intents。
CREATE UNIQUE INDEX sync_intents_mapping_sequence_unique
  ON sync_intents(mapping_id, sequence_number) WHERE mapping_id IS NOT NULL;
