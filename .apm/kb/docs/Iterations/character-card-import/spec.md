---
date: 2026-07-26
---

# 导入角色卡 技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **依赖写入语义**：[vfs-zip-directory](../workspace-chat-vfs-upgrade/features/vfs-zip-directory/spec.md)（子树覆盖、`confirmed`、失败不污染、不管规则表）

## 设计目标

1. Core 提供「角色卡字节/JSON → 相对路径 md 树」纯解析，以及「确认后整子树替换为该文本树」的导入服务（语义 ≡ ZIP Phase A/B，**不用** batch merge）。  
2. Desktop / Mobile / CLI 并列「导入角色卡」入口，确认心智与「导入 ZIP」一致。  
3. 支持 SillyTavern **PNG**（仅 `tEXt`/`chara`）与 **纯 JSON**；字段落盘按 PRD：`description` / 开场合并 / 世界书 + `keywords` Front Matter。  
4. 零新运行时 PNG 依赖（手写 chunk 扫描，对齐 ZIP central-dir 先例）。  
5. 不读写 workplace 规则表；不实现酒馆关键字扫描。

## 现状与约束

| 层 | 现状 | 本需求 |
|----|------|--------|
| 解析 | 无角色卡 / `chara` 实现 | 新建 `domain/character-card` |
| 子树覆盖 | `VfsZipIoService.import(zipBytes, {confirmed, directoryPath})` | 抽出或并列「文本树子树替换」；角色卡走此路径 |
| Batch | `VfsBatchIoService` 合并写入 | **禁止**用作角色卡落盘 |
| Front Matter | 仅有 `split`/`parse`；写入用 `stringifyText(..., "yaml")` 手拼 | 世界书 md 手拼 `---` + `keywords`（**始终**写该键） |
| Desktop/Mobile/CLI | 仅「导入 ZIP」 | 并列「导入角色卡」 |
| 依赖 | 无运行时 pngjs/sharp | 保持；手写 PNG **仅** `tEXt` |

**不可破坏契约（继承 ZIP）**

- `confirmed !== true` → 零写库（对齐 `NOT_CONFIRMED` 语义）。  
- Phase A（解析/校验）失败 → 不调用 `deleteVfsPrefix`。  
- Phase B 单事务：删目标子树 → 确保目标目录行 → 写入文件；失败整事务回滚。  
- 同级路径保留；不管 workplace 规则表。  
- **不得**对合成 md 树套用 ZIP「basename 前缀硬失败」规则（避免目标目录名与 `开场/` 首段冲突误杀）；合成树只做逻辑相对路径合法性校验。  
- **显式不调用** `assertZipEntriesNotDomainRootPrefixed`；**不走** `validateVfsZipEntries`。

## 总体方案

### 流水线

与 Desktop ZIP 同构钉死：**先确认 → 再选文件 → Core `importFromBytes`/解析在选文件之后、`deleteVfsPrefix` 之前**。

```text
UI/CLI 确认（confirmed=true / --yes）
  → 选文件 / 读 --file（Uint8Array 或 UTF-8 文本）
  → CharacterCardImportService.importFromBytes（或先 parseCharacterCardToMdTree 再 import）
       解析失败 → CharacterCardError，零写库
       Phase A: 校验相对路径 / 拼逻辑路径 / 目标非 file
       Phase B: deleteVfsPrefix(子树) + ensureEmptyDirectoryRow + insert 各 md
  → Toast / 退出码 0
```

**三端编排顺序（各一句）**

| 端 | 编排 |
|----|------|
| Desktop | ConfirmModal 确认 → IPC（`confirmed: true`）→ Main `dialog` 选 png/json → 读字节 → `importFromBytes`（解析在选文件后、delete 前） |
| Mobile | Alert 确认 → 系统 picker 选 png/json → 读字节 → `importFromBytes`（解析在选文件后、delete 前） |
| CLI | 校验 `--yes`（否则 `NOT_CONFIRMED`）→ 读 `--file` → `importFromBytes`（解析在读文件后、delete 前） |

取消确认 / 取消选文件 / 解析或 Phase A 失败：目标子树字节级不变。

### Core API（示意）

```ts
// 纯解析 — domain/character-card
type MdTree = ReadonlyMap<string, string>; // key: 相对目标目录路径，无 leading `/`，用 `/`

function parseCharacterCardToMdTree(input: Uint8Array | string): MdTree
// 输入判别与解码见下方「输入判别顺序（可执行）」；失败抛 CharacterCardError
// （表内 code：NOT_CHARACTER_CARD | UNSUPPORTED_SPEC | …）

function characterCardJsonToMdTree(card: unknown): MdTree
// 规范化 V2（及字段兼容形态）后映射文件树

// 导入 — service，经 public/vfs 导出
type CharacterCardImportOptions = {
  readonly confirmed: boolean;
  readonly directoryPath?: string; // 缺省 "/"
};

interface CharacterCardImportService {
  import(
    scope: VfsScope,
    tree: MdTree,
    options: CharacterCardImportOptions,
  ): Promise<void>;
  /**
   * 便捷：bytes → 解析 → import；解析失败不写库。
   * `bytes` 的 PNG/JSON 判别与 `parseCharacterCardToMdTree(Uint8Array)` **同一套顺序**（见下）。
   */
  importFromBytes(
    scope: VfsScope,
    bytes: Uint8Array,
    options: CharacterCardImportOptions,
  ): Promise<void>;
}

/** factory — 对齐 createVfsZipIoService；可选 testHook 供回滚单测 */
type CreateCharacterCardImportServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: CharacterCardImportTestHook;
};

function createCharacterCardImportService(
  conn: TdbcConnection,
  options?: CreateCharacterCardImportServiceOptions,
): CharacterCardImportService
```

**输入判别顺序（可执行）** — `parseCharacterCardToMdTree` 与 `importFromBytes` 共用，**禁止 JSON-first**：

```text
string → 按 UTF-8 JSON 解析（可剥 BOM）→ characterCardJsonToMdTree
Uint8Array：
  1. 若前 8 字节为 PNG 魔数（89 50 4E 47 0D 0A 1A 0A）
       → 仅走 tEXt / keyword=chara → Base64 → JSON → md 树
       → 任一步失败（无 chara、仅 iTXt/zTXt、Base64/JSON 坏等）
         → NOT_CHARACTER_CARD
       → **不得**再把同一份 bytes 当 UTF-8 JSON 回退解析
  2. 否则按 UTF-8 文本解析为 JSON（可剥 BOM）→ characterCardJsonToMdTree
```

**子树替换内核（推荐）**：从 `DefaultVfsZipIoService.import` Phase B 抽出共享函数（例如 `replaceSubtreeWithTextFiles(repoTx, scope, directoryPath, files, directories?)`），ZIP `import` 与角色卡 `import` 共用；ZIP 专属校验（entry 上限、basename 前缀、junk）仍留在 ZIP Phase A。

若工期紧可先在 `CharacterCardImportService` **内联复制** Phase B，但须单测钉死与 ZIP 同构（兄弟保留、不确认、校验失败不删）；后续再抽内核，避免双份漂移。

### Phase A 路径校验（合成 md 树）

对 `MdTree` 每个相对路径 key，在任何 `deleteVfsPrefix` / 写库之前执行下列可执行清单（对齐 ZIP entry 相对路径规则的**可复用**部分；错误码 `INVALID_PATH`）：

1. 无 leading `/`；段分隔只用 `/`。  
2. **禁止**反斜杠 `\`。  
3. **禁止**任意段为 `..`（含路径中出现 `..` 段）。  
4. **禁止**空段（如 `开场//开场001.md`、首尾多余 `/` 导致的空段）。  
5. **禁止**超长：相对路径长度 ≤ `VFS_ZIP_MAX_ENTRY_PATH_LEN`（512，与 ZIP 同常量或等价本地常量）。  
6. **禁止** Windows 盘符绝对形态（如 `C:/...`），若合成路径出现则失败。  
7. 将相对路径 join 到 `directoryPath` 得到逻辑绝对路径后，调用 `assertLogicalPathAllowed(scope, logical)`。  
8. 目标 `directoryPath` 已存在且为 **file** → `INVALID_PATH`。

**显式不做**：

- **不调用** `assertZipEntriesNotDomainRootPrefixed`（合成树首段常为 `开场`/`世界书`，不得因与目标 basename 巧合或无关而误杀）。  
- **不走** `validateVfsZipEntries`（不套 ZIP junk / UTF-8 entry 解码 / 条数与体积上限 / basename 前缀整包校验）。

### 卡片规格与字段映射

| 输入 | 支持 |
|------|------|
| PNG | 标准 PNG（魔数见上节）；**仅**扫描 `tEXt` chunk，keyword=`chara`；值为 Base64(JSON)。**本期不支持** `iTXt` / `zTXt`（即便 keyword 为 `chara` 也视为无法识别 → `NOT_CHARACTER_CARD`）。魔数命中后**禁止** JSON 回退。 |
| JSON | UTF-8；**允许剥离 UTF-8 BOM**；顶层为 V2（`spec === "chara_card_v2"` 或存在可用的 `data`/`description` 兼容形态） |
| 不支持 | 加密卡、CharX、仅像素无元数据的 PNG、非角色卡 JSON、仅含 iTXt/zTXt chara 的 PNG → `CharacterCardError`（`NOT_CHARACTER_CARD` 等表内 code），不清空子树 |

**规范化**：优先读 `data.*`（V2）；若无 `data` 则回退顶层同名字段（兼容扁平 JSON）。

| 来源字段 | 生成路径 | 规则 |
|----------|----------|------|
| `description` | `角色描述.md` | **始终生成**；正文可为空字符串 |
| `first_mes` + `alternate_greetings` | `开场/开场{nnn}.md` | 合并顺序：非空 `first_mes` 先入队，再按数组顺序追加非空 `alternate_greetings`；从 1 连续编号，**三位数字对齐**（`开场001`、`开场002`…`开场010`）；合并后长度为 0 → **不创建** `开场/` |
| `character_book.entries[]` | `世界书/<名>.md` | 见下「无有效世界书」；每条对象均导入（**忽略** `enabled`）；正文为条目 `content`，**缺失则正文 `""`** |

**无有效世界书** ≡ `character_book.entries` **不是数组**，或 `entries.length === 0` → **不创建** `世界书/`。数组中**非对象**元素（`null`、原始类型、数组等）**跳过**（不生成文件）；对象条目的 `条目{n}` 仍按该元素在原 `entries[]` 中的 **1-based 下标** 命名（与 T-C13 一致）。

**世界书文件名**

1. `comment` trim 非空 → 用作标题基名。  
2. 否则第一个非空 `keys[]`。  
3. 否则 `条目{n}`，其中 **n = 该条目在 `entries[]` 中的 1-based 下标**（例如 `entries[0]` → `条目1`）。  
4. `sanitize`：替换 `/ \ : * ? " < > |` 与控制字符为 `_`；去掉首尾 `.` 与空格；空结果视为无效并落入下一步回退。  
5. 同目录去重：已占用则 `基名-2.md`、`基名-3.md`…  
6. 文件名加 `.md` 后缀。

**世界书 Front Matter**

```markdown
---
keywords:
  - 原神
  - 原批
---
条目正文…
```

- 使用 `stringifyText({ keywords: string[] }, "yaml")` 生成 FM 体；`keywords` 来自该条目 `keys`。  
- **始终写入 `keywords` 键**（无 key / 空 keys → `keywords: []`）；不得省略该键。  
- **不**写入 enabled/constant/depth 等酒馆规则字段（PRD：不关注规则）。

### 错误类型

新建 `packages/core/src/errors/character-card-errors.ts`（勿污染 `VfsZipErrorCode`）：

| Code | 含义 |
|------|------|
| `NOT_CHARACTER_CARD` | 非 PNG/非卡 JSON、缺 `tEXt` chara、仅有 iTXt/zTXt、Base64/JSON 解码失败、无法识别为角色卡 |
| `UNSUPPORTED_SPEC` | 可解析但规格无法映射本期字段 |
| `INVALID_PATH` | 合成树路径非法 / 目标为 file |
| `NOT_CONFIRMED` | 未确认 |
| `IMPORT_FAILED` | Phase B 事务失败 |

解析注释、抛错与 UI 文案一律使用上表 code（勿另造 `NOT_PNG` / `CHARA_MISSING` / `INVALID_JSON` 等旁路代号；语义并入 `NOT_CHARACTER_CARD` 等）。

UI Toast 优先展示可读 `message`（如「无法识别为角色卡」）。

### 三端入口

| 端 | 入口 | 确认 | 选文件 | 成功文案 |
|----|------|------|--------|----------|
| Desktop | blank / 目录行右键「导入角色卡」（文件行无） | ConfirmModal 标题「导入角色卡」；正文复用 `zipImportConfirmMessage` 同等覆盖句（根目录「当前目录（工作区根）」+ 同级不受影响 +「确定继续？」） | `extensions: ["png","json"]`（确认之后） | 「已导入角色卡」 |
| Mobile | 更多「导入角色卡」（当前 `currentPath`） | Alert 标题「导入角色卡」；正文**复用**现有 `zipImportConfirmCopy` 同等覆盖句：根目录为「当前目录（工作区根）」下全部文件、同级其他内容不受影响；句尾可保留「是否继续？」以对齐现网 ZIP | picker：png/json + 扩展名断言（仿 YAML pick；确认之后） | 「已导入角色卡」 |
| CLI | `import-character-card --file <path> [--path <dir>] [--yes]` | 无 `--yes` → `NOT_CONFIRMED` | 读本地文件 | 退出码 0 |

挂载：与 `import-zip` 相同，在 `nm vfs` / `nm project vfs` / `nm session vfs` 三处注册。

Desktop IPC：新 channel（如 `nm:vfs/characterCardImport`），Request 含 `scope` + `confirmed` + `directoryPath?`；Main 内 dialog 选文件后调 Core（与 zipImport 编排同构：**确认在 Renderer，选文件在 Main**）。

### 错误接线

| 端 | 接线点 | 要求 |
|----|--------|------|
| Desktop | `App.tsx` | 新增 ConfirmModal `kind`（如 `import-character-card`），确认后走角色卡 IPC |
| Desktop | `shared/ipc-types.ts` | 请求/响应类型（对齐 `VfsZipRequest` 形态 + channel 名） |
| Desktop | IPC handlers | Main handler 调 `import…WithDialog` / Core |
| Desktop | invoke-registry | 注册 Renderer invoke |
| Desktop | `format-ipc-error.ts` | **须**特判 `CharacterCardError`，透出 `err.code` + `message`（勿落成泛化 `Error.name`）。可比现网 `VfsZipError` 分支更严：现网 ZIP 若仅透 `message`，角色卡仍须显式带上 `code` |
| Mobile | `format-error.ts` | 对 `CharacterCardError` **特判**，直接展示 `message`（对齐 `VfsZipError` 分支） |
| CLI | `cli-errors.ts` / 命令 | `formatCliError`（或等价）透出 `CharacterCardError.message`；退出码对齐 ZIP 运行时失败 |

## 最终项目结构

```text
packages/core/src/
  domain/character-card/
    model/character-card.ts
    logic/
      extract-png-chara.ts
      parse-character-card-json.ts
      character-card-to-md-tree.ts
      sanitize-entry-filename.ts
  service/vfs/
    create-character-card-import-service.ts   # createCharacterCardImportService(+ optional testHook)
    impl/
      character-card-import.service.ts        # 或 vfs-subtree-replace + thin wrapper
      vfs-zip-io.service.ts                   # 可选：改用共享 replace 内核
  domain/vfs/logic/
    vfs-subtree-text-replace.ts              # 可选抽出的共享 Phase B
  errors/character-card-errors.ts
  public/vfs.ts                              # re-export 下列符号

packages/core/test/
  character-card/
    extract-png-chara.test.ts
    character-card-to-md-tree.test.ts
    character-card-import.test.ts            # 子树覆盖 / 兄弟保留 / 不确认 / 规则表
    helpers/png-chara-fixture.ts
  package-exports/snapshots/
    public-vfs-allowlist.json                # 须追加本需求导出符号

apps/desktop/
  renderer/features/workspace/workspace-context.ts  # 菜单 + 确认文案（复用 ZIP 覆盖句）
  renderer/App.tsx                                  # confirm kind + Toast
  src/main/services/vfs-character-card.service.ts
  src/main/ipc/format-ipc-error.ts                  # CharacterCardError
  shared/ipc-types.ts / ipc handlers / invoke-registry

apps/mobile/
  src/components/vfs/VfsFileManager.tsx              # Alert 复用 zipImportConfirmCopy 同等句
  src/services/vfs-character-card.service.ts
  src/errors/format-error.ts                        # CharacterCardError 特判

apps/cli/src/
  vfs/commands/import-character-card.ts
  cli-errors.ts                                     # CharacterCardError.message
  + main.ts / project/vfs.ts / session/commands.ts 注册
```

### `public/vfs.ts` 须导出符号

经 `@novel-master/core/vfs`（`packages/core/src/public/vfs.ts`）导出，并**同步更新** `packages/core/test/package-exports/snapshots/public-vfs-allowlist.json`：

| 符号 | 种类 |
|------|------|
| `createCharacterCardImportService` | value |
| `parseCharacterCardToMdTree` | value |
| `characterCardJsonToMdTree` | value |
| `CharacterCardError` | value（class） |
| `CharacterCardErrorCode` | type |
| `CharacterCardImportService` | type |
| `CharacterCardImportOptions` | type |
| `CreateCharacterCardImportServiceOptions` | type（若对外暴露 options） |
| `MdTree`（或实现选用的等价类型名，如 `CharacterCardMdTree`） | type |

## 变更点清单

| 模块 | 变更 |
|------|------|
| Core domain/character-card | 新增 PNG/JSON 解析与 md 树映射 |
| Core CharacterCardImportService | 新增；confirmed + 子树替换 |
| Core `create-character-card-import-service.ts` | factory + 可选 testHook（对齐 zip） |
| Core public/vfs | 导出上表符号；更新 `public-vfs-allowlist.json` |
| Core vfs-zip-io（可选） | 抽共享 `replaceSubtreeWithTextFiles` |
| Desktop | 菜单 / Confirm kind / IPC types / handlers / invoke-registry / format-ipc-error / Main dialog |
| Mobile | 更多菜单 / Alert（覆盖句） / picker / format-error 特判 |
| CLI | `import-character-card` 三域挂载 + cli-errors 透出 message + e2e |
| 测试 | core 单测必过；Desktop 菜单静态测；CLI e2e 对齐 zip |

## 详细实现步骤

- Step 1 — phase-parse-core — blocking: yes — qa: auto：落地 `extract-png-chara` + fixture PNG（IHDR+tEXt chara+IEND），单测能取出 JSON 字符串；iTXt/zTXt-only → `NOT_CHARACTER_CARD`；**输入判别**按「PNG 魔数优先、失败不回退 JSON」落地  
- Step 2 — phase-parse-core — blocking: yes — qa: auto：落地 `parse-character-card-json` / V2 规范化（含 UTF-8 BOM 剥离）；非法输入抛表内 `CharacterCardError` code  
- Step 3 — phase-parse-core — blocking: yes — qa: auto：落地 `character-card-to-md-tree`（角色描述始终；开场合并编号且**三位数字对齐** `开场001`…；世界书命名/`条目{n}` 1-based/`content` 缺失→`""`/keywords **始终写键**；无有效世界书判定）；覆盖 T-C1～T-C6、T-C13、T-C14、T-C16
- Step 4 — phase-import-core — blocking: yes — qa: auto：实现 `createCharacterCardImportService` + `CharacterCardImportService`（共享或复制 ZIP Phase B）；Phase A 路径清单 + **不**调 basename 前缀/`validateVfsZipEntries`；`confirmed:false` / 非法路径不删子树；成功后兄弟保留、目标≡树；**代码路径禁止调用 WorkplaceService**；导出 public API + allowlist 快照  
- Step 5 — phase-desktop — blocking: yes — qa: auto：Desktop 菜单项 + ConfirmModal kind + IPC types/handlers/registry + format-ipc-error（`CharacterCardError` 透出 `err.code`）+ Main 选 png/json（确认→选文件）；菜单测断言 blank/dir 有、file 无  
- Step 6 — phase-mobile — blocking: yes — qa: auto：Mobile 更多菜单 + Alert（`zipImportConfirmCopy` 同等覆盖句，标题「导入角色卡」）+ picker + format-error 特判；关键分支单测或源码契约测（对齐现有 zip 测法）  
- Step 7 — phase-cli — blocking: yes — qa: auto：CLI `import-character-card` 三域挂载；无 `--yes` 失败；有 `--yes` 后目标子树与解析树一致；错误 message 透出  
- Step 8 — phase-desktop — blocking: no — qa: manual_user：Desktop 真机导入样卡 PNG/JSON，确认覆盖与 Toast  
- Step 9 — phase-mobile — blocking: no — qa: manual_user：Mobile 真机导入样卡，确认覆盖与 Toast  

## 测试策略

- **Core 自动**：`npm run test:fast -- packages/core/test/character-card`（或仓库等价路径）。  
- **入口自动**：Desktop `workspace-*-menu` 类测；CLI e2e 仿 `vfs-zip-e2e`。  
- **手工**：Step 8–9；不作为 CI 门禁。

### 测试用例

- T-C1 — blocking: yes — Step 3：仅 `description` → 仅有 `角色描述.md`，无 `开场/`、`世界书/`  
- T-C2 — blocking: yes — Step 3：非空 `first_mes` + 2 条 alternate → `开场/开场001.md`…`开场003.md`，内容顺序正确；第 10 条为 `开场010.md`  
- T-C3 — blocking: yes — Step 3：两条 comment 均为「原神」→ `世界书/原神.md` 与 `世界书/原神-2.md`  
- T-C4 — blocking: yes — Step 3：keys=`["原神","原批"]` → FM **含 `keywords` 键**且列表含二者，正文=content  
- T-C5 — blocking: yes — Step 3：`enabled: false` 条目仍生成文件  
- T-C6 — blocking: yes — Step 1–2：坏 PNG / 非卡 JSON / 仅 iTXt chara → `CharacterCardError`（`NOT_CHARACTER_CARD`），无部分树；**PNG 魔数命中但 chara 失败时不得 JSON 回退成功**  
- T-C7 — blocking: yes — Step 4：目标 `/角色` 有旧文件、同级 `/大纲`；确认导入后 `/角色`≡md 树且 `/大纲` 不变  
- T-C8 — blocking: yes — Step 4：`confirmed:false` → 抛 `NOT_CONFIRMED`，子树不变  
- T-C9 — blocking: yes — Step 4：解析失败路径（`importFromBytes`）→ 子树不变  
- T-C10 — blocking: yes — Step 5：Desktop blank/dir 菜单含「导入角色卡」，文件行不含  
- T-C11 — blocking: yes — Step 7：CLI 无 `--yes` 非 0；有 `--yes` 后 list 路径集合正确  
- T-C12 — blocking: no — Step 8–9：真机 PNG+JSON 各一次成功 Toast「已导入角色卡」  
- T-C13 — blocking: yes — Step 3：某条目 `comment` 与 `keys` 皆空，且位于 `entries[2]`（0-based）→ 文件名为 `世界书/条目3.md`（1-based 下标）  
- T-C14 — blocking: yes — Step 3：条目无 `keys` / 空 keys → FM **仍含** `keywords: []`；`content` 缺失 → 正文为 `""`  
- T-C15 — blocking: yes — Step 4：导入前写入可识别的 workplace 规则快照（或等价行）；确认导入成功后规则表**未被清理/重写**（与 ZIP「不管规则表」一致）。实现约束：角色卡导入代码路径**禁止调用** `WorkplaceService`  
- T-C16 — blocking: yes — Step 1–4：fixture PNG bytes（合法 IHDR+tEXt chara+IEND）分别经 `parseCharacterCardToMdTree` 与 `importFromBytes`（`confirmed:true`）成功得到 md 树 / 落盘子树；**防 JSON-first 回归**（若实现先按 JSON 解码再试 PNG，本用例必须失败）

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 合成树误用 ZIP basename 前缀校验导致合法导入失败 | Phase A 用上文路径清单 + `assertLogicalPathAllowed`；**禁止**调用 `assertZipEntriesNotDomainRootPrefixed` / `validateVfsZipEntries` | — |
| Phase B 与 ZIP 双份实现漂移 | 优先抽共享内核；至少 T-C7/T-C8 与 ZIP T-Z3/T-Z4 对称 | 删除角色卡入口与 service，保留 ZIP |
| Mobile MIME 不准 | 扩展名断言（仿 YAML） | — |
| V1/V3 卡形态差异 | 本期：能抽出 description/开场/世界书则导入；否则 `UNSUPPORTED_SPEC`/`NOT_CHARACTER_CARD` | 文档写明仅 V2 优先 |
| workplace 残留规则 | 与 ZIP 一致，不修；T-C15 验收「未清理/重写」 | — |
| Mobile 确认文案丢覆盖语义 | Alert 正文复用 `zipImportConfirmCopy` 同等句，仅改标题 | — |

**回滚**：移除三端菜单/命令与 IPC；删除 `character-card` 模块与导出；不迁移数据（导入结果为普通 md，可留可删）。

## Context Bundle

```yaml
iteration_name: character-card-import
requirement_path: Iterations/character-card-import/prd.md
spec_path: Iterations/character-card-import/spec.md
explore_summary: >
  写入对齐 ZIP 子树 Phase A/B（勿 batch）；解析新建 domain/character-card；
  Uint8Array 先 PNG 魔数再 JSON（PNG 失败不回退）；流水线先确认再选文件；
  三端并列导入入口；FM 始终写 keywords；仅 tEXt；factory + public/vfs 导出 + allowlist；
  错误接线 Desktop（须透 code）/Mobile/CLI。
impact_files:
  - packages/core/src/domain/character-card/**
  - packages/core/src/service/vfs/create-character-card-import-service.ts
  - packages/core/src/service/vfs/impl/character-card-import.service.ts
  - packages/core/src/errors/character-card-errors.ts
  - packages/core/src/public/vfs.ts
  - packages/core/test/package-exports/snapshots/public-vfs-allowlist.json
  - apps/desktop/renderer/features/workspace/workspace-context.ts
  - apps/desktop/renderer/App.tsx
  - apps/desktop/src/main/services/vfs-character-card.service.ts
  - apps/desktop/src/main/ipc/format-ipc-error.ts
  - apps/desktop/shared/ipc-types.ts
  - apps/desktop/**/invoke-registry*
  - apps/desktop/**/handlers/**
  - apps/mobile/src/components/vfs/VfsFileManager.tsx
  - apps/mobile/src/services/vfs-character-card.service.ts
  - apps/mobile/src/errors/format-error.ts
  - apps/cli/src/vfs/commands/import-character-card.ts
  - apps/cli/src/cli-errors.ts
constraints:
  - confirm then pick file then importFromBytes (parse before delete)
  - confirmed gate + deleteVfsPrefix subtree only
  - no workplace rule mutation / no WorkplaceService on import path
  - no assertZipEntriesNotDomainRootPrefixed / no validateVfsZipEntries on synthetic tree
  - no batch ingest for wipe semantics
  - Uint8Array sniff: PNG magic first then JSON; PNG fail no JSON fallback
  - PNG tEXt only; keywords key always written; entry content missing => ""
  - no valid worldbook <=> entries not array or length 0; skip non-object entries
  - Desktop format-ipc-error must surface CharacterCardError.code
blocking_steps:
  - phase-parse-core
  - phase-import-core
  - phase-desktop
  - phase-mobile
  - phase-cli
```
