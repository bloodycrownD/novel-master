---
date: 2026-07-20
dependency:
  - Iterations/agent-worktree-block-ui/prd.md
  - Iterations/message-attachment-unified/prd.md
  - Iterations/message-attachment-unified/bugs/composer-at-token-tag-ux/prd.md
  - Iterations/mobile-message-edit-multiline/prd.md
---

# 宏 Tag、文件编辑滑动与 Workplace 统一 PRD

## 背景

本迭代打包三项已拍板的小优化，统一改善配置编辑体验、Mobile 文件编辑浏览体验，以及「常驻工作区」在产品与工程上的命名/协议一致性。

### 与现状的关系

1. **动态区宏插入**  
   双端 Agent 编辑器动态区可通过芯片插入 `{{$time}}` / `{{$week_cn}}` / `{{$filetree}}`，但正文内为普通字符：无着色 tag、退格需逐字删。会话 Composer 的 `@path` 在 Mobile 已有「着色 + 退格整段删」；Desktop `@path` 仅有视觉高亮。用户希望动态区白名单宏在双端都具备可原子删除的 tag 体验，且**手输合法宏同样成 tag**（强于现网 Mobile `@path`「仅程序化插入成 mention」的口径）。

2. **聊天工作区等文件编辑态滑动**  
   Mobile `FileEditor` 默认预览可安心滚动；进入编辑后整屏可编辑输入区兼任滚动面，滑动易误聚焦并弹出软键盘，与 Composer / 消息编辑「阅读面与输入面分离」的体感不一致。预览与批注边界本期不变。

3. **常驻工作区 / workplace**  
   用户可见文案已统一为「常驻工作区」；Agent 开关真相源仍是 `persist` 内 `type: worktree`（键名惯例 `canon`）。历史 PRD（`agent-worktree-block-ui`、`message-attachment-unified`）曾刻意**保留** wire `type:"worktree"`。本期改为顶层 `prompts.workplace: boolean`，与持久区解耦；并按「尽量全仓」口径将工程标识、CLI、IPC、库表等从 worktree 收敛为 workplace。  
   **兼容**：无 `workplace` 字段默认 `false`；旧 `type: worktree` 块**直接忽略**（不升为开启）。`persist` 仅保留 `type: text`。

术语注意：**workplace**（常驻工作区）≠ **workspace**（Explorer 工作区列表）；后者不在本期改名范围内。历史 `.apm` 迭代文档不回写改名。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 宏可原子编辑 | Desktop + Mobile 动态区正文中，白名单合法宏呈 tag 观感；退格/Delete 碰到宏边界时**整段删除**（含芯片插入与手输） |
| 落库仍为纯文本 | 保存后的 Agent 配置中宏仍为 `{{$…}}` 字面量，无编辑器内部 markup 泄漏 |
| 编辑态可安心滚读 | 所有 `FileEditor`（会话 / 项目 / 全局）在**未聚焦**时纵向滑动不弹出软键盘；点正文后可正常编辑；Android 与 iOS 同口径 |
| 配置开关语义清晰 | Agent YAML/JSON 用 `prompts.workplace: true\|false` 表达常驻工作区开关；GUI Switch 与该字段一致；与 `persistEnabled` 解耦 |
| 命名收敛 | 产品与工程面不再以 worktree 指代常驻工作区能力（见范围）；用户可见「工作树」残留为 0 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Agent 配置者 | 在动态区插入或手输宏后，想一次退格删掉整段 `{{$filetree}}`，而不是抠括号 |
| Desktop / Mobile 配置者 | 两端宏编辑手感一致（都有 tag + 整段删） |
| Mobile 写作者 | 在任意工作区打开长文件进入编辑后，先滑动浏览再点某处修改，不被滑动误弹键盘打断 |
| 维护 / CLI 用户 | 配置、命令与文档用语统一为 workplace，不再在 worktree / 常驻工作区之间切换心智 |
| 升级用户 | 旧 Agent 若曾用 `type: worktree` 开启常驻区，升级后开关为关，需手动打开 `workplace` |

## 范围

### 包含范围

**A. 动态区宏 Tag（Desktop + Mobile）**

- 动态区文本内容中，白名单宏（`$time` / `$week_cn` / `$filetree` 对应的 `{{$…}}`）显示为可辨认的 tag。
- **芯片插入与手输**：凡正文中已是白名单合法宏，均视为 tag，支持退格/Delete **整段删除**。
- 非法或残缺 `{{…}}` 不强制成 tag（按普通文本编辑）。
- 宏语义、白名单、仅动态区可用等业务边界不变；落库/导出仍为纯字符串。

**B. Mobile 文件编辑滑动与键盘**

- 覆盖所有进入 `FileEditor` 的路径：会话工作区、项目、全局。
- 目标手势：**未聚焦**时滑动只滚内容、不弹软键盘；**点正文**后聚焦并出键盘；聚焦后在输入区内滚动可保持键盘。
- Android 与 iOS 同验收口径。
- 不改变预览默认、批注仅预览、保存/脏标记等既有产品行为。

**C. Workplace 协议与命名统一**

- Agent 配置：`prompts.workplace: boolean`（缺省 `false`），与 `persist` / `persistEnabled` 解耦。
- `persist` 仅允许 `type: text`；不再使用 `type: worktree` 块。
- 读入旧配置：剥离并忽略 `type: worktree` 块，**不**据此设 `workplace: true`。
- GUI：常驻工作区顶卡 Switch ↔ `prompts.workplace`；开启后的运行时注入语义保持（system 后注入 user 文件树前缀 + assistant done），仅开关读取来源变更；预览与运行时消息/segment 标识统一为 workplace（细节见 SPEC T-W5 / T-W5b）。
- **全仓收敛（本期目标）**：将仍指代该能力的 worktree 命名改为 workplace，包括但不限于内部模块/符号、包导出路径、IPC channel、CLI 子命令、SQLite 相关表名等；旧名**不要求**长期兼容别名（接受破坏性升级）。
- 用户可见文案继续使用「常驻工作区」；英文标识统一 `workplace`。

### 不包含范围

- 扩大或缩小宏白名单；持久区允许宏；系统区宏芯片。
- 将会话 `@path` 的 Desktop 原子删除、或「手输 `@path` 也成 mention」纳入本期（宏口径独立，不强行回改 Composer）。
- 改变常驻前缀拼装内容规则、规则引擎业务语义、Composer 附件 `source: workplace` / chip「规则:」产品文案。
- 改名 **workspace**（Explorer 工作区）或回写历史 `.apm` 迭代文档标题/正文。
- Desktop 文件编辑器（非软键盘问题）体验改造。
- 为旧 `type: worktree` 提供「自动保持开启」的迁移升级。

## 核心需求（3-7 条）

1. **宏 Tag 双端一致**：Desktop 与 Mobile 动态区对白名单合法宏提供 tag 观感与退格/Delete 整段删除；含手输。
2. **宏落库纯文本**：编辑器内部可有辅助表示，对外配置与校验所见仍为 `{{$…}}` 字面量。
3. **FileEditor 未聚焦滑动不弹键盘**：所有 scope、双端移动 OS；点按后可正常编辑与保存。
4. **`prompts.workplace` 开关**：新建/缺省为关；GUI 与 wire 一致；注入与 `persistEnabled` 独立。
5. **旧 worktree 块忽略**：加载含 `type: worktree` 的旧 Agent 时剥离该块且保持 `workplace=false`（除非新字段显式为 true）。
6. **worktree → workplace 全仓命名**：工程与对外 CLI/IPC/库表等标识统一为 workplace；不以长期双名兼容为成功标准。
7. **术语边界**：不改 workspace；不把附件增量管道改称其它产品名。

## 验收标准

### A. 宏 Tag

- [ ] **Given** Desktop 或 Mobile Agent 动态区文本块，**When** 点击宏芯片插入 `{{$time}}`（或另两枚白名单宏），**Then** 插入结果呈 tag 观感，且一次退格删除整段宏。
- [ ] **Given** 用户在动态区**手输**完整白名单宏 `{{$week_cn}}`，**When** 宏已完整出现在正文，**Then** 其表现为 tag，且退格/Delete 可整段删除。
- [ ] **Given** 正文含残缺或非白名单 `{{…}}`，**When** 编辑，**Then** 不强制按宏 tag 整段删除（按普通文本）。
- [ ] **Given** 保存 Agent，**When** 查看导出/落库配置，**Then** 宏为纯文本 `{{$…}}`，无内部 markup。

### B. FileEditor 滑动

- [ ] **Given** 会话 / 项目 / 全局任一路径打开长文件并进入**编辑**且输入框**未聚焦**，**When** 纵向滑动多屏，**Then** 软键盘不弹出（Android 与 iOS）。
- [ ] **Given** 同上编辑态，**When** 点正文某处，**Then** 聚焦并弹出软键盘，可编辑、可保存。
- [ ] **Given** 已聚焦且键盘可见，**When** 在输入内容区内滚动，**Then** 不应因滚动而强制收起键盘（允许保持编辑）。（验收映射：SPEC **T-F6** — 聚焦态 `scrollEnabled={true}` + 真机滚动矩阵）
- [ ] **Given** 预览态，**When** 滑动，**Then** 行为不劣于现网（不引入新的无法滚动或误弹键盘）。

### C. Workplace 协议与命名

- [ ] **Given** 新 Agent 或无 `workplace` 字段的配置，**When** 加载，**Then** `workplace` 视为 `false`，不注入常驻前缀双消息。
- [ ] **Given** `prompts.workplace: true`，**When** 运行需拼装 prompt 的回合，**Then** 在 system 之后注入常驻文件树 user 消息 + assistant done（与现网开启态语义一致），且**不要求** `persistEnabled: true`；消息/预览 segment 标识为 workplace（SPEC T-W5 / T-W5b）。
- [ ] **Given** 旧配置 `persist` 含 `type: worktree` 且无 `workplace: true`，**When** 加载（含 wire 与已解析领域存储），**Then** 该块被忽略，开关为关；`persist` 中仅保留 text 块语义（SPEC T-W3 / T-W9）。
- [ ] **Given** GUI 常驻工作区 Switch，**When** 开/关并保存，**Then** 配置中出现/保持 `workplace: true|false`（或等价缺省省略 false），且 `persist` 中**不再**写入 `type: worktree`。
- [ ] **Given** 仅 `workplace:true` 且 system/persist/dynamic 区域开关均为关，**When** 保存 Agent，**Then** 配置合法可保存（SPEC T-W8）。
- [ ] **Given** 产品 GUI，**When** 检索用户可见文案，**Then** 无「工作树」指代本能力；CLI/IPC 等对外标识使用 workplace 而非 worktree（按本期全仓收敛完成定义）。
- [ ] **Given** 与 Explorer「工作区 / workspace」相关的文案与事件名，**When** 回归，**Then** 不被误改为 workplace。

## 约束与依赖

- 依赖并**局部 supersede**：`agent-worktree-block-ui`（不再以 persist 块有无表达开关）、`message-attachment-unified`（不再保留 Agent wire `type: worktree` 可长期存在的口径）。
- 宏 Tag 体验参考 `composer-at-token-tag-ux` / Mobile `@path`，但**手输也成 tag** 为本期对宏的独立产品口径。
- FileEditor 体验对齐「阅读与输入分离」的思路，参照消息编辑多行输入的产品意图（`mobile-message-edit-multiline`），但不要求复用其短输入布局。
- 全仓改名含库表时，须保证用户库可升级；具体迁移步骤属 SPEC，不在本 PRD 展开。

## 风险与待确认项

- **破坏性升级**：旧 Agent 曾开启 worktree 块者升级后默认关，需在发布说明中提示「请重新打开常驻工作区」。
- **全仓改名面大**：CLI 脚本、外部文档、已导出 YAML 中的 `type: worktree` 将失效或被忽略；接受为产品决策。
- **宏手输成 tag**：与 `@path` 不对称，后续若统一 Composer 口径需另开需求。
- **历史文档**：`.apm` 旧迭代标题仍含 worktree，不作为本期清零对象。
