# Novel Master Desktop App PRD

## 背景

- Monorepo 已具备 `@novel-master/core`（项目/会话/消息、域 VFS、工作树、Agent、服务商、正则、压缩、事件编排等完整域能力）。
- **`apps/mobile`** 已实现与 Core 全量对接的 Android 产品 App（SQLite + SKSP Android + 完整功能闭环），可作为 **行为与能力对照**。
- **`examples/desktop`** 提供浏览器优先的 **三栏 UI 原型**（预览 | 工作区树 | 聊天轨 + 设置页），布局与 IA 已冻结；当前数据为 mock（localStorage），无 Core 集成。
- **`apps/desktop`** 仅为 Electron 壳（占位 renderer），尚未承载产品 UI 与 runtime。
- 平台 SKSP 驱动已具备：`@novel-master/sksp-windows`（DPAPI）、`@novel-master/sksp-mac`（Keychain）；Desktop 需按平台注册对应驱动以安全存储服务商 API Key。
- Node 侧 SQLite 可通过 `@novel-master/tdbc-driver-better-sqlite3` 接入（CLI 已验证）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 还原 desktop 原型 UI | 三栏冻结布局（`#preview-pane` \| `#explorer-pane` \| `#chat-rail`）及原型能力清单在 Electron 中可演示；视觉与交互与 `examples/desktop` 一致 |
| 功能对齐 mobile | mobile 已交付的全部产品能力在 Desktop 可用（对话、VFS、Agent、服务商/模型、正则、压缩、事件、备份等）；行为语义与 mobile/CLI 一致 |
| 真实持久化 | 业务数据写入应用私有 SQLite（经 Core bootstrap）；不再依赖原型 mock / localStorage |
| 跨平台可交付 | Windows 与 macOS 均可构建 **未签名** 安装包（`.exe` / `.dmg` 或等价产物），本地安装后可独立运行 |
| 凭据安全 | 各平台 API Key 经 SKSP 加密存储；Provider 创建/编辑/请求时密钥不落明文到 DB 或 UI 日志 |
| 数据可迁移 | 支持 DB 全量导出/导入（复用 Core 原生能力，与 mobile 备份格式兼容）；跨端迁移时大部分业务数据可恢复，少量 UI/指针类状态不可恢复为可接受范围 |

**量化参考：**

- mobile 功能清单覆盖率：**100%**（不含 mobile 专属开发调试页）。
- 端到端场景 E1–E3（见验收标准）在 Win 与 macOS 各至少通过 1 次。
- `examples/desktop/scripts/verify-spec-matrix.mjs` 所覆盖的 desktop DOM/交互项，在正式 App 中有对应实现（由 mock 升级为真实数据）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 创作者 | 在桌面端管理项目与会话，编辑工作区文件，与 AI 协作写作 |
| 配置用户 | 在设置页管理 Agent、服务商/模型、压缩条件、事件、正则、全局模板 |
| 跨端用户 | 从 mobile 导出 DB 后在 Desktop 导入继续工作（或反向） |

**典型流程：**

1. 启动 App → 选择/创建项目 → 选择/创建会话 → 在聊天轨进入对话。
2. 在中间工作区树编辑会话/项目/全局 VFS 文件 → 左侧预览/编辑文件内容。
3. 发送消息 → Agent 运行（含流式输出、工具调用展示）→ 必要时消息编辑/隐藏/回滚/分叉。
4. 在设置页配置 Provider（含 API Key）→ 拉取远程模型 → 配置采样参数。
5. 导出 DB 备份 → 在另一台机器或 mobile 导入恢复。

## 范围

### 包含范围

1. **Electron 产品 App**（`apps/desktop`）：以现代前端框架（React 或 Vue，实现阶段选型并说明理由）重写 renderer，**UI 完全依照 `examples/desktop` 原型**，不接原型 vanilla JS 直迁。
2. **Runtime 集成**：对标 `apps/mobile` 的 Core 服务装配（项目/会话/消息、VFS、Agent、Provider、正则、压缩、事件等）；UI 层仅做薄封装，不重写域逻辑。
3. **平台驱动**：
   - SQLite：`tdbc-driver-better-sqlite3`
   - SKSP：Windows 注册 `sksp-windows`，macOS 注册 `sksp-mac`
4. **功能全集（对齐 mobile）**，包括但不限于：
   - 项目/会话 CRUD、批量操作、项目模板与会话工作区 VFS
   - 对话（消息流、Composer、流式、token meta、消息操作、手动压缩）
   - Agent 管理/编辑（含 YAML 导入导出）
   - 服务商/模型/采样 CRUD、远程模型拉取
   - 压缩条件、事件配置（含 YAML 导入导出）
   - 正则组/规则管理
   - 全局模板 VFS、文件编辑器（markdown 预览）
   - DB 导出/导入（全量替换）
   - 主题浅/深切换
5. **构建产物**：Win/macOS 未签名可安装包；开发态 `npm run desktop:dev` 可运行。

### 不包含范围

- **CLI（`nm`）功能扩展**；Desktop 为独立产品端，不新增 CLI 子命令。
- **mobile 式 VFS/SKSP 开发调试页**。
- **自动更新、代码签名、应用商店分发**。
- **Linux 平台**支持。
- 本 PRD **不包含**技术方案、接口设计、目录结构、任务拆分（见后续 SPEC）。

## 核心需求

1. **三栏主界面**：左预览、中工作区树、右聊天轨；列宽可调；窄屏下预览区可隐藏；与原型布局一致。
2. **聊天轨嵌套导航**：项目 → 会话 → 对话 drill-down；返回导航；会话菜单（切换 Agent/模型、真实提示词、批量消息操作、压缩等）。
3. **工作区联动**：Explorer 标题与范围随当前导航上下文切换（全局 / 项目 / 会话）；VFS 行操作（纳入、目录规则、重命名、删除、模板 pull、zip 导入导出）。
4. **完整 Agent 对话闭环**：Composer 发送 → Core `runAgentTurn` → 流式展示 → 工具卡/步骤可见；支持消息编辑、隐藏、复制、分叉、回滚、删除。
5. **设置与配置**：原型 settings 覆盖的全部配置面对接 Core 真实 CRUD（Agent、Provider/模型/采样、压缩、事件、正则、全局模板、备份恢复）。
6. **SKSP 凭据**：Provider API Key 写入/读取走平台 SKSP 驱动；列表/详情不泄露明文密钥。
7. **跨平台交付**：同一 codebase 产出 Windows 与 macOS 安装包；各平台 SKSP 行为一致（set/get round-trip）。

## 验收标准

### 布局与导航

- **Given** 首次启动 Desktop App  
  **When** 主窗口打开  
  **Then** 可见三栏（预览 | 工作区 | 聊天轨），且可通过拖拽调整列宽。

- **Given** 在聊天轨  
  **When** 依次进入某项目 → 某会话 → 对话视图  
  **Then** 中间工作区标题与树范围切换为对应上下文；左侧预览可打开选中文件。

### 对话与 Agent

- **Given** 已配置有效 Provider/模型/Agent，当前会话非空  
  **When** 在 Composer 输入并发送一条用户消息  
  **Then** 消息持久化到 SQLite；Agent 运行完成或流式结束后，助手回复可见；刷新 App 后消息仍在。

- **Given** 会话中已有助手消息  
  **When** 对某消息执行「回滚到此」并确认  
  **Then** 该消息之后的内容从当前视图移除且 DB 状态与 mobile/CLI 语义一致。

### Provider 与 SKSP

- **Given** Windows 或 macOS 环境  
  **When** 新建 Provider 并保存 API Key，随后发起一次模型列表拉取或对话请求  
  **Then** 请求成功；DB `sksp_secrets` 存在对应 ref 且 UI/日志无 API Key 明文；重启 App 后仍可读取密钥。

### VFS 与文件

- **Given** 某会话工作区  
  **When** 新建文件、编辑保存、在左侧预览打开  
  **Then** 内容与 Core VFS 一致；纳入/目录规则变更后「真实提示词」反映新上下文。

### 配置页

- **Given** 打开设置页各子项（Agent、Provider、压缩、事件、正则、全局模板）  
  **When** 完成一项创建/编辑/删除  
  **Then** 变更持久化；重启 App 后仍生效；行为与 mobile 同功能一致。

### 备份与跨端

- **Given** mobile 或 Desktop 导出的 DB 备份文件  
  **When** 在 Desktop 执行导入（全量替换）  
  **Then** 项目/会话/消息/VFS/Agent/Provider 等核心业务数据可继续使用；少量 UI 指针状态丢失不阻塞主流程。

### 构建与平台

- **Given** 干净环境执行 Desktop 构建  
  **When** 分别在 Windows、macOS 生成安装包并安装运行  
  **Then** 上述 E1（布局）、E2（对话）、E3（Provider+SKSP）场景均可完成。

---

## 约束与依赖

- UI 以 [`examples/desktop`](../../../../examples/desktop) 为 **唯一 IA/布局权威**；[`apps/mobile`](../../../../apps/mobile) 为 **功能与行为权威**。
- 域逻辑、数据模型、服务接口以 `@novel-master/core` 为准；禁止在 Desktop UI 层复制 business rules。
- 依赖已存在的 SKSP 驱动包；Desktop 仅负责按平台注册与 runtime 接线。
- DB 备份/导入复用 Core 能力，不单独定义 Desktop 专有格式。

## 非功能需求（业务/体验）

- 主路径操作（发送消息、保存文件、切换会话）无明显未捕获崩溃。
- 浅色/深色主题切换即时生效且持久化。
- 长对话与 VFS 大目录下保持可接受的交互响应（具体性能指标在 SPEC 定义）。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 前端框架选型 | PRD 不限定 React/Vue；SPEC 阶段需给出选型及优缺点（如 RN 生态接近度、Electron 社区成熟度、团队熟悉度、包体积等）并锁定 |
| 原型与 mobile 差异 | 原型 README 部分条目（如 rail「对话\|我的」Tab）与当前 HTML 实现可能不完全一致；以 **实际原型 HTML 行为** 为准，功能缺口用 mobile 能力补齐 |
| Token 精确计数 | mobile 使用 Android native tokenizer；Desktop 是否首期接入 Node tokenizer 驱动或近似计数，SPEC 阶段确认 |
| 安装包形态 | 未签名 `.exe`/`.dmg` 的具体工具链（electron-builder 等）在 SPEC 定义；首版不要求公证/签名 |
