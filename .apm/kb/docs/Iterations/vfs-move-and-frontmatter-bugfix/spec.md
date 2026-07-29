---
date: 2026-07-29
---

# VFS 目录重命名与 FrontMatter 渲染修复 技术规格（SPEC）

## 设计目标

修复两类 bug，满足 PRD（`.apm/kb/docs/Iterations/vfs-move-and-frontmatter-bugfix/prd.md`）的 AC-1 ~ AC-6：

1. **VFS 目录重命名残留**：`moveVfsDirectory` 的清理段死代码导致源根目录行 + 子目录行不删；`moveVfsPath` 的空目录判断误报 `NOT_FOUND`。
2. **FrontMatter 渲染异常**：底层 `splitMarkdownFrontMatter` 的「不闭合」语义被上层滥用为「禁止渲染正文」的总闸；`FileMarkdownPreview` 的 plain 兜底表达式导致闭合+空正文双重渲染。

核心策略：
- VFS move 走「最小修正」——补齐源目录清理 + 去掉恒假的 `hasDirRow` 判断。
- FM 走「取向 A 最干净版」——底层不闭合当无 FM 处理，上层整套提示 UI 随之清理，`closed` 字段保留但恒真（签名兼容）。

## 总体方案

### 方案一：VFS move 修正（`packages/core`）

**根因复用**：`vfs.list(dir)` 的 SQL 是 `LIKE 'dir/%'`，设计上不返回目录根行本身。这导致所有 `entries.some(e => e.path === dir)` 风格的判断在根行上**恒为 false**，是两处缺陷的共同根源。

**修法**：
- `moveVfsDirectory` 末尾的「条件删源根」整段替换为「无条件递归删源根」——文件已在前面被 `moveVfsFile` 搬走（`write(to) → delete(from)`），递归删只会清掉残留的目录行，不会误伤文件。
- `moveVfsPath` 的空目录判断整段去掉——`vfs.list(oldDir)` 本身已能在路径真不存在时抛 `NOT_FOUND`（`vfs.service.ts` L47-53 的 `findByPath` 兜底），返回 `[]` 即表示真实存在的空目录。`hasDirRow` 这层多余判断删掉后，空目录会自然进入 `moveVfsDirectory`，其中 `dirs`/`files` 都为空，只走 `mkdirIgnoreExists(newDir) + delete(oldDir, {recursive:true})`，满足 AC-2。

**为什么不新增 `findByPath` 到 VfsService port**：现有 `list` / `read` 已能区分「空目录」（list 返回 `[]`）与「真不存在」（list 抛 NOT_FOUND），不需要新 API。保持 port 不变。

### 方案二：FrontMatter 语义调整（`packages/core` + `apps/mobile`）

**底层（core）**：
- `splitMarkdownFrontMatter` 不闭合分支（L40-42）改为返回 `{ frontMatterLines: null, body: content, closed: true }`——与「无 FM」分支同形。
- `parseMarkdownFrontMatter` 的「格式无效」分支（L57-59）整段删除——成为死代码，因为 `split.closed` 恒真。不闭合文件的 header 档自然走「无 Front Matter」分支。
- `MarkdownFrontMatterSplit.closed` 字段保留（签名兼容），但语义退化为恒真；新代码不应再依赖它做分支。

**上层（mobile）**：
- `FileMarkdownPreview` 里 11 处 `closed` 依赖全部简化或删除（详见变更点清单）。
- `FrontMatterCard` 组件的 `invalid` / `rawLines` 分支整段删除，组件瘦身为「标题 + 空 FM 提示 + fields 渲染」。
- `build-front-matter-document-html.ts` 的 `invalid` / `rawLines` 参数删除，签名收窄为 `{ fields; empty }`。
- 两处 `(split?.body ?? '').trim() || content` 兜底（L511 / L530）统一改为复用 `mdBody` 变量，根治双重渲染。

## 最终项目结构

本 iteration **不新增文件、不新增模块**，全部为既有文件的修改。改动横跨两个包：

```
packages/core/
  src/domain/vfs/logic/vfs-move.ts           # move 清理逻辑 + 空目录判断
  src/domain/workplace/logic/front-matter.ts  # FM 语义调整
  test/vfs/vfs-move.test.ts                   # 新增目录清理 + 空目录用例
  test/workplace/workplace-display.test.ts    # 改写 invalid FM 用例 + 补边界

apps/mobile/
  src/components/vfs/FileMarkdownPreview.tsx              # 11 处 closed 清理 + 双重渲染修复
  src/components/vfs/build-front-matter-document-html.ts   # 删 invalid/rawLines 参数
  __tests__/FileMarkdownPreview.test.tsx                   # 删/改写不闭合用例 + 补空 body 用例
```

## 变更点清单

### A. `packages/core/src/domain/vfs/logic/vfs-move.ts`

| 编号 | 行号 | 改动 |
|---|---|---|
| A1 | L178-181 | `hadOldDirRow` 判断 + 条件 delete 整段替换为 `await vfs.delete(oldDir, { recursive: true });`（文件已被 moveVfsFile 搬走，递归删只清残留目录行） |
| A2 | L225-231 | 删除 `hasDirRow` 判断与 `entries.length === 0 && !hasDirRow` 的 NOT_FOUND 抛错；改为 `await vfs.list(oldDir, { recursive: true });`（让 list 自身负责 NOT_FOUND），随后直接进入 `moveVfsDirectory` |

> 不改：`assertMoveTargetAvailable` L124-127 的同形 `hasDirRow` 死代码（已被前置 `read(to)` 拦截目录目标，无功能影响，留待后续清理）。

### B. `packages/core/src/domain/workplace/logic/front-matter.ts`

| 编号 | 行号 | 改动 |
|---|---|---|
| B1 | L40-42 | 不闭合分支改为 `return { frontMatterLines: null, body: content, closed: true };`（与 L25-27 无 FM 分支同形） |
| B2 | L57-59 | `parseMarkdownFrontMatter` 的 `if (!split.closed) { return ["1｜（Front Matter 格式无效）"]; }` 整段删除（B1 后不可达） |

> 保留：`MarkdownFrontMatterSplit.closed` 字段（签名兼容）；类型注释可补一句「恒真，仅为兼容保留」。

### C. `apps/mobile/src/components/vfs/FileMarkdownPreview.tsx`

| 编号 | 行号 | 当前 | 改为 |
|---|---|---|---|
| C1 | L291-293 | `fmFields = showFrontMatter && split?.closed ? parseFrontMatterFields(fmLines) : []` | `fmFields = showFrontMatter ? parseFrontMatterFields(fmLines) : []`（去 `split?.closed`） |
| C2 | L296-298 | `mdBody = isMdPath && split?.closed ? (split.body ?? '').trim() : ''` | `mdBody = isMdPath ? (split?.body ?? '').trim() : ''`（去 `split?.closed`） |
| C3 | L333-337 | `mdUseWebViewPreview` 含 `split?.closed === true` | 删去该项，其余条件保留 |
| C4 | L342-358 | `frontMatterHtml` 传 `invalid: !split?.closed`、`rawLines: !split?.closed ? fmLines : undefined`、`empty: split?.closed === true && fmLines.length === 0` | 删 `invalid`/`rawLines`；`empty` 简化为 `fmLines.length === 0`；依赖数组去 `split?.closed` |
| C5 | L502-506 | `!split?.closed` 红字提示「请返回编辑并补全结束的 ---」 | 整块删除（含外层三元） |
| C6 | L507 | `mdUseWebViewPreview \|\| (mdAnnotateActive && split?.closed)` | `mdUseWebViewPreview \|\| mdAnnotateActive` |
| C7 | L511 | `plain={(split?.body ?? '').trim() \|\| content}`（**双重渲染 bug**） | `plain={mdBody}` |
| C8 | L519-526 | 第一处 `FrontMatterCard` 传 `invalid`/`rawLines`/`empty` | 删 `invalid`/`rawLines`；`empty` 简化为 `fmLines.length === 0` |
| C9 | L530 | `content={(split?.body ?? '').trim() \|\| content}`（**同形 bug**） | `content={mdBody}` |
| C10 | L536 | `split?.closed && showFrontMatter` | `showFrontMatter` |
| C11 | L538-543 | 第二处 `FrontMatterCard` 传 `invalid={false}` | 删 `invalid` prop |

### D. `FrontMatterCard` 组件（同文件 L554-618）

| 编号 | 行号 | 改动 |
|---|---|---|
| D1 | L557 | 删 `invalid: boolean;` 字段 |
| D2 | L559 | 删 `rawLines?: string[];` 字段 |
| D3 | L565 / L567 | 解构参数去 `invalid`、`rawLines` |
| D4 | L581-585 | 删 invalid 红字分支「格式无效：缺少结束的 --- 分隔线」 |
| D5 | L591 | `!invalid && !empty` 简化为 `!empty` |
| D6 | L607-615 | 删 rawLines mono 渲染整段 |
| D7 | 样式表 L640 | 删 `fmError` 定义（死代码） |

### E. `apps/mobile/src/components/vfs/build-front-matter-document-html.ts`

| 编号 | 行号 | 改动 |
|---|---|---|
| E1 | L8 | 删 `readonly invalid: boolean;` |
| E2 | L10 | 删 `readonly rawLines?: readonly string[];` |
| E3 | L25-29 | `hasContent` 删 `input.invalid \|\|` 与 `(input.rawLines?.length ?? 0) > 0`，保留 `input.empty \|\| input.fields.length > 0` |
| E4 | L35-38 | 删 `if (input.invalid)` 错误 div 整块 |
| E5 | L42 | `if (!input.invalid && !input.empty)` 简化为 `if (!input.empty)` |
| E6 | L52-56 | 删 `if (input.invalid && input.rawLines?.length)` rawLines 渲染整块 |

### F. 测试

| 编号 | 文件 | 改动 |
|---|---|---|
| F1 | `packages/core/test/vfs/vfs-move.test.ts` | 现有「moves a directory tree」用例补断言：`/src`、`/src/sub` 目录行已清理（list 抛 NOT_FOUND 或 root 列表不含）；新增「空目录可重命名」用例 |
| F2 | `packages/core/test/workplace/workplace-display.test.ts` | L37-40 「degrades invalid front matter」改写为断言 `["1｜（无 Front Matter）"]`，用例名改为反映新语义；新增 `splitMarkdownFrontMatter` 边界用例（单行 `---`、不闭合含正文、空 FM） |
| F3 | `apps/mobile/__tests__/FileMarkdownPreview.test.tsx` | L196-215 「does not render Web body when front matter is unclosed」改写为「不闭合时按无 FM 渲染正文」（断言 WebView 挂载、frontMatterHtml 为 undefined、正文渲染）；新增「闭合 FM + 空 body 只渲染一次」用例 |

## 详细实现步骤

> phase 划分：`phase-vfs-move`（VFS 目录清理）、`phase-fm-core`（FM 底层语义）、`phase-fm-mobile`（mobile 上层清理与双重渲染修复）。三者相互独立，可并行实现；但建议按 VFS → FM core → FM mobile 的顺序提交，便于 review。

- **Step 1** — phase-vfs-move — blocking: yes — qa: auto：改 `vfs-move.ts` 的 `moveVfsDirectory` 清理段（A1），把 L178-181 替换为 `await vfs.delete(oldDir, { recursive: true });`。
- **Step 2** — phase-vfs-move — blocking: yes — qa: auto：改 `moveVfsPath` 空目录判断（A2），删 L225-231 的 `hasDirRow` + `entries.length` 误报逻辑，改为 `await vfs.list(oldDir, { recursive: true });` 让 list 自抛 NOT_FOUND，随后直接调 `moveVfsDirectory`。
- **Step 3** — phase-vfs-move — blocking: yes — qa: auto：补 `vfs-move.test.ts` 用例（F1）：在「moves a directory tree」补断言源根 `/src` 与子目录 `/src/sub` 已清理；新增「空目录可重命名」用例（建 `/empty`，move 到 `/moved`，断言不抛错 + `/empty` 不在 + `/moved` 在）。
- **Step 4** — phase-fm-core — blocking: yes — qa: auto：改 `front-matter.ts` 的 `splitMarkdownFrontMatter` 不闭合分支（B1，L40-42）为返回 `{ frontMatterLines: null, body: content, closed: true };`。
- **Step 5** — phase-fm-core — blocking: yes — qa: auto：删 `parseMarkdownFrontMatter` 的格式无效分支（B2，L57-59）。
- **Step 6** — phase-fm-core — blocking: yes — qa: auto：改 `workplace-display.test.ts`（F2）：L37-40 改写为新语义断言 `["1｜（无 Front Matter）"]`；新增 `splitMarkdownFrontMatter` 边界用例（单行 `---`、不闭合含正文、空 FM）。
- **Step 7** — phase-fm-mobile — blocking: yes — qa: auto：改 `FileMarkdownPreview.tsx` 的 11 处 `closed` 依赖（C1-C11），简化或删除；同步修 C7（L511）/ C9（L530）双重渲染兜底为 `mdBody`。
- **Step 8** — phase-fm-mobile — blocking: yes — qa: auto：清理 `FrontMatterCard` 组件（D1-D7），删 invalid/rawLines 相关字段、分支、样式。
- **Step 9** — phase-fm-mobile — blocking: yes — qa: auto：改 `build-front-matter-document-html.ts`（E1-E6），删 invalid/rawLines 参数与对应渲染分支。
- **Step 10** — phase-fm-mobile — blocking: yes — qa: auto：改 `FileMarkdownPreview.test.tsx`（F3）：L196-215 改写为「不闭合按无 FM 渲染」；新增「闭合 FM + 空 body 只渲染一次」用例。
- **Step 11** — phase-fm-mobile — blocking: no — qa: manual_user：真机验收（合并后用户执行）：① 目录重命名后老目录消失；② FM 不闭合文件正文正常渲染、无提示；③ FM 闭合+空正文 FM 只渲染一次。

## 测试策略

### 测试用例

- **T-VM1** — blocking: yes — 映射 Step 1/3：`moveVfsPath("/A","/B")` 后，`/A`、`/A/sub` 目录行已清理，`/B` 子树完整（对应 AC-1）。
- **T-VM2** — blocking: yes — 映射 Step 2/3：空目录 `/empty` 重命名为 `/moved` 不抛错，`/empty` 不在、`/moved` 在（对应 AC-2）。
- **T-FM1** — blocking: yes — 映射 Step 4/6：`splitMarkdownFrontMatter` 不闭合输入返回 `{frontMatterLines: null, body: content, closed: true}`（对应 AC-5）。
- **T-FM2** — blocking: yes — 映射 Step 5/6：`parseMarkdownFrontMatter` 不闭合输入返回 `["1｜（无 Front Matter）"]`（对应 AC-5）。
- **T-FM3** — blocking: yes — 映射 Step 4/6：`splitMarkdownFrontMatter` 边界——单行 `---`、空 FM、首行非 `---` 均符合新语义（对应 AC-5）。
- **T-FM4** — blocking: yes — 映射 Step 7/10：FM 不闭合 + 正文非空时，`FileMarkdownPreview` 挂 WebView、`frontMatterHtml` 为 undefined、正文渲染（对应 AC-3）。
- **T-FM5** — blocking: yes — 映射 Step 7/10：FM 闭合 + 空 body 时，`frontMatterHtml` 含 `fm-card`，`plain`/`content` 不含 `---`/`title:`（对应 AC-4）。

### 运行命令

```bash
# core 测试
npx jest --selectProjects @novel-master/core vfs-move workplace-display

# mobile 测试
npx jest --selectProjects @novel-master/mobile FileMarkdownPreview
```

> 具体项目名与 jest 配置以仓库实际为准；如无 `--selectProjects` 配置，用 `--testPathPattern` 替代。

## 兼容性或迁移说明

- **VFS move**：不改对外 API 签名（`moveVfsPath` / `moveVfsDirectory` 入参不变），仅修正内部清理逻辑。所有 scope（session/project/global/agent `fs mv`）共用同一 core 实现，修复后自动覆盖。
- **FM 底层**：不改 `splitMarkdownFrontMatter` / `parseMarkdownFrontMatter` 的导出路径与函数签名，仅调整「不闭合」分支返回值语义。`MarkdownFrontMatterSplit.closed` 字段保留但恒真，新代码不应再依赖它做分支。
- **LLM header 档语义变更**（预期内）：`workplace-display.ts` 透传 `parseMarkdownFrontMatter`，不闭合文件的 header 档从 `["1｜（Front Matter 格式无效）"]` 变为 `["1｜（无 Front Matter）"]`。这是取向 A 的直接结果，PRD 已确认为预期内变更；本 iteration 不新增 LLM 行为评估测试，留待后续按需评估。
- **旧 spec 覆盖**：`apps/mobile/.../mobile-bugfix/spec.md` 中「保持 FM 未闭合提示逻辑不变」的约束已被本 iteration 的 PRD 覆盖、归档，不再构成约束。

## 风险与回滚方案

### 风险

1. **`delete(oldDir, { recursive: true })` 的安全性**（Step 1）：依赖「files 循环已搬走全部文件行」。`files = entries.filter(kind==='file')`，entries 来自 `list(oldDir, recursive:true)` 覆盖整个子树，不会有遗漏。若仍担忧，可在递归删前断言 `list(oldDir, recursive:true)` 仅剩目录行——但会增加一次 SQL，非必要。
2. **`ScopedVfsService` 的 `delete({recursive:true})` 行为**：scoped 包装对 path 做前缀翻译后委托 inner，recursive 删除语义应一致；AC 验证用 `ctx.sessionVfs(...)`（session-scoped），测试通过即等价覆盖。如发现 scoped 有额外限制，Step 1 改为「按 dirs 深度降序逐个 `delete(dir, {recursive:false})` + 最后删 oldDir」的保守取向。
3. **`closed` 字段语义退化的认知风险**：保留 `closed: true` 字段可能让未来读代码的人误以为还在做分支。已在「兼容性说明」与 front-matter.ts 注释中标注「恒真，仅为兼容保留」。
4. **空 body 场景的渲染兜底**：改完后空 body 走第三分支（`mdBody` 为空 → `showFrontMatter` 接管 → 「正文为空」）。`RichContentBody content=""` 是否会画空白未在测试中显式守过，T-FM5 会断言 `plain`/`content` 不含 FM 原文，间接守住。

### 回滚

改动集中在 `vfs-move.ts`（2 处）、`front-matter.ts`（2 处）、`FileMarkdownPreview.tsx`（11 处 + FrontMatterCard）、`build-front-matter-document-html.ts`（6 处）+ 测试。回滚直接 `git revert` 对应 commit 即可，无数据迁移、无 schema 变更，风险可控。
