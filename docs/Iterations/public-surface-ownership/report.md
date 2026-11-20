---
date: 2026-11-18
---

# public-surface-ownership 执行报告

基线 `ac4d0dcbd`（p21-nm-deep）→ 本次执行，spec 见同目录 `spec.md`。

## 验收结果（2026-11-18 实测）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 根 typecheck（14 workspace） | ✅ PASS（cli 已摘除） |
| 2 | core 全量测试 | ✅ 454 文件 / 3537 用例全绿 |
| 3 | desktop 全量测试 | ✅ 全绿 |
| 4 | mobile 全量测试 | ✅ 268 套件 / 2381 用例全绿 |
| 5 | check-style --all 三段 | ✅ signatures / inline / methods 全 PASS |
| 6 | dup-gate | ✅ 新增 0（同名 117→70 消除 47、形态 258→227 消除 31——撤 re-export 顺带消掉的） |
| 7 | check-public-ownership.mjs | ✅ exit 0（`npm run check:public-ownership`） |
| 8 | 跨域 re-export | ✅ 116 → 0（raw 19 条全部命中例外表） |
| 9 | re-export 总数 | ✅ 586 → 493 |
| 10 | exports 子路径 | ✅ 32 → 34（+`./tokenizer` +`./llm-protocol`） |

## 与 spec 的三处事实修正

spec 层 C 裁决表有三条「外部零消费」的判断经全仓实测**不成立**，按实测处置：

1. **`resolveVfsToolFilePath` 留在 `public/chat.ts`**（spec 判撤）。desktop `shared/logic/chat.ts` 与 mobile `message-blocks.ts` 都在消费；`domain/tool` 无独立出口，mobile webview 侧还因 bundle 闭包只能本地镜像。已进检测器例外表（第 6 行）。
2. **`CHARACTER_CARD_MAX_FILE_COUNT` / `CHARACTER_CARD_MAX_SINGLE_FILE_BYTES` 照撤**，但 core 测试 `character-card-import.test.ts` 是真实消费方——改走 `src/domain/character-card/.../character-card-limits.js` 内部相对路径（测试不是保留公开导出的理由）。
3. **`createTemplatePullService` / `TemplatePullService` 照撤**，消费方只有 3 个 core 测试——同上改走 `src/service/template/...` 内部路径。

计数顺带修正：`RollbackOptions` 本就由 `public/message-checkpoint.ts` 导出，从 `session-fs` 撤除后净减 1，因此「保留 1 个符号」的净删除数仍是 93，总数精确落在 493。

## 执行中补的三类基础设施接线（不改任何逻辑）

- `packages/core/tsconfig.test.json`：补 `@novel-master/core/tokenizer`、`@novel-master/core/llm-protocol` 两条 paths 映射——测试经 tsx 跑 src，缺映射会落到 dist 造成 token 缓存 src/dist 双实例（首轮 core 测试 14 红的根因）。
- `apps/mobile/jest.config.js`：moduleNameMapper 补同样两条（RN preset 的 customExportConditions 不含 import，未映射子路径 jest-resolve 直接抛）。
- mobile 三个测试套件的 `jest.mock` / `require` 路径随符号归属迁移：`setup-llm-fetch`（→llm-protocol）、`chat-prompt-tokens`（provider mock 按归属拆成 tokenizer + provider 两条）、`mobile-prompt-token-counter`（三处 require → tokenizer）。

## 归属检测器

`scripts/check-public-ownership.mjs`（独立门，root `check:public-ownership`）。例外表 6 行带理由：compaction（depth 实现细节）、vfs（角色卡导入上限，symbol 级）、skills（bootstrap 定义处）、provider（infra/serialization 的 zodToJsonSchema）、smart-sort-rule（compile 返回类型，symbol 级）、chat（resolveVfsToolFilePath，symbol 级）。

## 未处理项（沿袭存量，本轮无新增）

- `find-fake-exports`：FAKE_PUBLIC 1（`userVfsTurnStorage`）+ DEAD / TEST_ONLY 存量——p19~p21 已分桶记录，本轮未新增。
- `check-oop`：16 个 OOP_CANDIDATE / MANY_EXPORTS 全部在本轮未触碰的文件，沿袭 p21 状态。
- spec §七 的不处理项（public 门面合并、prefs 门面等）照旧不排期。
