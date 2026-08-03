---
date: 2026-07-29
dependency: []
---

# VFS 目录重命名与 FrontMatter 渲染修复 PRD

## 背景

近期用户在使用中反馈了两类问题，分属 VFS 文件操作与 Markdown 预览，根因都已通过代码探索定位：

### 问题一：VFS 目录重命名后老目录残留

把目录 A 改名成目录 B 后，A 和 B 同时存在。根因在 `packages/core/src/domain/vfs/logic/vfs-move.ts` 的 `moveVfsDirectory`：

- `vfs.list(dir)` 的 SQL 用 `LIKE 'dir/%'`，**设计上不返回目录根行本身**；但清理逻辑用 `dirs.some(d => d.path === oldDir)` 判断「源目录行是否存在」，该判断**恒为 false**，导致 `vfs.delete(oldDir)` 永不执行——源根目录行残留。
- 源目录下的**子目录行**（如 `/A/sub`）也从未被删除，只在新位置 `mkdirIgnoreExists` 了一份，老侧原封不动。
- 旧**文件**由 `moveVfsFile` 内部 `write(to) → delete(from)` 清理，不受影响——所以单文件重命名正常，**只有目录重命名中招**。
- 附带 bug：**空目录重命名会抛 `NOT_FOUND`**。因为 `moveVfsPath` 在 `entries.length === 0 && !hasDirRow` 时抛错，而空目录下 list 既空、hasDirRow 又恒 false。

所有 scope（session / project / global / agent `fs mv`）共用同一实现，均受影响。测试 `vfs-move.test.ts` 的「moves a directory tree」用例只断言旧文件不在了，没有断言目录行被清理，所以回归没被守住。

### 问题二：移动端 Markdown 预览的 FrontMatter 渲染异常

移动端 `FileMarkdownPreview` 用 `splitMarkdownFrontMatter`（`packages/core/src/domain/workplace/logic/front-matter.ts`）拆分 FrontMatter（YAML front matter，文件开头的 `--- ... ---` 块），存在两个子问题：

- **FM 不闭合时正文完全不渲染**：文件首行是 `---` 但没有第二个 `---` 闭合时，`splitMarkdownFrontMatter` 返回 `closed: false`；`FileMarkdownPreview` 把 `closed === false` 当成「禁止渲染正文」的总闸，最终只显示一句「请返回编辑并补全结束的 --- 后再预览正文」，连 FM 区下方的 markdown 正文一行都不画。
- **FM 闭合 + 正文为空时双重渲染**：根因在 `FileMarkdownPreview.tsx` L511 的 `plain={(split?.body ?? '').trim() || content}` 兜底表达式——正文为空时 `||` 把含 FM 的完整 `content` 捞回 plain，导致顶部 FM 卡片渲染一次、下方 plain 又把 `---\ntitle:...\n---` 原样显示一次。

FrontMatter 并不是 Markdown 规范的必需部分，用户的核心诉求是：**没有 FM、FM 闭合、FM 不闭合，都不应该影响 Markdown 正文的正常渲染**。桌面端用 `react-markdown` 直接渲染整段、不拆 FM（FM 被当普通 `<hr>` 渲染），不存在该问题，可作对比基线。

### 修复取向（已与用户拍板）

- **VFS move**：补齐源目录与子目录行的清理，并修正空目录 rename 的 NOT_FOUND 误报。
- **FM 渲染**：采用「取向 A 最干净版」——修改底层 `splitMarkdownFrontMatter` 语义，不闭合时直接当成「无 FM」处理（返回 `frontMatterLines: null, body: content, closed: true`）；同步清理 mobile 端整套「未闭合提示」UI，并更新 core 受影响的测试与 header 档语义。旧的 `mobile-bugfix/spec.md` 中「保持 FM 未闭合提示逻辑不变」的约束已被本 PRD 覆盖、归档，不再构成约束。

## 目标（含成功指标）

修复上述两类 bug，使 VFS 目录重命名行为正确、移动端 Markdown 预览对 FM 的处理符合「FM 不应干扰正文渲染」的常识预期。

**成功指标**：

- 目录重命名后，源目录及其所有子目录行被清理，列表中只剩目标目录（自动化测试断言）。
- 空目录可被重命名，不再抛 `NOT_FOUND`（自动化测试断言）。
- FM 不闭合时，移动端预览能正常渲染正文，且不再出现「请返回编辑」阻断提示（自动化测试 + 手工验收）。
- FM 闭合 + 空正文时，FM 只渲染一次（自动化测试断言）。
- 受影响的 core 测试同步更新并通过；新增回归测试覆盖上述场景。

## 用户与场景

- **移动端用户**：在聊天工作区或文件管理器中重命名 VFS 文件夹；预览含 FrontMatter 的 Markdown 文件。
- **Agent / CLI 用户**：通过 `fs mv` 工具或命令移动/重命名目录（共用同一 core 实现，修复后一并受益）。
- **LLM 上下文消费方**：`workplace-display.ts` 的 `<file>` 块 header 档会因 FM 语义调整而变化（不闭合 header 档从「格式无效」变为「无 Front Matter」），属于预期内的语义调整。

## 范围

### 包含范围

- `packages/core` 的 VFS move 逻辑修复（`vfs-move.ts`）。
- `packages/core` 的 `splitMarkdownFrontMatter` / `parseMarkdownFrontMatter` 语义调整（`front-matter.ts`）。
- `apps/mobile` 的 `FileMarkdownPreview` 适配与提示 UI 清理。
- 相关测试更新与回归用例补充（`vfs-move.test.ts`、`workplace-display.test.ts`、`FileMarkdownPreview.test.tsx`、`front-matter-fields.test.ts` 等）。

### 不包含范围

- 桌面端 Markdown 预览（`apps/desktop`）——本就不存在 FM 渲染问题，不做改动。
- VFS 的 read / write / delete 单独路径（除 move 外不调整）。
- VFS 重命名相关的 UI 交互改造（仅修复底层正确性，不改交互流程）。
- Markdown 预览引擎本身的渲染能力增强（不涉及 markdown-it / WebView 引擎选型变更）。

## 核心需求

1. **目录重命名清理源目录**：重命名目录后，源根目录行及所有源子目录行必须被删除；目标侧保留完整副本（目录结构 + 文件）。文件 move 的现有正确行为保持不变。

2. **空目录可重命名**：对空目录执行 rename / move 不再抛 `NOT_FOUND`，目标侧创建空目录、源侧清理。

3. **FM 不闭合时按无 FM 渲染**：修改 `splitMarkdownFrontMatter`，文件首行是 `---` 但未闭合时，返回 `{ frontMatterLines: null, body: <原文>, closed: true }`；`parseMarkdownFrontMatter` 同步调整为返回「无 Front Matter」语义。上层不再因不闭合而阻断正文渲染。

4. **清理 mobile 未闭合提示 UI**：移除 `FileMarkdownPreview` 及其联动文件中依赖 `!split.closed` 的提示分支（红字文案、`FrontMatterCard` 的 invalid 状态、WebView 错误 div、`buildFrontMatterDocumentHtml` 的 invalid 参数等），因为不闭合已等价于无 FM，不再有「未闭合」这一态。

5. **修复 FM 闭合 + 空正文的双重渲染**：修正 `FileMarkdownPreview.tsx` 中 plain 兜底表达式（L511 同形表达式，含 L530 隐患点），正文为空时不再把含 FM 的 `content` 回填到 plain。

6. **更新受影响测试与语义**：更新 `workplace-display.test.ts` 的「degrades invalid front matter」用例以反映新语义；删除/改写 `FileMarkdownPreview.test.tsx` 中「不闭合时不渲染 WebView」的用例；为 `splitMarkdownFrontMatter` 补全边界用例（无 FM / 闭合 / 不闭合 / 单行 `---` / 空 FM）。

## 验收标准

### AC-1：目录重命名清理（对应核心需求 1）

- **Given** VFS 中存在 `/A`（含子目录 `/A/sub` 和文件 `/A/f.md`、`/A/sub/g.md`）
- **When** 执行 `moveVfsPath(vfs, "/A", "/B")`
- **Then**
  - `vfs.list("/")` 不含 `/A`（源根目录行已删）
  - `vfs.read("/A/f.md")` 抛 NOT_FOUND（文件已移走）
  - `vfs.list` 找不到 `/A/sub`（源子目录行已删）
  - `vfs.read("/B/f.md")`、`vfs.read("/B/sub/g.md")` 内容正确
  - `vfs.list("/B")` 含 `sub` 子目录

### AC-2：空目录重命名（对应核心需求 2）

- **Given** VFS 中存在空目录 `/empty`
- **When** 执行 `moveVfsPath(vfs, "/empty", "/moved")`
- **Then**
  - 不抛错
  - `vfs.list("/")` 不含 `/empty`
  - `vfs.list("/")` 含 `/moved`

### AC-3：FM 不闭合按无 FM 渲染（对应核心需求 3、4）

- **Given** 移动端预览引擎为默认 webview，文件内容为首行 `---` 但无闭合 `---`、下方有正常 markdown 正文（如 `# Title`）
- **When** 在移动端打开该文件预览
- **Then**
  - markdown 正文（`# Title`）正常渲染
  - 不出现「请返回编辑并补全结束的 ---」提示
  - 不出现 `FrontMatterCard` 的 invalid 状态或 WebView 错误 div

### AC-4：FM 闭合 + 空正文只渲染一次（对应核心需求 5）

- **Given** 文件内容为闭合 FM + 空 body（如 `---\ntitle: x\n---\n` 之后无正文）
- **When** 在移动端预览
- **Then**
  - FM 卡片只在顶部渲染一次
  - 下方不再重复出现 `---\ntitle: x\n---` 原文
  - （正文为空的提示由空正文分支正常处理，不回填 content）

### AC-5：FM 边界语义正确（对应核心需求 3、6）

- `splitMarkdownFrontMatter` 在以下输入下行为符合预期（自动化测试断言）：
  - 首行非 `---` → `{ frontMatterLines: null, body: content, closed: true }`
  - 正常闭合 → `{ frontMatterLines: <中间行>, body: <闭合后正文>, closed: true }`
  - 不闭合（含单行 `---`） → `{ frontMatterLines: null, body: content, closed: true }`
- `parseMarkdownFrontMatter` 在不闭合时返回「无 Front Matter」语义（不再返回「格式无效」）。

### AC-6：受影响测试同步更新

- `workplace-display.test.ts` 的「invalid front matter」用例已更新为新语义并通过。
- `FileMarkdownPreview.test.tsx` 的「不闭合时不渲染 WebView」用例已删除或改写。
- 全量相关测试套件通过。

## 约束与依赖

- 不改变 VFS move 对外 API 签名（`moveVfsPath` / `moveVfsDirectory` 入参不变），仅修正内部清理逻辑。
- 不改变 `splitMarkdownFrontMatter` / `parseMarkdownFrontMatter` 的导出路径与函数签名，仅调整「不闭合」分支的返回值语义。
- 所有 scope（session / project / global / agent）共用同一 core 实现，修复后自动覆盖。
- 本 PRD 覆盖旧的 `apps/mobile/.../mobile-bugfix/spec.md` 中关于「FM 未闭合提示逻辑不变」的约束，旧 spec 相关条款视为归档。

## 风险与待确认项

- **LLM header 档语义变更**：`workplace-display.ts` 把不闭合文件的 header 档从「格式无效」改为「无 Front Matter」，属于预期内变更，但缺乏评估该变更对 LLM 行为影响的测试。拟在 SPEC 中补充说明，不在本 PRD 强约束。
- **`parseMarkdownFrontMatter` 的「格式无效」字符串成为死代码**：取向 A 后该返回值分支不可达，可在实现阶段一并清理或保留以备未来需要。SPEC 决策。
- **mobile 提示 UI 清理的连带面**：`buildFrontMatterDocumentHtml` 的 `invalid` 参数、`FrontMatterCard` 的 invalid 分支等需要逐一清理，SPEC 中列详细清单。
