# `@novel-master/core` — Layering & Module Template

> Iteration: [core-package-structure](../../.apm/kb/docs/Iterations/core-package-structure/spec.md)  
> Requirements: [PRD](../../.apm/kb/docs/Iterations/core-package-structure/prd.md)

## Layering

```text
packages/core/src/
├── bootstrap/       # DDL + seed; subdirs per bounded context
├── domain/<ctx>/    # types, schema, pure logic, ports, repos; may depend on infra + other domain
├── service/<ctx>/   # use-case orchestration, factories, persistence adapters; depends on domain + infra
├── errors/          # package-level catchable business errors (by context)
├── infra/           # technical capabilities without business filenames (domain/service may depend)
└── index.ts         # public API facade (internal paths may change; symbol names stay stable)
```

### Dependency rules (natural dependency)

| Direction | Target | Notes |
|-----------|--------|-------|
| domain → service | **0** | service orchestrates domain; never the reverse |
| domain → infra | **allowed** | macro render, date format, serialization, etc. |
| domain → domain | **allowed** | cross-context types/logic; avoid cycles |
| service → domain | **allowed** | application orchestration |
| service → infra | **allowed** | adapters, serialization |
| infra → domain | **allowed** | protocol adapters use domain types |
| infra → service | **forbidden** | infra must not know use cases |

## Domain module template

```text
domain/<ctx>/
├── model/                  # *.ts types + *.schema.ts (schemas live here only)
├── repositories/           # optional; when SQL persistence exists
│   ├── *.port.ts
│   └── impl/sqlite-*.repository.ts
├── ports/                  # optional; non-repo domain ports
├── logic/                  # pure functions: validate, compile, rules, estimate…
├── <feature>/              # optional: action/ triggers/ content/ session/ builtin/
└── (no .ts files at module root)
```

### Naming

| Kind | Rule | Example |
|------|------|---------|
| Validation | `logic/validate-<entity>.ts` | `validate-agent-definition.ts` |
| Rules / detection | `logic/<noun>.ts` or `logic/<verb>-<noun>.ts` | `doom-loop.ts`, `apply-regex-rules.ts` |
| Repo port | `repositories/<entity>.port.ts` | `message.port.ts` |
| Repo impl | `repositories/impl/sqlite-<entity>.repository.ts` | `sqlite-message.repository.ts` |
| Default impl | `action/default-<name>.ts` or `impl/default-*.ts` | `default-compaction-action.ts` |
| Service factory | `create-<storage>-<role>.ts` or `impl/createSqlite*` | `createSqliteCompactionAgentResolver` |
| Errors | `errors/<ctx>-errors.ts` or `<ctx>-runtime-errors.ts` | `agent-runtime-errors.ts` |

### Documented exceptions

- **`domain/*/repositories/impl/sqlite-*.ts`** — SQLite adapters live with their bounded context (port in repo, impl co-located), not in `infra/persistence/`.
- **`domain/compaction/action/default-compaction-action.ts`** — may import `infra/prompt-template`, `infra/date-format` (domain → infra is valid).
- **`domain/provider/model/model-sampling-profile-from-json.ts`** — wire encode/decode helper; stays beside schema in `model/`.
- **`infra/sksp/sksp-error.ts`**, **`infra/sql-template/errors.ts`**, **`infra/tdbc/errors.ts`** — infra-internal errors, not in `errors/`.
- **`service/prompt/render-prompt.ts`** — single-file application service; no `impl/` subdir.
- **`domain/vfs/ports/vfs-service.port.ts`** — `VfsService` contract; `service/vfs` implements it; builtin `vfs-tools` depend on domain port only.

## Service module template

```text
service/<ctx>/
├── *.port.ts
├── create-<ctx>-*.ts
└── impl/*.service.ts | *.ts    # ChatAgentSession and similar adapters
```

Persistent session adapters (e.g. `ChatAgentSession` over `MessageService`) belong in **service**, not domain.

Builtin tools under `domain/tool/builtin/` depend on **domain ports** (e.g. `VfsService`), never on `service/*` types.

## Infra module templates

Infra is split by **shape**, not one flat rule for every folder.

### Adapter 型（多实现、可替换）

Same idea as domain `ports/` + `impl/`, but names reflect vendors/protocols (not `sqlite-*`).

```text
infra/<capability>/
├── ports/
│   └── *.port.ts           # LlmProtocolAdapter, SecretStore, TdbcDriver, TdbcConnection…
├── impl/
│   └── <vendor>.*.ts       # openai.adapter.ts, env-secret-store.ts
├── logic/                  # registry, mappers, http helpers (no second impl)
├── index.ts                # optional public barrel (sksp, tdbc)
└── errors.ts               # optional; infra-local errors only
```

**Current layout:**

| Module | ports | impl | logic |
|--------|-------|------|-------|
| `llm-protocol/` | `adapter.port.ts` | `openai`, `anthropic`, `gemini` adapters | registry, mappers, http-util, tool-definitions, … |
| `sksp/` | `secret-store.port.ts` | `env-secret-store`, `composite-secret-store` | registry, ref-to-env |
| `tdbc/` | `driver.port.ts`, `connection.port.ts` | (drivers register from external packages) | open, registry, template-helper, normalize-bindings |

### Library 型（纯函数 / 解析器，无 port）

Keep flat or use `logic/` / `tags/` only when it helps navigation:

```text
infra/serialization/       # decode, encode, parse-text, stringify-text, zod-to-json-schema
infra/prompt-template/     # macro-render, macro-scan, week-cn
infra/sql-template/        # parser, evaluator, tags/
infra/date-format.ts
infra/kkv-value-codec.ts
```

Do **not** add empty `ports/` + `impl/` here.
