---
date: 2026-07-21
dependency: Iterations/workspace-chat-vfs-upgrade/prd.md
---

# vfs-batch-io Feature PRD

## 背景

用户需要在 ZIP 之外，直接在工作区与本机文件系统之间搬运文件。现状：

- **无**「从本机选文件写入 VFS」或「把 VFS 文件导出到本机」。  
- Desktop 工作区树**无**拖拽（无树内移动、无拖入、无拖出）。  
- Mobile「批量操作」= 多选删除 / 目录规则开关，**不是**文件 IO。  
- 父级约定 Mobile **不做拖放**。

本 feature 与 `vfs-zip-directory` 并列，合称四项能力中的「批量导入 / 批量导出」。**Desktop 走批量路径；Mobile 收窄为单文件导入/导出，目录级操作用 ZIP**（见平台限制）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| Desktop 批量导入 | 用户可将本机多个文件和/或文件夹写入当前（或指定）VFS 目录，保留相对结构 |
| Desktop 批量导出 | 用户可将 VFS 中选中的文件/文件夹导出到本机，保留相对结构 |
| Desktop 拖拽三向 | 树内拖动 = 移动；从系统拖入 = 导入；拖出到系统 = 导出 |
| Mobile 单文件 IO | 「更多」含**导入文件**、**导出文件**（单选）；目录级导入/导出走 **ZIP** |
| 与 ZIP 分工 | 非 ZIP 路径不要求用户先打 ZIP；冲突/覆盖有确认或明确策略；Mobile 目录 = ZIP |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Desktop | 从资源管理器把一章文件夹拖进会话工作区；或把树里几章拖到桌面；或把 `草稿.md` 拖到 `定稿/` |
| Mobile | 在当前文件夹「更多 → 导入文件」选一个本机文本文件写入当前目录；在文件项菜单「导出文件」另存到本机；目录级用「导入 ZIP / 导出 ZIP」 |

## 范围

### 包含范围

1. **Desktop 批量导入（非 ZIP）**  
   - 目标目录：拖放落点目录。  
   - 支持多文件；**支持文件夹**（递归，保留相对路径）。  
   - 仍以 UTF-8 文本为主；无法作为文本写入的条目须明确跳过或失败提示（不得静默损坏）。  

2. **Desktop 批量导出（非 ZIP）**  
   - 导出对象：多选的文件/文件夹。  
   - 导出到本机目录时保留相对结构。  

3. **Desktop 交互（无独立批量按钮）**  
   - **树内拖到另一目录** → VFS 内移动（非导出）。  
   - **从本机拖入树** → 批量导入。  
   - **从树拖出到本机** → 批量导出（`startDrag`；**不以**另存 dialog 作为默认验收替代）。  
   - 三种意图须可区分，不能互相覆盖错。  

4. **Mobile 单文件 IO（无拖放、无批量）**  
   - **更多菜单**：**导入文件**（系统文件选择器，**单选**）。  
   - **文件项菜单**：**导出文件**（`saveDocuments` 另存，**单文件**）。  
   - **目录级**：导入/导出目录统一走 **ZIP**（`vfs-zip-directory`）；本 feature **不包含** Mobile 批量导入/导出、多选导出、导出当前目录全部、文件夹 pick。  
   - 平台限制：`@react-native-documents/picker` 的 `pick` / `saveDocuments` **无法可靠选取或写入文件夹**；不得在产品文案中承诺 Mobile 非 ZIP 目录批量。  

5. Desktop / Mobile（Android）验收；冲突策略产品默认：**覆盖前确认**（SPEC 已钉死）。

### 不包含范围

- ZIP 导入导出（`vfs-zip-directory`）— Mobile 目录级入口在该 feature  
- Mobile 拖放  
- Mobile 非 ZIP **批量**导入/导出、多选导出、导出当前目录全部、文件夹 pick  
- 修改既有「批量操作」的删除/规则语义（可并存，勿混名）  
- 二进制大文件策略超出既有 VFS 文本约定的扩展（若做，仅跳过+提示）  
- 云盘同步  
- 以系统分享替代 `saveDocuments` 作为 Mobile 单文件导出默认验收主路径  

## 核心需求

1. **Desktop 批量两侧**与 ZIP 入口按父级 IA 划分，文案不互相抢。  
2. **Mobile 单文件**与 **ZIP 目录**分工清晰，菜单文案与实现一致。  
3. **Desktop 三向拖拽均为一等能力**：移动 / 导入 / 导出。  
4. **导入默认合并进目标目录**（不先清空整个域）；与同名冲突须可预期。  
5. **导出保留目录结构**（Desktop）；Mobile 单文件导出不涉及目录结构。  
6. **安全**：导入/覆盖需可取消；失败语义见 SPEC — 非 session **整批回滚**，session **逐文件汇总**（`written` / `skipped` / `failed`），禁止无提示半套；read 失败不得假「导入完成」。

## 验收标准

**Desktop**

- [ ] Given 本机文件夹，When 拖入工作区某目录，Then VFS 下出现对应相对路径的文本文件，兄弟未删  
- [ ] Given 树内文件，When 拖到另一目录，Then 为移动（原路径不存在，新路径存在），不是复制到本机  
- [ ] Given 树内选中项，When **拖出**到系统文件夹（startDrag，非 dialog 另存），Then 本机出现对应文件/目录树；拖出失败有 toast  

**Mobile**

- [ ] Given 当前目录，When「更多 → 导入文件」并完成**单文件**选择，Then 文件出现在当前目录  
- [ ] Given 某文件项，When「导出文件」，Then 本机可通过 `saveDocuments` 打开/保存该文件  
- [ ] Given read/copy 失败，When 导入流程结束，Then toast 显示失败信息，**不得**显示「导入完成」  
- [ ] 「更多」中导入文件与「导入 ZIP」并存且文案可区分；目录项导出 ZIP 与文件项导出文件可区分  

**通用**

- [ ] 用户取消覆盖确认后，目标处原文件保持不变  
- [ ] 非 session 批量写入中途失败 → 整批不落库；session 下部分失败 → UI/结果含已写入与失败项说明（`failed[].message`）  
- [ ] 同批次 ingest 存在 file/dir 类型冲突 → plan 阶段检出，apply 零写入且 `failed` 非空  

## 风险与待确认项

| 项 | 说明 |
|----|------|
| Mobile 平台文件选择器 | **已定案**：单文件 `pick` / `saveDocuments`；目录级仅 ZIP；无 folder-pick |
| 拖出权限 / 临时文件 | Desktop 拖出须 preload + main `startDrag`；失败 toast；dialog 不作默认验收替代 |
| 与「批量操作」文案 | Mobile 菜单用「导入文件/导出文件」，避免与多选「批量操作」混淆 |
| 空目录 | Desktop 导入本机空文件夹是否在 VFS 创建目录节点 — SPEC：是（`mkdir` 显式节点） |
| BatchApplyReport | **已定案**：字段 `written` / `skipped` / `failed`（项为 `{ path, message }`）；非 session 整批回滚 vs session 逐文件汇总 |
