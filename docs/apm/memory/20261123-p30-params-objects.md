# p30 >4 参签名收 params 对象（2026-11-23）

范围（用户裁决「测试不管，主要是 core 这种核心逻辑代码」）：core + apps 生产代码，测试与 tools/nm-style 豁免。判据写进 nm-code-style SKILL.md §2（068a3570e）。

## 提交链
- 59dcdf2af core vfs 群 12 函数（主代理亲自，校准形状标准）：copyTree/replaceSubtree/nextUpdateVersion/sweepRevisionsUnderScope/repair/decrementLiveUnderScope/seedUnderPrefix/insertFileSeeding/write/renameEntry/renameDirectory；VfsCopyEndpoint{scope,pathPrefix} 表达 from/to 孪生端点；CopyVfsTreeOptions/ReplaceVfsSubtreeOptions/WriteWithRevisionOptions 退役。
- 5a4db0e9d 四片工作流（dwfrun-e02df3ca）31 函数 + 主代理收尾修正；tag p30-params-objects。

## 形状标准（写死给后续轮次复用）
单 params 对象（形参名 p），依赖与语义参数同对象，字段名即文档；可选字段展平、Options interface 退役；≤4 参不动；平台契约形态（fetch init / Promise executor / 原生桥 / IPC wire format）不动；apps 层依赖混排拆 Deps/Req。

## escalation 口径确立（两起同款裁决）
**内部 port 契约随实现一起收 params**（skills.port / internal-vfs.port / vfs-batch-io.port 及 desktop IPC handler 连锁适配、全仓 typecheck 验证 mobile 消费点）；「契约形状不动」豁免只适用于**外部平台协议**（fetch init、Promise executor、原生桥、IPC wire format——SkillsWriteRequest 不改）。

## 工作流漏网（主代理亲自收尾修掉）
- openai.adapter.test 的 mock postSse 还是 3 参位置形态（片C 只改了 core test 三个文件漏了这个）→ `onChunk is not a function`；修 mock + 3 处 `mock.calls[0].arguments[1]` 位置断言改字段断言。
- mobile llm-native-fetch-shim.test / stop-button-repro.test 的 fake post 同款 → `Cannot read properties of undefined (reading 'signal')`。
教训：**mock/fake 是调用点的影子**——收口签名时 grep 范围必须含所有端测试目录的 mock.module/jest.mock 工厂，不能只扫 core/test。

## 验收终态
typecheck 15/15；core dist 完整重建（rm dist + tsbuildinfo + tsc-alias）；core 960/0、desktop 774/0、mobile 2384/2384；signatures=0、throw-audit PASS、dup gate PASS（+2 组登记 judged：`(: ReadonlyArray<string>)` 语义无关单参撞车、`(: VfsReplaceParams)` 同 port 契约双实现）。arity 复盘：生产面 >4 参 **63→10**——core 残 1（compute-replace-result.compute，5 参含单 options，kept）、apps 残 9 全在 mobile UI/几何层（mermaid gestures、anchored-menu、composer/screen 回调、RichDocumentWebView、failBootstrap），非核心逻辑层，符合范围裁决。

## 工艺备忘
- 测试侧多行位置参数调用点用正则批量转换时要容忍：repo 位置的 `new X(tx)`（含空格括号）、模板串里的 `${}` 嵌套花括号——`[^,}]+` 两轮都断在这；scopeKey 捕获用 `(?:[^{}]|\{[^{}]*\})+?`。
- 正则转换产生的对象字面量双逗号（`,\s*\n\s*,`）是语法错主因，转换后跑一遍清洗正则。
- python heredoc 逐字面匹配多行代码不可靠（缩进/换行漂移即 assert），改用 re.sub。
