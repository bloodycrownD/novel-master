# @novel-master/tdbc-driver-better-sqlite3

Node.js TDBC driver backed by [better-sqlite3](https://github.com/WiseLibs/better-sqlite3).

## Setup

```typescript
import { open, SqlTemplateParser, executeTemplate } from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";

registerBetterSqlite3Driver();

const conn = await open("tdbc:sqlite:file:./app.db");
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

## URL

- `tdbc:sqlite:file:./path/to.db`
- `open(..., { filename: ":memory:" })` for in-memory databases
