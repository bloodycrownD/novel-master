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
- **`domain/provider/model/saved-model-settings-from-json.ts`** — wire encode/decode helper; stays beside schema in `model/`.
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
| `llm-protocol/` | `adapter.port.ts` | `openai`, `anthropic`, `gemini` adapters | registry, mappers, `postSse` (fetch + RN XHR), `stream-partial-blocks`, protocol SSE parsers, http-util, tool-definitions, usage-parser, … |

**LLM protocol capability matrix** (user abort returns partial `blocks` via `buildStreamPartialBlocks`; streaming uses `postSse` on all three protocols):

| Protocol | Stream | Abort partial | RN SSE (`postSse`) | Tools / multi-turn |
|----------|--------|---------------|--------------------|--------------------|
| openai | yes | yes | yes | yes |
| anthropic | yes | yes | yes | yes |
| gemini | yes | yes | yes | yes |
| `tokenizer/` | `token-counter.port.ts`, `token-counter-registry.port.ts` | `heuristic-token-counter` | resolve-tokenizer-family, serialize-prompt-input, create-default-registry, count-prompt-llm-input |
| `nmtp/` | `tokenizer-driver.port.ts` | — | registry (`registerTokenizerDriver`, `resolveTokenizerDriver`) |
| `sksp/` | `secret-store.port.ts` | `env-secret-store`, `composite-secret-store` | registry, ref-to-env |
| `tdbc/` | `driver.port.ts`, `connection.port.ts` | (drivers register from external packages) | open, registry, template-helper, normalize-bindings |

**External NMTP drivers** (zero native deps in core): `@novel-master/tokenizer-driver-node` (CLI / Electron), `@novel-master/tokenizer-driver-rn` (Android RN + Kotlin `TokenizerModule`).

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

## 发版策略（A-18）

本仓库是 monorepo，内部包和端产品承担的角色不一样，所以发版义务也要分开看。

`packages/*` 下的所有包，以及 `apps/cli`，都属于内部包。它们的 `version` 字段统一锁在 `0.0.0`，不承担 semver 义务，也不会单独发布到任何 registry。内部包之间的相互引用走 npm workspaces 解析（依赖声明里直接写包名，由 workspace 把它指向本地源码），所以版本号本身没有实际意义，锁定 `0.0.0` 只是为了表明「这一层不发版」。

真正承担发版义务的是端产品：`apps/desktop`、`apps/mobile`、`apps/cli`（CLI 作为对外分发的可执行产物时）。这三者保留各自的 semver 版本号，按各自的产品节奏迭代。换句话说，版本语义只在外部可见的产物上才有意义，内部包永远跟着 main 走，不需要维护变更日志或兼容性承诺。

完整的发版流程、版本号维护规则、以及内部包与端产品的边界，落在 [`docs/release.md`](../../docs/release.md) 里，这里只做原则性声明。

## 测试 runner 约定

仓库里大多数包用 Node 自带的 test runner 跑测试，命令统一是 `tsx --test`，core、各 driver 包、cli 都是这么做的。这样能少一层依赖，跑得也快。

`apps/mobile` 是这条约定的显式例外——它仍然走 Jest。原因是 React Native 项目的社区默认就是 Jest，配套的 mock 体系（`jest-preset`、`react-test-renderer`、原生模块 mock）都建立在 Jest 之上。如果强行把 mobile 迁到 `tsx --test`，会丢掉 RN 这套成熟的 mock 能力，得不偿失。所以 mobile 维持 Jest 不动，这里登记为例外，避免后续清理时被误判成「不一致」而强行统一。
