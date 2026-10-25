---
date: 2026-10-25 14:20
title: chat/content 优化 + truncateText 抽到 core/common + 删除转手 wrapper + parse 迁移 AppError/Result（待用户审查，未提交）
keywords: domain/chat/content, parse-message-content, message-body-text, format-message-cli, truncateText, common/text, messageBodyTextFromBlocks, CHAT_INVALID_ARGUMENT, AppError, Either, 单行 wrapper, 错误工厂, 内联, nm-code-style
abstract: 用户要求按 nm-code-style 优化 packages/core/src/domain/chat/content，随后指出 truncate 应抽成通用工具、messageBodyText / messageBodyTextFromContent 两个单行 wrapper 没有存在意义、content 里的 throw 应迁到 AppError + Either。已落地：新增 core/common 的 truncateText 并收敛 core 11 处、mobile 2 处、desktop 1 处同语义截断；删除两个转手 wrapper，全仓改为直接传 blocks；新增 CHAT_INVALID_ARGUMENT=106001，parse 链路改为 Result<MessageContent, AppError>、删除 assertMessageContent、边界统一 throw。第一版迁移因错误工厂 wrapper 与单点私有函数被用户指出不合规，已重写为全部内联（只保留多处复用的 requireString）。core 相关套件、三端 typecheck、CLI chat smoke 全绿；usage-stats 两条时区红与 CLI 其余 25 条会话创建前置 agent 的旧测试红均为基线既有。改动未提交，等用户审查。
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
- 验证：core typecheck；content/meta/registry 27 例、chat 468 例、package-exports 21 例全绿；usage-stats 仍是基线既有的 2 条时区红（37/39）；CLI typecheck、desktop main typecheck、mobile typecheck 通过。重建 core / tokenizer-driver-node / CLI 的 dist 后，CLI chat smoke（message append/list）通过；CLI 全量 68/93，其余 25 条红是基线旧测试——会话创建现在要求先有 agent，错误来自 `session.service.ts:111`（引入于 c3032e5e1），与本次解析链无关。改动仍未提交。
