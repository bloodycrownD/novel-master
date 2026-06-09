# E2E fixture bootstrap (adb + host SQLite)

Fixture specs need a pre-seeded chat session. Injection uses **Node `node:sqlite` on the host** (pull → patch → push) — no `sqlite3` binary on the device.

## Prerequisites

- Debug APK installed (`assembleDebug`)
- Emulator/device with `adb`
- App launched **at least once** so `novel_master_vfs` exists

DB path:

```text
/data/data/com.novelmaster/files/default/novel_master_vfs
```

## Inject

From **repo root**:

```bash
npm run mobile:e2e:fixture
```

From `apps/mobile`:

```bash
npm run e2e:fixture
```

## Run fixture specs

```bash
npm run mobile:e2e -- --spec e2e/specs/chat.tool-phase-and-order.e2e.ts
npm run mobile:e2e -- --spec e2e/specs/chat.rollback.e2e.ts
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Could not read app database` | Launch debug app once, then re-run inject |
| `run-as: package not debuggable` | Use **debug** APK |
| `sqlite3: No such file` (old scripts) | Use `npm run mobile:e2e:fixture` (Node host inject) |
