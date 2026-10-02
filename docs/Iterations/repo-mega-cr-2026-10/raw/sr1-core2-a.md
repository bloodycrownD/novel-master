---
zone: wave-b-core2 · 组 A（N-P1-02 / M-06 / summarizeToolInput）
agent: sr1-core2-a（readonly reviewer）
baseline_sha: fe79b781
files_scanned: >
  docs/Iterations/repo-mega-cr-2026-10/{PLAN.md, ledger-v2.md, fix-spec/SPEC.md,
  fix-spec/wave-b-core2.md, fix-spec/wave-e.md, raw/}
  docs/apm/RULE.md
  packages/core/src/domain/prompt/{logic/normalize-agent-prompt-layout.ts,
  logic/validate-agent-prompt-layout.ts, model/agent-prompt-layout.ts}
  packages/core/src/config-forms/stored-config-validity/assess-agent-definition-wire.ts
  packages/core/src/domain/agent/{logic/resolve-agent-tool-registry.ts, model/agent-definition.schema.ts}
  packages/core/src/service/prompt/render-prompt.ts
  packages/core/src/config-forms/agent/agent-editor-state.ts
  packages/core/src/infra/llm-protocol/logic/{openai-sse-parser.ts, anthropic-sse-parser.ts,
  gemini-sse-parser.ts, sse-parse-errors.ts, sse-line-buffer.ts, dispatch-sse-chunk.ts}
  packages/core/src/public/chat.ts
  packages/core/test/{prompt/normalize-agent-prompt-layout.test.ts,
  prompt/validate-agent-prompt-layout.test.ts, chat/skill-tool-ref.test.ts,
  infra/llm-protocol/*.test.ts, package-exports/**, config-forms/agent-editor-state.test.ts}
  apps/desktop/renderer/features/chat/message-blocks.ts
  apps/desktop/test/message-blocks-read-ref.test.ts
  apps/mobile/src/components/chat/message-blocks.ts
  apps/mobile/src/web/chat-transcript/webview/{runtime/render/tool-logic.ts,
  runtime/render/row-logic.ts, ui/render/ToolGroup.tsx, tsconfig.json}
  apps/mobile/__tests__/message-blocks-read-ref.test.ts
  apps/mobile/{package.json, jest.config.js, scripts/build-webview.mjs}
  apps/desktop/{package.json, tsconfig.json, tsconfig.renderer.json, scripts/run-tests.mjs}
  packages/{core,core/test}/package.json, tsconfig*.json, .github/workflows/ci.yml
  packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt
---

# sr1-core2-a · 组 A 逐条审查（execute-ready 判定）

**基线核对**：`git log -1` = `fe79b781 chore(release): 1.5.29`，分支 `feat/repo-mega-cr`，与 fix-spec front matter 的 `baseline_sha` 一致。
**核对方式**：所有 file:line 均在 `fe79b781` 工作树上重新打开逐行核对（Read / findstr / git grep），未照抄台账或 spec 的行号。病症均从代码重推导。

---

## 1 · 逐条 verdict 表

图例：✅ 通过 ｜ ⚠️ 有瑕疵但不阻塞（doc-fix 顺手改） ｜ ❌ 必须修（不修则实现即编译失败 / 断言不可执行 / 依赖不闭合）

| # | 条目 | 病症（代码重推导） | 证据（file:line + 引文） | 修法可行 | 验收可测 | 测试策略 | 回归线 | 依赖闭合 | 条目 verdict |
|---|---|---|---|---|---|---|---|---|---|
| A1 | **N-P1-02** `normalizeAgentPromptLayoutDomain` 白名单漏 `skillsEnabled`/`skillsPrefix` | ✅ 成立 | ⚠️ 主体全对，2 处行号归属错 | ✅ | ❌ | ✅ | ⚠️ | ❌ | **No-Go（3 处 must-fix）** |
| A2 | **M-06** SSE `data:` 无空格被整流静默丢弃 | ✅ 成立 | ✅ 逐行全对 | ✅ | ❌ | ✅ | ✅ | ✅ | **No-Go（1 处 must-fix）** |
| A3 | **`summarizeToolInput` 三处统一（core 单源）** | ✅ 成立 | ⚠️ 1 处事实错误 | ❌ | ⚠️ | ⚠️ | ✅ | ✅ | **No-Go（4 处 must-fix）** |

---

### A1 · N-P1-02

**病症重推导（成立）**。`packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts:61-73` 的返回体是显式白名单重建，逐行确认 `skillsEnabled` / `skillsPrefix` 双双不在其中；`AgentPromptLayout`（`model/agent-prompt-layout.ts:83-114`）确有 7 个可选字段，其中 `:105 readonly skillsEnabled?: boolean` / `:110 readonly skillsPrefix?: string`。受害链三处全部在位：`resolve-agent-tool-registry.ts:71 if (definition.prompts.skillsEnabled === false) {`、`render-prompt.ts:165-179` 的 `formatSkillsIndexBody` 前缀回落、`:281 if (layout.skillsEnabled !== false)`。`agent-definition.schema.ts:115-116` 的 wire 注释「缺省 = 开；仅显式 false 表示关闭」确认 spec 关于「不能照抄 `=== true`」的告警是对的。

**证据行号逐处核对**：

| spec 写的 | 实测 | 结论 |
|---|---|---|
| `normalize-agent-prompt-layout.ts:61-73` | 返回对象恰为 61-73 | ✅ |
| `assess-agent-definition-wire.ts:86`（函数 `:78-91`） | `:86 prompts: normalizeAgentPromptLayoutDomain(stored.prompts),`；函数 78-91 | ✅ |
| `resolve-agent-tool-registry.ts:71` | 逐字一致 | ✅ |
| `render-prompt.ts:165-179`，前缀回落「实为 `:174-176`」 | `formatSkillsIndexBody` 165-179 ✅；前缀三元 `:175-177`（`:174` 是 `const header =`，`:177` 是 `: DEFAULT_SKILLS_INDEX_PREFIX;`），spec 写的 174-176 少一格 | ⚠️ 轻微 |
| 调用点 `:282` / `:365` | 282 / 365 逐字一致 | ✅ |
| `validate-agent-prompt-layout.ts:308-314` | 逐字一致（308 是 `skillsEnabled === false`，309-314 是 prefix IIFE） | ✅ |
| `agent-definition.schema.ts:115-116` | 一致 | ✅ |

**❌ MF-1（核心机制无牙 + 假承诺）**：spec §1 验收把「键集 exhaustiveness」当作本条交付的护栏，§1 修法 2 还要求在模块头注释里写死一句「新增字段时同步更新 `全字段白名单往返` 用例，**否则该用例会红**」。这句话是假的。

- 该断言形态是 `Object.keys(normalizeAgentPromptLayoutDomain(full)).sort()` vs `Object.keys(full).sort()`，两侧的 `full` 都是**人手写的夹具**。
- 假设有人给 `AgentPromptLayout` 新增 `readonly foo?: string` 却忘了加白名单：`full` 里没有 `foo`，normalize 输出里也没有 `foo`，两侧键集依然相等 ⇒ **测试照样全绿**。
- 也就是说：这条断言只对「把已有的一条 spread 删掉」有牙（这部分确实成立，spec 自己也写对了），对 wave-e H2 点名的**真正失败模式**（「新增 `AgentPromptLayout` 字段时不会编译报错、也不会测试红」，`wave-e.md:658-660`）**零牙**。
- 真正有牙的只有类型层：`satisfies Record<Exclude<keyof AgentPromptLayout, "persist" | "dynamic">, null>`（`wave-e.md:708-711`），新增字段 ⇒ `Record` 缺键 ⇒ 编译红；删了已删字段 ⇒ excess property ⇒ 编译红。这正是任务问的「类型层 satisfy/映射穷举」的答案，**而 spec 把这条机制整体推给了 wave-e**。

**❌ MF-2（与 wave-e 钩子②的联动引用不闭合）**：两份 spec 对「谁写那个编译期守卫」互相甩锅，且 wave-e 内部自己也自相矛盾：

- `wave-e.md:703` 的小标题是「**Step 1（wave-b-core2 负责，本条负责钩子侧）**」，把 `NORMALIZED_OPTIONAL_FIELDS` 常量的归属划给 wave-b-core2；
- 但 `wave-b-core2.md:139-142`（§1 修法 3）明写「**Wave E 防再犯钩子②不在本条实现**：本条只交付靶子 + 一条有牙齿的单测」，**不产这个常量**；
- `wave-e.md:773-776`（H2.6）又写「wave-b-core2 的 N-P1-02 必须与本条同 PR 或严格在前」，并禁止 wave-e 自己动行为，等于默认 wave-e 自己写常量。

三方对不上 ⇒ 「靶子 → 钩子」的引用链断在中间：wave-b-core2 交出的靶子没有牙齿，wave-e 的钩子又被标成「别人的 Step 1」。doc-fix 必须二选一并把两处同步（建议：守卫归 wave-e H2，wave-b-core2 §1 依赖栏改成单向引用 + 删掉 Step 1 的归属标注）。
附带一条给 doc-fix 的实现提示：`tsconfig.base.json` 开了 `noUnusedLocals: true`，那个常量若加了却没被同文件的断言函数消费，会直接 TS6133 报错。

**⚠️ MF-3（回归线两处路径/行号归属错）**：

- `wave-b-core2.md:177-178` 写「`packages/core/test/config-forms/agent-editor-state.test.ts`（表单侧 `skillsEnabled/skillsPrefix` 的 omit 语义 **`:528-535`**）」。实测 `:528-535` 是 **`src/config-forms/agent/agent-editor-state.ts`** 的行号（`:528 ...(input.skillsEnabled === false ? { skillsEnabled: false } : {})`、`:530-534` prefix 省略逻辑）；测试文件里 `grep skills` 只命中 `:56-64` 的 `PROMPT_REGION_LABELS`，**没有任何 skillsEnabled/skillsPrefix 的 omit 用例**。行号被安到了错误的文件头上。
- `wave-b-core2.md:175-176` 写回归线 `packages/core/test/domain/agent/agent-definition.schema.test.ts`（或同目录 schema 测试）。实测 `packages/core/test/domain/` 下只有 `feature-flags/` 与 `format/`，**没有 `agent/` 目录**。真实的 schema / wire 往返用例在 `packages/core/test/agent/agent-definition-validate.test.ts`、`packages/core/test/prompt/agent-prompt-layout-wire.test.ts`、`packages/core/test/prompt/validate-agent-prompt-layout.test.ts`。

**⚠️ MF-4（验收命令之一不成立）**：`wave-b-core2.md:156` 给的第一条定向命令
`npm test -w @novel-master/core -- test/prompt/normalize-agent-prompt-layout.test.ts` **不会定向**。core 的 test 脚本是 `bash -O extglob -O globstar -c 'tsx ... --test test/**/!(performance).test.ts'`（`packages/core/package.json:121`），npm 追加的参数会落到 `bash -c` 的 `$0` 位置，**tsx 收不到**，结果跑的是全量。同行给出的第二条 `npx tsx --experimental-test-module-mocks --tsconfig packages/core/tsconfig.test.json --test <file>` 才是真定向（RULE「Windows 下跑本仓测试的两个假信号」第 ② 条同源）。保留第二条、删掉或改写第一条即可。

**已核实无问题、不需改动的部分**：

- §1 修法 1 的插入位置与代码逐字对齐 `validate-agent-prompt-layout.ts:308-314`，正确。
- 「`skillsEnabled` 不能照抄 `=== true`」的告警正确且必要（wire 与域两侧语义都是「缺省 = 开」）。
- 既有 6 条用例数核实无误：第 1 组 4 条（13/22/29/43 行）+ 第 2 组 2 条（64/83 行）= 6；「`:26` 缺省字段不出现在返回对象上」逐字一致。
- 「wire 形态走 `assessAgentDefinitionWire` 的 decode、不经本函数」核实成立（`:90`）。
- 风险栏「只影响域形态存量定义的读回路径」成立：`resolveAgentDefinitionFromStorage` 的域形态分支是唯一生产调用点。

---

### A2 · M-06

**病症重推导（成立）**。三个 parser 逐行确认同款：
`openai-sse-parser.ts:70-73` / `anthropic-sse-parser.ts:206-209` / `gemini-sse-parser.ts:199-202`，均为 `if (!line.startsWith("data: ")) { return; }` + `line.slice(6).trim()`。全仓 `git grep 'startsWith("data: ")'` 只命中这三处（第四处 `openai-content-mapper.ts:261` 是 `data:` URL 无关）；`feedSseLines`（`sse-line-buffer.ts:13-25`）确实不含任何 data 行语义；`packages/**/*.kt` 侧 `LlmSseModule.kt` 只做字节转发、无 `data` 字样 ⇒ core-only 判定成立。

**兼容性独立复核（结论：兼容面不破）**。我把 `parseSseDataLine` 的语义逐形态推了一遍：

| 输入行 | 现状（`startsWith("data: ")` + `slice(6).trim()`） | spec 修法（`startsWith("data:")` + `slice(5).trim()`） | 是否等价 |
|---|---|---|---|
| `data: {"a":1}` | `{"a":1}` | `slice(5)=" {\"a\":1}"` → trim → `{"a":1}` | ✅ |
| `data:  {"a":1}`（双空格） | `{"a":1}` | `"  {...}"` → trim → `{"a":1}` | ✅ |
| `data:{...}`（无空格） | 整行丢弃（病灶） | `{...}` | ✅ 修复目标 |
| `data:` / `data: `（空 payload） | 早退 | `""` → 返回 null → 早退 | ✅ |
| `[DONE]` / 空行 / `event:` / `:keep-alive` | 早退 | 早退（`[DONE]` 判定仍在调用方） | ✅ |
| payload 本身首尾带空白的 JSON 文本 | trim | trim | ✅ |

结论：**`data: ` 带空格分支行为逐形态不变**，spec 的兼容性判断正确。CRLF 由 `feedSseLines` 只切 `\n`、尾部 `\r` 被 `.trim()` 吃掉，spec 登记为非缺陷也对。

**证据行号逐处核对**：三处 parser 行号 ✅；`sse-parse-errors.ts:47` ✅；`sse-line-buffer.ts:13-25` ✅；`sse-parse-errors.test.ts:27 / :45 / :54` 的手写对象字面量 ✅（`:54` 是 `{ malformedLineCount: 2 }`，spec 括注里三个都写成 `{ malformedLineCount: 0 }`，不影响结论）；依赖栏提到的 wave-c1 §6#8 落在 `gemini-sse-parser.ts:122`（`mergeFunctionCallPart` 的归并键）✅，与本条 `:199-202` 确不交叠。

**❌ MF-5（验收不可执行）**：`wave-b-core2.md:255-256` 写「**三个 parser 各补一组用例**：喂 `data:{"choices":[{"delta":{"content":"Hi"}}]}\n\n`（无空格）→ 断言 `blocks.length === 1` 且 `blocks[0].text === "Hi"`」。

这条 payload 是 **OpenAI 协议形态**。喂给 anthropic parser：`processAnthropicSseLine`（`:200-212`）只按 `event.type` 分派，`{"choices":...}` 没有 `type` ⇒ 不进任何分支 ⇒ `blocks = []`；又因为 JSON 解析成功、`malformedLineCount` 为 0，`assertSseParseSucceededOrThrow` **不抛错** ⇒ 断言 `blocks.length === 1` 直接失败。喂给 gemini parser 同理（`processGeminiResponseChunk` 只看 `candidates`）。现有测试文件里三家各自的合法 payload 形态也印证了这一点：`anthropic-sse-parser.test.ts:145` 用 `{"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}`、`gemini-sse-parser.test.ts:161` 用 `{"candidates":[{"content":{"parts":[{"text":"x"}]}}]}`。

⇒ doc-fix 须把三条用例的 payload 改成各家的协议形态（无空格前缀保持不变），否则实现者会照抄这条验收、写出必红的测试，或更糟——为了让测试过而去改 parser 行为。

**已核实无问题、不需改动的部分**：

- 新增 `sse-data-line.ts` 单源、三处各改两行的修法，与代码结构吻合（`feedSseLines` 的 `onLine(line)` 回调签名现成）。
- 「`unrecognizedLineCount` 必须是可选字段」的告警**经核实成立且必要**：`SseParseDiagnostics`（`sse-parse-errors.ts:11-13`）在测试里被手写成对象字面量（`:27/:45/:54`），加必填字段会打红 TS2741，正是 RULE「给导出接口加必填字段前先扫手写假实现」那条。
- 可选加强段的豁免清单（`event:` / `:keep-alive` / 空行）与「只在 `blocks.length === 0` 时参与判定」的风险控制写得对。
- 测试命名 `SSE-DATA-NS-*` 与既有 `SSE-MAL-*` 不撞号（实测三处 `SSE-MAL-01/02` + `sse-parse-errors.test.ts` 的 `SSE-MAL-03`）。
- 回归线四个文件全部真实存在（`llm-sse-transport.test.ts` / `llm-sse-transport-port.test.ts` / `sse-chunk-emitter.test.ts` / `debug-fetch.test.ts`）。
- 「必须用带 `-O globstar` 的全量脚本」与 `packages/core/package.json:121` 一致。

---

### A3 · `summarizeToolInput` 三处统一

**清单完整性（全仓 grep 已做完，完整）**。`git grep summarizeToolInput` 全仓命中只有三处定义 + 三处调用，无第四份：

| 面 | 定义 | 唯一调用点 | 消费者 |
|---|---|---|---|
| desktop RN 侧 renderer | `apps/desktop/renderer/features/chat/message-blocks.ts:178` | 同文件 `:232`（`toolCallSummary`） | `ToolCallCard` |
| mobile WebView | `apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts:8`（已 export） | 同文件 `:42`（`toolCallSummary`） | `ToolGroup.tsx:5-9`（只 import `toolCallSummary`/`toolStatusClass`/`toolStatusLabel`，**不 import `summarizeToolInput`**） |
| mobile RN | `apps/mobile/src/components/chat/message-blocks.ts:277` | 同文件 `:319` | `ToolCallCard` |

⇒ 三个面的清单**完整**，spec 的「三条渲染路径全部活着」成立。行号 `:178-193` / `:8-24` / `:277-295` 逐字核对全部命中。

**❌ MF-6（webview 的 re-export 写法会让同文件编译失败）**：spec §3 修法 3 写「`tool-logic.ts`：改为 `export { summarizeToolInput } from "@novel-master/core/chat";`（re-export，保持对外符号名不变）」。

问题：纯 re-export（`export { X } from "mod"`）**不会把 `X` 引入本模块作用域**。而同文件 `:42` 的 `toolCallSummary` 正在调 `summarizeToolInput(row.name || '', row.input || {})` ⇒ 改成 re-export 后该行变成 TS2304「找不到名称」，webview tsconfig 直接红。

正确写法必须是两步：
```ts
import { summarizeToolInput } from "@novel-master/core/chat";
export { summarizeToolInput };
```
（附带结论：既然 `ToolGroup.tsx` 本来就不 import `summarizeToolInput`，这个 re-export 唯一的实际作用就是保住 `:42` 的本地引用——doc-fix 可在 spec 里直接写明这点，免得实现者以为它在对外暴露 API。）

**⚠️ MF-7（「公共尾巴逐字相同」是事实错误）**：spec §3 证据写「三份的公共尾巴逐字相同：`path ?? dir ?? from`」。实测：

- desktop `:194`：`input.path ?? input.dir ?? input.from`
- mobile RN `:281`：`input.path ?? input.dir ?? input.from`
- **webview `tool-logic.ts:26`：`input.path || input.dir || input.from`（是 `||`，不是 `??`）**

这不是笔误级差别：`{ path: "", dir: "x.md" }` 在 desktop/RN 下 `path` 取到 `""`、`typeof "" === "string"` ⇒ 返回 `""`；在 webview 下 `""` 为 falsy ⇒ 落到 `dir` ⇒ 返回 `"x.md"`。合并成单源时必须**显式选定一种语义**（建议取 `??`，与 2/3 份一致，且 `||` 版本对空串 path 的回落到 `dir` 本身更像历史偶然），并把该形态补进验收用例，否则合并后 WebView 摘要会静默变化且无测试锁定。

**⚠️ MF-8（验收/测试命令缺 core 重建，撞 RULE 的 dist 铁律）**：spec §3 验收命令列了
`npm test -w @novel-master/core` + `npx jest --maxWorkers=2`（mobile） + `node scripts/run-tests.mjs "test/**/*.test.ts" --test-concurrency=2`（desktop）。

本条新增了 `@novel-master/core/chat` 的导出，而**两端 app 的测试都从 core 的 dist 解析**：

- desktop：`apps/desktop/package.json:9` 的 `pretest` 只有 `ensure-test-native.mjs`（管 better-sqlite3 ABI），**不 build core**；`core-at-alias-hook.mjs` 只处理 `@/` 别名，`@novel-master/core/chat` 走 workspace symlink + exports map ⇒ 命中 `packages/core/dist/public/chat.js`；
- mobile：`jest.config.js:59-62` 把 `^@novel-master/core/chat$` 显式映射到 `packages/core/dist/public/chat.js`；而 `npx jest` **绕过了** `pretest`（`apps/mobile/package.json:8` 的 pretest 才会 build core）。

⇒ 不先 `npm run build -w @novel-master/core`，两端测试会解析到**没有 `summarizeToolInput` 的旧 dist**，症状是 import 报错或调用拿到 `undefined`，会被误判成本条改坏了。必须把 core 重建写进验收命令（RULE「改 dist 消费的包必须重建 dist」正是这条）。

**⚠️ MF-9（新测试文件路径指向不存在的目录）**：spec §3 说新增 `packages/core/test/domain/chat/tool-summary.test.ts`，并注「路径对齐 `test/domain/chat/`」。实测 `packages/core/test/domain/` 下只有 `feature-labels/` 与 `format/`，**没有 `chat/`**；仓内 chat 域逻辑测试的既有约定是 `packages/core/test/chat/`（同族的 `skill-tool-ref.test.ts`、`resolve-chat-link-target.test.ts` 都在那儿）。落点应改为 `packages/core/test/chat/tool-summary.test.ts`。

**已核实无问题、不需改动的部分**：

- 硬依赖「`public-chat-allowlist.json` 必须同 commit 更新」**经核实成立且必要**：`test/package-exports/public-subpath-allowlist.test.ts:22-31` 对 `chat` 子入口做 `assert.deepEqual(actual, [...snapshot].sort())`，多一个名字即红。快照文件 `test/package-exports/snapshots/public-chat-allowlist.json` 真实存在。
- 「WebView 侧可以引 core 的既有先例」核实成立：`row-logic.ts:6 import { formatStatusChipLabelFromAttachment } from '@novel-master/core/chat'`，且 esbuild 的 webview 打包是 `packages: 'bundle'`（`apps/mobile/scripts/build-webview.mjs:120`），会把 `public/chat.js` 整份打进去——**今天已经打进去了**，本条不新增包体面；`src/web/tsconfig.json` 的 `moduleResolution: "bundler"` 也能解析该子路径。
- 入参签名取并集 `Record<string, unknown> | null | undefined` 正确：webview 侧 `:10` 本来就最宽，另两处调用方传的都是非空 `tool.input`。
- 6 条验收用例的期望值我逐条对着三份现有实现验算过，全部对得上：#1 `"read global:my-skill"`（desktop `:190-192`）、#2 `"write my-skill"`（`:192` 的 `.trim()`）、#3 `"@researcher · 调研章节大纲"`（webview `:21-23`，desc 已 trim）、#4 只给 description 时 `parts=[desc]` 无前导 ` · `、#5 `{}`→`""` / `null`→`""`（需 `!input` 早退，合并后有）、#6 长度 ≤ 118 且以 `…` 结尾（117+1，三份一致）。
- 回归线条数核实无误：desktop `message-blocks-read-ref.test.ts` 实为 4 个 `it`（82/96/110/154）+ 2 个 `test`（292/312）= 「4+2 条」✅；mobile `__tests__/message-blocks-read-ref.test.ts` 实为 4 条 `it`（46/74/99/121）✅。
- 「必须跑 `build:webview`」与 RULE 的 webview 三层产物链一致（`package.json` 的 `pretest` 也会跑）。
- 台账定位核实：`ledger-v2.md:456` 确有该行、措辞与本片一致。

---

## 2 · must-fix 清单（doc-fix 照抄级）

| ID | 条目 | 位置（wave-b-core2.md 行号） | 问题 | 建议改法（照抄即可） |
|---|---|---|---|---|
| MF-1 | N-P1-02 | §1 修法 2（`:135-137`）+ §1 验收（`:146-155`）+ §11.3（`:1185`） | 键集断言对「新增字段」零牙；且要求写进代码注释的「否则该用例会红」是**假承诺** | ① 删掉修法 2 里那句假承诺，改写为「本白名单的字段集合由 wave-e H2 的 `satisfies Record<Exclude<keyof AgentPromptLayout, "persist" \| "dynamic">, null>` 在编译期兜底」；② §1 验收里把「键集全等」一条的定位从「exhaustiveness 护栏」降级为「回归锁（防已修字段被回退）」，并显式写明「新增字段必红由 wave-e H2 承担」；③ §11.3 的「有牙齿的 exhaustiveness 用例」改为「有牙齿的回归锁用例（对删改已有字段有牙，对新增字段无牙）」 |
| MF-2 | N-P1-02 | §1 依赖（`:182-184`）＋ 对端 `wave-e.md:703` | 编译期守卫归属三方矛盾：wave-e Step 1 标「wave-b-core2 负责」，wave-b-core2 §1 修法 3 说不在本条，wave-e H2.6 又默认自己写 | 二选一并同步两处：**建议归 wave-e H2**。改 `wave-e.md:703` 的小标题为「Step 1（本条负责）」；改 `wave-b-core2.md:182-184` 为单向引用（「钩子②落地时必须以本条用例为原型；守卫本体归 wave-e H2 Step 1，本条不产出」）。附实现提示：`noUnusedLocals: true`，常量必须被同文件断言函数消费 |
| MF-3 | N-P1-02 | §1 验收（`:156`） | `npm test -w @novel-master/core -- <file>` 不定向（参数落到 `bash -c` 的 `$0`，tsx 收不到，实跑全量） | 删掉该行，只保留 `npx tsx --experimental-test-module-mocks --tsconfig packages/core/tsconfig.test.json --test packages/core/test/prompt/normalize-agent-prompt-layout.test.ts`（并注明「core 定向跑必须带这两个 flag」，RULE 同源） |
| MF-4 | N-P1-02 | §1 回归线（`:175-178`） | ① `:528-535` 是 **src** 文件（`config-forms/agent/agent-editor-state.ts`）的行号，被安到测试文件头上；该测试文件里没有任何 skillsEnabled/skillsPrefix omit 用例。② `packages/core/test/domain/agent/agent-definition.schema.test.ts` 所在目录不存在 | ① 改为「`packages/core/src/config-forms/agent/agent-editor-state.ts:528-534` 是 omit 语义的**生产实现**（本条不改它）；`packages/core/test/config-forms/agent-editor-state.test.ts` 一并跑以防连带」。② schema/wire 往返回归线改为真实存在的三份：`packages/core/test/agent/agent-definition-validate.test.ts`、`packages/core/test/prompt/agent-prompt-layout-wire.test.ts`、`packages/core/test/prompt/validate-agent-prompt-layout.test.ts` |
| MF-5 | M-06 | §2 验收（`:255-256`） | 三条用例共用 **OpenAI 形态** payload `{"choices":[{"delta":{"content":"Hi"}}]}`。anthropic/gemini parser 不认这个结构 ⇒ `blocks=[]` 且因 `malformedLineCount=0` 不抛错 ⇒ 断言必红 | 拆成三家各自的 payload，前缀统一用**无空格** `data:`：openai `data:{"choices":[{"delta":{"content":"Hi"}}]}`；anthropic `data:{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}`；gemini `data:{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}`。各自断言 `blocks.length === 1 && blocks[0].text === "Hi"` |
| MF-6 | summarizeToolInput | §3 修法 3 第二点（`:355-357`） | 纯 re-export `export { summarizeToolInput } from "@novel-master/core/chat"` 不引入本地绑定，同文件 `:42` 的 `toolCallSummary` 会 TS2304 | 改为两步：`import { summarizeToolInput } from "@novel-master/core/chat";` + `export { summarizeToolInput };`，并注明「`ToolGroup.tsx` 本就不 import 此符号，re-export 的作用只是保住同文件 `:42` 的引用」 |
| MF-7 | summarizeToolInput | §3 证据（`:332-333`）＋ §3 修法 1（`:341-346`）＋ §3 验收（`:365-372`） | 「三份的公共尾巴逐字相同」不成立：webview `tool-logic.ts:26` 是 `path \|\| dir \|\| from`，另两份是 `??` | ① 证据栏改成「两份用 `??`、webview 用 `||`（空串 path 时行为不同）」；② 修法 1 显式定死单源采用 `??`；③ 验收补一条用例：`{path:"", dir:"x.md"}` → `"x.md"` 恒成立（按 `??` 语义实现时应返回 `""`，须把期望值写死并说明取舍）——**doc-fix 需先拍定语义再写期望值，别留两可** |
| MF-8 | summarizeToolInput | §3 验收（`:376-377`）＋ §3 测试策略（`:385-386`） | 两端 app 测试都从 core **dist** 解析（desktop `pretest` 不 build core；mobile `npx jest` 绕过 `pretest`），未先重建 core 会解析到旧 dist | 三条命令前统一加一步 `npm run build -w @novel-master/core`，或把 mobile 那条改成 `npm test -w @novel-master/mobile`（走 pretest）。理由引用 RULE「改 dist 消费的包必须重建 dist」 |
| MF-9 | summarizeToolInput | §3 验收/测试策略（`:365-366`、`:381`） | 新测试落点 `packages/core/test/domain/chat/` **不存在**（`test/domain/` 只有 `feature-lags/`、`format/`） | 落点改为 `packages/core/test/chat/tool-summary.test.ts`（与同族 `skill-tool-ref.test.ts`、`resolve-chat-link-target.test.ts` 同目录） |
| MF-10 | 打包约束 §0 | §0.1 表（`:29-34`）vs §0.2（`:46-49`）vs §11.1 硬约束①（`:1159`） | §0.1 说「一个 PR、**四个 commit**」、C3 是一个 commit；§0.2 与 §11.1① 又要求「M-04 在 C3 内**单独 commit**」⇒ commit 总数与表格自相矛盾，impl 代理照表做就会漏掉 M-04 的独立 commit | §0.1 改成「一个 PR、**五个 commit**（C3 内再分 C3a=M-03/CS-02/CS-08/B/S-D-02/summarizeToolInput、C3b=M-04）」，并在表内 C3 行注明拆分 |
| MF-11（可选，nit） | N-P1-02 | §1 证据（`:108-110`） | 前缀回落写作 `:174-176`，实测三元在 `:175-177` | 改为 `:175-177` |

---

## 3 · 已逐处核实为「spec 写了、代码确实如此」的可信点（免得 doc-fix 误改）

- A1：`normalize-agent-prompt-layout.ts:61-73` 白名单形态；`assess-agent-definition-wire.ts:78-91` 域形态分支是唯一生产调用点；`render-prompt.ts:281/282/359/365` 的 `skillsEnabled !== false` 判定链；`validate-agent-prompt-layout.ts:308-314` 的规范实现；`agent-definition.schema.ts:115-116` 的 wire 语义。
- A2：三处 parser 的 `startsWith("data: ")` + `slice(6)`；`sse-parse-errors.ts:47` 的不咬人判据；`sse-line-buffer.ts` 无 data 语义；`SseParseDiagnostics` 在 `sse-parse-errors.test.ts:27/45/54` 被手写成字面量（加必填字段必打红 TS2741）；四个回归线文件存在；`gemini-sse-parser.ts:122` 与本条 `:199-202` 不交叠；kt 侧无第二份解析。
- A3：三份定义与三处调用点行号；「只有 desktop 有 skill 分支、只有 WebView 有 task 分支、RN 两个都没有」；`ToolGroup.tsx:5-9` 的 import 面；`public-chat-allowlist.json` 快照测试确会因多一个名字而红；回归线两个测试文件的条数（4+2 / 4）；webview 已存在引 core 子路径的先例（`row-logic.ts:6`）与打包已包含 `public/chat.js` 的事实。

---

## 4 · 结论

**组 A：No-Go（条件性）** —— 三个条目的病症、行号主干、修法方向与依赖图都站得住，但按现状实现会**当场炸两处**（M-06 的验收用例必红、summarizeToolInput 的 webview re-export 编译不过），且 N-P1-02 的「exhaustiveness 断言」对自己声称要防的失败模式**没有牙齿**、与 wave-e 钩子②的归属互相甩锅——共 11 条 must-fix（9 条必改 + 2 条 nit），全部是文档级改动，不动修法方向，闭合后即可转 Go。

嗯哼～人家把每处行号都在 `fe79b781` 上重新按过一遍才敢下这个判定的哦，doc-fix 照着 MF 表抄就行啦。
