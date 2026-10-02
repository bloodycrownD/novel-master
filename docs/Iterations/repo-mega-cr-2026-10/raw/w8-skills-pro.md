---
zone: w8-skills-pro
agent: 检察官（对抗机位）
files_scanned: 26
---

## 摘要

技能域（SKILL.md + 附属文件的 meta 域目录树）负责双端技能的新建/编辑/启停/重命名/删除与 ZIP 导入导出；
角色卡域负责把 SillyTavern PNG/JSON 归一成 md 树；VFS ZIP 导入链是两者共同的落盘通道
（confirmed 门闸 → 解析 → 路径/体积校验 → 单事务子树替换）。本机位立场：冗余 / 死路径 / 安全面。

## 职责与边界

- `domain/skills/`：纯逻辑层——路径合成（`skill-paths`）、front matter 解析与重写、
  技能名字符集、合并视图纯函数、ZIP 预检、负清单 repository。
- `service/skills/`：应用服务——两域清单/读/写/edit/启停/重命名/删除，
  经 `ScopedVfsService` 落 `vfs_entry`，负清单落 `skill_disabled_rule`。
- `domain/character-card/`：角色卡 JSON/PNG → 相对路径 md 树的归一化与三道体积闸。
- `service/vfs/impl/vfs-zip-io.service.ts` + `character-card-import.service.ts`：
  两条结构近乎同构的导入服务（同款 confirmed 门闸 / Phase A 校验 / Phase B 子树替换 /
  dir-rule 补行 / session 缓存对齐）。

## 对外接口

| 符号 | 位置 | 说明 |
|---|---|---|
| `SkillService` | `service/skills/skills.port.ts:71` | 10 方法端口，含 `assertSkillNameNotReservedForCreate` |
| `computeEffectiveSkills` | `domain/skills/logic/effective-skills.ts:58` | 合并视图纯函数 |
| `parseSkillFrontMatter` / `withSkillFrontMatterValues` | 同目录 | 解析 / 重写单源 |
| `previewSkillZip` | `domain/skills/logic/preview-skill-zip.ts:34` | 技能 ZIP 只读预检 |
| `validateSkillName` / `isValidSkillName` / `SKILL_NAME_PATTERN` | `domain/skills/model/skill-name.ts` | 名字符集单源 |
| `VfsZipIoService` | `domain/vfs/ports/vfs-zip-io.port.ts:24` | export / import |
| `CharacterCardImportService` | `domain/vfs/ports/character-card-import.port.ts:20` | import / importFromBytes |
| `CHARACTER_CARD_MAX_*` | `domain/character-card/logic/character-card-limits.ts:16-25` | 48MB 输入 / 32MB 总量 / 8MB 单文件 / 5000 条目 |

## 数据访问

| 表 / 域 | 位置 |
|---|---|
| `vfs_entry`（`global:meta` / `project:{pid}:meta`，逻辑前缀 `/meta/skills/`） | `service/skills/impl/skills.service.ts:370`（write）、`:203`（delete） |
| `vfs_revision` / `vfs_content_blob` | 经 `sweepRevisionsUnderScope`（`skills.service.ts:440`）、`insertFileSeedingRevision`（`vfs-zip-io.service.ts:214`） |
| `skill_disabled_rule`（`scope_key='project:{pid}'`） | `domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.ts:28-114` |
| `workplace_dir_rule`（导入事务内补行） | `service/vfs/logic/ensure-import-dir-rules.ts:100-126` |
| KKV `rule_snapshot` / `file_cache`（导入提交后清） | `service/vfs/impl/vfs-zip-io.service.ts:258`、`character-card-import.service.ts:196` |
| `chat_message` + checkpoint 基线回填（session scope） | `vfs-zip-io.service.ts:233-243`、`character-card-import.service.ts:171-181` |

## 依赖关系

**import（谁依赖本区）**：`@novel-master/core/skills` / `/vfs` 两个子路径 barrel
（`public/skills.ts`、`public/vfs.ts`）→ desktop `ipc/handlers/skills.ts` + `handlers/vfs.ts` +
`features/skills/NewSkillModal.tsx` + `features/settings/SkillsManageView.tsx`；
mobile `components/skills/NewSkillModal.tsx` + `services/vfs-zip.service.ts` +
`services/vfs-character-card.service.ts`；core 内 `domain/tool/builtin/skill-tool.ts`（LLM 工具）、
`domain/tool/logic/fs-command-classify.ts`（pathTail 键）、`service/agent/logic/run-agent-turn.ts`、
`domain/chat/logic/prepare-user-messages-for-prompt.ts:593`、`bootstrap/skills/seed-builtin-skills.ts`、
`service/chat/impl/project.service.ts:182/279`（项目删/拷贝携带负清单）。

**被依赖（本区 import 谁）**：`domain/vfs/logic/*`（path-mapper / zip-* / vfs-tree-copy）、
`domain/workplace/logic/workplace-scope.ts`、`infra/tdbc`、`errors/skill-errors` / `vfs-zip-errors` /
`character-card-errors`。

---

## 发现清单

### F-w8-skills-pro-1 | P1 | `domain/vfs/logic/vfs-zip-parse.ts:41` + `domain/vfs/logic/vfs-zip-central-dir.ts:224` + `service/vfs/impl/vfs-zip-io.service.ts:189-192`

```ts
// vfs-zip-io.service.ts:189-192
const rawEntries = parseVfsZip(zipBytes);           // ← 全量解压在此发生
const { files, directories } = validateVfsZipEntries(scope, rawEntries, directoryPath);
```

**描述**：解压闸门在解压**之后**。`parseZipCentralDirectory` 逐条 `readLocalEntryData` → `decompressEntryData`
（`vfs-zip-central-dir.ts:85-115`）把每条 `inflateSync` 的结果塞进 `entries[]` 数组整体返回，全程无累计量。
三道闸 `VFS_ZIP_MAX_UNCOMPRESSED_BYTES=32MB` / `MAX_ENTRY_COUNT=5000` / `MAX_ENTRY_PATH_LEN=512`
（`vfs-zip-validate.ts:17-19`）在 `validateVfsZipEntries` 里才生效，此时解压已完成。
`uncompressedSize` 由归档作者填（`central-dir.ts:199`），仅在 `!== 0xffffffff` 时不触发 ZIP64 拒收
（`:205-207`），**不是可信上限**；`totalEntries` 是 uint16，最多 65535 条全部留在数组里。
fflate 回退分支（`vfs-zip-parse.ts:23-36`）同样无闸。

**影响**：几百 KB 的恶意 zip 可让 `inflateSync` 分配 GB 级——移动端（Hermes，堆受限）
是原生 OOM，`character-card-limits.ts:4-6` 整篇论证的正是这类 OOM 会「杀进程、try/catch 拦不住」。

**建议**：在 `parseZipCentralDirectory` 循环内累计 `uncompressedSize` 与条目数，越 `VFS_ZIP_MAX_*`
立即抛 `PAYLOAD_TOO_LARGE`；或改成先只读中央目录（不取 data）过闸，再第二遍解压。
注意这是与 ledger `CS-09` 同一病灶的**独立复核**（本机位未读 synth/raw，从代码顺序直接判定），
但本条给出了 `totalEntries` uint16 上界与 `uncompressedSize` 不可信这两点额外论据。

**置信**：confirmed

---

### F-w8-skills-pro-2 | P1 | `domain/skills/logic/preview-skill-zip.ts:35`

```ts
const entries = parseVfsZip(zipBytes);
```

**描述**：技能 ZIP 预检走的是**同一个无闸解压器**，且它比导入链更早、更没有后续校验。
`previewSkillZip` 只读地调 `parseVfsZip` 拿 `SKILL.md`，既不查 `VFS_ZIP_MAX_UNCOMPRESSED_BYTES`
也不查 `MAX_ENTRY_COUNT`（`fileCount` 只是数了一下）。

**调用点（双端都在 renderer / UI 线程）**：
`apps/desktop/renderer/features/skills/NewSkillModal.tsx:101`（`previewSkillZip(pickRes.data)`，
注释明写「预检（previewSkillZip）在 Renderer」）、
`apps/mobile/src/components/skills/NewSkillModal.tsx:156`。

**影响**：用户在「新建技能」弹窗点「从 ZIP 导入…」，主进程 IPC 边界之后**没有 32MB 闸**，
炸弹直接在 renderer 进程炸——比主进程炸更难恢复（整窗白屏）。这条比 F-1 更窄也更尖：
用户不需要真的提交，只要选个文件。

**建议**：`previewSkillZip` 内先按 `zipBytes.length` 与解析出的条目数/累计解压量过闸再取 `SKILL.md`；
或让预检改走 `validateVfsZipEntries`（它已经是纯函数，不写库）。

**置信**：confirmed

---

### F-w8-skills-pro-3 | P1 | `domain/skills/model/skill-name.ts:17` + `domain/skills/logic/skill-paths.ts:44-52` + `service/vfs/impl/vfs-zip-io.service.ts:186`

```ts
// skill-name.ts:17 —— 反斜杠不在字符集内
export const SKILL_NAME_PATTERN_SOURCE = "[^\\s/.][^\\s/]*";
```

**描述**：技能名字符集只排除了空白、`/`、前导 `.`，**没排 `\`**。而两条落盘通道对 `\` 的处置不一致：

- **write/edit 通道**（`skill-paths.ts:48`）走 `resolveLogicalPath` → `normalizePath`，
  后者 `path.replace(/\\/g, "/")`（`normalize-path.ts:19`）把 `\` 折成 `/`，
  于是 `/meta/skills/x\..\agent-config/SKILL.md` 归一为 `/meta/skills/agent-config/SKILL.md`，
  **不等于** `dirPrefix` → 命中 `:49-51` 的 escape 拒绝。安全。
- **ZIP 导入通道**（`NewSkillModal.tsx:168` / mobile `:207` 拼 `` `/meta/skills/${name}` ``）
  只过 `resolveZipDirectoryPath`（`vfs-zip-path.ts:14-19`），**没有 escape 复核**。
  同一技能名 `x\..\agent-config` 在这条通道上归一为 `/meta/skills/agent-config`。

**实测**（本机位跑临时脚本复刻两函数后删除，脚本未入库）：

```
{"name":"x\..\agent-config","nameOk":true,"writeChannel":"escape","zipImportTarget":"/meta/skills/agent-config"}
{"name":"a\..\..\..\x",     "nameOk":true,"writeChannel":"escape","zipImportTarget":"/x"}
```

**影响**：`BUILTIN_SKILL_NAMES` 只含 `agent-config`，`x\..\agent-config` 不在名单内，
所以 `assertSkillNameNotReservedForCreate`（`skills.service.ts:617`）直接 return 放行；
ZIP 导入随后 `releaseAndDeleteVfsPrefix(sk, "/meta/skills/agent-config")`
（`vfs-zip-io.service.ts:203`）**整棵删掉内置技能**再写 zip 内容。`a\..\..\..\x` 更能写到
`/x`——脱离 `/meta/skills/` 根。触发只需用户在新建弹窗的技能名框里输入一个带 `\` 的名字
（`isValidSkillNameInput` 用同一个 pattern，`skill-ui.ts:41-43`，同样放行）。

**建议**：两处之一——(a) `SKILL_NAME_PATTERN_SOURCE` 增排 `\\`（`[^\\s/.\\\\][^\\s/\\\\]*`），
让两条通道从源头对齐；(b) ZIP 导入目标路径复用 `resolveSkillRelPathCore` 的 escape 复核，
而不是各自拼字符串。推荐 (a)+(b) 都做：(a) 堵新入口，(b) 堵未来绕过 UI 直调 IPC 的路
（`handleVfsZipImportBytes` 收 renderer 任意 `directoryPath`，`vfs.ts:351-367`）。

**置信**：confirmed

---

### F-w8-skills-pro-4 | P2 | `domain/character-card/logic/sanitize-entry-filename.ts:13-23` + `domain/character-card/logic/validate-md-tree-paths.ts:42-47`

```ts
// sanitize-entry-filename.ts —— 无长度截断
const replaced = raw.replace(ILLEGAL_CHARS, "_");
let trimmed = replaced.trim();
```

**描述**：世界书条目基名清洗只做非法字符替换 + 首尾点号剥离，**不截断长度**。
下游 `assertMdTreeRelativePathAllowed` 用 `VFS_ZIP_MAX_ENTRY_PATH_LEN = 512` 硬拒
（`validate-md-tree-paths.ts:42-47`），而 `validateMdTreeForImport` 是**整树 fail-fast**：
任一条目超长 → 整张卡片导入失败（`character-card-import.service.ts:134` 抛，早于任何写库，
所以无脏数据，但用户拿不到任何内容）。

**实测**：600 字的中文世界书标题 → 清洗后 600 字 → 相对路径 `世界书/xxx.md` 607 字符 > 512 → 整卡拒。

**影响**：单个超长标题让整张卡不可导入，错误文案还是「md tree path exceeds 512 characters: <600字>」，
用户无从判断是自己哪个标题的问题。角色卡标题超长在真实数据里不罕见（模型生成的长 description）。

**建议**：`sanitizeEntryFilename` 出口按剩余预算截断（基名留 480 字给 `.md` 与 `世界书/` 前缀），
或 `validateMdTreeForImport` 改为「跳过并 warn 单条超长条目」而非整树拒——后者要产品拍板
（静默丢内容 vs 明确报错）。

**置信**：confirmed

---

### F-w8-skills-pro-5 | P2 | `domain/vfs/logic/vfs-zip-validate.ts:55`

```ts
if (entryName.includes("..")) {
  throw vfsZipError("INVALID_PATH", `parent segment in ZIP entry: ${entryName}`);
}
```

**描述**：`..` 判定用的是**子串包含**，不是路径段判定。同区的角色卡校验走的是正确的段判定
（`validate-md-tree-paths.ts:55-68`：`segments.some(s => s === "..")`）——同一件事两套口径。

**实测**（复刻判定函数）：

```
{"n":"a..b.md",       "r":"INVALID_PATH parent segment"}   ← 合法文件名被拒
{"n":"v1..2/notes.md","r":"INVALID_PATH parent segment"}   ← 合法文件名被拒
{"n":"报告..最终.md",  "r":"INVALID_PATH parent segment"}   ← 合法文件名被拒
{"n":"..hidden.md",   "r":"INVALID_PATH parent segment"}   ← 段判定下是合法的
```

**影响**：假阳性——本产品导出格式（`buildVfsZip`，`level: 0`）产出的 zip 只要含这类名字就**导得进、导不回**。
用户自建 `notes..bak.md`、`2024..2025 总结.md` 这类命名很常见，导出成功、导入报「parent segment」，
且错误文案把它说成路径穿越，误导排查方向。

**建议**：改成段判定（与 `assertMdTreeRelativePathAllowed` 同款），或直接复用它——
两处逻辑本就该是同一个函数。

**置信**：confirmed

---

### F-w8-skills-pro-6 | P2 | `domain/skills/logic/effective-skills.ts:73`

```ts
const overridden =
  s.domain === "project" && input.global.some((g) => g.name === s.name);
```

**描述**：`overridden` 在 `.map()` 里对每条 project 技能全量扫 `input.global`。
`merged` 已在 `:63-67` 用 `projectNames` 剔除了被覆盖的 global 条目，所以判定所需信息
在 `projectNames` 这个 Set 里已经有了——`overridden` 完全可以复用它，复杂度从 O(n·m) 降到 O(n)。

**次生**：`overridden` 的语义只在 project 条目为真，而 global 同名副本此时**已不在结果里**
（`:65` 过滤掉），所以「project 覆盖 global」这件事在输出中只能通过 project 条目的
`overridden=true` 单侧表达。文档注释（`:56-57`）说清了「global 原件不出现在结果里」，口径自洽，
但 UI 侧拿到的是一个单向信号——这条只是提醒，不是缺陷。

**建议**：`const overridden = s.domain === "project" && projectNames.has(s.name);`，
`projectNames` 提到 `.map()` 外层闭包。

**置信**：confirmed

---

### F-w8-skills-pro-7 | P2 | `service/skills/impl/skills.service.ts:260-262` + `:268-300`

```ts
for (const [name, files] of filesBySkill) {
  items.push(await this.summarizeSkill(vfs, domain, name, files));
}
```

**描述**：`listSkills` 对每个技能**串行**发一次 `vfs.read` 读 SKILL.md（`summarizeSkill:276`）。
`effectiveSkills`（`:302-309`）又调 `listSkills` 两次（global + project），于是
**每次技能清单查询 = 2 次全树 list + 2N 次串行 read**。
而调用方密度很高：`prepare-user-messages-for-prompt.ts:593`（每轮 prepare）、
`run-agent-turn.ts:192`（每次 agent run）、`skill-tool.ts:505`（模型每次 `skill list`）。

**影响**：技能数 N 上百时，每轮 prepare 多出上百次串行 SQLite 往返。这是热路径上的 N+1。

**建议**：`listSkills` 改批量——`scanContents(SKILLS_ROOT, {recursive:true})` 一次拿全树
（`sqlite-vfs-entry.repository` 已有该方法，`export` 路径在用：`vfs-zip-io.service.ts:139`），
在内存里按首个 `/` 切分出 name → SKILL.md 内容；`files` 列表从 `listEntriesUnderPrefix` 一次取。
两个 `listSkills` 也可 `Promise.all` 并行（`effectiveSkills:303-307` 已经是并行的，
但内部各自串行）。

**置信**：confirmed

---

### F-w8-skills-pro-8 | P2 | `service/vfs/impl/character-card-import.service.ts:49-84` vs `service/vfs/impl/vfs-zip-io.service.ts:50-103`

**描述**：两个导入服务的 `ensureEmptyDirectoryRow` / `assertDirectoryPathNotFile` /
`relativeUnderPhysicalPrefix` 是**逐行同构复制**（只差错误类型与占位符名
`__vfs_card_placeholder` vs `__vfs_zip_placeholder`）。此外整条 import 事务骨架
（Phase A → 事务 → `releaseAndDeleteVfsPrefix` → 逐条 `ensureParentDirectories` +
`insertFileSeedingRevision` → `ensureImportDirRules` → session `backfillBaselineCheckpoints`
→ 提交后 `clearSessionPromptCaches`）也是同一套抄了两遍，两个文件共 486 行、结构近乎逐行对应。

**影响**：安全相关的闸（`confirmed` 门、目录行-文件行冲突检测、事务边界）在两处独立演化。
本轮就找到一处已发生的分叉：`vfs-zip-io.service.ts:249` 用
`error.name === "VfsZipError"` 做 instanceof 替代（跨模块实例安全），
而 `character-card-import.service.ts:187` 用 `error instanceof CharacterCardError`——
同一意图两种写法，后者对重复打包的 core 实例会失效。

**建议**：抽 `service/vfs/logic/import-subtree.ts`，导出
`importSubtreeReplacing({ conn, scope, directoryPath, files, backfillBaseline, sessionKkv })`，
两服务只保留各自的 Phase A 校验与错误类型映射。顺带把 instanceof 判定统一。

**置信**：confirmed

---

### F-w8-skills-pro-9 | P2 | `domain/vfs/logic/vfs-zip-path.ts:71, 95, 125`

```ts
export function zipDirectoryEntryNameFromLogical(logical: string): string {   // :71  零引用
export function logicalFromZipEntryName(entryName: string): string {          // :95  仅 :130 内部用
export function logicalFromZipDirectoryEntryName(entryName: string): string { // :125 零引用
```

**描述**：`zipDirectoryEntryNameFromLogical` 与 `logicalFromZipDirectoryEntryName` 全仓零引用
（`findstr /s` 扫 `packages/core/src` + `test` + apps 双向确认，只有定义行本身）。
`logicalFromZipEntryName` 也只被同文件 `:130` 的死函数调用，是**死代码簇**。
三个都在 `vfs-zip-path.ts` 里，与实际在用的 `*RelativeToDirectory` 系列（`:48/:78/:106/:136`）
构成两套并行 API——在用的那套带 `directoryPath` 相对化，死的这套不带，正是被相对化版本取代的旧形态。

**建议**：删三个（连带 `logicalFromZipEntryName`）。它们是 `assertZipEntriesNotDomainRootPrefixed`
等新逻辑上线前的遗留，knip 若接上（`knip.json` 已配但 `package.json:16-34` 无 `knip` script，
当前跑不起来）本应自动报出来。

**置信**：confirmed

---

### F-w8-skills-pro-10 | P3 | `domain/skills/model/skill-name.ts:53` + `errors/vfs-zip-errors.ts:15` + `domain/character-card/logic/parse-character-card-json.ts:15`

**描述**：三处「导出即无人使用」：
- `isValidSkillName`（`skill-name.ts:53`）只在 `public/skills.ts:43` 转出，仓内零调用
  （desktop 用 `isValidSkillNameInput` 自己拼 pattern，mobile 用 `validateSkillName`）。
- `VfsZipErrorCode` 的 `"EXTERNAL_NOT_SUPPORTED"`（`vfs-zip-errors.ts:15`）全仓无抛出点，
  也无测试断言。
- `stripUtf8BomText`（`parse-character-card-json.ts:15`）虽被同文件 `:28` 用，
  但 `export` 无外部消费者。

**建议**：`isValidSkillName` 与 `stripUtf8BomText` 降为模块私有（去掉 `export`）；
`EXTERNAL_NOT_SUPPORTED` 从联合类型删除，或补上它本该服务的「外部符号链接/挂载点」分支实现。

**置信**：confirmed

---

### F-w8-skills-pro-11 | P3 | `service/skills/impl/skills.service.ts:302-309` vs `:411-414`

```ts
// :306 —— 硬编码字面量
this.disabledRules.listDisabledNames(`project:${projectId}`),
// :409 —— 走 helper
const scopeKey = disabledScopeKeyOfProject(projectId);
```

**描述**：`disabledScopeKeyOfProject`（`:111-113`）的注释明写这个 scopeKey「语义固定为
`project:{pid}`（setDisabled / effectiveSkills / 项目删除的 removeScope 同源），与 VFS 重定位到
meta 域无关，**不得跟随改写**」——正是为了防漂移才抽的 helper。但同一个字面量在
`effectiveSkills:306` 又手写了一遍。四处同源点（`setDisabled` / `effectiveSkills` /
`project.service.ts:182` / `project.service.ts:279`）里只有一处没走 helper。

**影响**：当前无 bug（值相同），但 helper 存在的全部意义就是消掉这个漂移点，
现在它自己就是漂移点之一。

**建议**：`effectiveSkills:306` 改用 `disabledScopeKeyOfProject(projectId)`。

**置信**：confirmed

---

### F-w8-skills-pro-12 | P3 | `domain/skills/logic/effective-skills.ts:42-49`

```ts
function normalizeDisabled(disabled) {
  if (disabled == null) return new Set();
  return disabled instanceof Set ? new Set(disabled) : new Set(disabled);
}
```

**描述**：三元表达式两个分支**完全相同**（都是 `new Set(disabled)`）。
`Set` 构造本就接受 iterable，`new Set(array)` 与 `new Set(set)` 等价，这个分支判断没有任何作用。
从代码形态看像是早期想区分「拷贝 Set」与「转 Set」后来发现不需要，或 merge 时留下了残骸。

**建议**：删掉三元，直接 `return new Set(disabled)`。

**置信**：confirmed

---

### F-w8-skills-pro-13 | P3 | `domain/character-card/logic/extract-png-chara.ts:66-99`

**描述**：PNG chunk 扫描循环用 `offset + 12 <= bytes.length` 控边界，
`length` 是 `readUInt32BE` 的无符号 32 位值（`:35-42`，`>>> 0` 保证非负），
`:72` 的 `length < 0` 判空因此是**恒假死条件**。真正生效的是 `crcEnd > bytes.length`。
无实际影响（`length` 恒非负），但它是防御性代码里的一处自我误导——读代码的人会以为
这里防了负长度，实际防不了。

**建议**：删 `|| length < 0`，或改成 `length < 0` → 由 `readUInt32BE` 改用可失败签名
（当前 `>>> 0` 已吞掉符号位，改签名是过度设计，直接删条件更合适）。

**置信**：confirmed

---

### F-w8-skills-pro-14 | P3 | `domain/vfs/logic/vfs-zip-validate.ts:104-115`

```ts
const decoded = new TextDecoder("utf-8").decode(payload);
const roundTrip = new TextEncoder().encode(decoded);
if (!bytesEqual(payload, roundTrip)) { throw vfsZipError("INVALID_UTF8", ...); }
```

**描述**：UTF-8 合法性用「往返编码比对」判定（注释说为了 Hermes 与 Node 行为一致，
不用 `fatal: true`）。这个选择本身是对的（`:101-103` 有解释），但**代价没被计价**：
每个 entry 都要额外分配一份与正文等大的 `Uint8Array`。32MB 上限下，单条 entry 峰值内存
是 `payload` + `decoded`(string，UTF-16 时 2×) + `roundTrip`，最坏约 4× 压缩后体积。
叠加 F-1 的「解压已完成」，这是同一条内存放大链上的第三个乘数。

**建议**：不动判定方式（RULE 与注释都表明这是有意选择），但在 F-1 的「中央目录内累计闸」
落地后此处峰值可控；本条仅作为 F-1 修方案的复杂度输入记录，不单独开工。

**置信**：confirmed

---

## 争议与存疑

1. **F-3 的严重度定级存疑（我给 P1，主代理可能判 P2）**。F-3 需要用户在技能名框里输入带 `\` 的名字，
   不是纯外部输入（无网络/无自动触发的 zip 通道），触发者就是用户自己。
   判 P1 的理由是**后果不可逆**：`releaseAndDeleteVfsPrefix` 会整棵删掉内置 `agent-config`，
   而该技能按 `seed-builtin-skills.ts:179` 的台账快路径**不会自动重种**（`applied >= 3` 即 return），
   用户不手工改台账版本号就再也拿不回来。判 P2 的理由是触发需要主观构造。
   两个理由我都摆在正文，请主代理裁决。

2. **F-1 与 ledger `CS-09` 是否重复计票**。我读代码独立得出同一结论（解压在 `vfs-zip-io.service.ts:189`、
   闸在 `:191`，顺序确凿），但 ledger 已有 `CS-09` 收录同一病灶、且标注 W6 confirmed。
   本机位纪律禁读 `synth/` 与 `raw/`，我确实没读；`ledger.md` 是允许读的 L3 层。
   若 reduce 阶段按 ID 去重，F-1 应标为「CS-09 的独立复核 + 补充论据」而非新条目。
   **但 F-2（`preview-skill-zip.ts:35`）我判断应当单独立项**——status.md 的 core-skills 条目
   把它描述为独立发现，说明 L3 侧可能已把它并入 CS-09；若真被合并，需确认合并后 fix-spec
   覆盖的是 `vfs-zip-io.service.ts` 主链还是也含 `previewSkillZip` 这个**零闸次生入口**。

3. **F-4 该不该静默丢条目，我没拍**。`validateMdTreeForImport` 现在是整树 fail-fast，
   改成「跳过超长条目 + warn」体验更好但会静默丢用户数据；保持整树拒则用户拿不到任何内容。
   这是产品取舍不是技术取舍，我只给两个选项，不选。

4. **F-7 的 N+1 是否已在别处被缓存抵消**。我只确认了 `effectiveSkills` 的四个调用点都是裸调
   （`prepare-user-messages-for-prompt.ts:593` 那里有 `skillNames` 惰性 Promise 缓存，
   但**只缓存本轮内的去重结果集**，不缓存 `effectiveSkills` 本身，且仅在 skillAttach 存在性判定命中时触发）。
   `run-agent-turn.ts:192` 是否有跨 run 缓存我没展开读（超出本 zone 边界），若上层另有缓存，
   F-7 的实际收益要打折。**建议 reduce 阶段找 `run-agent-turn` 机位核实一次再定级。**

5. **ZIP 导入目标路径不经 escape 复核，是否还有第三条通道**。我只查了技能新建弹窗
   （desktop `NewSkillModal.tsx:168` / mobile `:207`）这一处拼 `` `/meta/skills/${name}` `` 的地方。
   `handlers/vfs.ts:351-367` 的 `handleVfsZipImportBytes` 收 renderer 任意 `directoryPath`，
   意味着**任何** renderer 侧调用方都能指定目标目录——这本身是 IPC 设计（renderer 是可信面），
   不算漏洞，但意味着 F-3 的修复不能只补 UI 校验，必须落在 core 的路径解析层。这点我写进 F-3 建议了。

---

## RULE 拍板项（标 intentional，不计入问题）

- **保留名门**（`skills.service.ts:364, 422, 496, 617`）：`docs/apm/RULE.md:29` 明写
  「global 域新建/导入同名会撞保留名门（`assertSkillNameNotReservedForCreate`，中文报错，
  ZIP 导入落盘前同样过门）」，且 `seed-builtin-skills.ts:10-16` 论证了「内置名是不可删/不可同名新建的
  官方资产」。**intentional**。注意 F-3 攻击的是这扇门的**字符集前置条件**（`\` 未被排除），
  不是否定门的设计——门本身按设计工作，是它的输入校验有缺口。
- **last-write-wins**（`skills.service.ts:368` 注释「版本比对已从 VFS 底层移除：last-write-wins」）：
  `RULE.md:83`「VFS write/edit/skill 工具的并发语义（无锁，pathTail 同路径串行化为唯一保护层）…用户
  2026-09-06 拍板全拆（60af90b）」。**intentional**，不报。
- **pathTail 串行化 + 其两处盲区**（`domain/tool/logic/fs-command-classify.ts:56-63, 86-98`）：
  `RULE.md:83` 明写「pathTail 以原始键比对（`a.md` vs `/a.md` 互不串行）且跨不了 runner 实例」
  为**拍板接受**的已知盲区。**intentional**，不报。本 zone 只确认 `skill` 工具名确实在
  `classifyMutatingToolCall:128-130` 的名单里，合成键 `skill:{domain}:{逻辑路径}` 与
  `skill-paths.ts` 单源一致——实现与拍板相符。
- **import 缓存对齐的 try/catch 口径**（`RULE.md:17`「导入走 helper 整体 try/catch 吞错 +
  console.warn…置位/压缩裸 await」）：`vfs-zip-io.service.ts:258-260` 与
  `character-card-import.service.ts:196-198` 都是提交后 best-effort，**intentional**，与拍板一致。
- **`ensureImportDirRules` 事务内吞错**（`ensure-import-dir-rules.ts:9-13` 依赖
  「SQLite 语句级失败不自动 ROLLBACK」，由 T-I5 故障注入用例守卫）：注释已把风险与守卫写明，
  **intentional**，不报。
- **无效技能 front matter 不重写**（`skills.service.ts:554-556`「解析成功才重写，invalid 跳过，
  避免改名顺手『治好』无效技能的行为歧义」）：**intentional**，是显式产品取舍。
- **global 重命名的负清单孤儿边界**（`skills.service.ts:577-580`「已知边界（文档化不处理）：
  global X 与 project P 的 X 并存且 (P,X) 被禁用时改 global X 名，(P,X) 一并迁移但 P 实际生效的
  是本地副本 X，行成孤儿；低频组合接受」）：已文档化的已知边界，**intentional**，不报。
- **meta 域不走 `validateVfsEntryName`**（`validate-entry-name.ts:28-29`「导入链路（zip/角色卡）
  不走本校验（外部文件名可先导入再用改名功能纠正）」）：**intentional**，有注释交代。
