# DRY Fix-Spec: jscpd 重复代码收敛

## 元信息

- **来源**：jscpd 全量扫描（base c25f7bb8 + merge origin/main `c850d356`），2026-08-09
- **仓库**：novel-master
- **分支**：cr-fix
- **base_sha**：`7a8380da`（当前 HEAD）
- **状态**：draft
- **扫描统计**：1005 clones / 11413 dup lines / 6.91%（typescript）

## 设计目标

把 jscpd 报告里**源码（非测试）**的重复热点收敛掉，重点关注三类：跨端复制（desktop↔mobile）、同族 driver 复制（sksp 三端）、core 内部多份实现。测试代码的重复暂不处理（测试 setup 的模板复制是可接受的工程取舍）。

**核心思路**：可维护、干净、不破坏行为。每条改动都保持对外可观察行为不变，只消除知识重复和路径重复。

---

## Must-fix（按优先级）

### DRY-1 [P1] SKSP 三端 secret store 抽公共 SQLite 逻辑

- **维度**：C（DRY）
- **文件**：
  - `packages/sksp-android/src/android-secret-store.ts`
  - `packages/sksp-mac/src/sqlite-secret-store.ts`
  - `packages/sksp-windows/src/sqlite-secret-store.ts`
- **问题**：三个平台 secret store 的 `get`/`has`/`set`/`delete` 四个方法里，SQL 模板（`SELECT ... FROM sksp_secrets`、`INSERT ... ON CONFLICT`、`DELETE ...`）和 `assertValidRef` + `queryTemplate`/`executeTemplate` 调用模式完全相同（37+24+21 = 82 行重复）。差异只在加密/解密调用点——Android 调 `native.decrypt/encrypt`，mac 调 `decryptUtf8/encryptUtf8`，windows 调 `unprotectUtf8/protectUtf8`；以及 blob 解码方式（Android 用 base64 文本存储绕过 quick-sqlite heap 损坏，mac/windows 用 Buffer binary）。
- **改法**：
  1. 在 `packages/core/src/infra/sksp/` 或 sksp 共享位置新建 `sqlite-secret-store-base.ts`，提供 `SqliteSecretStoreBase` 抽象类，实现 `get`/`has`/`set`/`delete` 的 SQL 编排逻辑，通过模板方法暴露两个 hook：`encrypt(ref, plain) → { ciphertext, iv }` 和 `decrypt(ref, row) → string`。
  2. 三端各自继承 base class，只实现自己的 `encrypt`/`decrypt` 和 `ALGO` 常量。
  3. Android 的 base64 文本存储差异在 `encrypt`/`decrypt` 里处理——base class 的 SQL 模板里 ciphertext/iv 直接用 `unknown` 绑定，具体序列化方式由子类决定。
  4. `rowCiphertext`/`rowIv`/`decodeBlob` 这些辅助函数也抽到 base 里，子类可用。
- **验收**：三端 `get`/`has`/`set`/`delete` 行为不变；各自测试全绿；jscpd 报告中 sksp 间的重复降到 10 行以下。
- **预计消除**：~70 行重复

### DRY-2 [P1] desktop agent-event-types 改为 import core

- **维度**：C（DRY）
- **文件**：
  - `apps/desktop/shared/agent-event-types.ts`（整文件 60 行）
  - `packages/core/src/domain/events/model/event-types.ts`（源）
- **问题**：desktop 的 `shared/agent-event-types.ts` 是 core `event-types.ts` 的手工副本——7 个 `EVENT_*` 常量和 7 个 payload interface 完全相同（47 行重复）。文件头注释写着「由脚本生成」，但实际上每次 core 加新事件就得手改，已经漂移过（core 有 `EVENT_SUBAGENT_CHILD_SESSION_CREATED` 和 `EVENT_SESSION_*`，desktop 副本里没有）。
- **改法**：
  1. 删掉 `apps/desktop/shared/agent-event-types.ts`。
  2. 所有 desktop 内 import `agent-event-types` 的地方改为从 `@novel-master/core/events` 导入。
  3. 如果 renderer 进程因为安全限制不能直接 import core（main→renderer IPC 序列化边界），改为在 main 进程 import core 后通过 IPC 暴露给 renderer，或者直接用字符串字面量（事件名本来就是 `as const` 字符串，不怕漂移）。
  4. 保留生成脚本的思路——如果确实需要 renderer 隔离，写一个 `scripts/generate-desktop-events.mjs` 从 core 的 event-types 自动生成，并接入 CI 校验漂移。但优先尝试直接 import。
- **验收**：desktop 事件相关功能不变；`agent-event-types.ts` 文件删除；grep desktop 下无对它的 import。
- **预计消除**：47 行重复 + 消除漂移风险

### DRY-3 [P1] mobile agent-yaml / events-yaml 抽公共 yaml-import-export

- **维度**：C（DRY）
- **文件**：
  - `apps/mobile/src/services/agent-yaml.service.ts`（109 行）
  - `apps/mobile/src/services/events-yaml.service.ts`（99 行）
  - `apps/desktop/src/main/services/agent-yaml.service.ts`
  - `apps/desktop/src/main/services/events-yaml.service.ts`
- **问题**：agent-yaml 和 events-yaml 的 `blobFs`/`normalizeYamlError`/`exportXxxYaml`/`importXxxYaml` 四个函数结构完全相同（mobile 内 32+23+23+20 = ~98 行重复；desktop 内也有 26+20+20 行）。差异只在 schema（`agentDefinitionSchema` vs `eventsConfigSchema`）、文件名（`.agent.yaml` vs `events.config.yaml`）和 runtime 访问点（`agentRegistry` vs `eventsConfig`）。
- **改法**：
  1. 在 mobile 侧新建 `apps/mobile/src/services/yaml-import-export.ts`，提供泛化的 `exportYaml(yaml, fileName)` + `importYaml()` + `blobFs` + `normalizeYamlError`。
  2. `agent-yaml.service.ts` 和 `events-yaml.service.ts` 改为只提供 schema 绑定（decode/encode 纯函数），import/export 调公共函数。
  3. desktop 侧同理抽公共（如果 desktop 的 fs API 不同——desktop 用 `node:fs/promises` 而非 RN blob util——那就只抽 mobile 内部，desktop 另外单独收敛 agent/events 对）。
- **验收**：mobile 导入导出 agent yaml 和 events yaml 功能不变；yaml.service 之间的 jscpd 重复降到 10 行以下。
- **预计消除**：~80 行重复（mobile + desktop 各 ~40）

### DRY-4 [P2] vfs replace 逻辑抽公共函数

- **维度**：C（DRY）
- **文件**：
  - `packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts` L94-129
  - `packages/core/src/service/vfs/impl/vfs.service.ts` L133-168
- **问题**：两个 vfs service 的 `replace` 方法完全相同（34 行）——都是 read 当前内容 → indexOf/split 查找 oldString → 拼接 nextContent → write/update。唯一差异是最终调用 `this.write`（revision-aware）还是 `this.repo.update`（普通），但这只是 update 的路径不同。
- **改法**：
  1. 在 `packages/core/src/domain/vfs/logic/` 新建 `compute-replace-result.ts`，抽出纯函数 `computeReplaceResult(currentContent, oldString, newString, replaceAll) → { nextContent, replacements }`。
  2. 两个 service 的 `replace` 方法都改为调这个纯函数，然后各自走自己的 write 路径。
  3. `buildReplaceNotFoundError` 已是共享的，不用动。
- **验收**：vfs replace 相关测试全绿；jscpd 报告中两个 vfs service 间重复降到 10 行以下。
- **预计消除**：~25 行重复

### DRY-5 [移出] application-model-id 两份实现合一

- **维度**：C（DRY）
- **状态**：移出本次范围 → open_questions
- **原因**：探索报告确认 config-forms 有 **barrel 隔离硬约束**（`config-forms/**/*.ts` 全树零 `@/` import），且 `config-forms-merge-into-core/spec.md` 明确推迟合并。直接合并会打破 barrel 隔离，需独立迭代处理错误类型统一 + barrel 策略。

### DRY-6 [P2] desktop↔mobile 共享 hooks/services 抽公共

- **维度**：C（DRY）
- **文件**（top 重复项）：
  - `useBatchSelection.ts`（desktop renderer ↔ mobile，52 行重复）
  - `useAgentStreamMetrics.ts`（desktop renderer ↔ mobile，42+23+21 = 86 行重复）
  - `useAgentRunLifecycle.ts`（desktop renderer ↔ mobile，23 行重复）
  - `session-prompt-input.service.ts`（desktop main ↔ mobile，35 行重复）
  - `regex-test.service.ts`（desktop renderer ↔ mobile，36 行重复）
  - `regex-apply-channel.service.ts`（desktop main ↔ mobile，24 行重复）
  - `compare-app-versions.ts`（desktop main ↔ mobile，24 行重复）
  - `excerpt-release-notes.ts`（desktop main ↔ mobile，22 行重复）
  - `format-token-count.ts`（desktop renderer ↔ desktop main，25 行重复）
- **问题**：desktop 和 mobile 有大量直接 copy 的 hooks 和 utility service，逻辑完全相同但分别维护。这些是跨端共享逻辑的经典 DRY 问题。
- **改法**（分优先级处理，避免一次性动太多）：
  1. **纯工具函数优先**（`compare-app-versions` / `excerpt-release-notes` / `format-token-count`）：这些没有平台依赖，直接移到 `packages/core/src/common/` 或新建 `packages/shared/` 包，两端 import。
  2. **service 层次之**（`regex-test` / `regex-apply-channel` / `session-prompt-input`）：这些依赖各自 runtime，但核心逻辑相同。抽接口 + 共享实现，两端注入各自的 runtime adapter。
  3. **React hooks 最后**（`useBatchSelection` / `useAgentStreamMetrics` / `useAgentRunLifecycle`）：hooks 涉及 React 组件模型，需要确认两端 React 版本兼容后再抽。可以放到 `packages/shared-hooks/` 或 core 的 public hook 导出。
  4. **本 step 只做第 1 类**（纯工具函数），第 2/3 类记入 open_questions 留后续。
- **验收**：移到共享包的纯函数两端 import 成功；相关功能不变；jscpd desktop↔mobile 重复降低。
- **预计消除**：~70 行（第 1 类）；第 2/3 类额外 ~200 行留后续

### DRY-7 [移出] session port 两层定义收敛

- **维度**：C（DRY）
- **状态**：移出本次范围
- **原因**：探索报告确认这是 DDD 分层（domain repo 只 CRUD 返回原始行，service port 做业务编排返回反序列化模型），不是重复。强行合并会破坏依赖方向。

### DRY-8 [P2] webview post.ts 两端重复

- **维度**：C（DRY）
- **文件**：
  - `apps/mobile/src/web/code-editor/webview/runtime/post.ts`（全文）
  - `apps/mobile/src/web/rich-document/webview/runtime/post.ts`（全文）
- **问题**：两个 webview runtime 的 `post` 函数完全相同（23 行重复）——都是 `window.ReactNativeWebView.postMessage(JSON.stringify(msg))` 的封装。
- **改法**：
  1. 在 `apps/mobile/src/web/shared/` 下新建 `post.ts`，两个 webview runtime 都从 `../shared/post` import。
  2. 如果 webview bundle 的 import 路径解析有特殊限制（webview 是独立 bundle，不能用 `@/` 别名），用相对路径。
- **验收**：两个 webview 的 postMessage 功能不变；jscpd 重复消除。
- **预计消除**：~20 行重复

---

## Open questions / 待拍板

- **DRY-6 第 2/3 类**（service + hooks 跨端共享）：是否新建 `packages/shared/` 包来放跨端共享代码？还是继续放在 core？如果放 core 会增加 core 的 RN 兼容负担（hooks 需要 React 依赖）。新建包更干净但需要配 tsconfig/eslint/build。
- **DRY-2 renderer 安全边界**：desktop renderer 是否可以直接 import core 的 event-types？如果 renderer 进程有 bundle size 或安全限制（不能含 node 依赖），可能需要保持生成的副本——但要用 CI 脚本自动同步而非手维护。
- **DRY-3 desktop 侧**：desktop 的 agent-yaml/events-yaml 使用 `node:fs/promises` 而非 RN blob util——是各自抽还是统一接口？

---

## 不做（本次排除）

- **测试间重复**（388 clones / 4376 lines）：测试 setup/teardown 模板代码的复制是可接受的工程取舍，抽 test helper 的收益不大且会增加测试复杂度。
- **同文件内重复**（391 clones / 4827 lines）：大多是同一测试文件里多个 `it` 块的初始化代码相似，属于测试模式而非 DRY 问题。
- **desktop/desktop 内部重复**（如 `AgentDefinitionEditorForm.tsx` ↔ `AgentEditorView.tsx` 96 行）：这些是 UI 组件的表单逻辑复制，需要更大的重构（抽表单 schema 驱动），超出 DRY 收敛范围。

---

## 验收矩阵

| id | 预计消除行数 | 验收方式 | blocking |
|----|------------|---------|----------|
| DRY-1 | ~70 | sksp 三端测试 + jscpd | yes |
| DRY-2 | ~47 | desktop 事件功能 + grep 无旧 import | yes |
| DRY-3 | ~80 | mobile yaml 导入导出 + jscpd | yes |
| DRY-4 | ~25 | vfs replace 测试 + jscpd | no |
| DRY-5 | ~26 | config-forms 测试 + jscpd | no |
| DRY-6 | ~70（第1类） | 跨端工具函数 import + jscpd | no |
| DRY-7 | ~15 | typecheck | no |
| DRY-8 | ~20 | webview 功能 + jscpd | no |

**总计预计消除**：~350+ 行重复（从 11413 降到 ~11000 以下，重复率从 6.91% 降到 ~6.7%）

测试间和同文件内重复（~9200 行）不在本次范围。

---

## Fix-Spec Closure

| 项 | 状态 |
|----|------|
| fix-spec-ready | no（draft，待用户确认） |
| fix_spec_path | `docs/review/dry-fix-spec/D-DRY-1-fix-spec.md` |
| P0 / P1 / P2 | 0 / 3 / 5 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| open_questions | 3（见上） |
