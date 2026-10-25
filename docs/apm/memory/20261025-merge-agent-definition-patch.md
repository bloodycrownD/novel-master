---
date: 2026-10-25 10:13
title: agent patch 重构为通用 RFC 7396 merge + service.update（已落地，桌面 patch 通道）
keywords: applyMergePatch, RFC7396, AgentDefinitionPatch, AgentRegistryService.update, 桌面 IPC, 显式 null, 薄壳删除
abstract: 用户指出 merge-agent-definition-patch 实现随便、复用性差、耦合 tool，且对外更新接口本质也是 patch，不该有两套实现。最终落地：新增 common/merge-patch.ts（RFC 7396 运行时实现 + 8 条单测）；`AgentDefinitionPatch`/`AgentPromptLayoutPatch`/`AgentRuntimePatch`/`AgentToolPolicyPatch` 写显式 interface 放 model，递归 `MergePatch<T>` 泛型因无人消费删除；AgentRegistryService 增加 update()，agent 工具改走它；桌面新增 nm:agentRegistry/update 通道，编辑器保存/覆盖默认/重命名改 patch 并显式 null 清字段，复制/建空白/导入/CLI 仍用 upsert。core 27 项相关测试、桌面相关 15 测试、CLI/desktop typecheck、webview 门 B/C 全绿。
---

user:
D:\Dev\Js\novel-master\packages\core\src\domain\agent\logic\merge-agent-definition-patch.ts
这是干什么的

assistant:
是 `agent update` 工具的部分更新合并层，调用点在 `agent-tool.ts`：工具收到 LLM 提交的 patch 后，先 `registry.get(agentId)` 取当前定义，再 `mergeAgentDefinitionPatch(current, definition)` 合并，最后走同一个 upsert 校验门禁。它编码了三层语义：

1. **顶层浅合并**：patch 里没出现的字段保留现值，出现的覆盖；`runtime` 这类对象字段是整体替换，不做深合并。
2. **`null` = 显式清除**：与「未提供 = 保留」区分开，便于 LLM 表达「取消 pin 的 model」这类意图（删除字段回缺省）。
3. **`prompts` 子键合并**：只填 `dynamic` 就只换 `dynamic`，`persist` 保留；子键置 `null` 清掉该布局；`prompts: null` 清整个布局（落盘前由 withDefaultPromptLayouts 补回空布局）。

它明确不做形状校验——非法形状原样透传，由下游 `validateAgentDefinition` 与 wire 往返拒绝，合并层只负责语义清晰的覆盖。单测 8 条覆盖上述分支。这不是单行包装，是有真实语义的逻辑，保留。

顺手按「函数参数不换行」的偏好把它的签名和 `Object.entries(value as Record<string, unknown>)` 调用拉平成单行；typecheck 与 8 条单测复跑全绿，dist 重建。

user:
我知道了，更新agent工具，那放domain干嘛？放tool不是更好吗？

assistant:
理解这个直觉，但建议留在 `domain/agent/logic`，理由是「归属看它认识谁」，不是「看谁在调它」：

1. 这个函数只认识 `AgentDefinition`，不认识 tool 上下文、zod schema、`ToolError`、action 分发——删掉 agent 工具它依然成立（任何部分更新入口都需要），删掉 AgentDefinition 它就没意义。所有权跟着被操作的数据模型走。
2. 分层约定：`logic/<verb>-<noun>.ts` 里的 noun 是 agent-definition；`domain → domain` 显式允许，且 `agent-tool.ts` 本来就 import 了 `AgentDefinition` 与 `validate-agent-definition` 的类型，跨引 agent 域是既有形态，不是新耦合。
3. tool 层应保持薄：schema、description、action 分发、空 patch 拦截、`ToolError` 都是 tool 的活，这些也确实都在 `agent-tool.ts`；把合并语义也塞进 tool，会把「LLM 输入约定」和「agent 定义语义」混在一起。日后桌面 IPC / CLI 若加 patch 更新，放 tool 域就会让 service 反向依赖 tool 域。

反方向的理由也承认：目前唯一调用点确实是 agent 工具，`null=清除` 也部分来自工具 JSON 约定。但函数签名是 `(current: AgentDefinition, patch: Record<string, unknown>)`，没有一处 tool 概念；真要挪，最多挪到 `domain/tool/logic/`，代价是把一个通用的定义合并语义标记成工具私有。判断尺子：删掉调用方它还有意义吗？有 → 属于模型域；没有 → 属于调用方。当前落在前一类，所以不动。

user:
可以保留在domain，但是实现不能这么写，你不觉得当前的实现很随便吗？复用性没有，过于耦合tool了。patch是个通用的功能，而且现在对外的更新接口本质不也是patch吗？弄出两个实现很令人不解。

assistant:
按「彻底统一 + RFC 7396 深合并」落地：

1. 新增 `common/merge-patch.ts`：`applyMergePatch<T>(current, patch: unknown)` 实现标准 JSON Merge Patch——对象递归、`null` 删键、数组/标量整体替换、`undefined` 视为未提供、过滤 `__proto__`/`constructor`/`prototype`、不修改入参；`MergePatch<T>` 是深层可 patch 类型。8 条单测。
2. `AgentDefinitionPatch` 及嵌套的 `AgentPromptLayoutPatch` / `AgentRuntimePatch` / `AgentToolPolicyPatch` 写显式 interface 落到 `agent-definition.ts` model；`merge-agent-definition-patch.ts` 与其 11 条重复单测删除，合并直接调 `applyMergePatch`。`prompts` 特殊分支没了，`runtime`/`tools` 也按子键深合并（行为变更，由通用 8 条单测 + service 集成测试覆盖）。
3. 服务层：`AgentRegistryPort` / `AgentRegistryService` 增加 `update(agentId, patch, options)`——`get` 当前定义 → `mergeAgentDefinitionPatch` → `upsert` 校验落库，返回合并结果；agent 工具 update 改走 `registry.update`（create 仍 upsert），错误翻译收敛成 `saveWithTranslatedError<T>`。
4. 桌面：新增 `nm:agentRegistry/update` 通道 + handler + renderer wrapper + client 导出；编辑器保存与「覆盖为默认」改走 update，并把表单未产出的可选字段显式置 `null`（model/runtime/tools/description），否则 patch 会保留旧值；重命名改 `{name}` patch；复制/建空白/YAML 导入/CLI create/--save 仍 upsert（create/replace）。
5. `apps/mobile/scripts/build-webview.mjs` 白名单补 `common/merge-patch.js`。

验证：core 264/264（agent/errors/common/package-exports）、桌面 dirty-guard 8/8、registry+IPC handlers 7/7、CLI typecheck、desktop main typecheck、webview 门 B/C 绿、dist 重建。renderer ratchet 仍红，但原因是基线里 TS6307 的绝对路径绑定在 `D:/Dev/nm-worktree/mcr`，本机路径不同导致身份整体漂移；我方 renderer 文件的错误身份都在基线内，未新增。语义注意：`tools` 深合并后可能同时出现 allow+deny，由 `validateAgentDefinition` 拒绝，调用方需显式 `null` 清一侧。

user:
export function mergeAgentDefinitionPatch(current: AgentDefinition, patch: AgentDefinitionPatch): AgentDefinition {
  return applyMergePatch(current, patch);
}
何意味啊》为什么要这么在封一层？有价值吗？

assistant:
没有价值，按「单行转手不包壳」的既有规则删掉：函数体只有 `return`，类型收窄已由 `update(patch: AgentDefinitionPatch)` 的签名承担，命名价值由类型别名提供。`AgentDefinitionPatch` 保留在 model（端口/工具/桌面共用，零运行时），service 直接 `applyMergePatch(current, patch)`；`merge-agent-definition-patch.ts` 与 11 条重复单测一并删除，webview 白名单里两条随之失效的 `merge` 条目也移除。复跑 core typecheck、27 项相关测试、desktop typecheck、webview 门 B/C，全绿。

user:
这是标准写法吗？怎么感觉这么恶心啊，不用更粗犷的对象，不用细节的 interface 的原因是什么？（问递归条件类型 `MergePatch<T>`）

assistant:
递归条件类型是通用 patch 的常见 TS 写法，但「标准」不等于这里必要——只有 AgentDefinition 一个消费者，属于过度泛化。粗犷的 `Record<string, unknown>` 会丢键名检查（拼错变静默无效键），`Partial<AgentDefinition>` 只浅层且不能表达 `null` 清除，`DeepPartial` 也不认 `null` 语义。最终改成显式 interface：`AgentDefinitionPatch` + 三个嵌套 patch interface 写在 `agent-definition.ts`，还能把 `name` 收紧成不允许 `null`；`MergePatch<T>` 泛型因无人消费删除，`applyMergePatch` 运行时实现保留。代价是模型加字段时要手动决定是否进 patch，换来可读与逐字段控制。

user:
但问题是这个函数就是给tool用的，放到domain的意义是什么？如果说它是所有对外agent更新接口的通用逻辑，那没问题，但问题是它是吗？

assistant:
先承认：不是。核实过——CLI 只有 `--save` 走全量 `agentRegistry.upsert`，桌面 `agent-registry.ts` / `agent-yaml.service.ts` 也是整份 `upsert`，没有任何第二个 patch 入口。之前拿「所有对外更新接口通用」当理由，是预测不是事实，不该作为论据。

但「调用点只有一处」不等于「归属在调用方」。判据换成三层：
1. **概念属于谁**：函数名、入参、规则（顶层浅合并、`null` 清除、prompts 子键）全部是 `AgentDefinition` 的语义；tool 层只是把这套语义接到 JSON schema 上。tool 自己的职责（schema、description、action 分发、空 patch 拦截、`ToolError` 翻译）也确实都在 `agent-tool.ts`。
2. **为什么不是 tool 域**：放 `domain/tool/logic/` 等于让 tool 域去定义 agent 模型的部分更新规则，读的人会以为这是工具协议的一部分；而且 `agent-tool` 已经跨引 agent 域的 `AgentDefinition` 与 `validate-agent-definition`，跨引本来就是这个工具的常态。`domain → domain` 架构显式允许，两边都在 domain 层，不是层级违规。
3. **以后加 patch 入口的走向**：真到那天，正确做法是把语义上提到 service（`AgentRegistryService` 或独立 domain service），而不是从 tool 域 import 给桌面/CLI 用（那会变成 service→tool 反向依赖）。现在放 agent 域，至少位置离正确方向更近，且搬家成本低。

严格 YAGNI 也可以选「只服务当前调用方就放调用方」，但那要同步改 `agent-tool` import、单测 import、以及 `apps/mobile/scripts/build-webview.mjs` 的白名单（该文件当前列在 webview 打包清单里）。这是口味/取舍问题，不是对错；结论仍建议留 agent 域，用户若拍板要挪可立即执行。
