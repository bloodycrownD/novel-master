# fetch 工具实现轮（impl-fetch-tool）

日期：2026-08-26。上接 `20260826-fetch-tool-spec-review-r1.md`（SPEC 审查闭合），本轮在 worktree `.woktree/fetch-tool`（分支 feat/fetch-tool）按 spec Step 1~6 完成实现，Step 7 mobile shim 按可选项跳过（本期核心测试全部落在 `packages/core/test/tool/`，mobile 不引用 fetch 新符号）。

## 提交序列（7 个逻辑块 commit）

1. `builtin-tool-context.ts` +fetchFn 可选字段（Step 1）。
2. `fetch-tool.ts` 工具本体（Step 2）：协议白名单 superRefine、AbortController+setTimeout 超时、content-length 预检、字节预算截断、非文本占位、toolFailed 转译。
3. `format-tool-output.ts` +isFetchOutput/formatFetchOutput（Step 3）。
4. `build-tool-result-block.ts` summarizeToolSuccess +fetch 分支（Step 4）：`200 · 12.3KB` / `truncated · 50KB/1.2MB`，1024 进位 1 位小数。
5. `register-builtin-tools.ts` 注册 + 4 处 registry 计数断言 9→10（Step 5）。
6. `agent-tool-catalog.ts` +fetch 行 + catalog 测试计数与条目断言（Step 6）。
7. `fetch-tool.test.ts` T-FT1~T-FT13 + `format-tool-output.test.ts` 形状回归。

## 实现口径（与 spec 的对齐点）

- 截断标注行 `Output truncated (original N bytes).` 由工具本体附在 body 末尾（不计入 FETCH_MAX_BODY_BYTES 预算），formatter 只拼 GET/Status 头不重复追加——T-FT3 与 T-FT10 都按此断言。
- 多字节截断：TextEncoder 增量按块（8192 字符）编码累计、末块逐码位（codePointAt，代理对成对）推进找切点，避免切半个字符。
- 预检路径 body 占位 `[response too large, not downloaded]` + 标注行，originalBytes 回填 content-length 头数值；`text` 未被调用（fakeResponse 记 textCalls 断言 0）。
- summary 保留量：正常截断按预算口径（50KB），预检/占位路径 body 很小按 body 现算（诚实展示未下载）。
- fetch 输出 url 字段是 `new URL(input.url).href` 规范化值；finalUrl 取 response.url，空串回填请求 URL。

## 环境坑（worktree 首次使用）

- `packages/core` 部分 test（helpers/novel-master.ts）依赖 core dist 与 `@novel-master/tdbc-driver-better-sqlite3` dist，worktree 需先 `npm run build -w @novel-master/core` 与 build 该 driver，否则 ERR_MODULE_NOT_FOUND（与改动无关）。
- 默认 shell 是 sh（dash），`npm run test` 的 extglob `test/**/!(performance).test.ts` 报语法错；绕过：`bash -c 'shopt -s extglob; npx tsx ... --test "test/**/!(performance).test.ts"'`。

## 验证结果

- 定向：fetch-tool.test.ts + format-tool-output.test.ts 41 用例全过；5 个计数断言文件 71 用例全过。
- 全量：core 2169 用例全过；typecheck、eslint（改动文件）干净。
