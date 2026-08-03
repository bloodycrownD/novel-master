---
date: 2026-06-12
dependency:
  - Iterations/sksp/prd.md
  - Iterations/mobile-stability-db-migration/prd.md
  - Iterations/vfs-zip-io-agent-tool-policy/prd.md
  - Iterations/mobile-chat-conversation-back/prd.md
---

# 导入导出与导航修复 PRD

## 背景

本迭代针对数据迁移与工作区导航的三类可复现问题，与现有能力关系如下：

1. **数据库备份（`.nmbackup`）**  
   Mobile（「我的 → 导出/导入数据库」）与 Desktop 均通过**整库 SQLite 文件拷贝**完成导入导出，当前会包含 `sksp_secrets`、`llm_provider`、`llm_saved_model` 等服务商相关表。  
   由于 SKSP 密钥与平台绑定（Android Keystore / Windows DPAPI 等），跨设备或跨平台导入后密文无法解密，导致 **API Key（AK）失效**；保留这些表于备份中无实际价值且易误导用户。  
   **期望**：导出侧排除服务商相关数据；导入侧不覆盖本机已有服务商配置。

2. **Mobile 聊天工作区返回手势**  
   会话内「聊天工作区」面板（`VfsFileManager`）中，Android 系统返回/边缘侧滑当前由 `useAndroidChatBackHandler` 处理：只要处于工作区面板，即**直接切回「聊天」子 Tab**，无法先在工作区目录树内逐级返回。  
   用户浏览子目录时期望与「上级目录」按钮一致：**先返回上级目录**；仅当已处于该工作区域根目录时，才返回聊天 Tab。

3. **工作区 VFS ZIP 导入**  
   工作区 ZIP 导入导出（global / project / session 域，Mobile + Desktop + CLI）在设计上为**域内全量替换**（ZIP 为真相源）。  
   实际反馈：**从外部工具（尤其 Windows 环境）制作的 ZIP 导入后，工作区文件列表中文件名乱码，但文件正文内容正常**；同时导入后**旧文件仍残留在列表中**，未呈现覆盖效果（推测与 entry 名编码错误导致写入新路径、未清除原路径有关）。  
   **期望**：外部 ZIP 导入后文件名与 ZIP 内可见中文名一致；导入完成后域内文件树与 ZIP 内容一致，无历史残留。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| DB 备份不含服务商密钥 | 导出 `.nmbackup` 后，目标库中**不存在**可随备份迁移的服务商密钥与 provider 配置行（`sksp_secrets`、`llm_provider`、`llm_saved_model`） |
| DB 导入保留本机服务商 | 导入备份后，本机导入前已配置的服务商与 API Key **仍可用**，聊天/模型调用不因导入而失效 |
| Mobile 工作区返回符合目录层级 | 工作区子目录内系统返回/侧滑 **100%** 先回到上级目录；仅在域根目录时返回聊天 Tab |
| VFS 导入文件名正确 | 含中文文件名的外部 ZIP 导入后，工作区列表展示名与 ZIP 内 entry 名一致（内容保持 UTF-8 正确） |
| VFS 导入为覆盖语义 | 同一域导入成功后，域内文件树**仅含** ZIP 内条目，导入前该域下的旧文件 **0 残留** |

**整体验收**：上述指标在约定平台的手工用例中全部通过，且不破坏现有 VFS 导出、DB 备份其余数据、聊天会话数据等能力。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 换机/重装用户 | 导出数据库迁移聊天、项目、VFS 等到新设备，**不希望**备份携带失效的 AK，也**不希望**导入覆盖新机上已配好的服务商 |
| Mobile 工作区浏览用户 | 在会话「聊天工作区」中进入多级子目录，用系统返回或边缘侧滑逐级退出目录 |
| 跨工具工作区迁移用户 | 在 Windows 上打包 ZIP（含中文文件名）后导入 Mobile/Desktop 工作区，期望文件名正确且完全替换原工作区文件 |
| Desktop 工作区用户 | 与 Mobile 相同：VFS ZIP 导入不乱码、全量覆盖 |

## 范围

### 包含范围

1. **数据库导出排除服务商相关表**  
   - 排除表：`sksp_secrets`、`llm_provider`、`llm_saved_model`（及仅服务于上述配置的关联数据，若有）。  
   - **Mobile + Desktop** 的「导出数据库」均适用。

2. **数据库导入保留本机服务商配置**  
   - 导入备份时，**不修改、不删除**本机上述三张表的现有数据；其余数据按现有整库替换语义导入。  
   - **Mobile + Desktop** 均适用。

3. **Mobile 工作区系统返回/侧滑**  
   - 仅 **Android Mobile**（`conversationPanel === 'workspace'` 时）。  
   - 工作区 `currentPath` 非域根目录：系统返回/边缘侧滑 → **上级目录**（与「上级目录」按钮行为一致）。  
   - 工作区已处于域根目录：系统返回/边缘侧滑 → **切回「聊天」子 Tab**（保持现有会话不退出）。  
   - 聊天 Tab 内其他返回层级（overlay 关闭、会话列表等）保持 `mobile-chat-conversation-back` 既有语义，本迭代仅调整工作区目录层级。

4. **VFS ZIP 导入：文件名编码修复**  
   - 修复**从外部 ZIP 导入**时 entry 名乱码问题（验收侧重：含中文文件名的 Windows 等环境制作的 ZIP）。  
   - **Mobile + Desktop**（及 CLI 若共用同一解析链路）均适用。  
   - 导出侧若存在同类编码问题，一并在本迭代修复，保证常见跨平台往返不乱码。

5. **VFS ZIP 导入：域内全量覆盖**  
   - 用户确认导入后，该 scope（global / project / session）内工作区文件树**完全**以 ZIP 为准；导入前域内文件不保留。  
   - 与现有确认文案「将完全替换当前工作区文件」语义一致，修复实现与体验偏差。

### 不包含范围

- iOS Mobile 验收（可后续跟进；本迭代 PRD 不强制 iOS 用例）。  
- 服务商配置的**选择性导出/导入**（不支持「只迁移某几个 provider」）。  
- 数据库表级增量合并（仍为「除服务商表外整库替换」）。  
- VFS ZIP 支持二进制文件、非 UTF-8 文本内容（仍仅 UTF-8 文本；本迭代只解决 **entry 路径名** 乱码）。  
- Agent YAML、Events YAML 等单文件配置的导入导出行为变更。  
- Desktop/Mobile 数据库备份格式变更（仍为 `.nmbackup` / SQLite 校验）。  
- 工作区内的手势滑动实现（仍依赖 Android `BackHandler`；不新增自定义 Pan 手势）。  
- 本 PRD 不展开技术方案、接口设计、表合并算法或任务拆分（见后续 SPEC）。

## 核心需求

1. **DB 导出不含服务商表**：生成备份时排除 `sksp_secrets`、`llm_provider`、`llm_saved_model`，避免备份携带无法在目标环境解密的 SKSP 密文与 provider 行。  
2. **DB 导入保留本机服务商**：导入备份时跳过对上述三张表的写入/删除，本机原有服务商与 AK 保持有效。  
3. **Mobile 工作区逐级返回**：工作区子目录内系统返回优先 `上级目录`；仅域根目录时 `showChatPanel` 回到聊天 Tab。  
4. **VFS 导入路径名不乱码**：外部 ZIP（含中文 entry 名）导入后，工作区列表展示的文件/目录名人类可读且与 ZIP 一致。  
5. **VFS 导入全量替换**：导入成功同一 scope 内无 ZIP 未包含的历史文件或目录。  
6. **双端一致**：第 1、4、5 项 Mobile 与 Desktop 行为一致；第 3 项仅 Mobile。  
7. **无关键回归**：DB 备份/导入其余数据、VFS 导出、工作区 CRUD、聊天与会话数据、本机服务商 CRUD 保持可用。

## 验收标准

### 1. 数据库导出排除服务商

- **Given** 本机已配置至少一个服务商及 API Key（`llm_provider` + `sksp_secrets` 有数据）  
  **When** 在 Mobile 或 Desktop 执行「导出数据库」得到 `.nmbackup`  
  **Then** 用 SQLite 工具打开备份文件，**查不到** `sksp_secrets`、`llm_provider`、`llm_saved_model` 中的业务数据行（表可为空或不存在，以 SPEC 为准，但**不得**含可误导迁移的 provider/密钥记录）。

- **Given** 本机有聊天、项目、VFS 等非服务商数据  
  **When** 导出数据库  
  **Then** 备份仍包含上述非服务商数据，导入到新环境后仍可恢复（不含服务商部分）。

### 2. 数据库导入保留本机服务商

- **Given** 设备 A 已配置服务商 `openai` 且 AK 有效；设备 B 有一份自 A 导出（已排除服务商表）的 `.nmbackup`  
  **When** 在设备 B（B 上亦有自有服务商配置）执行导入  
  **Then** 导入完成后 B 上**原有**服务商配置与 AK **仍可正常调用**；不被备份内容覆盖或清空。

- **Given** 导入备份前 B 无服务商配置  
  **When** 导入排除服务商表的备份  
  **Then** 导入后 B 仍无服务商配置（备份未带入 provider 数据），其余数据正常恢复；用户可另行添加服务商。

### 3. Mobile 工作区系统返回

- **Given** 用户处于会话「聊天工作区」，当前路径为域内子目录（如 `/notes/sub`），非域根  
  **When** 触发 Android 系统返回或边缘侧滑  
  **Then** 工作区 `currentPath` 变为上级目录（如 `/notes`），**仍停留在工作区面板**，不切换到聊天 Tab。

- **Given** 用户处于工作区域根目录（`currentPath === rootPath`）  
  **When** 触发系统返回或边缘侧滑  
  **Then** 切回「聊天」子 Tab，会话保持打开。

- **Given** 用户在工作区根目录连续返回  
  **When** 再次触发系统返回  
  **Then** 行为与导入前一致：返回会话列表或退出层级，**不**因本迭代引入额外跳转。

### 4. VFS ZIP 导入文件名

- **Given** 在 Windows（或常见外部工具）制作含中文文件名的 ZIP（如 `笔记/第一章.md`），内容为合法 UTF-8 文本  
  **When** 在 Mobile 或 Desktop 对某 session/project/global 域执行工作区 ZIP 导入并确认  
  **Then** 工作区文件列表中目录与文件名**正确显示中文**，与 ZIP 内 entry 名一致；打开文件内容正确可读。

### 5. VFS ZIP 导入覆盖

- **Given** 某 session 域工作区已有文件 `A.md`、`旧目录/遗留.md`  
  **When** 导入仅含 `B.md` 的 ZIP 并确认  
  **Then** 导入成功后域内**仅有** `B.md`（及 ZIP 内目录结构），**不存在** `A.md`、`旧目录/遗留.md` 或任何 ZIP 未包含的路径。

- **Given** 导入因校验失败（如非法路径、非 UTF-8 内容）被拒绝  
  **When** 用户确认导入  
  **Then** 该域工作区与导入前**完全一致**（现有两阶段校验语义不变）。

### 6. 回归

- VFS ZIP **导出**含中文路径的文件，在本 App 内再导入，文件名与内容均正确。  
- Mobile「我的 → 导出/导入数据库」在 Agent 未运行时可正常完成；Desktop 同等。  
- 工作区「上级目录」按钮、文件编辑/保存、聊天发送消息不受本迭代破坏。
