-- Verification tool metadata only. Does not alter business records.
CREATE TABLE IF NOT EXISTS test_data_drafts (
  draft_id CHAR(36) NOT NULL PRIMARY KEY,
  revision INT NOT NULL DEFAULT 1,
  payload_json LONGTEXT NOT NULL,
  approved_hash CHAR(64) NULL,
  created_by INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CHECK (JSON_VALID(payload_json))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
