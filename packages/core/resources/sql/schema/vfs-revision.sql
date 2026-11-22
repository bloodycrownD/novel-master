-- vfs_revision schema（手工按执行顺序组装：spread + 程序生成 DROP 已展开；执行顺序语义见原 vfs-revision-schema.ts 注释）

CREATE TABLE IF NOT EXISTS vfs_revision (
  entry_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  mtime_ms INTEGER NOT NULL,
  content_hash TEXT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
  PRIMARY KEY (entry_id, version),
  CHECK (NOT (status = 'active' AND content_hash IS NULL))
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS trg_revision_insert_inc_blob_ref
AFTER INSERT ON vfs_revision
WHEN NEW.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash;
END;

DROP TRIGGER IF EXISTS trg_revision_delete_dec_blob_ref;

DROP TRIGGER IF EXISTS trg_revision_update_transfer_blob_ref;

DROP TRIGGER IF EXISTS trg_revision_delete_dec_blob_ref_v2;

DROP TRIGGER IF EXISTS trg_revision_update_transfer_blob_ref_v2;

CREATE TRIGGER trg_revision_delete_dec_blob_ref_v2
AFTER DELETE ON vfs_revision
WHEN OLD.content_hash IS NOT NULL
BEGIN
  UPDATE vfs_content_blob
  SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0
    AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
END;

CREATE TRIGGER trg_revision_update_transfer_blob_ref_v2
AFTER UPDATE OF content_hash ON vfs_revision
WHEN OLD.content_hash IS NOT NEW.content_hash
BEGIN
  UPDATE vfs_content_blob SET ref_count = ref_count - 1
  WHERE content_hash = OLD.content_hash AND OLD.content_hash IS NOT NULL;
  DELETE FROM vfs_content_blob
  WHERE content_hash = OLD.content_hash AND ref_count <= 0 AND OLD.content_hash IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM vfs_entry WHERE content_hash = OLD.content_hash);
  UPDATE vfs_content_blob SET ref_count = ref_count + 1
  WHERE content_hash = NEW.content_hash AND NEW.content_hash IS NOT NULL;
END;

CREATE INDEX IF NOT EXISTS idx_vfs_entry_content_hash
  ON vfs_entry(content_hash) WHERE content_hash IS NOT NULL;
