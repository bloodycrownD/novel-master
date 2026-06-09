# E2E fixture bootstrap (adb + SQLite)

Fixture specs (`chat.tool-phase-and-order.e2e.ts`, turn rollback in `chat.rollback.e2e.ts`) need a pre-seeded chat session with tool-turn messages. Inject via **adb** into the app-private SQLite file — no production code changes.

## Prerequisites

- Debug APK installed (`assembleDebug`)
- Emulator or device with `adb`
- App launched **at least once** so `novel_master_vfs` exists
- App **force-stopped** before injection (see scripts below)

DB path (quick-sqlite default layout):

```text
/data/data/com.novelmaster/files/default/novel_master_vfs
```

Fixture SQL: [`../fixtures/tool-turn-session.sql`](../fixtures/tool-turn-session.sql)

Creates:

| Entity | Value |
|--------|--------|
| Project | `E2E Tool Turn` |
| Session title | `E2E Tool Turn Fixture` (override with `E2E_FIXTURE_SESSION_TITLE`) |
| Assistant anchor | `e2e-fix-a1` (thinking → body → tools) |
| Turn tail | `e2e-fix-u2`, `e2e-fix-a2` (for rollback case) |
| Workspace model | `anthropic/claude-3-5-sonnet-20241022` |

## Inject (Windows PowerShell)

From `apps/mobile`:

```powershell
.\e2e\scripts\inject-tool-turn-fixture.ps1
```

## Inject (macOS / Linux)

```bash
chmod +x e2e/scripts/inject-tool-turn-fixture.sh
./e2e/scripts/inject-tool-turn-fixture.sh
```

## Manual inject

```bash
adb shell am force-stop com.novelmaster
adb push e2e/fixtures/tool-turn-session.sql /data/local/tmp/e2e-fixture.sql
adb shell "cat /data/local/tmp/e2e-fixture.sql | run-as com.novelmaster sqlite3 /data/data/com.novelmaster/files/default/novel_master_vfs"
adb shell rm /data/local/tmp/e2e-fixture.sql
```

If `sqlite3` is missing inside `run-as`, use an emulator system image that includes it, or copy the DB out, patch locally, and push back (not covered here).

## Run fixture specs

```bash
cd apps/mobile
npm run e2e -- --spec e2e/specs/chat.tool-phase-and-order.e2e.ts
npm run e2e -- --spec e2e/specs/chat.rollback.e2e.ts
```

Optional env overrides:

```bash
E2E_FIXTURE_SESSION_TITLE="My Fixture Session" \
E2E_FIXTURE_ASSISTANT_MESSAGE_ID=e2e-fix-a1 \
npm run e2e -- --spec e2e/specs/chat.tool-phase-and-order.e2e.ts
```

To allow skipping when fixture is absent (CI/agent env):

```bash
E2E_ALLOW_FIXTURE_SKIP=1 npm run e2e
```

## Verify injection

1. Launch app → open project **E2E Tool Turn** → session **E2E Tool Turn Fixture**
2. Assistant bubble shows **思考过程**, body text, and **工具调用** group (no pending spinner)
3. Composer accepts input (workspace model pre-selected)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `run-as: package not debuggable` | Use **debug** APK, not release |
| DB path not found | Cold-start app once, then re-run inject |
| Session not in list | Re-run SQL; confirm project name matches `E2E Tool Turn` |
| E4 still skips | Unset `E2E_ALLOW_FIXTURE_SKIP`; confirm inject succeeded |
