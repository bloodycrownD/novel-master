# Novel Master Android App PRD

## 背景

- Monorepo 已具备 `@novel-master/core`（项目/会话/消息、域 VFS、工作树、Agent、服务商、正则、压缩等）及 `@novel-master/tdbc-driver-rn`、`@novel-master/sksp-android`；CLI（`nm`）作为行为对照。
- **`examples/mobile`**（[`index.html`](../../../examples/mobile/index.html) + [`js/app.js`](../../../examples/mobile/js/app.js)）为可运行的 **HTML 交互原型**；功能清单已按代码审计修订为 [feature-inventory.md](../../../examples/mobile/docs/feature-inventory.md)（**权威 UI/IA**，非旧版 4 Tab 假设）。
- 原型数据为 **mock**（localStorage / 内存）；正式 App 须接 Core SQLite，语义对齐 CLI。
- **`apps/mobile`** 脚手架已完成（全库 bootstrap、VFS/SKSP 开发页）；本 PRD 定义在其之上的 **Android 产品 App**。
- **Core 前置（C0）**：见 [spec.md](./spec.md)（含 `KkvService` 库级导出；App 用 `AppUiPreferences` 封装 module `nm-mobile-ui`）。
- **平台**：仅 **Android**；不考虑 iOS。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 还原原型 IA | 底栏 **3 Tab**（对话 / Agent / 我的）；对话内 **会话↔项目模板**、**聊天↔会话工作区** 子 Tab；☰ **项目抽屉 / 会话操作抽屉** 上下文切换与原型一致 |
| 还原原型交互 | 清单 **§0–§13**（已实现部分）在 App 中可演示；§14 扩展项按优先级分期 |
| 真实持久化 | 业务数据写应用私有 SQLite；不再依赖原型 mock 存储 |
| 完整写作闭环 | 选项目 → 会话 → 编辑会话工作区 → AI 对话（含工具卡）→ 调工作树规则 → 真实提示词/日志 → 必要时回滚 |
| Android 可交付 | 约定环境下 `run-android` 可安装；主路径无未捕获崩溃 |

**量化参考：**

- **P0（原型 §0–§13）**：§15 文档索引中「已实现」条目 ≥ 95% 可演示（允许发送/拉模型等依赖 Core 的链路在接好后验收）。
- **P1（§14 扩展）**：项目/会话 template pull、服务商完整 CRUD、会话复制等，可在 M2+ 迭代，不阻塞首版上架内测。
- 端到端场景 **E1–E3**（见验收）至少各通过 1 次。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 创作者 | 手机上管理项目与会话，在「会话工作区」写稿，与 AI 协作 |
| 配置用户 | 在「我的」管理模型、Agent、压缩、正则、全局模板 |
| 开发者 | 保留 VFS/SKSP 开发页做设备端对照 |

**典型流程（对齐清单 §11）：**

1. 项目抽屉选项目 → 新建/选会话 → 聊天；必要时在「项目模板」Tab 维护模板。  
2. 「会话工作区」编辑文件 → 对话中 AI 改文件 → 「会话日志」查看 → **检查点回滚**（用户编辑与 Agent 写文件均产生 SessionFs 批次）。  
3. VFS 行上改纳入/目录规则 → 「真实提示词」确认 AI 可见上下文。  
4. 「我的」维护 global 模板；**扩展**：项目/会话 template pull（§14，原型无按钮）。

## 范围

### 包含范围

以修订后的 [功能清单](../../../examples/mobile/docs/feature-inventory.md) 为准，分两层：

#### A. 必须与 HTML 原型一致（清单 §0–§13）

1. **全局（§0–§1）**  
   页面/抽屉/模态/Sheet 清单；3 Tab + 全屏栈；列表 **批量管理**（项目/会话/Agent/服务商/模型/正则）；Toast/confirm；**浅色/深色主题**（顶栏切换、持久化）。

2. **项目与会话（§2）**  
   项目抽屉（列表、当前、新建、批量删）；当前项目 Banner；会话列表（meta、新建、批量删、空状态）；**项目模板**子 Tab（project 域 VFS）。

3. **对话（§3）**  
   聊天 meta（默认 Agent + 工作区/专属模型展示）；消息流与工具卡片；会话操作抽屉（**切换模型**、真实提示词、会话日志）；输入区（多行 + 发送，接 Core 后生效）。

4. **VFS 文件管理器（§4）**  
   三域同一套 `vfs-fm`：路径、上级、行状态/徽章/规则灯、行菜单、更多菜单、目录规则 Sheet；**fileEditor**（保存/预览/未保存/离开确认）。

5. **工作树（§5）**  
   无独立 Tab；规则在 VFS 行操作；真实提示词页展示合成文本（App 接 `WorktreeService.renderDisplay`，非静态 HTML）。

6. **会话日志（§6）**  
   统一时间线；工具成功/失败/检查点（含 **Agent 写文件** 批次）；回滚确认与进行中互斥；FIFO 提示 Banner。

7. **Agent（§7）**  
   列表（默认徽标、菜单：设为默认/复制/删除、批量）；编辑页（专属模型开关、maxSteps、Prompt 块 text/abstract/chat、工具说明、JSON 预览）。

8. **服务商与模型（§8）**  
   服务商列表与详情；添加已保存模型；采样独立页（按协议字段）；**工作区当前模型**模态框（我的 + 会话抽屉双入口，同一状态）。

9. **正则（§9）**  
   四级栈；组/规则批量管理；规则详情（llm/display 分区开关）；测试预览（样例 + channel）；**接 Core**，非 localStorage。

10. **扩展（§10）**  
    压缩策略完整表单（含 agent 摘要 + instruction）；扩展设置页各项；全局模板 VFS；开发调试入口接脚手架页。

11. **边界（§12）**、**Android 布局（§13）**。

#### B. App 扩展（清单 §14，原型无 UI，建议首期或紧接二期）

| 能力 | 优先级建议 |
|------|------------|
| 项目/会话 **template pull**（警告覆盖） | 高（Core 已有） |
| 服务商 **新增/编辑/密钥**、**拉取模型列表** | 高 |
| 会话 **复制**、项目 **复制/删除**（非仅批量） | 中 |
| **停止生成** | 中（依赖 Core abort） |
| 工具卡片 **展开详情** | 中 |
| Zip 导入/导出 | 低 |
| 独立工作树 Tab | 低（真实提示词已覆盖主路径） |
| Per-session Agent 选择 | 低（首期用工作区 **当前 Agent** 指针，见 C0） |

### 不包含范围

- **iOS**（不编译、不验收、不发布）。
- **banzhu 阅读器**业务。
- 与 CLI **共用同一 DB 文件**或云同步。
- 聊天气泡 **display 通道**脱敏（清单 §9 范围外）。
- 应用商店上架、账号体系、埋点、国际化（另立项）。

## 核心需求

1. **IA  fidelity**：严格按原型 §0 的页面/抽屉/模态结构实现 RN 导航，不以「4 Tab + 独立文件页」替代现有嵌套 Tab 方案，除非经产品变更 PRD。
2. **数据层**：`bootstrapNovelMaster` + 与 CLI 等价的 service 装配；原型 mock 仅作 UI 对照。**持久化分层**：工作区/跨端配置 → `PersistentState` / `PersistentPreferences`；UI 偏好 → App 封装 `AppUiPreferences`（Core 导出 `KkvService`，module `nm-mobile-ui`）。Agent 变异工具经 `SessionFsService.execute`。
3. **对话闭环**：发送消息 → `AgentRunner` 流式/工具卡 → 会话工作区可见文件变更；顶栏模型与 **当前 Agent**（`PersistentState.currentAgentId`，未设则 Registry 首项）及工作区/专属模型展示一致。
4. **VFS + 工作树**：三域浏览器行为对齐 `vfs-fm`；用户保存走 `sessionFs.execute`（actor `user`）；目录规则 Sheet 字段对齐 Core；真实提示词页动态渲染。
5. **配置中心**：我的菜单各二级页与原型表单项一致；正则/压缩/采样接 Core 存储；**设为默认 Agent** 写 `PersistentState.setCurrentAgentId`；**UI 扩展设置**（主题、工具展示等）写 App 封装的 **`AppUiPreferences`**（KKV `nm-mobile-ui`）。
6. **列表批量管理**：项目/会话/Agent/服务商/模型/正则的批量 UX 与原型一致（含底栏/内嵌双模式）。
7. **扩展交付**：§14 中高优先级项在首版或紧随迭代交付，并在验收中单独标注。

## 验收标准

> 章节号对应 [feature-inventory.md](../../../examples/mobile/docs/feature-inventory.md)。

### A. 工程

- **A0（C0）** Core：`randomUUID`；`PersistentState.currentAgentId`；Agent 工具→SessionFs；**导出 `createKkvService`/`KkvService`**。
- **A1** App 启动进入 **对话 Tab**（非仅开发页）；DB 失败可读错误。
- **A2** 冷启动后项目/会话、**当前 Agent 指针**仍存在。

### B. 导航与 IA（§0–§1）

- **B1** 底栏仅 **对话 / Agent / 我的** 三项。
- **B2** 对话 Tab 含 **会话 | 项目模板** 与 **聊天 | 会话工作区** 子 Tab；切换后顶栏标题与原型一致。
- **B3** 会话列表态 ☰ 打开 **项目抽屉**；聊天态 ☰ 打开 **会话操作抽屉**（含当前模型文案）。
- **B4** 全屏二级页隐藏底栏；返回栈正确；Agent/规则/文件编辑未保存离开 confirm。
- **B5** 项目/会话列表可进入 **批量管理** 并删除，confirm 文案合理。

### C. 项目与会话（§2）

- **C1** 项目抽屉：新建、切换、当前徽标、Banner 联动。
- **C2** 会话：新建进入聊天、空状态、批量删除。
- **C3** 项目模板 Tab：`/template` 域 VFS 可浏览（接 Core 后真实数据）。

### D. 对话（§3）

- **D1** 顶栏展示当前 Agent 名与模型（工作区或专属）；与会话抽屉模型选择一致；与 `PersistentState.currentAgentId` 一致。
- **D2** 发送消息后助手回复；工具卡状态可辨；流式有指示（或协议不支持时整段显示）。
- **D3** 真实提示词页内容为 Core 渲染结果（非写死 HTML）。
- **D4** 未配置工作区模型时不可发送并有引导。

### E. VFS 与工作树（§4–§5）

- **E1** 会话工作区：上级/路径/行菜单/更多菜单/目录规则 Sheet 行为与原型一致。
- **E2** 纳入三态、目录规则开关、行副标题与徽章随操作更新。
- **E3** 双击/打开文件进入编辑器；保存经 SessionFs（actor `user`）后内容持久；未保存离开 confirm。
- **E4** 修改规则后真实提示词文本变化（`renderDisplay`）。

### F. 会话日志（§6）

- **F1** 工具与检查点同列倒序；含 Agent 写文件批次；失败条、已移除检查点 disabled。
- **F2** 回滚确认、进行中互斥、成功 Toast。

### G. Agent（§7）

- **G1** 默认 Agent 徽标（对 `currentAgentId`）；设为默认写 `PersistentState`；复制/删除；编辑页各区块可保存并再入页回显。

### H. 服务商与模型（§8）

- **H1** 添加已保存模型、进采样页、按协议保存采样。
- **H2** 工作区模型模态框：我的与抽屉写入同一 `PersistentState` 模型指针。

### I. 正则（§9）

- **I1** 四级导航；当前组徽标；组/规则 CRUD + 批量删。
- **I2** 规则详情 llm/display 开关 + 测试预览与 `nm regex test` 语义一致（单条规则）。

### J. 扩展设置（§10）

- **J1** 压缩策略各字段可保存至 Core store。
- **J2** 扩展设置：`AppUiPreferences`（KKV `nm-mobile-ui`）持久化 theme / 工具展示等；`sessionFsVersionCheck` 写 `PersistentPreferences`（跨端，不进 App module）。

### K. 主题与平台（§1.5、§13）

- **K1** 主题切换全局生效；冷启动后仍保持（KKV `nm-mobile-ui/theme`，经 `AppUiPreferences`）。
- **K2** 不要求 iOS build。

### L. 端到端（§11）

- **L1** 新建项目 → 会话 → 工作区写文件 → 对话 → 真实提示词含工作区上下文。
- **L2** Agent 工具改文件后工作区可读；日志有工具条 **与** 对应检查点批次。
- **L3** 可回滚 Agent 或用户编辑产生的检查点（`sessionFs.rollbackBatch`）。

### M. App 扩展（§14，可选里程碑）

- **M1** `project template pull` / `session template pull` 有 UI + 警告 confirm。
- **M2** 服务商可新增并配置密钥（SKSP）。
- **M3** 会话可复制（`SessionService.copy`）。

## 约束与依赖

| 项 | 说明 |
|----|------|
| UI 权威 | `examples/mobile` 代码 + 修订后 `feature-inventory.md` |
| 行为权威 | `apps/cli` / `@novel-master/core` |
| 技术 SPEC | [spec.md](./spec.md)（含 C0 与里程碑） |
| 原型差异 | 旧 README「4 Tab」描述已过时，以清单 §0 为准 |
| 平台 | 仅 Android |

## 风险与待确认项

| 项 | 影响 |
|----|------|
| 检查点 FIFO | 设置页有条数；Core retention **尚未**实现，首期 Banner 可仅提示 |
| 停止生成、zip | §14；Core/App 待做 |
| 服务商「添加」原型未实现 | §14 高优，M6 交付 |
| Gemini 无 stream | 降级展示 |
| C0 与 Mobile 并行 | **须先合并 C0** 再开 M1 |
| App 误写 Core KKV module | App 仅经 `AppUiPreferences`；禁止直写 `nm-workspace-state` 等 |

**已关闭（本期定案，见 spec C0）**

| 原待确认项 | 定案 |
|------------|------|
| 默认 Agent 持久化 | `PersistentState.currentAgentId` |
| Agent 工具 vs SessionFs | 变异工具经 `sessionFs.execute`（actor `assistant`） |
| `node:crypto` on RN | Core `infra/random-uuid` |
| UI 偏好（主题等） | Core 导出 `KkvService`；App `AppUiPreferences` → module `nm-mobile-ui`（不用 AsyncStorage） |

## 里程碑（与 [spec.md](./spec.md) 对齐）

| 阶段 | 交付 |
|------|------|
| **C0** | Core：randomUUID、currentAgentId、Agent→SessionFs、**export KkvService**；CLI toolCtx 对齐 |
| M1 | Runtime + 3 Tab + 双抽屉 + 项目/会话/子 Tab |
| M2 | VFS 三域 + fileEditor + 目录规则 Sheet |
| M3 | 对话 + AgentRunner + 真实提示词 + 当前 Agent |
| M4 | 我的全套（服务商/采样/压缩/正则/设置/全局模板） |
| M5 | 会话日志 + 批量管理打磨 + 主题 |
| M6 | §14 扩展（template pull、服务商 CRUD、会话复制） |
