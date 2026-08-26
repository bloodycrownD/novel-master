# thinking-openai-unify 迭代实现（impl）

- 日期：2026-08-26
- 节点：impl-thinking-openai-unify
- worktree：`.woktree/thinking-openai-unify`，分支 `feat/thinking-openai-unify`
- 前置：spec 见 `docs/Iterations/thinking-openai-unify/spec.md`，spec review 记忆见 `20260826-thinking-openai-unify-spec-review-r1.md`

## 完成内容（Step 1~5 全部落地）

1. **Step 1（43cde79）**：`apply-thinking-to-body.ts` 的 `applyOpenAiThinkingToBody` 拆除 GLM 特判（删 `openai-glm-thinking.js` import 与 `isGlmDefaultThinkingOnModel` 分支），签名收窄为 `(body, thinking)` 两参；`openai.adapter.ts` 的 `buildBody` 与 `chatTextOnly` 两处调用去第三参。全仓 typecheck 通过。
2. **Step 2（d9ca747）**：整文件删除 `openai-glm-thinking.ts`；grep（`isGlmDefaultThinkingOnModel|applyGlmThinking|openai-glm-thinking`，排除 dist / node_modules / .woktree）主树零残留；`clean -w @novel-master/core` 后 typecheck 通过。
3. **Step 3（e57d932）**：改写 `openai-thinking-body.test.ts`（GLM 用例改统一断言、新增 buildBody / text-only 两条 adapter 路径 GLM 覆盖、旧调用去第三参），删除 `openai-glm-thinking.test.ts`；定向 9 用例全过。
4. **Step 4（a51098f）**：`thinking-level-presets.test.ts` 补 glm-4.7 / glm-5.2 与 gpt-* 四档一致断言；`model-request-thinking.test.ts` 的 `createService` 加自定义 `vendorModelId` 参数并补 medium / off 用例；定向 12 用例全过。
5. **Step 5**：core 全量 2157 测试全过、三个基线文件（anthropic / gemini / glm-tool-stream）零改动通过；改动文件 eslint 零告警。

## 环境坑（复用价值）

- `npm install` 会把 lockfile 里落后的 workspace 版本号（desktop/mobile 1.5.1→1.5.4）同步进 `package-lock.json`，与迭代无关，已 checkout 还原、不混入提交。
- core 全量 `npm test` 的 glob `test/**/!(performance).test.ts` 是 bash extglob 语法，默认 sh/dash 跑不了；需 `bash -O extglob -c '...'` 且 tsx 在 worktree 根 `node_modules/.bin/tsx`。
- 全量测试依赖 `packages/core/dist`（test/helpers 引 `dist/public/...`）与 `tdbc-driver-better-sqlite3/dist`：clean 之后必须先 `npm run build -w @novel-master/core` 与 `build -w @novel-master/tdbc-driver-better-sqlite3`，否则 100+ 用例 ERR_MODULE_NOT_FOUND（是环境问题，不是代码回归）。
- `npm run lint -w @novel-master/core` 基线上存在两个遗留 error（`sanitize-entry-filename.ts` no-control-regex、`annotate-source-range.ts` prefer-const），非本期引入、不在 spec 范围，未处理。
