-- E2E tool-turn fixture: workspace model + session with thinking/body/tools + rollback tail.
-- Apply via e2e/scripts/inject-tool-turn-fixture.ps1|.sh (see e2e/scripts/README.md).
-- Idempotent: safe to re-run; replaces messages for the fixture session.

INSERT OR IGNORE INTO chat_project (id, name, created_at_ms, updated_at_ms)
VALUES ('e2e-fixture-proj', 'E2E Tool Turn', 1700000000000, 1700000000000);

INSERT OR REPLACE INTO chat_session (
  id, project_id, title, created_at_ms, updated_at_ms
) VALUES (
  'e2e-fixture-sess',
  'e2e-fixture-proj',
  'E2E Tool Turn Fixture',
  1700000000001,
  1700000000001
);

DELETE FROM chat_message WHERE session_id = 'e2e-fixture-sess';

INSERT INTO chat_message (
  id, session_id, seq, role, content_json, provider, raw_json, created_at_ms, hidden
) VALUES
  (
    'e2e-fix-u1',
    'e2e-fixture-sess',
    1,
    'user',
    '{"blocks":[{"type":"text","text":"read file"}]}',
    NULL,
    NULL,
    1700000000002,
    0
  ),
  (
    'e2e-fix-a1',
    'e2e-fixture-sess',
    2,
    'assistant',
    '{"blocks":[{"type":"thinking","text":"Let me read the file."},{"type":"text","text":"reading"},{"type":"tool_use","id":"tu1","name":"read","input":{"path":"/a.md"}}]}',
    NULL,
    NULL,
    1700000000003,
    0
  ),
  (
    'e2e-fix-utr',
    'e2e-fixture-sess',
    3,
    'user',
    '{"blocks":[{"type":"tool_result","toolUseId":"tu1","content":"ok"}]}',
    NULL,
    NULL,
    1700000000004,
    1
  ),
  (
    'e2e-fix-u2',
    'e2e-fixture-sess',
    4,
    'user',
    '{"blocks":[{"type":"text","text":"more"}]}',
    NULL,
    NULL,
    1700000000005,
    0
  ),
  (
    'e2e-fix-a2',
    'e2e-fixture-sess',
    5,
    'assistant',
    '{"blocks":[{"type":"text","text":"later"}]}',
    NULL,
    NULL,
    1700000000006,
    0
  );

-- Workspace model so composer send works without manual provider setup.
INSERT OR IGNORE INTO llm_saved_model (
  provider_id,
  vendor_model_id,
  display_name,
  settings_json,
  created_at_ms,
  updated_at_ms
) VALUES (
  'anthropic',
  'claude-3-5-sonnet-20241022',
  'E2E Fixture Model',
  '{}',
  1700000000000,
  1700000000000
);

INSERT OR REPLACE INTO kkv_entry (module, key, value) VALUES
  ('nm-workspace-state', 'currentModelId', 'anthropic/claude-3-5-sonnet-20241022'),
  ('nm-workspace-state', 'currentProjectId', 'e2e-fixture-proj'),
  ('nm-workspace-state', 'currentSessionId', 'e2e-fixture-sess');
