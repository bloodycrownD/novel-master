/** Fixture project name (must match tool-turn-session.sql). */
export const E2E_FIXTURE_PROJECT_NAME =
  process.env.E2E_FIXTURE_PROJECT_NAME ?? 'E2E Tool Turn';

/** Fixture session title shown in the session list. */
export const E2E_FIXTURE_SESSION_TITLE =
  process.env.E2E_FIXTURE_SESSION_TITLE ?? 'E2E Tool Turn Fixture';

/** Assistant message id with thinking + body + tool_use blocks. */
export const E2E_FIXTURE_ASSISTANT_MESSAGE_ID =
  process.env.E2E_FIXTURE_ASSISTANT_MESSAGE_ID ?? 'e2e-fix-a1';

/** Tail assistant message removed by turn-boundary rollback. */
export const E2E_FIXTURE_TAIL_ASSISTANT_MESSAGE_ID =
  process.env.E2E_FIXTURE_TAIL_ASSISTANT_MESSAGE_ID ?? 'e2e-fix-a2';

/** Tail user message before the tail assistant. */
export const E2E_FIXTURE_TAIL_USER_MESSAGE_ID =
  process.env.E2E_FIXTURE_TAIL_USER_MESSAGE_ID ?? 'e2e-fix-u2';
