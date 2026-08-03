# VFS 统一根路径（对齐 ST-VFS）PRD

> **范围**：VFS 逻辑路径模型与对外语义；与 ZIP 导入导出、CLI、移动端展示一致。  
> **边界**：本 PRD 不含技术方案、接口、表结构、任务拆分（见后续 SPEC）。  
> **参照**：[SillyTavern st-virtual-file-system](file:///D:/Dev/Js/SillyTavern/public/scripts/extensions/third-party/st-virtual-file-system) — 路径恒为 `/` 下绝对路径；「模板」为数据范围/快照，而非 `/template/` 路径前缀。

## 背景

- Novel Master 当前 VFS 在 **global / project** 域要求逻辑路径以 `/template/` 为前缀，**session** 域则为会话根下的 `/foo.md` 等，形成两套路径形状。
- 用户与工具心智应为：**任意域的文件树都以 `/` 为根**，路径如 `/readme.md`、`/ddd/love_message.txt`，不应在 session/project 界面或 Agent 工具中看到 `/template/...`。
- 便携 ZIP 应以「去掉 leading `/` 的平铺路径」表达文件树（如 `ddd/a.md`），**不因域不同而改变路径形状**；同一 ZIP 在不同域导入时应仅表示「覆盖该域当前文件树」，而非因路径前缀规则拒绝合法文件列表。
- 现行 `chat-project-vfs` 将 `template` 当作路径命名空间，与 ST-VFS 及上述产品预期不一致，需在独立迭代中纠正。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 统一逻辑根 | 所有 VFS 域（global / project / session）对外逻辑路径均以 **`/` 为唯一根** |
| 模板语义去路径化 | 「模板」指 **模板快照 / 编辑范围**（global 或 project 级默认树），**不是**逻辑路径前缀 `/template/` |
| 便携 ZIP 形状一致 | 导出 ZIP 条目名为 `foo.md`、`dir/bar.md`（无 `template/` 域前缀）；三域 ZIP **路径形状相同** |
| 导入语义不变 | 导入仍为 **该域全量替换**；路径校验仅针对「`/ ` 下合法路径」，**不再**因「非 `/template/`」拒绝 session 形 ZIP |
| 三端一致 | Core 语义为准；CLI、移动端、Agent `vfs.*` 工具看到的路径规则一致 |

**成功指标（可量化）**

- Core + CLI 自动化：至少 **6 条**用例覆盖路径规范化、三域 list/read 路径形状、ZIP 往返（含中文 UTF-8 文件名与内容）。
- 手工：同一会话导出的 ZIP，在 **同 session** 导入成功；在 **project/global 模板入口** 导入时，**不因路径前缀**失败（仅因业务上是否允许覆盖该域而提示，而非 `only allows paths under /template/`）。
- 文档/帮助：不再引导用户在 global/project 使用 `/template/foo.md` 作为对外路径（可保留迁移期说明）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 写作用户（移动端） | 在会话工作区编辑 `/notes/a.md`；导出 ZIP 备份；需要时导入覆盖恢复 |
| 模板维护者 | 在「全局模板 / 项目模板」范围编辑 `/seed/prompt.md`，路径与会话内一致，不出现 `/template/...` |
| 开发者 / 运维 | CLI `nm vfs` / `project vfs` / `session vfs` 使用统一 `/...` 路径；脚本化 ZIP 可在域间迁移（覆盖目标域） |
| Agent 配置者 | `vfs.read` / `vfs.write` 等工具参数路径始终为 `/dir/file.md` 形式，不区分域前缀 |

## 范围

### 包含范围

1. **逻辑路径规则**：规范化后均为绝对路径 `/...`；禁止将 `template` 作为逻辑路径段的前缀要求（global/project 与用户可见 API 一致）。
2. **域与存储**：保留 global / project / session **三域**划分及「导入 = 该域全量替换」；物理存储布局可在 SPEC 中映射，对外不可见 `/projects/.../template/...` 形态路径。
3. **Session 创建**：从 project 模板快照复制到 session 时，路径仍为 `/a.md` 等形式（与现 session 侧一致，project 侧也改为 `/a.md` 而非 `/template/a.md`）。
4. **ZIP 导入导出**：条目名与 ST-VFS 一致（逻辑 `/x` → ZIP `x`）；校验规则与统一路径模型一致；忽略常见垃圾条目（如 `__MACOSX/`、`.DS_Store`，具体列表见 SPEC）。
5. **CLI / 移动端 / Agent 工具**：列表、读写、ZIP 菜单使用的路径展示与 Core 一致。
6. **迁移与兼容**：在 SPEC 中定义旧数据（含 `/template/` 逻辑路径或物理路径）的处理策略（见风险与待确认项）。

### 不包含范围

- 合并 global / project / session 为单一 VFS 命名空间（仍为三域，仅路径形状统一）。
- 单 ZIP 同时写入多域或自动跨域同步。
- 非 UTF-8 / 二进制文件入 ZIP（沿用 zip-io 迭代策略）。
- Worktree 规则语义重写、消息/会话实体模型变更。
- Web 端 VFS UI（若尚无则不在本迭代交付）。

## 核心需求

1. **唯一虚拟根**：任意域内，用户与工具仅面对以 `/` 开头的逻辑路径；相对路径输入规范化后变为绝对路径（如 `notes/a.md` → `/notes/a.md`）。
2. **模板 = 范围而非路径**：编辑「全局模板」或「项目模板」时，操作的是该域下的文件树，路径仍为 `/foo.md`；不得在 session 或 project 对外界面展示 `/template/...` 作为业务路径。
3. **ZIP 与域解耦（路径形状）**：导出文件列表仅反映「树内相对根的路径」；不因 global/project/session 在 ZIP 内插入 `template/`、`projects/`、`sessions/` 等前缀。
4. **导入覆盖目标域**：用户选择某域入口导入 ZIP 时，仅替换该域文件树；路径合法则写入，**不得**仅因条目来自其他域的历史导出形状而拒绝（在统一路径模型下应可写入）。
5. **与 ST-VFS 原则对齐**：路径规范化、ZIP 边界安全（`..`、绝对 ZIP 名等）与参照实现一致或更严；具体规则在 SPEC 对照列出。
6. **不保留旧路径兼容**：不维护对 `/template/...` 旧逻辑/物理路径的双读或长期兼容；升级策略在 SPEC 中定义（可含一次性迁移或开发期清库重建），**不做**旧格式静默降级。

## 验收标准

### 路径与列表

- **Given** global 域写入 `/seed/hello.md`，**When** global `list`（或等价 API），**Then** 可见路径为 `/seed/hello.md`，**不出现** `/template/seed/hello.md`。
- **Given** project P 写入 `/prompts/system.md`，**When** project vfs `list`，**Then** 可见 `/prompts/system.md`，**不出现** `/template/prompts/system.md`。
- **Given** session S 存在 `/ddd/love_message.txt`，**When** session `list`，**Then** 可见 `/ddd/love_message.txt`（与现网 session 一致）。

### Session 与模板复制

- **Given** project P 模板域存在 `/a.md`、`/sub/b.md`，**When** 创建 session S，**Then** S 的域内为 `/a.md`、`/sub/b.md`，内容与 P 模板一致。
- **Given** 创建 S 后修改 P 模板 `/a.md`，**Then** S 内 `/a.md` 不变。

### ZIP

- **Given** session 含 `/ddd/love_message.txt`（UTF-8 中文内容），**When** 导出 ZIP 再在同 session 导入并确认，**Then** 域内路径与内容一致。
- **Given** 同上 ZIP，**When** 在 project 模板域入口导入并确认，**Then** project 模板域文件树与 ZIP 一致（含 `/ddd/love_message.txt`），**不**报「仅允许 `/template/`」类错误。
- **Given** global 域导出 ZIP 仅含 `foo.md`，**When** 解压查看，**Then** 无 `template/` 前缀条目名。

### 跨域隔离（仍为三域）

- **Given** global 写入 `/only-global.md`，**When** 某 project session `list`，**Then** 不出现 `/only-global.md`（除非 session 内另有同名路径）。

### Agent / CLI

- **Given** Agent 调用 `vfs.read` 路径 `/notes/x.md`，**When** 在 session 域运行，**Then** 与 UI 所见路径一致，无需改写为 `/template/...`。

## 约束与依赖

- 依赖现有三域 VFS、`vfs_entry`、session 创建复制、ZIP IO（`vfs-zip-io-agent-tool-policy`）能力；本迭代 **修订路径语义**，ZIP 行为随 SPEC 调整。
- 依赖 [chat-project-vfs](../chat-project-vfs/prd.md) 的实体与域划分；与之冲突处以 **本 PRD** 为准（路径模型）。
- 参照 ST-VFS 的路径与 ZIP 原则，不要求实现其 SillyTavern 存储桶（extensionSettings / chatMetadata）结构。

## 非功能需求（业务/体验）

- 路径展示与错误提示使用用户语言（中文），错误信息须说明**路径**而非内部物理前缀。
- 升级/迁移执行时须有明确说明（一次性），避免用户误以为旧路径仍有效。

## 已决事项（产品确认）

| 项 | 决策 |
|----|------|
| **PRD 方向** | 采纳：统一 `/` 根、模板为范围非路径前缀、ZIP 路径形状一致（对齐 ST-VFS） |
| **旧数据兼容** | **不兼容**：breaking change；不保留旧 `/template/` 路径的长期双读 |
| **与 zip-io 迭代** | **不合并**：`vfs-unified-root` 独立迭代；`vfs-zip-io-agent-tool-policy` 另行维护/跟进 |

## 风险与待确认项（SPEC 阶段）

| 项 | 说明 |
|----|------|
| **物理路径迁移方式** | 不兼容前提下，SPEC 定稿：重写 `vfs_entry.path` vs 清库重建等具体手段 |
| **Worktree / snapshot** | 审计是否存 `/template/...` 逻辑路径，一并纳入本迭代 |
| **zip-io 跟进** | 路径 SPEC 落地后，在 zip-io 分支/SPEC 上同步去掉 `template/` 校验与文档（不合并发布） |

## 里程碑（可选）

| 阶段 | 交付 |
|------|------|
| M0 | SPEC：路径映射表、迁移策略、ST 对照清单 |
| M1 | Core：`vfs-path-mapper`、校验、ZIP 路径规则 |
| M2 | CLI + 测试 + 数据迁移（若需要） |
| M3 | Mobile UI + Agent 工具路径展示 |
