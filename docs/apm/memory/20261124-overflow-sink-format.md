---
date: 2026-11-24 21:30
title: curl/search 超限落盘文件单行问题调研（overflow-sink 格式化）
keywords: overflow-sink, curl, search, 落盘, 单行, 换行, JSON 格式化, read 分页
abstract: 用户提出 curl/search 超 50KB 自动落盘的文件是单行、不便 agent 用 read 读取，希望自动换行/格式化。调研结论：落盘统一走 OverflowSink.sink；read 按行分页且超长行尾部不可续读，单行文件实际只能读到前 50KB；建议在 sink 入口做纯函数格式化（JSON 加缩进、非 JSON 按空白边界硬换行）。
---

user:
调研下 curl 和 search 工具，它们超限 50KB 后会自动落文件，但落的是单行文件，不合适。最好能自动换行/格式化：json 好处理，非 json 也能硬换行。目的是方便 agent 用工具读取。

assistant:
落盘只有一个出口 `domain/tool/builtin/overflow-sink.ts` 的 `OverflowSink.sink`，curl 落原始正文、search 落 `JSON.stringify(success)`（必然单行）。read 工具按行分页、单次 50KB，超长行截到预算点后尾部不可续读，所以单行落盘文件模型最多只能读到前 50KB。建议：新增纯函数格式化模块并在 sink 写入前调用；JSON 用只插空白的 tokenizer 方式加缩进（parse 再 stringify 会损坏大整数）；非 JSON 在超过阈值的行的空白边界前插换行、无空白则硬切。未动代码，等用户拍板。

user:
不用存原文；换行宽度 300（1000 对人类可读差），agent 自己可以改 read 的行数，读 150 行就行。

assistant:
已实现。`common/text.ts` 的 `Text` namespace 新增三个方法：`readableLines`（入口，JSON 走 `prettyJson`，否则 `wrapLongLines`）、`prettyJson`（先 `JSON.parse` 验证是对象/数组，再逐 token 插空白加两空格缩进，数字与短字符串字面量逐字节不动；超过宽度的长字符串值解码后递归展开，内嵌 JSON 再缩进）、`wrapLongLines`（超过宽度的行在宽度内最后一个空白处断开，无空白则硬切，硬切点避开代理对）。`OverflowSink.sink` 写盘与 file_cache upsert 前统一过 `Text.readableLines(content, 300)`，curl / search 一处覆盖。

用户中途纠正：不要把函数散在模块顶层，要符合仓库的 object namespace 风格——已全部收进 `Text`。

测试：`test/common/text.test.ts` 新增 6 例；curl / search / vfs-tools 里原本锁定「落盘内容逐字节等于原文」的断言改为锁定折行后的形态（T-G3 改为 read 每页 150 行两页读回）。core `test/common`、`test/tool` 全绿，tsc 0，lint 0，core dist 已重建。5MB 输入耗时 60~85ms。

nm-style hygiene：`Text.prettyJson` / `Text.wrapLongLines` 报 INLINE_CANDIDATE（各被 `readableLines` 单点调用），未内联——两者是各自独立完整的扫描循环，且 prettyJson 经 readableLines 递归；内联会把两个状态机塞进同一个 70 行成员。

踩坑重演：用 heredoc 追加测试文件时转义序列被降级（与约束 291 同族），字符串里的换行转义变成真换行、`});` 丢分号，改用 Edit 才修好。另外仓库文件是 CRLF，node -e 里按 LF 锚点做替换匹配不到。

user:
prettyJson 应该放 json 域，不是 text 工具域；wrapLongLines 同意留在 text，因为可以复用。

assistant:
已调整：`prettyJson` 移到 `common/json.ts` 的 `Json` namespace；入口 `Text.readableLines` 删除（单行转手 wrapper），调用方 `OverflowSink.sink` 直接写 `Json.prettyJson(content, 300) ?? Text.wrapLongLines(content, 300)`。依赖方向单向：json.ts 引 text.ts（长字符串里的非 JSON 文本折行），text.ts 不引 json.ts，避免 common 内循环依赖。测试随迁：`json.test.ts` 新增 5 例，`text.test.ts` 改为直接测 `Text.wrapLongLines`。core `test/common` 96 条、`test/tool` 392 条全绿，tsc 0，lint 0，nm-style check --changed PASS（上一轮两条 INLINE_CANDIDATE 随之消失），core dist 已重建。

user:
提交 push 吧，可以发布。（随后调用 novel-master-publish skill）

assistant:
已提交 db2d52e46（feat）与 a7bade0dc（docs）并推送 main。随后按 publish checklist 发 v1.5.52：CHANGELOG 新增 1.5.52 段（变更：超大网页与搜索结果落盘文件整理成多行；说明：1.5.51 安卓包未产出、本版恢复），desktop / mobile package.json 与 build.gradle 默认 versionName 升到 1.5.52，desktop 774 条、mobile 2385 条测试全绿（mobile 用 --maxWorkers=2），typecheck 均过，提交 7f3950754 后推 tag v1.5.52 与 main。

坑：main 上还有一个「Deploy Docs to GitHub Pages」workflow（publish skill 写着 release.yml 是唯一 workflow，已过时）。发版提交那次它红了——upload-pages-artifact 刚上传完 deploy-pages 就查不到产物（Found 0，平台侧传播延迟）。`gh run rerun --failed` 只重跑 deploy 步骤，会再上传一份产物，变成「两个同名产物」继续红。正确做法：删掉该 run 的全部 github-pages 产物后 `gh run rerun <id>`（整跑），一次过。
