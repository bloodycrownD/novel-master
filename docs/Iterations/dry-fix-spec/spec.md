---
date: 2026-08-09
---

# DRY Fix-Spec 技术规格（SPEC）

## 需求来源

- 需求文档：`docs/review/dry-fix-spec/D-DRY-1-fix-spec.md`（jscpd 重复代码收敛 fix-spec）
- 探索报告：3 份 readonly 子代理报告（SKSP / 跨端 / core 内部）
- 基线：cr-fix 分支 `7a8380da`（merge origin/main 后）

## 设计目标

把 jscpd 报告里源码（非测试）的重复热点收敛掉。核心思路：可维护、干净、不破坏行为。每条改动保持对外可观察行为不变，只消除知识重复和路径重复。

探索报告确认了 6 条 must-fix（原 8 条中 DRY-5/7 移出：application-model-id 有 barrel 隔离硬约束，session port 是 DDD 分层不是重复）。

## 总体方案

### 波次编排：P1 跨端/跨包 → P2 包内收敛

- **Phase 1（blocking）**：DRY-1 SKSP 三端抽象 + DRY-2 desktop event-types + DRY-3 yaml service —— 这三条是跨包/跨端的 P1，改动面最大但收益最高
- **Phase 2（non-blocking）**：DRY-4 vfs replace + DRY-6 纯工具函数 + DRY-8 webview post —— 包内/端内收敛，风险低

### 关键架构决策

- **SKSP 抽象**：模板方法模式，base class 管 SQL 编排，子类只实现 encrypt/decrypt strategy。Android 的 base64 文本存储（quick-sqlite heap 损伤 workaround）和 Windows 的 NULL iv 是两条红线——strategy 接口的载荷类型用 `unknown`，由子类自行序列化
- **event-types**：desktop renderer 消费点全是 `import type`（编译期擦除），直接改为 import core `@novel-master/core/events`，删掉手抄副本
- **yaml service**：不跨端抽（mobile RN blob / desktop node fs API 不通），只在同端内抽公共编排（blobFs/normalizeYamlError + 泛化 export/import）
- **DRY-5/7 不做**：application-model-id 有 barrel 隔离约束；session port 是分层不是重复

## 最终项目结构

```
packages/core/src/
  infra/sksp/impl/
    base-sqlite-secret-store.ts    # 新建：SQL 编排抽象基类
    sksp-strategy.port.ts          # 新建：encrypt/decrypt 策略接口
  common/
    compare-app-versions.ts        # 从 apps 移入
    excerpt-release-notes.ts       # 从 apps 移入
    format-token-count.ts          # 从 apps 移入
    normalize-yaml-error.ts        # 从 apps 移入（纯函数）
  domain/vfs/logic/
    compute-replace-result.ts      # 新建：replace 纯函数

packages/sksp-android/src/
  android-secret-store.ts          # 瘦身：只保留 strategy 实现
packages/sksp-mac/src/
  sqlite-secret-store.ts           # 瘦身：只保留 strategy 实现
packages/sksp-windows/src/
  sqlite-secret-store.ts           # 瘦身：只保留 strategy 实现

apps/mobile/src/
  services/yaml-shared.ts          # 新建：blobFs + 泛化 yaml 编排
  web/shared/post.ts               # 新建：webview postMessage 统一

apps/desktop/src/main/services/
  yaml-shared.ts                   # 新建：normalizeYamlError + 泛化 yaml 编排

apps/desktop/shared/
  agent-event-types.ts             # 删除
```

## 变更点清单

### Phase 1：phase-dry-core（blocking）

- DRY-1：SKSP 三端 secret store 抽公共 SQLite 逻辑
- DRY-2：desktop agent-event-types 改 import core + 删副本
- DRY-3：mobile + desktop yaml service 抽公共编排

### Phase 2：phase-dry-polish（non-blocking）

- DRY-4：vfs replace 抽纯函数
- DRY-6：纯工具函数移 packages/core/src/common/
- DRY-8：mobile webview post.ts 统一

## 详细实现步骤

### Phase 1：phase-dry-core

- Step 1 — phase-dry-core — blocking: yes — qa: auto：**DRY-1 抽象层**：在 `packages/core/src/infra/sksp/impl/` 新建 `sksp-strategy.port.ts`（定义 `SkspCryptoStrategy` 接口：`algo: string` + `encrypt(ref, plain) → { ciphertext, iv }` + `decrypt(ref, row) → string`，载荷类型用 `unknown`）和 `base-sqlite-secret-store.ts`（抽象类实现 `get`/`has`/`set`/`delete` 的 SQL 编排，通过 strategy hook 委托加密/解密）。通过 `infra/sksp/index.ts` barrel 导出。`has`/`delete` 三端逐字相同直接搬；`get` 前半段（SELECT + algo 校验）搬入 base，**ciphertext/iv 的解码与 null 检查全部下放 strategy**（Windows 不读 iv 不能由 base 统一检查）；`set` 后半段（INSERT ON CONFLICT）搬入 base，前半段调 `strategy.encrypt`。iv 列当可空处理。需验证 `executeTemplate` 对 null 绑定值（Windows iv）的处理
- Step 2 — phase-dry-core — blocking: yes — qa: auto：**DRY-1 三端迁移**：sksp-android 改为 `extends BaseSqliteSecretStore` + 传入 Android strategy（encrypt 调 `native.encrypt` 返回 base64 string，decrypt 调 `native.decrypt`）；sksp-mac 改为 `extends` + mac strategy（encrypt 调 `getOrCreateMasterKey` + `encryptUtf8`，decrypt 调 `decryptUtf8`）；sksp-windows 改为 `extends` + windows strategy（encrypt 调 `protectUtf8` 返回 `{ ciphertext: Uint8Array, iv: null }`，decrypt 调 `unprotectUtf8`）。保留各自的 `create*SecretStore` 工厂和 `ALGO` 常量。`register.ts` 不动
- Step 3 — phase-dry-core — blocking: yes — qa: auto：**DRY-2 event-types**：确保 core 先 `npm run build`（renderer typecheck 依赖 dist 存在）；删 `apps/desktop/shared/agent-event-types.ts`；4 个 renderer 消费点（`ConversationPanel.tsx` / `conversation-abort-retain.ts` / `useAgentRunLifecycle.ts` / `useAgentStream.ts`）的 `import type` 从 `@shared/agent-event-types` 改为 `@novel-master/core/events`（type-only 编译期擦除，不进 bundle）；保留 `generate-desktop-events.mjs` 脚本但标注「已不需要，保留 lint 子集约束选项」
- Step 4 — phase-dry-core — blocking: yes — qa: auto：**DRY-3 mobile yaml**：在 `apps/mobile/src/services/` 新建 `yaml-shared.ts`，抽 `blobFs` + `normalizeYamlError` + 泛化的 `exportYamlFile(yaml, fileName)` + `importYamlFile(consume: (yamlText: string) => Promise<void>)`（用 `@react-native-documents/picker` 的 pick/save/keepLocalCopy，把 decode+validate+persist 整体作为回调注入）；`agent-yaml.service.ts` 和 `events-yaml.service.ts` 改为薄封装：只保留 `decode*YamlText`/`encode*YamlText`（schema 绑定）+ 调公共编排
- Step 5 — phase-dry-core — blocking: no — qa: auto：**DRY-3 desktop yaml**：在 `apps/desktop/src/main/services/` 新建 `yaml-shared.ts`，抽 `normalizeYamlError` + 泛化的 `exportYamlWithDialog(yaml, fileName)` + `importYamlWithDialog()`（用 `electron.dialog`）；`agent-yaml.service.ts` 和 `events-yaml.service.ts` 改为薄封装

### Phase 2：phase-dry-polish

- Step 6 — phase-dry-polish — blocking: no — qa: auto：**DRY-4 vfs replace**：在 `packages/core/src/domain/vfs/logic/` 新建 `compute-replace-result.ts`，抽纯函数 `computeReplaceResult(currentContent, oldString, newString, replaceAll) → { nextContent, replacements }`；`revision-aware-vfs.service.ts` 和 `vfs.service.ts` 的 `replace` 改为「read → 调纯函数 → 各自 write/update」
- Step 7 — phase-dry-polish — blocking: no — qa: auto：**DRY-6 纯工具函数**：把 `compareAppVersions` + `excerptReleaseNotes` + `formatTokenCount` + `formatPromptTokenUsageLabel` + `normalizeYamlError` 移到 `packages/core/src/common/`；在 `packages/core/package.json` exports 新增 `"./common"` 子路径（types/import 指向 `dist/common/index`），并在 `packages/core/src/common/index.ts` 做 barrel re-export。删 apps 下的重复实现（含 mobile 的 `format-token-count.ts`——三端三份重复）；各消费点改 `import { ... } from "@novel-master/core/common"`。注意 bundler 解析：mobile metro / desktop vite / desktop main 三套都要能解析新子路径
- Step 8 — phase-dry-polish — blocking: no — qa: auto：**DRY-8 webview post**：在 `apps/mobile/src/web/shared/` 新建 `post.ts`（`BRIDGE_V` 由调用方传入或提为 shared 常量）；`code-editor/webview/runtime/post.ts` 和 `rich-document/webview/runtime/post.ts` 删除，调用点改为 import `@web/shared/post`

## 测试策略

### 测试原则

- 每条 DRY 改动都是纯重构，现有测试必须保持全绿
- 新增的公共抽象（base class / 纯函数）补单测覆盖
- jscpd 验证重复率下降

### 测试用例

- T-DRY1 — blocking: yes — SKSP 三端 `get`/`has`/`set`/`delete` 行为零回归（现有测试全绿）
- T-DRY2 — blocking: yes — desktop renderer 事件类型 import 编译通过；`generate-desktop-events` 脚本仍可运行（如保留）
- T-DRY3 — blocking: yes — mobile/desktop yaml 导入导出 agent/events 功能不变
- T-DRY4 — blocking: no — vfs replace 单次/全量/未命中三种场景行为不变
- T-DRY6 — blocking: no — `compareAppVersions` / `excerptReleaseNotes` / `formatTokenCount` 从 core import 后两端功能不变
- T-DRY8 — blocking: no — 两个 webview 的 postMessage 功能不变
- T-JSCPD — blocking: no — jscpd 重跑，非测试源码重复行数下降 ≥300 行

## 风险与回滚方案

### 高风险项

1. **SKSP Android base64 workaround**：strategy 接口必须允许 `ciphertext: string`（不能假设 Uint8Array）。如果抽象层把 Android 的 base64 路径改成 Uint8Array，会触发 quick-sqlite heap corruption。**缓解**：载荷类型用 `unknown`，子类自行序列化
2. **SKSP Windows NULL iv**：SQL 模板的 iv 列必须接受 null。**缓解**：base class 的 INSERT 模板里 iv 直接绑 strategy 返回值（可能是 null）
3. **bundler 解析**：纯工具函数移到 core 后，mobile metro bundler 需要能解析 `@novel-master/core/common` 新子路径。**缓解**：在 `packages/core/package.json` exports 显式新增 `"./common"` 子路径

### 回滚原则

每条 DRY 改动独立提交，出问题可单独 revert。

### 跨 phase 依赖

Step 7（Phase 2）会把 `normalizeYamlError` 从 Step 4/5（Phase 1）的本地 `yaml-shared.ts` 替换为 core 导入——实施时 Phase 2 直接从 core import 即可，Phase 1 的本地版本会被覆盖。
