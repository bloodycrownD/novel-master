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

INSERT OR REPLACE INTO kkv_entry (module, key, value) VALUES
  ('nm-workspace-state', 'currentModelId', 'e2e-fixture-model'),
  ('nm-workspace-state', 'currentProjectId', 'e2e-fixture-proj'),
  ('nm-workspace-state', 'currentSessionId', 'e2e-fixture-sess');
