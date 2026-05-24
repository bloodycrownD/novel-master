# @novel-master/tdbc-driver-rn

React Native TDBC driver via [react-native-quick-sqlite](https://github.com/margelo/react-native-quick-sqlite) (peer dependency).

## Entry points

| Import | Use when |
|--------|----------|
| `@novel-master/tdbc-driver-rn` | Node tests, CI conformance, docs (default adapter uses **dynamic** `import()`) |
| `@novel-master/tdbc-driver-rn/native` | **RN App / Metro** — static quick-sqlite binding (`NativeQuickSqliteAdapter`) |

React Native apps should import from **`/native`** so Metro includes the peer in the bundle.

## Setup (Node / docs)

```typescript
import { open, SqlTemplateParser, executeTemplate } from "@novel-master/core";
import { registerRnDriver } from "@novel-master/tdbc-driver-rn";

registerRnDriver();

const conn = await open("tdbc:sqlite:file:myapp.db", { driver: "rn" });
```

## Setup (RN App)

```typescript
import { registerRnDriver } from "@novel-master/tdbc-driver-rn/native";

registerRnDriver();
```

## SqlTemplateParser + execute

```typescript
const parser = new SqlTemplateParser();

await executeTemplate(
  conn,
  parser,
  "INSERT INTO users (id, name) VALUES (#{id}, #{name})",
  { id: 1, name: "Ada" },
);

const rows = await conn.query("SELECT id, name FROM users WHERE id = ?", [1]);
await conn.close();
```

## Device smoke checklist (manual)

- [ ] Open a file database on device or simulator
- [ ] INSERT and SELECT round-trip
- [ ] `transaction` rollback on error
- [ ] `batch` with ~10 parameter sets
- [ ] `close` then call → `CONNECTION_CLOSED`

CI runs conformance against `MockRnSqliteAdapter` in Node; use the checklist above for real quick-sqlite behavior.
