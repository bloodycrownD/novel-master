# D0-3：knip 死代码扫描报告

## 元信息
- 工具：knip 6.31.0
- 扫描日期：2026-08-05
- 原始输出：[`knip-raw-output.txt`](knip-raw-output.txt)（1015 行）

---

## 总览

| 类别 | 数量 | 在 core 里 | 在 apps 里 |
|------|------|-----------|-----------|
| Unused files | 174 | **2** | 172 |
| Unused exports | 451 | ~23 | ~428 |
| Unused exported types | 151 | ~23（含重复） | ~128 |
| Unused dependencies | 10 | 0 | 10 |
| Unused devDependencies | 19 | 1 | 18 |
| Duplicate exports | 5 | 3 | 2 |
| Unresolved imports | 107 | 0 | 107 |
| Unlisted dependencies | 84 | 0 | 84 |

**核心结论：packages/core/src 几乎没有死代码。** knip 报告的问题 99% 在 apps 端侧（desktop/mobile），而且大部分是端侧特有的问题（`@/` 路径别名 knip 不认识、测试文件被识别为 unused）。

这个结论对 L9 角度的定位影响极大——**L9 的重心不应在 core，而在 apps**。

---

## 1. packages/core/src 里的死代码（L9 在 core 的全部目标）

### Unused files（仅 2 个）

```
packages/core/src/domain/chat/logic/resolve-current-workspace-snapshot.ts
packages/core/src/domain/chat/logic/resolve-flush-baseline-tree.ts
```

两个都在 `domain/chat/logic/` 下，且名字都是 `resolve-*` 模式——疑似某次重构后被遗弃的解析函数。**高嫌疑**：对应 `chat-send-render-refactor` 或 `message-rollback-execution-redesign` 迭代。

### Unused exports（~23 个，集中在几个文件）

**`infra/tokenizer/index.ts`（3 个）**：
- `CONTEXT_WINDOW_RULES`、`DEFAULT_CONTEXT_WINDOW_TOKENS`、`registerTokenizerDriver`
- token 计数相关的常量和注册函数没人用——可能是 model-aware-token-counting 迭代后遗留

**`domain/vfs/`（6 个）**：
- `VfsEntryKind`（在 3 个文件里重复导出：vfs-list-entry / vfs-service.port / vfs-entry.port）
- `VfsGrepMatchMode`（在 3 个文件里重复导出：vfs-grep / vfs-service.port / vfs.port）
- `BatchIngestTypeConflict`（vfs-batch-io.port）

**`domain/tool/builtin/`（6 个）**：
- `ReadToolOutput`、`GrepToolOutput`、`GlobToolOutput`、`VfsReadResult`、`VfsToolContext`、`ChatGrepMatch`
- tool 输出类型没人消费——可能是 tool-system-v2 迭代后类型定义残留

**其他零散**：
- `NovelMasterEventPayload`（events/model/event-types.ts）——事件类型未使用
- `MacroActionKind`（infra/prompt-template/macro-scan.ts）——宏扫描类型
- `ForeachAttrs`、`TrimAttrs`（infra/sql-template/index.ts）——SQL 模板属性类型
- `ForVendorModelOptions`（infra/tokenizer/index.ts）——tokenizer vendor 选项
- `VfsZipIoService`、`VfsZipImportOptions`（service/vfs/vfs.port.ts）——**vfs zip 相关类型**，对应 `remove-mobile-vfs-zip-native` 迭代，zip 原生压缩移除后类型未清理

### Duplicate exports（3 个在 core）

```
BUILTIN_PROVIDER_KEYS|BUILTIN_PROVIDER_IDS    packages/core/src/domain/provider/logic/builtin-providers.ts
savedModelSettingsSchema|...                  .../saved-model-settings.schema.ts
MUTATING_FILE_TOOL_NAMES|MUTATING_VFS_TOOL_NAMES  packages/core/src/domain/tool/builtin/vfs-tools.ts
isMutatingFileToolName|isMutatingVfsToolName      packages/core/src/domain/tool/builtin/vfs-tools.ts
```

**同一个符号被 export 了两次**（不同名字指向同一个东西），或者两个 alias 互相重复。这是 L8 公共面角度也应关注的问题。

### 核心结论

**packages/core/src 的死代码极少且集中**：
- 2 个 unused files（chat/logic 里的遗弃函数）
- ~23 个 unused exports/types，集中在 tokenizer 常量、vfs 类型重复导出、tool 输出类型残留
- 3 个 duplicate exports（provider/tool 的 alias 重复）
- vfs zip 类型残留（`remove-mobile-vfs-zip-native` 后没清理干净）

**L9 在 core 的工作量很小**——预计半小时内可以逐条核实完毕。真正的 L9 工作量在 apps。

---

## 2. apps 端侧的死代码（L9 主要工作量）

### Unused files 分布

| 目录 | 数量 | 性质 |
|------|------|------|
| **apps/desktop/test/** | **74** | desktop 的全部测试文件——**knip 误判**（见下） |
| **apps/mobile/src/web/** | **~35** | mobile webview 代码（chat-transcript/code-editor/rich-document 的 webview） |
| apps/mobile/src/ 零散 | ~9 | 各种 hooks/components/services |
| apps/desktop/renderer/ | 24 | renderer 的 hooks/utils/components |
| apps/mobile/e2e/ | 17 | mobile e2e 测试（Appium/wdio） |
| apps/desktop/scripts/ | 4 | 构建脚本 |

### ⚠️ knip 误判说明（重要）

**74 个 desktop 测试文件被标为 unused**，这几乎肯定是 **knip 配置问题**，不是真的死代码。desktop 测试可能通过自定义 runner（非标准 `test/` 入口）执行，knip 找不到测试入口就认为它们 unused。

**17 个 mobile e2e 文件同理**——wdio 配置的入口 knip 可能不认识。

**~35 个 mobile webview 文件**（`apps/mobile/src/web/*/webview/`）也疑似误判——webview 代码可能通过 bundler 入口（webpack/vite）加载，不走标准 import 链，knip 的静态分析看不到。

**结论**：apps 端侧的 unused files 大部分是 knip 配置问题，**不能直接当死代码**。L9 需要先修正 knip 配置（添加正确的入口），再重新扫描才能得到真实的端侧死代码。

### 真实端侧死代码嫌疑（排除误判后）

排除 test/e2e/webview 后，apps 端侧的真实死代码嫌疑：

**apps/desktop/renderer/（24 个）**：
- hooks：useAgentRunLifecycle、useAgentStream、useAgentStreamMetrics、useAutoResizeTextarea 等
- utils：format-token-count、format-user-error、ime-composition、vfs-path 等
- components/ui：IconButton、PickerModal、Switch、TextArea
- features：useWorkspaceTree、chat-messages-scroll、tool-turn-actions

**apps/mobile/src/（~9 个，排除 webview）**：
- components/batch/ListBatchBar、form/FormErrorCard、chat/transcript-selectable-role
- hooks/useStreamTailGenerating
- navigation/linking

这些更可能是真实死代码——某个迭代重构后遗留的旧组件/hook。

---

## 3. 依赖问题

### Unused dependencies（10 个）

| 依赖 | 位置 | 嫌疑 |
|------|------|------|
| rehype-raw, sanitize-html | apps/desktop | HTML 渲染相关，可能被 chat-rich-render 替代 |
| @gorhom/bottom-sheet, buffer, fast-xml-parser, preact, tlds | apps/mobile | 各种 RN 依赖 |
| react-native-reanimated, react-native-worklets | 根 package.json | **根目录依赖**——可能是 override 残留 |
| js-tiktoken | tokenizer-driver-rn | 可能被 nmtp driver 替代 |

### Unused devDependencies（19 个）

desktop 的 `@types/sanitize-html`、`node-addon-api`；mobile 的整个 `@codemirror/*` 系列（6 个）、`@babel/*`（2 个）、`@wdio/*`（3 个）；根目录的 `linkedom`；core 的 `@novel-master/tokenizer-driver-node`（devDep）；sksp-android 和 tokenizer-driver-rn 的 `tsx`。

**注意 mobile 的 `@codemirror/*` 全系列 unused**——但 mobile webview 里有 code-editor（被 knip 误判为 unused file），所以这 6 个 codemirror 依赖很可能也是误判。

---

## 4. Unresolved imports（107 个，全在 apps/desktop/renderer）

全部是 `@/` 开头的路径别名（`@/utils/...`、`@/hooks/...`、`@/components/...`、`@/ipc/client`、`@/providers/...`）。

**这不是死代码问题，是 knip 配置问题**——knip 不认识 desktop renderer 的 `@/` 路径别名。需要配置 `paths` 才能正确解析。修复配置后这些告警会消失，同时也能正确识别 renderer 里的真实死代码。

---

## 5. 对 L9 角度的指导意义

### L9 在 core 的任务（轻量）

1. 核实 2 个 unused files：读 `resolve-current-workspace-snapshot.ts` 和 `resolve-flush-baseline-tree.ts`，确认是否真的没人用，找到对应的 Iteration
2. 核实 ~23 个 unused exports：重点看 vfs zip 类型残留（`remove-mobile-vfs-zip-native` 的遗留）、tokenizer 常量、tool 输出类型
3. 核实 3 个 duplicate exports：判断是 alias 重复还是真的导出两次
4. 交叉 L3：确认这些死代码是否被 documented exceptions 保护

### L9 在 apps 的任务（需先修 knip 配置）

1. **修 knip 配置**：添加 desktop renderer 的 `@/` 路径别名、测试入口、webview bundler 入口
2. **重跑 knip**：修正配置后重新扫描，排除误判
3. 核实排除误判后的真实死代码（desktop renderer ~24 个 + mobile ~9 个）
4. 核实 10 个 unused dependencies 和 19 个 unused devDependencies

### L9 不做的事

- 不改 knip 配置（只产出建议，由用户决定是否改）
- 不删代码（本 loop 不改实现）
- 不追 test/e2e/webview 的误判（那是配置问题，不是 CR 内容）

---

## 6. 初步观察（叙述式）

knip 扫出来的东西乍看吓人——174 个 unused files、451 个 unused exports——但仔细看，**packages/core/src 干净得令人意外**：只有 2 个 unused files 和 ~23 个 unused exports。考虑到 1700+ commit 的历史，core 的死代码控制得相当好。这和 D0-1 发现的「分层违规全清零」一致——说明这个仓库对 core 的代码质量有严格的系统性维护。

真正的死代码问题在 apps 端侧，但其中大部分是 knip 配置导致的误判（desktop 测试 74 个、mobile e2e 17 个、mobile webview ~35 个）。knip 不认识非标准入口（自定义 test runner、wdio、webview bundler），所以把这些入口可达的文件都标为 unused。**修正 knip 配置是 L9 在 apps 端的第一步**，否则会被海量误判淹没。

排除误判后，apps 端侧的真实死代码主要是迭代重构后的遗留组件（desktop 的旧 hooks/utils/components ~24 个，mobile ~9 个）。这些对应 desktop-ux-bug-fixes、mobile-fix-v2 等 UI 重构迭代，是典型的「改完没删旧」模式。

值得注意的是 core 里有几个明确的「迭代遗留」信号：vfs zip 类型（`VfsZipIoService`/`VfsZipImportOptions`）在 `remove-mobile-vfs-zip-native` 后没清理、tokenizer 的 `CONTEXT_WINDOW_RULES` 常量在 model-aware-token-counting 后可能废弃。这些是 L9 能快速确认并产出高价值发现的点。
