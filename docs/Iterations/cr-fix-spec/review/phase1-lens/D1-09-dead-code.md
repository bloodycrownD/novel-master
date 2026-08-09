# D1-09：死代码 & 迭代残留

## 元信息

- 角度：L9 死代码 & 迭代残留（lens-sweep，readonly）
- 数据源：knip 6.31.0（[`phase0/knip-raw-output.txt`](../phase0/knip-raw-output.txt) + [`phase0/D0-3-knip-scan.md`](../phase0/D0-3-knip-scan.md)）
- 核实范围：`packages/core/src` 全量逐条核实；`apps` 端侧在排除 knip 误判后直接引用 D0-3 结论
- 核实方法：grep 引用图 + 读源码 + 对照 Iteration spec/migration

---

## 结论

诶～这一格其实是九个角度里最干净的一格啦。core 这边只有 **2 个 unused files + 约 23 个 unused exports + 3 对 duplicate exports**，而且核实下来还发现 knip 报的「vfs zip 类型」根本是误判——它没把 `@novel-master/core/vfs` 这种子路径跨包引用算进来，所以看着像死代码，实际 mobile/desktop/cli 三端都在用 `createVfsZipIoService` 呢。

core 真正的死代码非常集中，而且每一个都能找到 Iteration 对应：净 diff 废除后留下的两个 `resolve-*` 文件（已经标了 `@deprecated`），以及 `core-architecture-style` 收敛公共面包后没清掉的 `infra/tokenizer/index.ts` re-export 残留——`registerTokenizerDriver`、`CONTEXT_WINDOW_RULES` 这些符号本身还在被 core 内部用，只是 `index.ts` 这一层 re-export 已经没人消费了，apps 早就改走 `@novel-master/core/nmtp` 这个 canonical 路径啦。

最有价值的发现是 **3+1 对 duplicate exports 全部是 `@deprecated` 别名**，而且核实下来 apps 和 core 测试里一个引用都没了。`BUILTIN_PROVIDER_IDS = BUILTIN_PROVIDER_KEYS`、`MUTATING_VFS_TOOL_NAMES = MUTATING_FILE_TOOL_NAMES`、`isMutatingVfsToolName = isMutatingFileToolName`、`savedModelSettingsDocumentSchema = savedModelSettingsSchema`——这些过渡 alias 现在是纯纯的迭代残留，删了零风险。`vfs-tools.ts:545` 那行 `export type { VfsToolContext }`（指向 `builtin-tool-context.ts` 的 `@deprecated` alias）也是同一类东西，建议一并清掉。

apps 端侧的 174 个 unused files 里有 126 个是 knip 配置误判（desktop test 74 + mobile e2e 17 + mobile webview 35），剩下的真实嫌疑约 desktop renderer 24 + mobile 9 个，但**这些必须等 knip 配置修好（加上 `@/` 别名、test runner、webview bundler 入口）重跑一遍才能确认**，现在 L9 不追——按指导文档要求标 B 级建议、引用 D0-3 数字即可。

---

## 核实清单

### packages/core/src

#### Unused files（2 个）

| 文件 | knip 结论 | 核实 | 对应 Iteration | 严重度 | 建议 |
|------|----------|------|---------------|--------|------|
| `domain/chat/logic/resolve-current-workspace-snapshot.ts` | unused | ✅ 文件头注释 `@deprecated 手改净 diff 已废除；本模块仅过渡期单测保留`；grep 全仓库无 import 引用 | `user-ops-operation-log`（D13 决策） | A | 可删；按 D13 也允许「保留 + @deprecated」作过渡，与 L3 确认是否进入正式清理批次 |
| `domain/chat/logic/resolve-flush-baseline-tree.ts` | unused | ✅ 同上，同样 `@deprecated` 标注，零引用 | `user-ops-operation-log`（D13 决策） | A | 同上 |

#### Unused exports — 主题一：vfs zip 类型（knip 误判）

| 符号 | 位置 | knip 结论 | 核实 | 严重度 | 建议 |
|------|------|----------|------|--------|------|
| `VfsZipIoService` | `service/vfs/vfs.port.ts` | unused | ❌ **knip 误判**。apps 三端通过 `@novel-master/core/vfs` 子路径消费：`apps/mobile/src/services/vfs-zip.service.ts`、`apps/desktop/src/main/services/vfs-zip.service.ts`、`apps/cli/src/vfs/commands/{export,import}-zip.ts` 都在用 `createVfsZipIoService`（runtime 值，由 `VfsZipIoService` port 暴露） | C | 修 knip workspace 配置（识别 `@novel-master/core/*` 子路径），符号保留 |
| `VfsZipImportOptions` | `service/vfs/vfs.port.ts` | unused | ❌ **knip 误判**。`apps/mobile/src/services/vfs-zip.service.ts:7` 直接 import 该类型（`Pick<VfsZipImportOptions, 'confirmed'>`） | C | 同上 |

> 注：交接前的初步判断把这两条算作「`remove-mobile-vfs-zip-native` 后未清理」，但语义核实推翻了——vfs zip 服务在三端都还活着，只是 mobile 端**原生压缩**那条路径被移除，类型本身仍是公共契约。和 L1/L8 交叉点：`VfsZipIoService` 是 vfs 域公共 port。

#### Unused exports — 主题二：tokenizer re-export 残留（真死代码）

| 符号 | knip 报位置 | 核实 | 对应 Iteration | 严重度 | 建议 |
|------|------------|------|---------------|--------|------|
| `registerTokenizerDriver` | `infra/tokenizer/index.ts:58` | ✅ core 内部从 `../nmtp/index.js` re-export 到 `infra/tokenizer/index.ts`，apps 已按 `core-architecture-style` 迁移到 canonical 路径 `@novel-master/core/nmtp`；该 re-export 行无消费方 | `core-architecture-style`、`nmtp` | A | 删除 `infra/tokenizer/index.ts:57-63` 这一段 re-export（保留 nmtp 模块本体定义） |
| `CONTEXT_WINDOW_RULES` | `infra/tokenizer/index.ts:30` | ✅ core 内部 `logic/resolve-context-window.ts` 直接相对 import 自 `./context-window-map.js`，不经 `index.ts`；`index.ts` 这一层 re-export 无消费方 | （长期累积） | A | 删除 `index.ts:29-32` 这一段 re-export（保留 `context-window-map.ts` 里的定义） |
| `DEFAULT_CONTEXT_WINDOW_TOKENS` | `infra/tokenizer/index.ts:31` | ✅ 同上，core 内部 `logic/seed-context-window-tokens.ts:9` 直接相对 import；`index.ts` re-export 无消费方 | （长期累积） | A | 同上一起删 |
| `ForVendorModelOptions` | `infra/tokenizer/index.ts:14` | ⚠️ port type，`ports/token-counter-registry.port.ts` 里定义，core 内部 `create-default-registry.ts` 等用；`index.ts` 这一层 re-export 是否有人走需 L3/L8 二次确认 | — | A→C | 建议从 `index.ts` 删 re-export，类型本体保留；与 L8 公共面交叉 |

> 这一组的特点：**符号本身没有死，只是 `infra/tokenizer/index.ts` 这一层 barrel re-export 已经没人走了**。删 re-export 不影响 core 内部，apps 早已切换。

#### Unused exports — 主题三：tool 输出类型（含 deprecated alias）

| 符号 | 位置 | knip 结论 | 核实 | 严重度 | 建议 |
|------|------|----------|------|--------|------|
| `VfsToolContext` | `domain/tool/builtin/builtin-tool-context.ts:26` | unused | ✅ `export type VfsToolContext = BuiltinToolContext` 显式 `@deprecated Use BuiltinToolContext`。grep apps + core test 零引用。但 `index.ts:177-180` 仍把 `VfsToolContext` 一起 re-export 到主入口 | A | 删除 `builtin-tool-context.ts:25-26` 的 deprecated alias + `index.ts:179` 的 re-export 行 |
| `ReadToolOutput` | `domain/tool/builtin/vfs-tools.ts:79` | unused | ⚠️ 工具自身的运行时输出类型，未在 `index.ts` 主入口 re-export；属「文件级 export 但只在文件内部被 tool handler 用」的过度导出 | A | 改为非 export（内部 type），或与 L8 确认是否预留为公共契约 |
| `GrepToolOutput` | `domain/tool/builtin/vfs-tools.ts:92` | unused | 同上 | A | 同上 |
| `GlobToolOutput` | `domain/tool/builtin/vfs-tools.ts:98` | unused | 同上 | A | 同上 |
| `ChatGrepMatch` | `domain/tool/builtin/chat-grep-tool.ts:22` | unused | 同上（工具自身输出类型） | A | 同上 |
| `VfsReadResult` | `domain/tool/builtin/vfs-tools.ts:545`（re-export） | unused | ⚠️ `vfs-tools.ts:545` 这里是 `export type { VfsReadResult }`，把 vfs-service port 的类型在 tool 文件里又 re-export 一次，无消费方 | A | 删除 `vfs-tools.ts:545` 这行 re-export（port 那边保留） |

> `VfsToolContext` 那条对应 `tool-system-v2` 的 shim 拆分（explore-tool.md 明确说「弃用 shim 便于 V1→V2 迁移」），现在迁移完成可以收。

#### Unused exports — 主题四：vfs 类型 re-export 链（与 L3 交叉）

| 符号 | 出现位置 | 核实 | 严重度 | 建议 |
|------|---------|------|--------|------|
| `VfsEntryKind` | 同时在 `vfs-list-entry`、`vfs-service.port`、`vfs-entry.port` 三处 export | re-export 链：model 定义 → ports re-export → service.port 再 re-export。knip 报的 unused 是链末端 | A | 与 L3 一起收敛 re-export 链，建议 model 层定义、port 层只 re-export 必要的 |
| `VfsGrepMatchMode` | 同时在 `vfs-grep`、`vfs-service.port`、`vfs.port` 三处 export | 同上 re-export 链 | A | 同上 |
| `BatchIngestTypeConflict` | `vfs-batch-io.port` | type 残留，需 L3 确认是否仍属 port 契约 | C | 与 L3/L8 确认 |

#### Unused exports — 主题五：事件/模板类型

| 符号 | 位置 | knip 结论 | 核实 | 严重度 | 建议 |
|------|------|----------|------|--------|------|
| `NovelMasterEventPayload` | `domain/events/model/event-types.ts:99` | unused | ⚠️ core 内部仅 type union 自身定义，无其他消费方。但 `core-explore-remediation/features/events-reliability/explore-events.md` 明确把「Public payload 导出不完整」标为 N1 缺口——这是「**导出意图不明**」，不是「真死代码」 | C | 与 L8 公共面确认：要么正式收入 events 公共面包，要么改为内部 type |
| `MacroActionKind` | `infra/prompt-template/macro-scan.ts:9` | unused | ⚠️ core 内部 macro-scan.ts 自身定义的 union type export，无外部消费方 | A | 改为非 export（macro-scan 内部用） |
| `ForeachAttrs` | `infra/sql-template/index.ts:12`（re-export） | unused | core 内部仅 `parser.ts` 用（直接相对 import 自 `./types.js`），`index.ts` 这一层 re-export 无消费方 | A | 从 `index.ts` 删 re-export（types.ts 里保留） |
| `TrimAttrs` | `infra/sql-template/index.ts:15`（re-export） | unused | 同上 | A | 同上 |

#### Duplicate exports（3 对 + 1 bonus，全部为 @deprecated alias）

| 别名 | Canonical | 位置 | 核实 | 严重度 | 建议 |
|------|----------|------|------|--------|------|
| `BUILTIN_PROVIDER_IDS` | `BUILTIN_PROVIDER_KEYS` | `domain/provider/logic/builtin-providers.ts:125` | ✅ `@deprecated`，grep apps + core test 零引用，只有自身定义 | A | 删 deprecated alias |
| `MUTATING_VFS_TOOL_NAMES` | `MUTATING_FILE_TOOL_NAMES` | `domain/tool/builtin/vfs-tools.ts:55` | ✅ `@deprecated`，零外部引用；但 `index.ts:152-160` 主入口仍把别名一起 re-export | A | 删 alias + `index.ts` 里的别名 re-export 行 |
| `isMutatingVfsToolName` | `isMutatingFileToolName` | `domain/tool/builtin/vfs-tools.ts:65` | ✅ `@deprecated`，零外部引用；同上 `index.ts` 仍 re-export | A | 同上 |
| `savedModelSettingsDocumentSchema` | `savedModelSettingsSchema` | `domain/provider/model/saved-model-settings.schema.ts:120` | ✅ `@deprecated 使用 savedModelSettingsSchema`，零外部引用 | A | 删 alias |
| （bonus）`builtinProtocolByProviderId` | `builtinProtocolByProviderKey` | `domain/provider/logic/builtin-providers.ts:140` | ✅ `@deprecated`，knip 未报但同类 | A | 一并清理 |

> 全部 4 对 knip 报的 + 1 对未报的，apps 端 + core test 端**零消费**，删了零风险。这是本次 L9 最高价值、最低风险的发现。

---

### apps/desktop/renderer（排误判后）

按 D0-3 §2 数字直接引用，**不逐个核实**（指导文档允许；追 107 个 `@/` unresolved + 74 个 test 误判性价比极低）。

| 类别 | 数量 | 性质 | 对应 Iteration | 严重度 | 建议 |
|------|------|------|---------------|--------|------|
| hooks（useAgentRunLifecycle / useAgentStream / useAgentStreamMetrics / useAutoResizeTextarea / useChatMessagesScrollFollow / useDesktopAgentActive / useStreamTailGenerating） | 7 | 疑似 agent stream / chat send 重构后旧 hook | `chat-send-render-refactor`、`agent-chat-ux-bugfix` | B | 修 knip `@/` 别名配置后重跑，逐个核实 |
| utils（format-token-count / format-user-error / ime-composition / settings-feedback / textarea-enter-shortcuts / vfs-path） | 6 | UI 工具函数残留 | `desktop-ux-bug-fixes`、`desktop-ui-polish` | B | 同上 |
| components/ui（IconButton / PickerModal / Switch / TextArea） | 4 | 设计系统迁移后旧组件 | `desktop-ui-polish` | B | 同上 |
| features（chat-messages-scroll / tool-turn-actions / transcript-selectable-role / useWorkspaceTree） | 3-4 | feature 模块重构残留 | `desktop-workspace-ux-fixes` | B | 同上 |
| 其他（AppMenuBar / sanitize-annotate-preview-html / regex-test.service） | 3 | 零散 | — | B | 同上 |

**前提**：必须先把 desktop renderer 的 `@/` 路径别名加到 knip 配置，否则 107 个 unresolved 会淹没真实告警。

---

### apps/mobile/src（排误判后）

| 类别 | 数量 | 性质 | 对应 Iteration | 严重度 | 建议 |
|------|------|------|---------------|--------|------|
| components/batch/ListBatchBar、form/FormErrorCard、chat/transcript-selectable-role | 3 | 旧组件残留 | `mobile-fix-v2`、`mobile-fix` | B | 修 knip webview 入口后重跑 |
| hooks/useStreamTailGenerating | 1 | 与 desktop 同名 hook，疑似同一迭代残留 | `mobile-chat-stability-fixes` | B | 同上 |
| navigation/linking | 1 | deep linking 配置残留 | — | B | 同上 |
| components/rich-content/build-rich-content-styles | 1 | 富文本样式构建残留 | — | B | 同上 |

---

### 依赖（10 unused deps + 19 unused devDeps）

按 D0-3 §3 表格直接引用，标 B 级。**不逐个核实**（指导文档允许）。

| 类别 | 数量 | 性质 | 严重度 | 建议 |
|------|------|------|--------|------|
| Unused dependencies | 10 | 含 `rehype-raw` / `sanitize-html`（desktop，可能被 `chat-rich-render` 替代）、`react-native-reanimated` / `react-native-worklets`（根 package.json，疑似 override 残留）、`js-tiktoken`（tokenizer-driver-rn，疑似 nmtp 迁移后遗留）、`@gorhom/bottom-sheet` / `buffer` / `fast-xml-parser` / `preact` / `tlds`（mobile） | B | 修 knip 配置后逐个 grep 核实 |
| Unused devDependencies | 19 | desktop：`@types/sanitize-html`、`node-addon-api`；mobile：`@codemirror/*` 全系列 6 个（**疑似误判**，code-editor webview 被 knip 当 unused file 连带）、`@babel/*` 2 个、`@wdio/*` 3 个；根：`linkedom`；core：`@novel-master/tokenizer-driver-node`（devDep）；sksp-android + tokenizer-driver-rn：`tsx` | B | `@codemirror/*` 那 6 个标 C 级误判；其余逐个核实 |

---

## knip 误判汇总（供修配置参考）

| 类别 | 数量 | 误判原因 | 修复建议 |
|------|------|---------|---------|
| `apps/desktop/test/**` | 74 | desktop 测试用自定义 runner，knip 找不到入口 | knip 配置加 desktop test 入口（`test/**` 或 runner bin） |
| `apps/mobile/e2e/**` | 17 | wdio 配置入口 knip 不认识 | knip 配置加 wdio 入口 |
| `apps/mobile/src/web/*/webview/**` | ~35 | webview 代码通过 bundler 入口加载，不走 import 链 | knip 配置加 webview bundler 入口 |
| Unresolved imports（全 `@/` 别名） | 107 | knip 不认识 desktop renderer 的 `tsconfig.paths` | knip 配置加 `paths` 映射 |
| `@codemirror/*` devDeps | 6 | code-editor webview 被 knip 当 unused file，连带 dep 也判 unused | 修 webview 入口后自动消除 |
| `VfsZipIoService` / `VfsZipImportOptions` | 2 | knip 不识别 `@novel-master/core/vfs` 这类 workspace 子路径跨包引用 | knip workspace 配置补全子路径 entry |

> 修好上面这些，预计 174 → ~33 个真实 unused files，451 → ~50 个真实 unused exports。**这是 L9 在 apps 端能产生价值的前提**。

---

## 与 L3 / L8 的交叉点

1. **vfs 类型 re-export 链**（`VfsEntryKind`×3、`VfsGrepMatchMode`×3、`BatchIngestTypeConflict`）：L3 应在架构角度统一收敛 re-export 链（model 定义 → ports re-export → service.port 再 re-export 是过长的链）。L9 不单独建议删哪个，等 L3 决策。

2. **deprecated alias 是否受 documented exception 保护**：4 对 duplicate exports + `VfsToolContext` alias 都标了 `@deprecated`，但 grep 验证零外部引用。如果 L3 的 exception 清单保护这些 alias，则保留；否则建议清理。从 `core-explore-remediation` 的 spec 看，`registerVfsTools`、`MUTATING_VFS_TOOL_NAMES`、`VfsToolContext` 都被明确标为「弃用 shim 便于 V1→V2 迁移」——**迁移已完成**（tool-system-v2 已落地），可以收。

3. **`NovelMasterEventPayload` 的导出意图**：events-reliability 探索报告明确把它列为「公共 payload 导出不完整」N1 缺口。L8 公共面角度需要决策：是正式收入 events 子入口的公共契约，还是降级为内部 type。L9 不单方面判定为死代码。

4. **`infra/tokenizer/index.ts` re-export 残留**：`registerTokenizerDriver` 等 4 个符号的 re-export 行删除后，不影响 core 内部（内部走相对路径）也不影响 apps（已迁 canonical）。但这是公共面包的形态变更，建议和 L8 一起做、配一次 package-exports 快照更新。

5. **`user-ops-operation-log` D13 决策**：两个 unused files 的 `@deprecated` 标注是 D13 明确允许的「文件保留 + @deprecated 仅测试过渡」。L9 不强推删除，只标 A 级建议，由 L3 决定是否进入正式清理批次。

---

## 核心交付（最高价值发现）

按性价比排序：

1. **4 对 duplicate exports + `VfsToolContext` alias**（A 级，零风险）：全部 `@deprecated`、apps + core test 零引用，删了立省维护成本。这是 L9 最高价值交付。
2. **`infra/tokenizer/index.ts` re-export 残留 4 个**（A 级）：`registerTokenizerDriver`、`CONTEXT_WINDOW_RULES`、`DEFAULT_CONTEXT_WINDOW_TOKENS`、`ForVendorModelOptions` 的 barrel re-export 已经没人走，删 re-export 行（保留定义端）。
3. **`vfs-tools.ts` 内部输出类型外露**（A 级）：`ReadToolOutput`、`GrepToolOutput`、`GlobToolOutput`、`ChatGrepMatch`、`VfsReadResult` re-export 建议改为非 export 或删除 re-export。
4. **2 个 unused files**（A 级，D13 决策允许保留）：与 L3 确认是否清理。
5. **knip 配置修复**（C 级但高杠杆）：修好 workspace 子路径 + `@/` 别名 + test/webview 入口，apps 端 126 个误判消失，才能看到真实死代码分布。

L9 不宣布 ready——apps 端真实死代码分布需等 knip 配置修复后重跑才能确认。
