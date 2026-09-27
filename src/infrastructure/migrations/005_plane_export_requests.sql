-- 首次建立需求在不同 client keys／actors 間仍須保持 owner/container 唯一。
-- Failed create 尚未完成，不能以另一筆 request 繞過；成功 attempt 保留歷史。
CREATE TRIGGER prevent_duplicate_plane_export_request BEFORE INSERT ON sync_intents
WHEN NEW.source_event_type = 'plane_ticket_export_requested'
  AND NEW.operation = 'create' AND NEW.lifecycle_status = 'active'
BEGIN
  SELECT RAISE(ABORT, 'Plane Ticket already has an outstanding export request')
  WHERE EXISTS (
    SELECT 1 FROM sync_intents previous
    JOIN ticket_revisions previous_revision ON previous_revision.id = previous.source_ticket_revision_id
    JOIN ticket_revisions requested_revision ON requested_revision.id = NEW.source_ticket_revision_id
    WHERE previous_revision.ticket_id = requested_revision.ticket_id
      AND previous.external_container_id = NEW.external_container_id
      AND previous.source_event_type = 'plane_ticket_export_requested'
      AND previous.operation = 'create' AND previous.lifecycle_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM sync_attempts attempt
        WHERE attempt.sync_intent_id = previous.id AND attempt.result_status = 'succeeded'
      )
  );
  SELECT RAISE(ABORT, 'Plane Ticket already has an active external mapping')
  WHERE EXISTS (
    SELECT 1 FROM external_work_item_mappings mapping
    JOIN ticket_revisions revision ON revision.id = NEW.source_ticket_revision_id
    WHERE mapping.internal_owner_type = 'ticket' AND mapping.internal_owner_id = revision.ticket_id
      AND mapping.external_container_id = NEW.external_container_id AND mapping.lifecycle_status = 'active'
  );
END;
