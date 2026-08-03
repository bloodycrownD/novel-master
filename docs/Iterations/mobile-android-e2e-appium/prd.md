# Mobile Android E2E（Appium + WebdriverIO + TS）PRD

> **类型**：测试基础设施 + 回归用例  
> **平台**：Android only（首期）  
> **关联迭代**：`chat-rollback-vfs-tool-fixes`（首期用例对齐其 Mobile 手工验收项）  
> **技术栈**：Appium 2 + WebdriverIO + TypeScript

## 背景

Novel Master Mobile 当前仅有 Jest 单元/组件/集成测（`apps/mobile/__tests__`），无法在 **真机/模拟器** 上验证完整用户路径（Tab 导航、WebView 聊天 transcript、VFS 文件管理、Toast、系统 Alert）。

`chat-rollback-vfs-tool-fixes` 等多条 PRD 的 Mobile 验收依赖手工操作（回滚不跳屏、重命名冲突 Toast、工具 loading 与块顺序等），重复成本高且易漏测。

团队已选型 **Appium + WebdriverIO + TypeScript**，希望建立 **独立 E2E 链路**，与现有 Jest、Release 构建 **并行存在、互不替代**。

### 「不影响生产链路」的含义（已确认）

| 维度 | 约定 |
|------|------|
| 代码组织 | E2E 脚本、配置、fixture **仅** 位于 `apps/mobile/e2e/`（及可选少量 **additive** 的 `testID`） |
| 运行时行为 | **不** 改变聊天、VFS、Agent、打包等已有业务逻辑与默认 UI |
| 构建产物 | **不** 修改 `release.yml`、Gradle release 配置；E2E 使用 debug 包或本地 `assembleDebug` |
| CI | **首期不接** GitHub Actions；不阻塞现有 workflow |
| 与 Jest 关系 | Jest 继续负责单测/组件测；E2E 补 **整机黑盒** 缺口 |

允许的最小生产侧改动：为关键控件增加 `testID` / 稳定 `accessibilityLabel`（对最终用户无可见差异，不属于业务逻辑变更）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 可本地运行的 Android E2E 脚手架 | 开发者按 README 能在模拟器/真机执行 `npm run e2e`（或等价命令）并得到 pass/fail |
| 覆盖 rollback-vfs 手工项 | 首期至少 **3 条** 可自动判定用例：重命名冲突 Toast、回滚后消息/VFS 状态、工具区 loading/顺序（见验收） |
| 与生产解耦 | 删除整个 `e2e/` 目录后，App 构建与 Jest 测试 **行为与结果不变** |
| 可维护 | 用例使用 Page Object + 共享 fixture 步骤；单条 smoke < 3 分钟（模拟器） |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile 开发者 | 改完 chat/VFS UI 后本地跑 E2E，确认未回归 rollback-vfs 相关体验 |
| QA / 发布前 | 在 Android 模拟器上跑固定套件，替代部分重复手工 |
| 后续 CI 维护者 | （非首期）复用同一套 wdio 配置接入 optional job |

## 范围

### 包含范围

1. **脚手架**：Appium 2 + WebdriverIO + TypeScript；Android UiAutomator2；独立 `package.json` scripts（位于 `apps/mobile/e2e` 或 `apps/mobile` 下 `e2e:*` script）。
2. **首期用例**（对齐 `chat-rollback-vfs-tool-fixes` **Mobile 可测** 子集）：
   - VFS 同目录重命名冲突 → Toast「名称不能重复」（或等价）
   - 消息回滚 → 后续消息消失 + Toast「回滚成功」
   - 回滚后工作区文件与锚点一致（通过 VFS 列表/文件内容断言）
   - 聊天 transcript：assistant 消息内 **thinking → 正文 → 工具** 顺序（落库态，fixture 会话）
   - 工具调用 **pending/loading** 态（fixture 或可控 mock 流，不要求真实 LLM）
3. **WebView 支持**：聊天 transcript（`ChatTranscriptWebView`）context 切换与 DOM 选择器封装。
4. **Fixture 策略**：UI 逐步创建 **或** `e2e/fixtures` 预置数据（首期至少一种路径文档化并实现一种）。
5. **文档**：`apps/mobile/e2e/README.md`（环境、Appium、模拟器、运行命令）。

### 不包含范围

- iOS / Desktop E2E
- 接入 GitHub Actions / Release pipeline（后续迭代）
- 替换或削弱现有 Jest 测试
- 真实 LLM / 真实 Agent 联网对话（用 fixture 会话或 debug 可控输入）
- Core 层 checkpoint、write 覆盖、tool message 文案等 **非 UI** 断言（仍由 `packages/core` 单测覆盖）
- Detox / Maestro 选型对比（已定为 Appium + WDIO）

## 核心需求

1. **独立 E2E 工程**：配置、依赖、用例与 Jest 分离；默认 `npm test`（Jest）**不** 运行 E2E。
2. **Android 黑盒驱动**：通过 Appium 启动已安装的 debug APK，包名/Activity 与现有 `MainActivity` 一致。
3. **稳定选择器**：为 E2E 高频路径补充 `testID`（Toast、VFS 行、Composer、Tab 等）；WebView 内复用已有 `data-id` / `data-action`。
4. **rollback-vfs 回归套件**：实现与 `chat-rollback-vfs-tool-fixes` PRD §1、§2、§6 对应的 **可自动化** Mobile 验收（§3–§5 中 Core/LLM 项不纳入 E2E）。
5. **Fixture 可重复**：每条用例前后 App 状态可重置（清数据重装或内置「新建项目/会话」流程），避免用例间污染。
6. **失败可诊断**：失败时保存 screenshot + page source（WDIO 内置）；日志含当前 context（NATIVE / WEBVIEW）。

## 验收标准

### 脚手架

- **Given** 已安装 Node 22、Android SDK、Appium 2、模拟器或真机  
  **When** 执行文档中的 E2E 启动命令  
  **Then** WDIO 能连接 Appium，启动 App，至少 1 条 smoke 用例 pass。

- **Given** 仅运行 `apps/mobile` 下 Jest（`npm test`）  
  **When** 未安装 Appium  
  **Then** Jest **全部仍可按现状运行**，无 Appium 依赖。

### 用例 1 — 重命名冲突（对齐 rollback-vfs PRD §2 Mobile）

- **Given** 工作区某目录下已有 `a.md`，另有 `b.md`  
  **When** E2E 将 `b.md` 重命名为 `a.md`  
  **Then** Toast 出现且文案含「名称不能重复」或等价；列表仍同时存在 `a.md` 与 `b.md`（内容未被覆盖）。

### 用例 2 — 消息回滚（对齐 §1 + §3 Mobile 可见部分）

- **Given** fixture 会话含 ≥3 条消息，用户已滚至非底部  
  **When** 长按锚点消息 →「回滚」→ 确认  
  **Then** Toast「回滚成功」；锚点之后消息从 transcript 消失；**不** 出现「整页跳到列表最上方」的断言失败（通过锚点 `data-id` 仍在视口内或 scroll 指标阈值判定）。

### 用例 3 — 回滚后 VFS（对齐 §3 用户可见）

- **Given** 锚点 user 消息时刻工作区有文件 A；之后新增文件 B  
  **When** 回滚到该 user 消息  
  **Then** VFS 列表可见 A、不可见 B（或 A 内容恢复为锚点时刻）。

### 用例 4 — 块顺序与工具 loading（对齐 §6 Mobile）

- **Given** fixture assistant 消息含 thinking、正文、tool_call/result（或流式 pending fixture）  
  **When** 打开会话 transcript  
  **Then** DOM 顺序为 thinking 区域 → 正文 → 工具组；pending 工具显示 loading/「进行中」态，result 到达后消失。

### 生产隔离

- **Given** 未合并任何 E2E 目录改动，仅使用当前 main 分支 App  
  **When** 执行 release/debug 构建与现有 Jest  
  **Then** 行为与合并 E2E **脚手架前一致**（E2E 为 additive 目录与可选 testID）。

## 约束与依赖

- React Native 0.85.3；聊天主路径为 **WebView transcript**（需 context 切换）。
- 当前工程 **无** `testID`，首期需少量 additive 标注。
- E2E 依赖 Android debug 包（`apps/mobile/android`）；与 release 签名/ProGuard 无关。
- 回滚/滚动类断言对 WebView 滚动精度有限，验收采用 **阈值 + 锚点 visibility** 而非像素级对比。

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| WebView 选择器随 rich HTML 变化 | Page Object 集中维护；优先 `data-id` / `data-action` |
| Agent 流式用例需 mock | 首期用 **预置会话 DB/fixture**，不依赖联网 |
| E2E 耗时长 | 套件保持精简；与 Jest 分工 |
| testID 改动触及 UI 文件 | 仅 additive 属性，不改布局/逻辑 |
