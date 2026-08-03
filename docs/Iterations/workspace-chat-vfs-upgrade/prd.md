---
date: 2026-07-21
dependency:
  - Iterations/vfs-zip-io-agent-tool-policy/prd.md
  - Iterations/import-export-navigation-fix/prd.md
  - Iterations/model-aware-token-counting/prd.md
  - Iterations/chat-user-rollback-redo/prd.md
  - Iterations/message-attachment-unified/prd.md
---

# 工作区 · 分叉 · Token · VFS IO 升级 PRD

> **边界**：本文件为**父级**产品需求，只定义大迭代目标、feature 清单与跨 feature 边界；技术方案见各 feature 后续 SPEC。  
> **结构**：细节需求写在 `features/*/prd.md`。

## 背景

日常使用中三类体验债叠加，且彼此独立、不宜塞进单一小迭代：

1. **分叉（fork）/ 会话复制（copy）**  
   现网只复制消息与当前活树文件，**不**带走会话 workplace 规则（inclusion / 目录排序），也**不**为新会话消息挂可回滚快照。用户分叉后规则「像丢了」；在新会话回滚时，若无可用 prior 快照，可能按空基线清空工作区（首条 plain user 的 undo_send 清空已接受）。标题带 `_ckpt_` 但无真实快照能力，易误导。

2. **Token 占用展示与压缩**  
   顶栏/页脚与压缩已统一为**本地**按模型「计数方式」计数；API 侧 usage 虽已解析进回合结果，**未**进入同一产品口径。用户希望尽量**一套计算引擎**：有 API 返回则用，没有则本地；禁止「展示一套、压缩另一套」。

3. **工作区导入导出**  
   既有 ZIP 为**整域全量替换**（见 `vfs-zip-io-agent-tool-policy` / `import-export-navigation-fix`）。用户需要升级为**目录子树** ZIP，并新增**非 ZIP 的文件 IO**：Desktop 以拖拽完成批量与树内移动；Mobile 以「更多 / 目录项 / 文件项菜单」接入，**单文件**非 ZIP + **目录级 ZIP**。现网「批量操作」仅指多选删除/规则开关，**不是**本迭代的文件 IO。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 分叉/复制可回滚且规则连续 | fork / copy 后，源会话上的 inclusion 与目录排序在新会话仍生效；非首条回滚**不会**因空基线删光文件 |
| Token 单引擎 | 聊天展示与压缩触发读取**同一套**占用结果；有可用 API `promptTokens` 时两端一致采用，否则一致回退本地 |
| 子树 ZIP | 对当前/指定目录导入 ZIP 后，**仅该子树**与 ZIP 一致，域内兄弟路径保留 |
| 批量 IO 可用 | Desktop 可拖入导入、拖出导出、树内移动；Mobile 可单文件导入/导出，目录级走 ZIP |
| 入口清晰 | Mobile：更多 = 导入文件 + 导入 ZIP；文件项 = 导出文件；目录项 = 导出 ZIP。Desktop：目录右键含 ZIP；批量靠拖拽 |

**整体验收**：四个 feature 的验收清单全部通过，且不破坏既有整域语义的可迁移路径（若 CLI 仍保留整域参数，须在 feature PRD 写清；默认产品 UI 走子树）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 长对话作者 | 在某条消息处分叉继续试写；期望规则与文件状态可回滚，而不是「新会话像空壳」 |
| 看占用的用户 | 发完一轮后顶栏/页脚数字可信，压缩时机与展示同一数字 |
| 跨工具搬文件 | 只替换某一章目录的 ZIP；或从本机文件夹拖入/多选导入，不必先打整包 ZIP |
| Desktop 重度用户 | 树内拖动整理目录；从资源管理器拖入、拖出到本机 |

## 范围

### 包含范围

父迭代仅组织以下四个 feature（各有独立 PRD）：

| Feature | 目录 | 摘要 |
|---------|------|------|
| 分叉快照与规则 | `features/fork-snapshot-and-rules` | fork / copy：挂当前活树快照 + 复制 session workplace 规则 |
| Token API 统一口径 | `features/chat-token-api-overlay` | 展示与压缩同一引擎；优先 API usage，否则本地 |
| 目录级 ZIP | `features/vfs-zip-directory` | 子树导入/导出 ZIP 与入口改挂 |
| 批量导入导出 | `features/vfs-batch-io` | Desktop 非 ZIP 批量 IO + 拖拽三向；Mobile 单文件 IO（目录见 ZIP） |

### 不包含范围

- 完整复制源会话 **历史 revision 差异链**（本迭代挂的是**分叉/复制时刻的当前活树**，非逐步历史）
- 为首条 plain user undo_send 增加虚拟 seq0 基线（清空可接受）
- 新增模型配置项「API 计数」独立选项
- 数据库 `.nmbackup`、Agent/Events YAML 导入导出
- Mobile 拖放
- iOS 强制验收（Android / Desktop / CLI 按各 feature 约定）
- 二进制进 VFS（继续以 UTF-8 文本为主，与既有 ZIP 约束对齐）

## 核心需求（父级）

1. **四个 feature 可独立验收**，但共享本 PRD 的产品术语与「不包含」边界。  
2. **ZIP 子树语义** supersede 既有「UI 默认整域全量替换」的产品默认；确认文案须改为子树覆盖，不再写「完全替换当前工作区」除非操作目标确为域根且产品仍定义为整子树=`/`。  
3. **Token**：禁止展示与压缩长期分叉为两套数字；无 usage 时统一本地。  
4. **fork 与 session.copy 同一合同**（规则 + 当前活树快照）。

## 验收标准

- [ ] 四个 feature 目录均有已确认的 `prd.md`，且无互相矛盾的范围声明  
- [ ] 手工/自动化验收以各 feature「验收标准」为准；父级不重复列技术项  
- [ ] 发布说明可向用户讲清：分叉更稳、token 更准、工作区可子树 ZIP + Desktop 批量拖入/导出 + Mobile 单文件/ZIP  

## 风险与待确认项

| 项 | 说明 | 处理 |
|----|------|------|
| CLI 整域 ZIP | CLI 是否保留「整域」显式开关 | 写入 `vfs-zip-directory`；默认可与 UI 子树对齐或保留 flag |
| Mobile 文件 IO 平台限制 | 系统文件选择器无法 pick 文件夹 / 非 ZIP 目录批量 | **已定案**见 `vfs-batch-io`：Mobile 单文件 `pick`/`saveDocuments`；目录级仅 ZIP |
| API usage 缺失 | 中转站不返回 usage | 统一回退本地；不新增配置项 |
| 与 attachment-unified「fork 不拷 kkv」 | 本迭代复制规则表；kkv 是否重建 | feature PRD：规则表必拷；常驻前缀允许首次拼装重建 |
