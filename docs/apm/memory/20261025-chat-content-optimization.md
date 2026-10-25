---
date: 2026-10-25 14:23
title: chat/content 优化 + truncateText + AppError/Result + annotate 死链清理 + nm-code-style 脚本化检查
keywords: domain/chat/content, parse-message-content, message-body-text, format-message-cli, truncateText, common/text, messageBodyTextFromBlocks, CHAT_INVALID_ARGUMENT, AppError, Either, 单行 wrapper, 错误工厂, 内联, nm-code-style
abstract: 用户要求按 nm-code-style 优化 packages/core/src/domain/chat/content，随后指出 truncate 应抽成通用工具、messageBodyText / messageBodyTextFromContent 两个单行 wrapper 没有存在意义、content 里的 throw 应迁到 AppError + Either。已落地：新增 core/common 的 truncateText 并收敛 core 11 处、mobile 2 处、desktop 1 处同语义截断；删除两个转手 wrapper，全仓改为直接传 blocks；新增 CHAT_INVALID_ARGUMENT=106001，parse 链路改为 Result<MessageContent, AppError>、删除 assertMessageContent、边界统一 throw。第一版迁移因错误工厂 wrapper 与单点私有函数被用户指出不合规，已重写为全部内联（只保留多处复用的 requireString）。core 相关套件、三端 typecheck、CLI chat smoke 全绿；usage-stats 两条时区红与 CLI 其余 25 条会话创建前置 agent 的旧测试红均为基线既有。已提交 0ee49a229 并推送到 origin/feat/core-errors-either。
---

user:
$apm-recall 恢复记忆，`D:\Dev\Js\novel-master\packages\core\src\domain\chat\content` 按 $nm-code-style 优化下吧。

assistant:
先核了四个文件和消费方：`formatMessageForCli` 有 apps/cli 真实调用，`messageBodyText` 被 desktop / mobile / tokenizer 驱动经 `@novel-master/core/prompt` 使用，`parseMessageContent` / `assertMessageContent` 被仓储、usage-stats、message.service 和 CLI 使用，`textBlocks` 多处使用——没有假公开或死导出可撤，`find-fake-exports` 报的 FAKE_PUBLIC 是 barrel 转发导致的漏计。

最终落了三个文件的收敛，`text-blocks.ts` 不动：

1. `parse-message-content.ts`：删掉 `BLOCK_TYPES` 预检（与 switch default 重复，且 default 的 “unsupported type” 本来不可达），未知类型统一由 default 报详细文案；`optionalBoolean` 单点调用内联；`parseImageSource`、`parseSkillRefMeta` 两个单点私有函数内联；空 text 丢弃规则从 `parseBlocksArray` 下沉到 `parseBlock` 的 text 分支（返回 null），循环改用 `entries()`；meta 改用 `ToolResultBlock["meta"]`，去掉重复的匿名结构；`assertMessageContent` 合并 `"blocks" in` 与 `Array.isArray` 两道检查。
2. `message-body-text.ts`：内联单点 `stripOrphanThinkingCloseTags`；`blockBodyText` 与 `messageBodyTextFromBlocks` 去掉永不成立的 `!== ""` 判断（空文本已由 null 表达）；`formatChatMessageForCliPreview` 从两遍遍历合成一遍，tool 段改在末尾 `unshift`（输出顺序不变）。
3. `format-message-cli.ts`：单点 `formatBlock` 内联进 map，删除不可达 default，两支 content-block 类型导入合并。

验证：core `typecheck` 通过，改动目录 eslint 通过；`test/chat`（排除 usage-stats）468 例全绿、`test/prompt` 202 例、`test/infra/tokenizer` 226 例、`test/package-exports` 21 例全绿。`usage-stats.service.test.ts` 的 T-C2 / T-C6 两条时区、DST 断言是基线既有红（git stash 后原样复现 37/39），与本次改动无关。

user:
对了，优化完先别提交，我审查下。

assistant:
收到，改动只留在工作区（3 个 modified 文件），不做 git add/commit，等用户审查后再决定。

user:
truncate 是常用的截断工具吧？感觉可以抽为工具。

assistant:
先把仓里的截断实现扫了一遍，确认有两种不同约定：多数是「超过 N 就保留前 N 个字符再补省略号」（输出最长 N+1），另一批是「总长不超过 N」（保留前 N-1 个字符再补省略号，如 117/120 那几处）。按占多数的那种抽公共工具，避免悄悄改变另一批的显示长度。

落地：

- 新增 `packages/core/src/common/text.ts`：`truncateText(text, maxChars)`（超长才补 `…`，输出长度上限 `maxChars + 1`），从 `@novel-master/core/common` barrel 导出；新增 `packages/core/test/common/text.test.ts` 覆盖未超长/恰好等于上限/超长/UTF-16 码元切片。
- 替换同语义实现：core 内 `format-message-cli`、`tool-arguments-parse`（删本地 `truncate`）、`agent-runner`（删本地 `truncateRaw`）、`excerpt-release-notes`、`longest-common-substring`、`status-chip-label`、`sse-parse-errors`、`http-util`、`llm-sse-transport`、`debug-fetch`（2 处）；mobile `FileMarkdownPreview`（2 处）、desktop renderer `SettingsViews`（删本地 `truncateInvalidMessage`）。
- 未动「总长不超过 N」语义：`prompt-preview-turns`（69）、`tool-summary`（117）、`build-tool-result-block`（117）、mobile `message-blocks`、webview `tool-logic`、mobile `PromptTurnCard`；要统一得先定契约。

验证：core `typecheck` 通过；common 18 例、vfs 390 例、chat 468 例、infra/llm-protocol 212 例、agent 192 例、package-exports 21 例全绿；mobile typecheck 通过、`FileMarkdownPreview` 17 例通过。agent-runner 的 `_branch` 未使用 lint 错误经 stash 复核为基线既有；desktop renderer ratchet 红的 69 条是基线里写死了 `D:/Dev/nm-worktree/mcr` 的历史路径导致的身份不匹配，不是本次新增。改动仍全部留在工作区，未提交。

user:
（贴出 `messageBodyTextFromContent` / `messageBodyText` 两个函数）没有看出这两个函数的意义，一行代码为什么要封装？

assistant:
同意，这两个都是没有策略/校验/默认值/依赖隔离的单行转手 wrapper，按 nm-code-style 应当删除；真正干活的是 `messageBodyTextFromBlocks`，保留它。

落地：

- `message-body-text.ts` 删除两个函数；`domain/prompt/logic/message-body.ts` 只留 `messageBodyTextFromBlocks` 与 `formatChatMessageForCliPreview`；`public/prompt.ts` 撤掉 `messageBodyText`，allowlist 快照同步删名。
- core 生产调用点内联：`prepare-user-messages-for-prompt`、`user-vfs-turn-view`（4 处）、anthropic/gemini/openai 三个 adapter（原来给 `{ blocks }`，现在直接传 `blocks`）、`heuristic-token-counter`。
- 跨包：tokenizer-driver-node 3 处、desktop 2 处、mobile 1 处；mobile `core-shim` 里已无消费者的 re-export 删掉，jest mock 键同步改名。
- 测试：12 个文件约 100 个调用点改为 `messageBodyTextFromBlocks(x.content.blocks)`；`message-body-text.test.ts` 改为直接测 blocks 入口并删掉 ChatMessage wrapper 用例；`agent-runner-lifecycle.test.ts` 去掉未使用 import。用一次性 codemod 脚本批量处理，期间发现并修掉两处尾逗号拼接（`[0]!,.content.blocks`）。
- 验证：core typecheck；chat 467、prompt 202、agent 192、tool 332、workplace 122、tokenizer 226、llm-protocol 212、common 18、package-exports 21 全绿；tokenizer-driver-node 30 例 + typecheck、desktop main typecheck、mobile typecheck + chat-prompt-tokens 25 例均绿。lint 只剩三处基线既有的 `_` 参数未使用（`_branch` / `_sessionMaxSeq` / `_vendorModelId` / `_options`，均非本次改动引入）。改动仍未提交。

user:
（贴出 `textBlocks`）这个何意味？为什么不用 class 呢？都 TS 为什么用 js 风格的函数构建呢？看起来有 throw，先把 ChatError 改成 AppError 吧；由于 ChatError 使用量较大，所以不删除先并存，我们先迁移 content 中的相关文件为 Either。

assistant:
`textBlocks` 先不改：`MessageContent` 是持久化 JSON DTO（`content_json`、IPC、RN 桥都走纯对象），class 实例过序列化会退化成 plain object，只有创建路径是实例会制造「实例 / 纯对象」双形态和失效的 `instanceof`；它没有行为/状态/身份，TS 里数据 DTO 用 interface + 工厂函数，class 留给行为（如 `DoomLoopDetector`）。`textBlocks` 有 7 处生产调用和大量测试，命名比重复字面量好读，保留。

content 迁 Either：

- 错误码表新增 `CHAT_INVALID_ARGUMENT: {code: 106001, desc: "invalid chat argument"}`（域 106 chat），注册表守卫测试补 `CHAT: [106000, 106999]` 号段。
- `parse-message-content.ts` 改为纯 Result：`parseMessageContent(json)` 与 `parseMessageContentValue(value)` 返回 `Result<MessageContent, AppError<"CHAT_INVALID_ARGUMENT">>`；删除 `assertMessageContent`，公共导出与 public-chat allowlist 同步改为 `parseMessageContentValue`。
- 边界决定抛不抛：repository 读行、message.service 的 append/updateContent、CLI append 都写 `if (!r.ok) throw r.error;`；usage-stats 的坏行从 try/catch 改成 Result 分支（仍 warn 后按 0 计）；CLI 的 `--content/--file` 走 `textBlocks` 不需要再校验。
- 测试改为断言 Result：content-blocks 12 例重写（含原对象不再被就地改写）、tool-result-meta 的 5 处 parse 与 2 处错误断言同步；`app-error.test.ts` 只加号段。

user:
先停一停，你怎么不按照 nm-code-style 规范写代码？（贴出 `invalid()` 与 `optionalString`）这种不符合规范。

assistant:
承认第一版迁移退回了旧习惯，按规则重写 `parse-message-content.ts`：

- 删掉 `invalid()` 错误工厂（只有 `new AppError` 的 wrapper），所有失败点直接 `Result.err(new AppError("CHAT_INVALID_ARGUMENT", ...))`。
- 删掉 `optionalString`，可选字符串判断在 4 个使用点内联。
- 删掉 `parseImageSource` / `parseSkillRef` / `parseMeta` / `parseBlocksArray` / `parseBlock` 这些单点私有函数，全部并回 `parseMessageContentValue` 的循环 + switch（空 text 块直接 `continue`）；只保留被 8 处复用的 `requireString`。
- 验证：core typecheck；content/meta/registry 27 例、chat 468 例、package-exports 21 例全绿；usage-stats 仍是基线既有的 2 条时区红（37/39）；CLI typecheck、desktop main typecheck、mobile typecheck 通过。重建 core / tokenizer-driver-node / CLI 的 dist 后，CLI chat smoke（message append/list）通过；CLI 全量 68/93，其余 25 条红是基线旧测试——会话创建现在要求先有 agent，错误来自 `session.service.ts:111`（引入于 c3032e5e1），与本次解析链无关。已提交 0ee49a229 并推送到 origin/feat/core-errors-either。

user:
（贴出 `sliceSourceBySoftRange` 多行签名）你是不是瞎啊，这些函数参数不换行你一点都不遵守啊？另外 `findAnnotateOccurrenceInSource` / `buildFlatTextIndex` / `estimateSoftOffsetRangeFromQuoteContext` 这些同样无人使用。更新下 skill 吧，对于这种死代码也移除吧。另外我发现 skill 要求检查的东西全部可以通过脚本程序化检测，比如内联、不换行；你应该写出脚本，skill 用这些脚本循环检查再改，不要总靠读整个文件。

assistant:
先沿调用链确认这三个 annotate 文件都是退役 DOM 搜字 fallback 的一部分：`applyAnnotateHighlights` 生产零调用，`findAnnotateOccurrenceInSource` / `buildFlatTextIndex` / `estimateSoftOffsetRangeFromQuoteContext` 只服务它。按用户决定整条删除，而不是只删叶子：

- 删除 `annotate-highlight.ts`、`annotate-source-anchor.ts`；`annotate-source-range.ts` 先收敛到只剩 `estimateSoftRangeFromOriginalText`，随后按「单引用」内联进 `run-agent-turn.ts`（`offsetToSourceLineCol` + 原文定位块），文件删除。
- 桌面 `preview-annotate.ts` 的两个单点函数内联进 `PreviewPane.tsx`，文件与测试删除。
- 删除 `buildAnnotateAttachmentFromDraft` 单行 wrapper，生产调用统一到 `buildFileAnnotateAttachmentFromDraft`；public/chat、desktop shared barrel、allowlist、4 个死 API 测试同步清理。
- 新增 `check-signatures.mjs`（多行参数/调用/new/import）、`check-inline.mjs`（DEAD_LOCAL / INLINE_LOCAL / PASS_THROUGH / CLASS_PRIVATE）、`check-style.mjs`（`--changed` 只看新增行，循环到 PASS）；`find-fake-exports.mjs` 补 `apps/desktop/renderer|shared` 生产路径与汇总。SKILL 增加死链沿调用链删到底、`INLINE_CANDIDATE` 默认内联、脚本循环与 30 秒清单。
- 关键教训：`find-fake-exports` 早已把 `estimateSoftRangeFromOriginalText` 标成 `INLINE_CANDIDATE`，但 `check-style` 只把 signatures/inline 当失败，skill 又留了 service→domain 单引用例外，导致漏做；已收紧为 `INLINE_CANDIDATE` 默认内联，只有确认跨层唯一入口才留并写明理由。

验证：core/desktop main/mobile typecheck 通过；renderer typecheck 仅基线既有错；core chat 478 例 476 绿（T-C2/T-C6 时区/DST 基线红）、package-exports 21、annotate/attachment 24、desktop preview 8、mobile 相关 20+12 全绿；`check-style --changed` 为 signatures=PASS inline=PASS。提交：`2c1092c1d`（annotate 死链清理，24 files，+124/−4437）、`b972aac30`（style 脚本，6 files，+378/−6）；推送：`origin/feat/core-errors-either`。

user:
下一轮：`attach-binary-heuristic.ts` 感觉是通用的文件工具，可以抽离；然后优化 `chat-annotate-draft-store.ts` / `build-attachment-action-xml.ts` / `attach-budget.ts`，通过脚本循环检查。另问循环检查用动态工作流是否更好。

assistant:
工作流问题：脚本循环是确定性检测（跑脚本 → 看行号 → 改 → 再跑），普通 shell/代理循环更稳也更省 token；动态工作流适合“多文件并行 + 模型判断”的审查，主循环不上，需要并行复核时再开。

落地：
- 新增 `core/common/file.ts`：`isBinaryFilePath` / `isImageFilePath`，路径分隔符同时认 `/` 与 `\`；删除 `domain/chat/logic/attach-binary-heuristic.ts`。`prepare-user-messages-for-prompt` / `scan-at-path-attachments` 改深导入 `@/common/file.js`；mobile webview core allowlist 路径同步改成 `common/file.js`，并补 `common/text.js`（ChatTranscriptBridge 经 common barrel 带入的小纯函数）；webview 四包 gate B/C 全绿。
- `chat-annotate-draft-store`：`cloneDrafts` 单点内联；两个 remove 抽 `removeDraftsBy` 共用；签名/import 收一行。
- `build-attachment-action-xml`：删除 `buildAttachmentActionXml` 单行转手 wrapper，统一调 `buildUserVfsActionXml`；`buildAlreadyReferencedActionXml` 单点内联；`mintAnnotateDraftId`、`formatAnnotateLocationLabel` 内联；`asParamPositiveInt` / `asParamNonNegInt` 合成 `asParamInt(value, min)`；public/chat 与 allowlist 撤掉 `buildFileRefActionXml` / `buildDirTreeActionXml` / `buildAlreadyReferencedActionXml` / `buildAttachmentActionXml` 四个无 app 消费者的导出，保留 `buildFileAnnotateAttachmentFromDraft` 与 `parseAnnotateDraftsFromAttachments`（mobile/desktop 真用）。
- `attach-budget`：`createAttachBudget` 闭包工厂改为 `class AttachBudget { private used; tryConsume }`，prepare 改 `new AttachBudget()`。`ATTACH_PROMPT_CHAR_BUDGET` 仍留 public：desktop/mobile 预算测试直接引用它自动跟随预算值，脚本报 FAKE_PUBLIC 属契约常量例外；`OVERSIZED/BINARY` 文案与 `AttachBudget` 只服务 prepare 链，保留为单源模块。
- 验证：core typecheck；targeted 169 例、package-exports 21、desktop main typecheck、mobile typecheck、webview build 四包 gate 全绿；`check-style --changed` 为 signatures=PASS inline=PASS；改动文件 lint 干净。未提交，等用户审查。

user:
（质疑 `removeChatAnnotateDraftsByPath` 假引用、`removeChatAnnotateDraft` 单行 wrapper、`updateChatAnnotateDraft` 一处使用、`unionComposerStatusWithAnnotate` 一处引用；问脚本没检测出来还是检测出来没改）

assistant:
先认两点：脚本 v1 只数「直接 import 定义文件」的文件数，不解析 barrel 再导出、也不数调用点；store 那批 `FAKE_PUBLIC` 我按“barrel 转发”人工放过了，没有逐个核实际调用，这是错的。

- `removeChatAnnotateDraftsByPath`：真实生产调用 0（只有 core 测试），删除；public/chat、desktop shared barrel、renderer 包装层、allowlist、测试引用同步清理。
- `removeDraftsBy` 因此只剩 `removeChatAnnotateDraft` 一处调用，内联回它；`removeChatAnnotateDraft` 现在是完整过滤/删除/通知实现，不再是单行 wrapper。
- `removeChatAnnotateDraft` 生产调用 2 处（desktop PreviewAnnotateUi + mobile FileMarkdownPreview）；`updateChatAnnotateDraft` 2 处；`unionComposerStatusWithAnnotate` 7 处——都不是单点，保留。
- `find-fake-exports.mjs` 升到 v2：`prod`/`test` 改成**调用点 / 值引用点**（`Nc/Nr`），解析 named import、`as` 别名、`@novel-master/core/chat` / `@shared/logic/chat` barrel 转发；新增 `AMBIGUOUS`（同名多定义）与 `--strict`；类和大写常量不做 inline 候选。旧版“直接 import 文件数”既会漏 barrel 调用，也会把 live export 误报成 FAKE_PUBLIC。
- 仍报 `FAKE_PUBLIC` 的两项保留：`resetChatAnnotateDraftStoreForTests`（测试支持 API，24 处测试调用）、`ATTACH_PROMPT_CHAR_BUDGET`（跨端预算契约，desktop/mobile 预算测试直接引用以自动跟随值）；是否严格撤 public 待用户定。
- 验证：core typecheck；store 6 例；package-exports 21；webview 四包 gate B/C 绿；`check-style --changed` 为 signatures=PASS inline=PASS。未提交。

user:
（追问 `build-attachment-action-xml.ts` 是否跑了检测；说还发现一个问题；后澄清 `parseAnnotateDraftsFromAttachments` 的“一处引用”是 WebStorm 直接引用，实际两处 barrel 调用）

assistant:
跑了：运行时导出 4 个全 KEEP。复核出并修掉三处问题：

- `AttachmentDisplayKind` 是导出类型但外部零引用 → 收成模块内 `type`；`find-fake-exports` 之前只看运行时导出，现已补 `TypeAlias` / `Interface` 与 `TypeReference` / `typeof` 计数，并加 `test-find-fake-exports.mjs` fixture 测试（barrel 单调用 / 双调用 / 测试引用 / 类型引用）。
- `asParamString(value, fallback = "")` 的 fallback 参数从未被传 → 删掉默认参数。
- `buildFileAnnotateAttachmentFromDraft` 8 段 `if (draft.x != null) params.x = draft.x` 重复 → 收敛成 key 列表循环。

`parseAnnotateDraftsFromAttachments` 经脚本 v2 核对是 **2 处生产调用**（desktop `rollback-annotate-restore.ts:55`、mobile `useChatTabMessageActions.ts:241`），WebStorm 显示的 1 处是直接引用；用户确认不内联。

## 2026-10-25 08:25 composer 四文件收敛与导出审计 v3

- composer-sendable-input.ts 删除：hasComposerSendableInput 的唯一三元门闩内联进 resolveComposerSendIntent；输入 attachments 字段从未被读取，连同 ComposerSendIntentAttachment 一起移除，desktop/mobile 调用点与测试同步删除。
- 类型面收私有：ComposerSendIntent/Input、ComposerTrigger、ComposerChipAttachment、ComposerSendableInput，以及 mobile controller 的 ConversationComposerState/ChatComposerController/UseChatComposerControllerOptions；测试改用 ReturnType/Parameters。
- composer-at-path：5 个多行签名压成一行，basename 内联；countScannedAtPathAttachments 删除（测试改用 scanAtPathAttachments）；filterAtPathTypeaheadCandidates 只有 desktop ChatComposer 一处生产调用，已内联并从 public/shared/双端 wrapper/allowlist/测试撤出。
- composer-chip-attachment：isComposerStatusAttachment 内联进 partition，不再导出。
- compute-stream-tail-generating.ts 与 DEFAULT_STREAM_TAIL_IDLE_MS 全删（public 转发 + 测试，无生产消费者），测试与 allowlist 同步清理。
- 脚本 v3：find-fake-exports --strict 纳入 PUBLIC_ONE_REF；check-style --changed/--all 把导出审计计入退出码；新增 --all 全 core 扫描，解决 --changed 看不到未改动文件死代码的问题；新增 nm-style: keep-public 注释豁免（跨层唯一入口/契约常量/测试支持 API），ATTACH_PROMPT_CHAR_BUDGET 与 resetChatAnnotateDraftStoreForTests 已标注；INLINE_CANDIDATE 改为必须恰好 1 次调用 + 0 值引用，修掉 JSX/值引用组件误报。
- 验证：check-style --changed PASS（signatures/inline/exports）；脚本自测通过；core composer 18、desktop 11、mobile 12 + controller 41、package-exports 21 全绿；core/desktop main/mobile typecheck 通过，renderer 仅基线错误且无 composer 报错。chat logic 目录严格审计仍有 30 FAKE_PUBLIC/18 DEAD/2 TEST_ONLY/4 INLINE_CANDIDATE/11 PUBLIC_ONE_REF 存量，未在本轮处理。
- 改动未提交。

补充（脚本修正）：
- check-signatures 原实现有 `params.length < 2` / `args.length < 2` / import `< 2` 的早退，单参数多行签名、单实参多行调用、单具名 import 拆行全部漏检；已改为比较节点起始行与第一个参数/实参/import 元素行，并继续比较相邻行。resolveComposerSendIntent 的单参数多行签名已压回一行。
- PUBLIC_ONE_REF verdict 取消：public 单点函数统一判 INLINE_CANDIDATE（public=yes），public 不再是保留理由；strict 直接失败。public=yes 只影响撤导出时要同步 barrel/allowlist。
- SKILL 强制“未处理项报告”：DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE 未改必须在交付说明逐条列符号、计数、理由、证据；“public/共享 API”不能作为理由，只能写三端唯一入口/契约常量/测试支持 API 等具体原因。

再补充（一行规则扩展）：
- check-signatures 新增 VARDECL / ASSIGN：const/let/var 与赋值右侧简单表达式不得拆行（含 `=` 后换行、二元/三元跨行）；对象/数组/箭头/JSX/模板等多行块不误报，调用/构造的多行实参仍由 ARGS 报，避免重复。
- 新增 scripts/test-check-signatures.mjs：fixture 覆盖单参数签名、单实参调用、单个具名 import、const RHS 拆行、赋值 RHS 拆行，并断言对象/数组/箭头多行不报。
- composer-send-intent 的 scannedCount/hasSendable/sendDisabled 等已由用户压成一行；脚本现在能在回退时抓到。

## chat-annotate-draft-store 对象化
- bySession / listeners 收进 ChatAnnotateDraftStore 类私有字段；CRUD/订阅/chip 投影改为实例方法（箭头字段，保持解构调用不丢 this）。
- 模块继续 export const xxx = store.method 保留现有函数入口，public/chat、allowlist 与三端调用点不动；对象成为唯一状态归属。
- notify 不作为 class private method（check-inline 的 CLASS_PRIVATE 口径），改为模块级 notifyListeners(listeners, sessionId)。
- 验证：core typecheck / eslint / check-style 单文件 PASS；store 6、desktop annotate 6、mobile annotate 9、package-exports 21 全绿；core build 通过。

## 2026-10-25 chat-annotate-draft-store 完整对象化 + OOP 检查
- 导出 chatAnnotateDraftStore 单例，删除 10 个函数别名；public/chat、allowlist、desktop shared、desktop renderer wrapper、desktop main、mobile 生产代码与 12+ 测试全部改为 store.method。
- desktop wrapper 保留 unionComposerStatusWithAnnotate DTO 适配；chipsFromAnnotateStore 无消费者已删。
- 新增 check-oop.mjs：模块级 Map/Set/let + >=2 导出函数共享状态 → OOP_CANDIDATE；导出函数 >=6 → MANY_EXPORTS（人工 review）；类/对象模块不报；接入 check-style（默认 REVIEW，--strict 阻断），新增 test-check-oop.mjs。
- SKILL 新增 §9：OOP 最后一步；只在共享可变状态 + 多操作 + 生命周期/不变量时对象化；纯函数/DTO/hook 不建类；OOP_CANDIDATE 必须处理或报告理由。
- 四 composer 文件 check-oop 全 KEEP；下一个候选是 apps/mobile/src/storage/chat-composer-draft.ts（8 导出、bySession×7 + listeners），但先要清它的 DEAD/INLINE 项，符合 OOP-last。

## 2026-10-25 第二批四文件收敛
- diff-workspace-for-user-vfs-flush.ts：@deprecated，生产 0、测试独占（diff/isEmpty），整模块 + 单测删除；无 public/allowlist 引用。
- fork-session-title.ts：nextForkSessionTitle 唯一生产调用在 message.service.forkUpTo；标题生成逻辑内联进该 service，模块 + 单测删除。
- mask-composer-scan-ranges.ts：maskComposerScanRanges 唯一生产调用在 run-agent-turn；夹取/排序/去重/等长空白掩码整段内联到 scanText 计算处，模块 + 单测删除。
- editable-text-from-message.ts：extractEditableText 改为 for-of + text 块收集，去掉 type predicate 链；两个导出保持 KEEP；签名/import 压一行。
- run-agent-turn 的 RunAgentTurnOptions / RunAgentTurnAfterResolveContext 从 public/agent 撤出并收私有；message.service 的 MessageServiceDeps 收私有。
- find-fake-exports 增加同文件调用计数（prod 含 local calls），修掉 assemble{Sills,Search,Agents}ToolContext 的 TEST_ONLY 假阳性。
- 验证：core typecheck/build、package-exports 21、editable+prepare 55、chat.services+run-agent+annotate 52、desktop/mobile typecheck 全绿；目标文件 check-style PASS；check-style --changed PASS。

## 2026-10-25 第三批四文件收敛
- message-content-helpers.ts：isPlainUserText 合并 role/tool_result 守卫，hasText 的 .some 压一行；四个导出均保留（hasToolResult/isUserInputMessage/hasAnnotateAttachment/isPlainUserText）。
- message-set-floor-range.ts：isSetFloorAnchorRole / computeSetFloorRanges 唯一调用在 message-transcript-effects.service；分别内联为 role !== "user" 与 hidePrefix/showSuffix 计算，模块+单测删除，public/allowlist 撤出。
- merge-pending-vfs-turns.ts：mergePendingVfsTurns 生产 0、仅测试；模块+单测删除，public/allowlist 撤出。
- message-visible-floor.ts：listVisibleSorted 被 depth-from-tail 单点使用，visibleFloorByMessageId 仅测试；先内联 filter 到 depth，再发现 depth-from-tail 仅服务 hide-message.action；继续内联 filter 到 hide-message.action，最终把 hide 编排整体内联进 run-compaction，删除 message-visible-floor / depth-from-tail / hide-message.action 三个模块；public/chat、public/compaction 与 allowlist 同步收敛，run-compaction 的 3 个参数/结果类型收私有。
- 验证：core typecheck/build、package-exports 21、message-content-helpers + message-transcript 16、depth + compaction 17 全绿；check-style --changed PASS；desktop/mobile typecheck 通过。

## 2026-10-25 第四批四文件收敛
- prompt-path-seen：PROMPT_FILE_SEEN_SHORT_TIP 生产 0、仅测试，删除并从 public/chat + allowlist 撤出；测试改本地字面量。
- render-dir-attach-tree：ATTACH_DIR_TREE_MAX_UTF8_BYTES / RenderDirAttachTreeDeps 收私有，renderDirAttachTree 撤 public/allowlist；attachDirTreeRootLabel 小助手内联。
- prepare-user-messages-for-prompt：PrepareUserMessagesForPromptRuntime 收私有；47 处签名/调用/RHS 拆行用 AST 逐节点合并 + Prettier printWidth=1000 清理；stripLegacyDirWrap / stripLegacyFileWrap / plainLengthOfLineBody 三个小助手内联；hydrateDirAttach / hydrateSkillAttachWithSeen / hydrateAttachWithSeen / hydrateWorkplaceWithSeen / prepareOneUserMessage 五个 >20 行管线阶段加 nm-style: keep-local。
- resolve-chat-link-target：elideChatLinkPath 撤 public/allowlist，加 keep-local（chatLinkNotFoundMessage 复用 + 测试直锁规则）；isHttpUrl 加 keep-public 语义谓词豁免。
- check-inline 新增 KEEP_LOCAL：只有 >20 行且带 nm-style: keep-local 的单点私有函数才豁免，小函数仍判 INLINE_LOCAL；新增 test-check-inline.mjs。find-fake-exports 同步识别 keep-local。
- 验证：check-style --changed PASS；四脚本自测 4/4；prepare+link 59、package-exports 21、core typecheck/build 全绿；desktop/mobile typecheck 通过。

## 2026-10-25 chat/logic 全目录收敛（未提交）
- 删除死模块：workspace-flush-snapshot / tail-batch-range / visibility-batch-range，连同单测；public/chat、desktop shared、allowlist 同步。全目录 find-fake-exports：KEEP=64，无 DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE（user-vfs 的 mobile shim / webview 消费者用 keep-local 标注）。
- 全目录 112 处签名/调用/RHS 拆行用 AST 逐节点合并 + Prettier printWidth=1000；check-signatures 0。
- 小助手内联：attachDirTreeRootLabel、stripLegacyDirWrap、stripLegacyFileWrap、plainLengthOfLineBody、wrap-user 的 sectionBody/renderExtraInfoBlock；prepare 五个 >20 行管线阶段 keep-local。
- public 面收缩：STATUS_CHIP_ZH / renameChipZh / RollbackConfirmKind 收私有；USER_VFS_TURN_SPAN / user-vfs view 函数保留 domain 供 mobile shim，撤 public/allowlist；wrapUserVfsActionsForStorage 保留 public 并标 keep-public（测试构造文本）。
- 剩余 18 个 INLINE_LOCAL（status-chip 7、user-vfs-turn-view 11）未处理：均为解析/格式化私有阶段，单点调用但语义独立；下一步逐个内联或在报告说明。check-style 目录：signatures=PASS / exports=PASS / oop=PASS，inline=FIND（5 KEEP_LOCAL + 18 INLINE_LOCAL）。
- 验证：core typecheck/build、full chat 422/424（2 条既有 DST）、package-exports 21、desktop/mobile typecheck 全绿。

## 2026-10-25 XML codec 与 clampSummary 收敛（未提交）
- 新增 `packages/core/src/common/xml.ts`：escapeXmlText / escapeXmlAttr / unescapeXmlText（XML + HTML + 数字 entity，单层解码）。
- 新增 `packages/core/src/domain/vfs/logic/user-vfs-action-xml.ts`：action XML 唯一 codec，底层 `fast-xml-parser@^5.7.3`（`preserveOrder` + `stopNodes:["*.action"]` + `parseTagValue:false`）；`buildUserVfsActionXml` 从 save-mapping 迁入；支持嵌套 wrapper、自闭合、多 action、历史非法裸 `&`/`<tag>` 正文。
- 删除重复 parser：`action-xml-to-tool-uses.ts` 与 `user-vfs-turn-view.ts` 各自的 ACTION_TAG_RE/parseAttrs/unescape/parseJson 删除；前者只做 action→tool 映射，后者只做 turn/view 组装。workplace-display 改用 common escaper；build-attachment 不再用 `includes("<action")` 预判。
- webview allowlist 增补 `domain/vfs/logic/user-vfs-action-xml.js` 与 `domain/chat/logic/chat-annotate-draft-store.js`；gate B/C 绿。
- `clampSummary` 改为 `truncateText(raw, 117)`（总长 ≤118），删除手写 `slice(0,117)…`；补 T-TS-29 钉住 118 字边界。之前未检出原因：它有 4 个调用点且非导出，check-inline 只看单点私有函数，find-fake-exports 只看导出；没有“截断语义重复”探测器。
- 验证：core typecheck/build、chat 423/425（2 条既有 DST）、vfs 395、prompt 202、package-exports 21、desktop/mobile typecheck、webview gate B/C 全绿。全目录 check-style 仍为 inline=FIND，剩 status-chip 7 个私有 JSON 解析单点函数（非 XML），prepare 5 个 keep-local。

## 2026-10-25 chat/logic 子包拆分 + chat i18n 样板（未提交）
- `domain/chat/logic` 按功能拆为 `composer/`、`attachment/`、`prompt/`、`message/`、`vfs-turn/`；`chat-annotate-draft-store`、`resolve-chat-link-target`、`rollback-confirm-copy`、`seed-fork-copy-parity`、`skill-tool-ref` 暂留根目录。
- 移动 18 个文件并重写相对/别名 import、public/chat 路径、core 测试路径、mobile core-shim dist 路径、webview allowlist 路径；无行为改动。`check-signatures` 全目录 0，`check-style` 仅剩 7 个 status-chip 单点私有 JSON 解析项。
- 新增 `common/i18n.ts`：`MessageDescriptor` + `MessageLike = string | descriptor` + `createTranslator`（locale 精确/语言前缀/默认语言回落、字符串直传、函数模板、`{param}` 插值、可序列化）。这是 i18n 的第一条通道；旧字符串路径是第二条通道，二者像 Either/throw 一样并存。
- 新增 `domain/chat/i18n/messages.ts`：zh-CN / en-US chat catalog（rollback primary/degraded/backfill），`chatTranslator` 默认 zh-CN；`public/chat` 导出 `chatTranslator` 与 `rollbackConfirmDescriptor`。
- `rollback-confirm-copy.ts` 改双入口：`rollbackConfirmDescriptor` 返回 key+params；`resolveRollbackConfirmMessage` 仍返回字符串（内部走 descriptor + chatTranslator），现有桌面/移动 UI 不用改。
- webview allowlist 增补 `common/i18n.js`、`domain/chat/i18n/messages.js`；`check-signatures` 支持 `satisfies` 包裹的 object literal，避免 catalog 多行表误报。
- 验证：core typecheck/build、chat 426/428（2 条既有 DST）、vfs 395、prompt 202、package-exports 21、common i18n 14、desktop/mobile typecheck、webview gate B/C 全绿；i18n 三文件 check-style PASS。
- 下一阶段：删 `errors/session-fs-errors.ts` 里重复的 backfill 文案（保留兼容入口到迁移结束）；把 `status-chip-label` 等 chat 文案逐个 descriptor 化；toast/error formatter 改为接受 `MessageLike`。

## 2026-10-25 薄包装检测补漏：normalizePromptSeenPath
- 用户指出 `normalizePromptSeenPath(path) => resolveLogicalPath(path.trim())` 未被脚本发现。根因两条：
  1. `check-inline` 的 PASS_THROUGH 只匹配 `return f(x)`，参数必须是裸标识符；`path.trim()` 是 CallExpression，直接漏检。
  2. 该函数是导出函数，`check-inline` 对导出符号跳过单点内联分析；`find-fake-exports` 只数引用，3 个生产调用导致 KEEP。
- 另外 `resolveLogicalPath` 内部已经 `input.trim()`，所以这个 wrapper 的 trim 是冗余的，确实零策略。
- 修复脚本：`check-inline` 新增 `isParamDerived`，识别 `param.method()` 与 `String/Number/Boolean(param)` 这类简单参数变换，统一报 `PASS_THROUGH`；`test-check-inline` 增加 `f(x.trim())` fixture。
- 删除 wrapper：`prompt-path-seen` 三处改直调 `resolveLogicalPath`（其自带 trim），`assemble-workplace-display` 改导入 VFS 函数，撤 `public/chat` 与 allowlist 导出；行为不变。
- 验证：core typecheck/build、chat 426/428（2 条既有 DST）、package-exports 21、desktop/mobile typecheck、webview gate B/C、check-inline 自测 2/2、check-signatures 自测 1/1 全绿。

## 2026-10-25 i18n 改为 JSON catalog + 通用运行时（修正上一版）
- 上一版把 zh/en 文案写进 `domain/chat/i18n/messages.ts`，属于代码/文案耦合；已删除该文件。
- 文案移到 `packages/core/locales/chat.zh-CN.json` / `chat.en-US.json`；`packages/core/package.json` 增 `./locales/*` export。
- `common/i18n.ts` 现在完全通用：无业务 key/文案，只有 `MessageDescriptor`、`MessageLike = string | descriptor`、`createTranslator`；支持嵌套 descriptor 数组（`{files}` 按行拼接）、locale 精确/语言前缀/默认回落、字符串直传。
- `domain/chat/i18n/keys.ts` 只保留 key 契约与类型；`rollback-confirm-copy.ts` 只返回 descriptor，不再含中文，也不再有 `resolveRollbackConfirmMessage` 字符串入口。
- 桌面 `apps/desktop/renderer/i18n/chat.ts`、移动 `apps/mobile/src/i18n/chat.ts` 用 JSON + `createTranslator` 创建各自 `chatTranslator`；两端 rollback UI 改为 `chatTranslator(rollbackConfirmDescriptor(...))`。desktop 用 Vite 构建验证 JSON 可打包，mobile Jest 验证 `@/i18n/chat` 可用。
- `tsconfig.renderer.json` / `apps/mobile/tsconfig.json` 开 `resolveJsonModule`；webview 不再需要 i18n runtime/catalog allowlist。
- `packages/core/test/chat/i18n-catalog.test.ts` 校验 zh/en JSON key 集合与 `CHAT_MESSAGE_KEYS` 一致；rollback 测试从 JSON 建 translator。
- 验证：core typecheck/build、chat 430/432（2 条既有 DST）、package-exports 21、common i18n 18、desktop renderer build + mobile typecheck、webview B/C 全绿；i18n 五文件 check-style PASS（`translateMessage` keep-local）。

## 2026-10-25 message 子域对象化实验（未提交）
- 新增 `domain/chat/logic/message/chat-message-entity.ts`：`ChatMessageEntity.from(message)` 组合 wire `ChatMessage`，提供 `hasToolResult` / `isUserInput` / `hasAnnotateAttachment` / `isPlainUserText` / `editableText` / `isUndoSendEligible`。DTO/持久化结构保持纯数据，不参与序列化。
- 删除自由函数模块 `message-content-helpers.ts`、`editable-text-from-message.ts`；core 的 prepare / prompt-preview / depth / rollback、desktop/mobile 的 composer-send-state / message-edit / rollback、测试全部改为 `ChatMessageEntity.from(x).method()`。
- `public/chat` 与 allowlist 由 6 个自由函数改为导出 `ChatMessageEntity`；测试文件改名为 `chat-message-entity.test.ts` / `chat-message-entity-undo-send.test.ts`。
- 验证：core typecheck/build、chat 430/432（2 条既有 DST）、entity/prepare 59 例、package-exports 21、desktop rollback 3、mobile composer+rollback 7、desktop/mobile typecheck、webview B/C 全绿；entity 文件 check-style PASS。
- 暂不动的同类函数： `countToolUseBlocks(content)`、status-chip/tool-summary/VFS preview（presentation）、scan/prepare/seed（services/codecs）。下一步按 DDD 角色命名服务对象，而不是继续把函数塞进 entity。

## 2026-10-25 类方法审计脚本 + DDD 角色规范
- 新增 `check-methods.mjs`：扫类方法生产引用，报 `DEAD_METHOD` / `INLINE_METHOD` / `PASS_THROUGH_METHOD` / `DEPRECATED_DEAD` / `DEPRECATED_METHOD` / `AMBIGUOUS_METHOD`；private 方法按类内引用计数，public 方法按全仓库属性访问计数（启发式）。
- `check-inline` 移除 `CLASS_PRIVATE` 一刀切；类方法交给 `check-methods`，private 方法同样按单点内联/死代码处理；`check-style` 汇总新增 `methods=` 并计入退出码。
- `test-check-methods.mjs` 覆盖 dead / inline / pass-through / deprecated；四个脚本自测全绿。
- `SKILL.md` §1 改为“类内方法同样受单点/死代码检查”，§9 扩为 DDD 角色选择表 + 命名规则 + 迁移顺序。
- 当前 `check-methods --changed` 0 处；`check-signatures --changed` 0 处；`chat-message-entity` 的 check-style 全 PASS。

## 2026-10-25 status-chip-label 单点 helper 清零
- `check-inline` 早已报出 `renameChipZh` / `resolveChipPath` / `tryParseRenameTo` / `tryParseRenamePairFromContent` / `tryParseAnnotateChipText` / `truncateChipText` / `parseRenameArrowPair` 7 个 INLINE_LOCAL；上一轮只跑了 check-methods 单文件 0 项，把这 7 项当历史遗留没处理，属于处理遗漏。
- 全部内联进 `formatStatusChipLabelFromAttachment`；合并 JSON 解析为 `parseChipContent`（annotate/rename 两处调用），保留 `resolvePathOrName` / `renameSuffixToChipPath` / `stripLegacyPrefix` 多调用 helper。
- 验证：status-chip 4 例、core typecheck/build、chat 430/432（2 条既有 DST）；`check-inline packages/core/src/domain/chat/logic/message` 0 处，status-chip 的 check-inline/signatures 均 0。

## 2026-10-25 DDD 化第一批：attachment 子域
- 合并 `scan-at-path-attachments.ts` + `scan-skill-attachments.ts` 为 `attachment-scanner.ts`：`AttachmentScanner` 服务（`scanAtPaths` / `scanSkills` / `mergeScannedAtPaths` / `mergeScannedSkills` / `mergeByPath` / `fromPaths`）+ `attachmentScanner` 单例；旧文件删除。`fromPaths` / merge 入口标 `nm-style: keep-public`。
- 合并 `build-attachment-action-xml.ts` 为 `attachment-xml-codec.ts`：`AttachmentXmlCodec` 的 `encodeFileRef` / `encodeDirTree` / `encodeAnnotateAttachment` / `decodeAnnotateDrafts` + `attachmentXmlCodec` 单例。
- public/chat、desktop shared、mobile composer、core prepare/subagent/run-agent、测试全部切到服务对象；webview allowlist 改 scanner 路径并补 codec/coerce/xml。
- 验证：core typecheck/build、chat 430/432（2 条既有 DST）、package-exports 21、desktop/mobile typecheck、desktop annotate 5、mobile rollback 13、webview B/C 全绿；attachment 子域 check-style 全 PASS。
- 剩余 DDD 批次：composer（at-path/chip/send policy）、prompt（assembler/wrapper）、message presentation（status chip/tool summary）、vfs-turn view、root（link resolver/fork seeder/skill ref/rollback copy）。

## 2026-10-25 logic 全量 DDD 化完成
- attachment：AttachmentScanner（scanAtPaths/scanSkills/merge*/fromPaths）、AttachmentXmlCodec（encode*/decodeAnnotateDrafts）、PromptPathSeen、AttachBudget、DirAttachTreeRenderer。
- composer：ComposerAtPath、ComposerChips、ComposerSendPolicy。
- prompt：PromptAssembler.prepare、UserMessageFormatter.wrapForLlm。
- message：ChatMessageEntity、MessageContentEntity、AttachmentPath；presentation 拆出 attachment-chip / tool-summary。
- vfs-turn：UserVfsTurns（parseActions/deriveToolUses/matchAt/buildView）、UserVfsTurnStorage；preview 拆到 presentation/chat/user-vfs-turn-preview.ts。
- root：ChatLinkResolver、ForkCopySeeder、SkillToolRefResolver；rollback confirm 拆到 presentation/chat/rollback-confirm.ts。
- core 的 chat logic 已无 `export function`；public/chat 全部改为领域对象/服务入口。webview 改为 presentation 深入口（package export `./presentation/chat/*`），不再拉 public/chat 全图。
- 脚本：check-methods 支持 static 工厂/keep-public，check-inline 不再一刀切 private；logic+presentation 目录 check-style 全 PASS。
- 验证：core typecheck/build、chat 430/432（2 条既有 DST）、package 21、desktop 16、mobile 20、desktop/mobile typecheck、webview B/C 全绿。

## 2026-10-25 先内联再抽象：AttachmentHydrator
- 原 6 个 KEEP_LOCAL 先按调用点内联：`hydrateDirAttach` → `hydrateAttach` 的目录分支；`hydrateWorkplaceWithSeen` → `hydrateMessage` 的 workplace 循环；`matchUserVfsTurnStructureAt` → `UserVfsTurns.matchAt`。
- 内联后观察：`<file>/<dir>` 旧外壳解包重复，抽 `unwrapLegacyBody`；`prepareOneUserMessage` 的三次 filter + identity Map 改为下标数组两轮有序处理。
- 剩余 hydrate 阶段共享 `seen` / `workplaceSeen` / `AttachBudget` / `skillNames` 缓存，收成 `AttachmentHydrator` 对象；保留的是对象共享状态阶段，不是自由函数长度。
- `nm-code-style` 增补 §1.1：先内联 → 简化 → 观察重复 → 再抽象；行数不是 `keep-local` 理由，原代码切分不是合理性证据。
