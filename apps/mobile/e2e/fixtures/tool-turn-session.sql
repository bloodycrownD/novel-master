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
  ),
  (
    'e2e-fix-a3',
    'e2e-fixture-sess',
    6,
    'assistant',
    '{"blocks":[{"type":"text","text":"read the note"},{"type":"tool_use","id":"tu2","name":"read","input":{"path":"/ref-note.md"}}]}',
    NULL,
    NULL,
    1700000000007,
    0
  ),
  (
    'e2e-fix-utr2',
    'e2e-fixture-sess',
    7,
    'user',
    '{"blocks":[{"type":"tool_result","toolUseId":"tu2","content":"","ok":true,"summary":"3 lines","contentRef":{"path":"/ref-note.md","entryId":920001,"version":1,"contentHash":"205576ea11f65b493a870f93ef61d88528c270026a92235e30b8e11c79ae7579","totalBytes":41,"offset":1,"returnedLines":3,"totalLines":3,"truncated":false}}]}',
    NULL,
    NULL,
    1700000000008,
    0
  );

-- Workspace model so composer send works without manual provider setup.
-- 2026-10-02 schema 对齐：display_name 已更名 model_name（saved-model-identity-v1），
-- 新增 NOT NULL 主键 id（kkv currentModelId 与它直接相等比较，须同值）。
-- settings_json 必须是合法 v2 文档（saved-model-settings.schema）：空 '{}' 会让
-- provider 校验直接 ProviderError——run 每次都以 invalid_union 失败（实测 ~7s
-- 超时 + console.error 弹 LogBox 抢 a11y 树），e2e 测的全是 run 失败的副作用
-- 而非被测功能（2026-10-02 用户拍板改 mock 服务商）。
INSERT OR IGNORE INTO llm_saved_model (
  id,
  provider_id,
  vendor_model_id,
  model_name,
  settings_json,
  created_at_ms,
  updated_at_ms
) VALUES (
  'e2e-fixture-model',
  'anthropic',
  'claude-3-5-sonnet-20241022',
  'E2E Fixture Model',
  '{"schemaVersion":2,"internal":{"contextWindowTokens":200000,"tokenCounterMode":"auto"},"generation":{"sampling":{"enabled":false},"thinkingLevel":"off"}}',
  1700000000000,
  1700000000000
);

-- anthropic 内置 provider 的 baseUrl 改指宿主 mock（mock-anthropic-provider.mjs
-- 监听 127.0.0.1:9753，SSE 应答最小合法回复）。设备侧访问 127.0.0.1:9753 依赖
-- `adb reverse tcp:9753 tcp:9753`（reverse 走 adb 通道不经网络栈，无 TUN 注入）。
-- 注意 llm_provider 行由 app bootstrap 幂等 seed（builtin 固定 UUID），UPDATE
-- 而非 INSERT，避免与 seed 冲突；改完 baseUrl 后 mock 不可达时 run 会以网络错
-- 失败——所以跑 e2e 前必须先把 mock 起起来。
UPDATE llm_provider
SET base_url = 'http://127.0.0.1:9753'
WHERE builtin_key = 'anthropic';

-- read-tool-result-ref：contentRef 形态样本的 revision/blob 保活链
-- （消息 e2e-fix-utr2 引用 (920001, 1)；blob 先落、revision 触发器自动
-- 维护 blob ref_count；revision.ref_count=2 = live head 1 + read 引用 1）。
-- 明文 "E2E read ref fixture\nline two\nline three\n"（41B / 3 行），
-- zlib hex 由 fflate zlibSync 产出（与 core 写侧同源）。OR IGNORE 保持
-- 重跑幂等（不触发 revision DELETE 触发器的 blob 回收链）。
INSERT OR IGNORE INTO vfs_content_blob (
  content_hash, encoding, bytes, byte_len, ref_count
) VALUES (
  '205576ea11f65b493a870f93ef61d88528c270026a92235e30b8e11c79ae7579',
  'zlib',
  x'789c73357255284a4d4c0112690a69991525a545a95c399979a90a25e5f9504646516a2a170023790e1d',
  42,
  0
);

INSERT OR IGNORE INTO vfs_entry (
  entry_id, scope_key, path, content_hash, head_version, mtime_ms, entry_kind, content
) VALUES (
  920001,
  'session:e2e-fixture-proj:e2e-fixture-sess',
  '/ref-note.md',
  '205576ea11f65b493a870f93ef61d88528c270026a92235e30b8e11c79ae7579',
  1,
  1700000000000,
  'file',
  NULL
);

INSERT OR IGNORE INTO vfs_revision (
  entry_id, version, status, mtime_ms, content_hash, ref_count
) VALUES (
  920001,
  1,
  'active',
  1700000000000,
  '205576ea11f65b493a870f93ef61d88528c270026a92235e30b8e11c79ae7579',
  2
);

INSERT OR REPLACE INTO kkv_entry (module, key, value) VALUES
  ('nm-workspace-state', 'currentModelId', 'e2e-fixture-model'),
  ('nm-workspace-state', 'currentProjectId', 'e2e-fixture-proj'),
  ('nm-workspace-state', 'currentSessionId', 'e2e-fixture-sess');
