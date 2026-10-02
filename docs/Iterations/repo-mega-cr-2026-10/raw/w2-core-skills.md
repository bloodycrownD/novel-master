---
zone: core-skills
agent: domain-survey
files_scanned: 18
scan_base: feat/repo-mega-cr @ worktree D:\Dev\nm-worktree\mcr
---

## 摘要

两块相邻的纯领域逻辑。`skills/` 管「SKILL.md + 附属文件」技能目录的口径：meta 域路径合成
（`/meta/skills/{name}/`）、技能名字符集与保留名、front matter 解析与重写、global ∪ project
合并视图、ZIP 预检、负清单表读写。`character-card/` 管角色卡导入：PNG `tEXt/chara` 提取、V2/扁平
JSON 规范化 → Markdown 树合成、路径与体积三闸门。两个域都不做 IO（repository 除外），是纯函数层。

## 职责与边界

**skills 域内部分层**

- `model/skill-name.ts` — 技能名字符集单源（新建校验 / `$` token 正则 / `$` 扫描三处共用）。
- `model/skill.schema.ts` — front matter zod strict schema + `SkillSummary` / `SkillRef` 领域类型。
- `logic/skill-paths.ts` — **路径合成单源**（RULE 2026-09-28 抽出）：`SKILLS_ROOT` / `SKILL_ENTRY_FILE` /
  `resolveSkillRelPathCore`。被 service 层（错误包装）与 tool 层（pathTail 串行化分类器）共用。
- `logic/parse-skill-front-matter.ts` — 解析不抛错，产出 `valid` + `invalidReason`（无效技能保留在清单里可修复）。
- `logic/with-skill-front-matter-values.ts` — 按提交值重写 name/description 行，保留其余键与正文。
- `logic/effective-skills.ts` — 合并视图纯函数（同名 project 覆盖 global、负清单过滤）。
- `logic/preview-skill-zip.ts` — ZIP 字节 → SKILL.md 元数据（只读预览，不落盘）。
- `repositories/` — `skill_disabled_rule` 表的端口 + SQLite 实现。

**character-card 域内部分层**

- `model/character-card.ts` — `MdTree`（相对路径 → content 的 ReadonlyMap）+ 规范化字段类型。
- `logic/extract-png-chara.ts` — 手写 PNG chunk 扫描取 `tEXt/chara` base64（**仅 tEXt**，iTXt/zTXt 不认）。
- `logic/parse-character-card-json.ts` — 剥 BOM、UTF-8 解码、V2/扁平字段规范化。
- `logic/character-card-to-md-tree.ts` — 规范化字段 → `角色描述.md` / `开场/开场NNN.md` / `世界书/*.md`。
- `logic/sanitize-entry-filename.ts` — 世界书标题清洗。
- `logic/validate-md-tree-paths.ts` — Phase A 相对路径校验（**刻意不套** ZIP basename / validateVfsZipEntries）。
- `logic/validate-md-tree-limits.ts` + `character-card-limits.ts` — 导入侧三闸 + 读取侧降级闸 + `utf8ByteLength`。

**明确的边界外**（不在本区，但在调用链上，本次为取证读过）：
`service/skills/impl/skills.service.ts`（保留名门、乐观锁调用点、事务编排）、
`service/vfs/impl/character-card-import.service.ts`（confirmed 门、事务、清缓存）、
`domain/vfs/logic/*`（`normalizePath` / zip 解析 / zip 校验 / 路径映射）。

**RULE 决策感知结果**

- RULE:29「技能域与内置技能」——保留名门 `assertSkillNameNotReservedForCreate` 在 **service 层**（不在本区），
  已在 `skills.service.ts:612` 与 `:503` 复核存在；ZIP 导入通道在双端 `NewSkillModal` 落盘前都调了它
  （`apps/mobile/.../NewSkillModal.tsx:192`、`apps/desktop/.../NewSkillModal.tsx:150`）。**符合 intentional，不报**。
- RULE:83「VFS write/edit/skill 的并发语义」——`skill` 已补入 pathTail 名单，合成单源在
  `domain/skills/logic/skill-paths.ts`。已核实 `fs-command-classify.ts:8-9,96` 与
  `skills.service.ts:36-38` 确实 import 同一份 `SKILLS_ROOT` / `resolveSkillRelPathCore`，**无第二份路径逻辑**。
  同条已声明的两处盲区（原始键比对、跨 runner 实例）**intentional，不报**。
- RULE:17「导入缓存对齐」——技能 ZIP 走 meta-scope 天然不触发 session 缓存清理；已在
  `character-card-import.service.ts:196` 复核门闸为 `scope.kind === "session"`。**intentional，不报**。
- RULE:29 尾句关于 `expectedVersion` 乐观锁的说法与 RULE:83 冲突，见 F-core-skills-17。

## 对外接口

`packages/core/src/public/skills.ts` 导出：

| 符号 | 来源 |
| --- | --- |
| `computeEffectiveSkills` / `EffectiveSkill` / `EffectiveSkillsInput` | `logic/effective-skills` |
| `parseSkillFrontMatter` / `ParsedSkillFrontMatter` | `logic/parse-skill-front-matter` |
| `withSkillFrontMatterValues` / `SkillFrontMatterValues` | `logic/with-skill-front-matter-values` |
| `previewSkillZip` / `SkillZipPreview` | `logic/preview-skill-zip` |
| `SkillDomain` / `SkillSummary` / `SkillRef` / `skillFrontMatterSchema` | `model/skill.schema` |
| `SKILL_NAME_PATTERN` / `SKILL_NAME_PATTERN_SOURCE` / `validateSkillName` / `isValidSkillName` | `model/skill-name` |

未导出（internal）：`SKILLS_ROOT` / `SKILL_ENTRY_FILE` / `resolveSkillRelPathCore`（仅 core 内部两层共用）、
`SkillDisabledRuleRepository`。

`packages/core/src/public/vfs.ts` 导出：`parseCharacterCardToMdTree`、`characterCardJsonToMdTree`、
`CHARACTER_CARD_MAX_SINGLE_FILE_BYTES`（另有 `CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES`）、
`type MdTree`。

## 数据访问

| 表 / 域 | 触点 | 证据 |
| --- | --- | --- |
| `skill_disabled_rule`（scope_key, skill_name） | 6 个方法全部走 SQL 模板，`INSERT OR IGNORE` / `DELETE` / `UPDATE OR IGNORE` | `repositories/impl/sqlite-skill-disabled-rule.repository.ts:28,39,49,59,68,89,96,109` |
| 表名常量 | 从 `@/bootstrap/skills/skills-schema.js` 引入，不在本区定义 | `sqlite-skill-disabled-rule.repository.ts:13` |
| VFS 逻辑前缀 `/meta/skills/`（global-meta / project-meta 域） | 路径合成，域内不做 IO | `logic/skill-paths.ts:14,17,47` |
| 负清单 scopeKey 语义 | domain 侧只当不透明字符串；`project:{pid}` 口径由 service 固定 | port 注释 `repositories/skill-disabled-rule.port.ts:8-22` |
| KKV | 本区**不触碰**任何 KKV 域 | — |

character-card 域**零 IO、零表**：全部为纯函数，输入是已读入内存的 `Uint8Array` / `string`。
落库由 `service/vfs/impl/character-card-import.service.ts` 承担。

## 依赖关系

**import（出向）**

- skills 域 → `@/domain/vfs/logic/vfs-path-mapper.js`（`resolveLogicalPath`）：`logic/skill-paths.ts:11`
- skills 域 → `@/domain/workplace/logic/front-matter.js`（`splitMarkdownFrontMatter`）：
  `logic/parse-skill-front-matter.ts:10` ← **跨域复用了 workplace 的 front matter 切分器**
- skills 域 → `@/infra/serialization/parse-text.js`（YAML）：`parse-skill-front-matter.ts:11`
- skills 域 → `@/infra/tdbc/*` + `@/infra/sql-template/*` + `@/bootstrap/skills/skills-schema.js`：
  仅 repository 实现
- character-card 域 → `@/domain/vfs/logic/vfs-zip-parse.js`：`logic/preview-skill-zip.ts:12`
- character-card 域 → `@/domain/vfs/logic/vfs-zip-validate.js`（仅取常量 `VFS_ZIP_MAX_ENTRY_PATH_LEN`）：
  `logic/validate-md-tree-paths.ts:8`
- character-card 域 → `@/domain/vfs/logic/vfs-zip-path.js` / `vfs-path-mapper.js`：`validate-md-tree-paths.ts:9-16`
- character-card 域 → `@/errors/character-card-errors.js`（5 个文件）
- character-card 域 → `@/infra/serialization/stringify-text.js`（世界书 front matter）：`character-card-to-md-tree.ts:7`
- character-card 域 → 外部 `fflate`（`strFromU8`）：`preview-skill-zip.ts:10`

**被消费（入向，重点）**

- `service/skills/impl/skills.service.ts`（消费 skill-paths / front-matter / effective-skills / skill-name / repository）
- `domain/tool/logic/fs-command-classify.ts:8`（pathTail 键合成）
- `domain/chat/logic/scan-skill-attachments.ts:14`（`SKILL_NAME_PATTERN`）
- `domain/tool/builtin/skill-tool.ts`、`builtin-tool-context.ts`（`EffectiveSkill`）
- `service/chat/impl/project.service.ts:42`（负清单 repo）
- `service/vfs/impl/character-card-import.service.ts:12-16`（角色卡 5 个模块）
- `domain/workplace/logic/load-or-fill-file-cache.ts:24-25`（读取侧降级闸复用常量）
- 双端 UI：`apps/desktop/shared/logic/skills.ts`、`apps/mobile/src/components/skills/skill-ui.ts`、
  两端 `NewSkillModal.tsx` / `SkillInfoEditModal.tsx`、`desktop/renderer/features/skills/skill-ui.ts`
- 测试：`packages/core/test/skills/*`（4 个）、`test/character-card/*`（2 个）、
  `test/tool/skill-tool.test.ts`、`test/chat/prepare-skill-attach.test.ts`、
  `test/workplace/load-or-fill-file-cache.test.ts`、`apps/desktop/test/skill-zip-import.test.tsx`、
  `apps/mobile/__tests__/*skill*.test.ts`

**测试覆盖观察**：`skill-paths.ts`（RULE:83 点名的路径合成单源）、`with-skill-front-matter-values.ts`、
`validate-md-tree-paths.ts`、`sanitize-entry-filename.ts`、`character-card-to-md-tree.ts`、
`parse-character-card-json.ts`、`sqlite-skill-disabled-rule.repository.ts` 在 `packages/core/test/` 下
**无对应用例**（已用 `rg` 逐符号确认）。其中 `withSkillFrontMatterValues` 仅由
`apps/desktop/test/skill-zip-import.test.tsx:141` 从 UI 侧覆盖，core 侧无测试。

## 发现清单

### F-core-skills-1 | P2 | packages/core/src/domain/skills/logic/preview-skill-zip.ts:35

```ts
const entries = parseVfsZip(zipBytes);
```

**描述**：`previewSkillZip` 在**解压之前没有任何尺寸 / 条目数闸门**，直接 `parseVfsZip` 全量解压
所有 entry。而 ZIP 侧的两道闸（`VFS_ZIP_MAX_ENTRY_COUNT = 5000`、`VFS_ZIP_MAX_UNCOMPRESSED_BYTES = 32MB`）
定义在 `domain/vfs/logic/vfs-zip-validate.ts:18,17`，只在 `validateVfsZipEntries` 里用，而那函数
**只在 main 进程的 `VfsZipIoService.import` 里调**（`service/vfs/impl/vfs-zip-io.service.ts:191`）。
`previewSkillZip` 的两个调用点都在 **renderer 进程**：
`apps/desktop/renderer/features/skills/NewSkillModal.tsx:101`、`apps/mobile/src/components/skills/NewSkillModal.tsx:156`。
双端选文件的 `assertZipArchive`（`apps/desktop/src/main/services/vfs-zip.service.ts:44` /
`apps/mobile/src/services/vfs-zip.service.ts:71`）只校验 4 字节魔数 + EOCD 存在，不看体积。
结论：用户在新建技能弹窗里选一个 zip bomb，renderer 会在**进主进程那道 32MB 闸门之前**就把
全部 entry inflate 进内存，进程被直接杀掉（不是 JS 异常，`try/catch` 拦不住——这与
`character-card/logic/character-card-limits.ts:5-7` 记录的 OOM 机理完全相同）。
同一文件里还有个次要放大点：`strFromU8(skillMdBytes)`（:52）对超大的 SKILL.md 也不设限。

**建议**：在 `previewSkillZip` 入口先做纯长度闸（如复用 `CHARACTER_CARD_MAX_INPUT_BYTES` 量级或新增
`SKILL_ZIP_MAX_INPUT_BYTES`），并在解压后、解压中两处按 `entries.size` 与累计 `byteLength`
early-abort——即把 `vfs-zip-validate.ts:17,18` 的两个常量下沉到 `parseVfsZip` 的调用侧，
让 preview 与 import 共用同一道门。至少要让 SKILL.md 全文的解码有单文件上限。

**置信**：confirmed（两处调用点与闸门位置已逐个读过；`validateVfsZipEntries` 的调用点全仓仅 1 处）

### F-core-skills-2 | P2 | packages/core/src/domain/skills/model/skill-name.ts:17

```ts
export const SKILL_NAME_PATTERN_SOURCE = "[^\\s/.][^\\s/]*";
```

**描述**：字符集**只禁首字符 `.`、禁 `/` 与空白，没有禁反斜杠 `\`**。但下游 VFS 路径归一化
`normalizePath` 的第一件事就是 `path.replace(/\\/g, "/")`
（`packages/core/src/domain/vfs/repositories/impl/normalize-path.ts:19`）。于是名字 `a\b`：
`validateSkillName("a\\b")` 通过（首字符 `a` 合规，其余 `\b` 不含 `/` 与空白）→
`assertNoPathSeparatorInName` 也放行（`service/skills/impl/skills.service.ts:124-128` **只查 `/`**）→
`resolveSkillRelPathCore("a\\b", "SKILL.md")` 拼出 `/meta/skills/a\b/SKILL.md`，被
`resolveLogicalPath` 归一化成 `/meta/skills/a/b/SKILL.md`，`startsWith("/meta/skills/a\\b/")` 为 false
→ 返回 `reason: "escape"`（`logic/skill-paths.ts:49-51`）→ service 包装成
`skillInvalidPath(..., "技能文件路径必须位于技能目录内")`（`skills.service.ts:89`）。
净效果：**UI 侧的技能名校验放行了一个永远建不出来的名字，用户提交后才收到一条指责「路径」的中文报错**，
且该报错完全不提示真正原因是技能名含 `\`，模型据此无法自我修复（与 `skills.service.ts:196`
那段注释里「让模型能自我修复」的设计意图相悖）。`:` `*` `?` `"` `<` `>` `|` 同样放行——
对纯 DB 虚拟 VFS 无害，但如果将来有导出到真实文件系统的路径会踩 Windows 限制。
双端 UI 校验（`apps/desktop/renderer/features/skills/skill-ui.ts:41`、`apps/mobile/.../NewSkillModal.tsx:130`）
消费的都是同一份 `validateSkillName` / `SKILL_NAME_PATTERN`，所以双端一致地错。

**建议**：`SKILL_NAME_PATTERN_SOURCE` 改为 `"[^\\s/\\\\.][^\\s/\\\\]*"`（首字符与后续都排除 `\`），
或至少在 `validateSkillName` 里加一条 `name.includes("\\")` 的显式拒绝；同时把
`assertNoPathSeparatorInName` 扩成 `assertNoPathSeparatorInName` 检查 `/` 与 `\`。
三处口径（pattern / validate / service 弱校验）必须同改，否则又出现 RULE 里反复治理的「口径漂移」。

**置信**：confirmed（normalizePath 的 `\`→`/` 已读；escape 分支与错误文案已追到 skills.service.ts:89）

### F-core-skills-3 | P2 | packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:51

```ts
const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
```

**描述**：front matter 的**识别**在本区有两份实现且不等价。解析侧
`parse-skillFrontMatter` 走 `splitMarkdownFrontMatter`，其分隔符判定是
`const FRONT_MATTER_START = /^---\s*$/`（`domain/workplace/logic/front-matter.ts:7`）逐行测试，
`\s` 覆盖尾随空格 / 制表符；重写侧的正则要求 `---` 后**紧跟**换行。
于是 `--- \nname: a\ndescription: b\n---\n\n正文`（分隔符带一个尾随空格，YAML/Markdown 生态里很常见）：
解析侧 → `valid: true`；重写侧 → `match == null` → 走 `:53-56` 的「无 front matter 块」分支，
在文件头**再插一个完整 front matter 块**。结果文件里出现两个 front matter 块，
`splitMarkdownFrontMatter` 只取第一个（新的、正确的那个），旧的 `--- \nname: a...` 整块
**变成了正文可见内容**——技能文档正文凭空多出一段 YAML。
`updateSkillInfo` 的调用点（`skills.service.ts:566-574`）正是「解析成功才重写」，
所以这条路径在真实改名/改描述操作上会被走到。

**建议**：让重写函数复用 `splitMarkdownFrontMatter` 的判定口径（同一份 `FRONT_MATTER_START`），
或把两处合并为 domain 内单源（`skills` 域自己的 `parse-skill-front-matter.ts` 已经 import 了
workplace 的切分器，重写侧应对称使用）。修完补一条 core 侧测试：分隔符带尾随空白的用例。

**置信**：confirmed（两侧正则/判定式均已读原文，`\s*$` 与 `\r?\n` 的差异是确定性的）

### F-core-skills-4 | P2 | packages/core/src/domain/skills/model/skill.schema.ts:23

```ts
  .strict();
```

**描述**：`name` / `description` 之外的**任何键都会让技能永久 invalid**。而
`withSkillFrontMatterValues` 的设计承诺恰恰是「**保留其余键**」（文件头注释第 3 行、`:58-65` 的
「块内缺失该 key 时追加到块尾」）——重写函数负责保住那些键，schema 却拒绝它们。
两处叠加产生一个**无法从 UI 脱困的死角**：一个带 `version: 1`（或任何第三方约定的附加元数据）
的 SKILL.md，`parseSkillFrontMatter` 返回 `valid: false` → `updateSkillInfo` 的
`if (source != null && parseSkillFrontMatter(source).valid)`（`skills.service.ts:566`）
判定跳过重写 → 用户在「编辑信息」里改描述**静默无效**（目录迁移那半边还会执行，
于是出现「技能目录已改名、SKILL.md 里还是旧名」的不一致状态）。
ZIP 导入同病：`NewSkillModal.tsx:219`（双端）无条件调 `withSkillFrontMatterValues`，
导入一个带附加键的技能包 → 落盘即 invalid，且 UI 改不动。

**建议**：二选一并写进 RULE——(a) schema 改 `.loose()`（或 `z.object({...}).catchall(z.unknown())`），
保留严格性只放在「name/description 必填」上；(b) 保持 `.strict()`，但 `updateSkillInfo` 的
「invalid 跳过重写」要改成「invalid 时仍重写 name/description、只是不视作修复」，
并让 UI 显式提示「该技能含未知 front matter 键，重命名不会生效」。
无论哪种，都需要一条 core 侧测试锁住行为。

**置信**：confirmed（schema、重写函数、service 调用点、双端 UI 调用点全部读过原文）

### F-core-skills-5 | P2 | packages/core/src/domain/character-card/logic/character-card-limits.ts:58

```ts
    return textEncoder.encode(text).byteLength;
```

**描述**：`utf8ByteLength` 的快路径用 `TextEncoder.encode(text)` 拿字节数——**为了测量长度，
把整个字符串完整编码成一份 `Uint8Array` 副本**。而本模块存在的全部理由（文件头 :4-7）就是
「巨大角色卡在解析链上产生多份全尺寸拷贝，触发原生 OOM（非 JS 异常，try/catch 拦不住）」。
`validateMdTreeLimits`（`validate-md-tree-limits.ts:37-38`）对 md 树的**每个** content 都调一次，
于是一个贴着 32MB 总量上限的卡片，在闸门阶段会额外产生一份 ~32MB 的 `Uint8Array` 峰值——
闸门自己成了它要防的那种拷贝。文件里已经写好了不分配的兜底实现（`:61-83` 的手工 UTF-8 折算），
但它只在 `typeof TextEncoder === "undefined"` 时启用（`:52-55`），在 Node / Electron / Hermes 上
**永远走不到**。真正需要它的场景恰恰是「字符串很大」。

**建议**：删掉 encode 快路径，直接用已有的手工折算循环（它对代理对的处理已按 TextEncoder 语义对齐、
有注释说明），或改用 `TextEncoder.prototype.encodeInto` 配一个可复用 scratch buffer
（零分配、且结果与 `encode().byteLength` 完全一致）。改完用现有
`test/workplace/load-or-fill-file-cache.test.ts:20` 导出的常量测试补一组「与 TextEncoder 结果一致」
的对拍用例，别让两条路径漂移。

**置信**：confirmed（两条分支的触发条件与分配行为已读原文）

### F-core-skills-6 | P3 | packages/core/src/domain/character-card/logic/validate-md-tree-paths.ts:105

```ts
    files.set(logical, content);
```

**描述**：`assertMdTreeRelativePathAllowed` 拒绝空段与 `..` 段（`:57-68`），但**不拒绝 `.` 段**。
`logicalFromZipEntryRelativeToDirectory` 内部走 `normalizePath`，`.` 段会被静默丢弃
（`normalize-path.ts:28`）。于是 `世界书/./a.md` 与 `世界书/a.md` 归一化到同一个 logical，
`files.set` **后者静默覆盖前者，无任何报错**。对照 ZIP 通道：`validateVfsZipEntries` 对同一情形
显式抛 `DUPLICATE_PATH`（`domain/vfs/logic/vfs-zip-validate.ts:215-217`）——两条导入通道对同一类
输入的处理不一致。连带影响：`validateMdTreeLimits` 的条目数闸用 `files.size`
（`validate-md-tree-limits.ts:29`），被覆盖后 Map 变小，**5000 条目的上限可被 `.` 段绕过**。
可达性评估：生产路径 `characterCardJsonToMdTree` 生成的是固定三组名字
（`角色描述.md` / `开场/开场NNN.md` / `世界书/<sanitized>.md`），`sanitizeEntryFilename` 把 `/` `\` 全换成 `_`，
所以**当前生成器产不出这种 key**；但 `MdTree` 是 `public/vfs.ts` 导出的公开类型，
`validateMdTreeForImport` 的签名与注释（`:22-23`「Phase A 拼好的逻辑路径产物均可」）都把它当通用校验器。

**建议**：`assertMdTreeRelativePathAllowed` 的段循环里加一条 `segment === "."` 的拒绝
（与已有的 `..` 拒绝并列，一行）；再在 `files.set` 前补 `if (files.has(logical)) throw characterCardError("INVALID_PATH", ...)`
兜住归一化碰撞。两条都改才能既堵住静默丢数据又堵住闸门绕过。

**置信**：confirmed（归一化丢 `.` 段与 ZIP 侧的 DUPLICATE_PATH 均已读原文）；
**对生产路径的可达性**：suspected（生成器侧看起来不可达，但公共类型暴露使其不宜依赖「调用方守规矩」）

### F-core-skills-7 | P3 | packages/core/src/domain/character-card/logic/character-card-to-md-tree.ts:85

```ts
  let n = 2;
  while (used.has(`${baseName}-${n}.md`)) {
    n += 1;
  }
```

**描述**：`allocateUniqueName` 每次冲突都从 `n = 2` 重新开始扫，整体 O(n²)。
角色卡条目数上限是 5000（`character-card-limits.ts:25`），一条 comment 全同名的世界书
（模型批量生成的卡很常见）就是 5000²/2 ≈ 1250 万次 `Set.has`，在低配手机上是一次可感知的卡顿。
不是正确性问题，是纯性能。

**建议**：给 `used` 维护一个 `Map<baseName, number>` 游标，每命中一次 baseName 就从上次的位置继续，
整体降到 O(n)。若不想加状态，最小改动是保留一个模块级外的局部 `Map` 传参进去。

**置信**：confirmed

### F-core-skills-8 | P3 | packages/core/src/domain/character-card/logic/parse-character-card-json.ts:99

```ts
  const bookRaw = primary?.["character_book"] ?? fallback["character_book"];
```

**描述**：`??` 只在 `null` / `undefined` 时回退到扁平根。若 `data.character_book` 存在但类型不对
（字符串 / 数字 / 数组，脏数据或第三方导出常见），`asRecord` 返回 undefined，
`readCharacterBookEntries` 直接 `return []`（`:100-103`）——**不会回退去读根上的 `character_book`**。
而同文件里的 `readStringField`（`:67-81`）走的是「逐字段 primary→fallback」，两套回退口径不一致。
后果：一张 `data.character_book` 损坏但根上有可用 `character_book` 的卡，世界书被整段静默丢弃，
用户看不到任何提示（导入成功、只是少了内容）。

**建议**：`readCharacterBookEntries` 改成先试 `primary`、非对象时再试 `fallback`
（与 `readStringField` 同款「逐字段回退」）；或者统一改成「primary 对象存在即整体采信 primary」并在
文档里写死这条口径——但那样 `readStringField` 也要跟着改。关键是**两处必须同口径**。

**置信**：confirmed

### F-core-skills-9 | P3 | packages/core/src/domain/skills/logic/effective-skills.ts:85

```ts
    .sort((a, b) => a.name.localeCompare(b.name));
```

**描述**：`localeCompare` 不带 locale 参数，走运行时默认 locale。技能名只禁空白 / `/` / 首字符 `.`
（F-core-skills-2），**CJK 是允许的**，所以排序结果确实依赖 locale。
Hermes（RN）带的是裁剪版 ICU，Electron/Node 带完整 ICU，两端对同一批中英混排技能名的排序
可能不同。影响面小（只是清单展示顺序，`effective` 判定与 `$` 候选集合都不依赖顺序），
但会让「桌面端排好的列表」在移动端不一样，跨端一致性测试 someday 会踩到。

**建议**：改用 `a.name < b.name ? -1 : a.name > b.name ? 1 : 0`（码点序，跨运行时确定），
或 `localeCompare(b.name, "en")` 固定 locale。注意 `skills.service.ts:263` 的
`items.sort((a, b) => a.name.localeCompare(b.name))` 是同一处模式，要一起改。

**置信**：confirmed（两处 `localeCompare` 已定位；Hermes ICU 差异属运行时事实，未在本仓实测）

### F-core-skills-10 | P3 | packages/core/src/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.ts:86

```ts
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE OR IGNORE ${SKILL_DISABLED_RULE_TABLE}
```

**描述**：`renameByName` 由**两条独立语句**组成（UPDATE OR IGNORE + 无条件 DELETE 旧行，:86-99），
方法本身不开事务。语义本身是对的（目标行已存在时保留目标、删旧行，port 注释 :26-31 写明了），
但原子性完全依赖调用方。当前唯一调用方 `updateSkillInfo` 确实包在
`this.deps.conn.transaction` 里且用 `new SqliteSkillDisabledRuleRepository(tx)` 构造
（`skills.service.ts:523-524`），所以**现状是安全的**；但 repo 端口签名（`skill-disabled-rule.port.ts:32-36`）
没有任何「必须在事务内调用」的约束或断言，下一个调用方用 `this.deps.conn` 直接构造就会得到
「UPDATE 成功、DELETE 失败」的半迁移状态：技能同时存在新旧两个名字的禁用行，
改名后技能**继续处于禁用态**且旧名留下孤儿行。

**建议**：要么在 `renameByName` 内部用 `this.conn.transaction` 自包（若 TdbcConnection 支持嵌套事务，
参考 `skills.service.ts:538` 注释里提到的「嵌套先例」），要么在 port 的 JSDoc 上写死
「调用方必须提供事务连接」，并把 `SkillsServiceDeps.disabledRules` 的注入点注释补上同款警示。
顺带：`copyScopeRules`（:102）与 `upsert`（:35）是单语句，无此问题。

**置信**：confirmed（两条语句与唯一调用点的事务边界已读原文）

### F-core-skills-11 | P3 | packages/core/src/domain/character-card/logic/extract-png-chara.ts:72

```ts
    if (crcEnd > bytes.length || length < 0) {
```

**描述**：`length < 0` 是**死分支**：`readUInt32BE`（:35-43）末尾 `>>> 0` 已保证结果是无符号 32 位，
永远 ≥ 0。防御性冗余，无害但会误导后续维护者以为这里处理了负数长度。

**建议**：删掉 `|| length < 0`。真正的越界防护是前半句 `crcEnd > bytes.length`（`crcEnd` 最大约 4GB+，
JS number 不会溢出，这句是充分的）。删的时候顺手在 `readUInt32BE` 上留一句
「`>>> 0` 保证无符号，调用方不需要再判负」的注释。

**置信**：confirmed

### F-core-skills-12 | P3 | packages/core/src/domain/character-card/logic/extract-png-chara.ts:45

```ts
function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}
```

**描述**：解 PNG `tEXt` 正文走「逐字符字符串拼接」，随后 `extractPngCharaJsonText`（:112-129）
再 `atob` → 逐字符 `charCodeAt` 建 `Uint8Array` → `TextDecoder` 解 UTF-8。
输入闸门是 48MB（`character-card-limits.ts:16`），但峰值驻留是：latin1 字符串（JS 内部两字节/字符，
48MB PNG 的 chara base64 约 64MB 输入 → 约 128MB 字符串）+ `atob` 产出的 binary string（再 128MB）
+ `Uint8Array`（48MB）+ `TextDecoder` 字符串（≤96MB）。也就是说**贴着闸门上限的卡片，
在解码链上瞬时占用可达 400MB 量级**。`character-card-limits.ts:4-7` 已经把
「多份全尺寸拷贝 → 原生 OOM」写成了本模块的存在理由，而这里正是那条链上最宽的一环。
`db-backup.service.ts:70` 已经为了同类问题做过「分块 ascii 写入，避免整包
`String.fromCharCode` / `btoa`」的处理，本文件没跟上。

**建议**：`decodeLatin1` 改 `String.fromCharCode.apply(null, chunk)` 分块（每 8K 一块）或
`TextDecoder("latin1")`；更根本的是给 `extractPngCharaBase64` 单独设一个远低于 48MB 的上限
（角色卡正文真正需要的量级远小于 48MB），并把该上限提到 `character-card-limits.ts` 与输入闸并列。
若只做一件事，做「单独的 chara 文本上限」——它同时解决了本条与 F-core-skills-1 的同类风险。

**置信**：confirmed（拷贝链与各步类型已逐行走通；具体峰值 MB 数是按 UTF-16 存储推算的估算，未实测）

### F-core-skills-13 | P3 | packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:67

```ts
  return source.replace(match[0], () => `---\n${fm}\n---\n`);
```

**描述**：匹配用 `\r?\n`（容忍 CRLF），但重建固定用 `\n`。一个 CRLF 的 SKILL.md 走完
「编辑信息」或 ZIP 导入回写后，**front matter 块变成 LF、文件其余部分仍是 CRLF**，
同一文件内混合行尾。后果不止观感：git diff 上该文件整体行尾被改写、
后续任何按行尾做 diff/去重的逻辑会看到「整文件都变了」。

**建议**：探测 `source`（或 `match[0]`）里是否含 `\r\n`，据此选重建时的换行符；
三处拼接（`:55` 的无 front matter 分支、`:64` 的追加、`:67` 的整体替换）统一走一个
局部 `const eol = source.includes("\r\n") ? "\r\n" : "\n"`。

**置信**：confirmed

### F-core-skills-14 | P3 | packages/core/src/domain/skills/model/skill.schema.ts:29

```ts
export interface SkillRef {
  readonly domain: SkillDomain;
  /** project 域必带；global 域缺省。 */
  readonly projectId?: string;
```

**描述**：`projectId` 是可选字段，「project 域必带」这条不变量只存在于注释里，
类型系统不强制。service 层用 `vfsForDomain` 在缺 projectId 时抛 `skillMissingProjectId`
（`skills.service.ts:147-150`）兜住了运行时，但 `SkillRef` 本身被双端 UI 大量构造
（`skill-ui.ts:46-50` 的 `toSkillRef`、mobile 对应实现），一旦哪条构造路径漏传，
类型检查不会拦，运行时要跨 IPC 才炸成 SkillError。

**建议**：改成判别联合——`{ domain: "global" } | { domain: "project"; projectId: string }`。
`SkillRef` 是纯类型，改动只影响构造点（双端各 1 处 `toSkillRef` + 若干 DTO 映射），
收益是把这个不变量从注释升级成编译期保证。`EffectiveSkill` / `SkillSummary` 无此问题。

**置信**：confirmed

### F-core-skills-15 | P3 | packages/core/src/domain/character-card/logic/parse-character-card-json.ts:117

```ts
  if (spec === SPEC_V2) {
    return;
  }
```

**描述**：`assertRecognizableCard` 的第一条判定就是「spec 等于 `chara_card_v2` 就认定可识别」，
不再看有没有 `data`、有没有任何实际字段。于是 `{"spec":"chara_card_v2"}` 这种空壳 JSON 会被
判为合法角色卡，产出一棵只含 `角色描述.md`（空正文）的 md 树并成功导入——用户得到一个空技能目录，
全程无任何警告。同理 `{"data":{}}` 也会通过第二条判定（`data != null`，:120-122）。

**建议**：把 `spec === SPEC_V2` 的放行加上「`data` 是对象」的前置条件
（`if (spec === SPEC_V2 && data != null) return;`，并让 spec 命中但 data 缺失时落到
`UNSUPPORTED_SPEC` 而不是静默通过）。空壳属于「不可识别」，报 `NOT_CHARACTER_CARD` 比
建一个空目录对用户友好得多。

**置信**：confirmed

### F-core-skills-16 | intentional | packages/core/src/domain/skills/logic/effective-skills.ts:71

```ts
      const isDisabled = disabled.has(s.name);
```

**描述**：负清单**只按技能名匹配、忽略域**，而合并规则是「同名 project 副本覆盖 global 原件」
（:63-67，global 原件已不在结果里）。所以项目 P 禁用 global 技能 X 之后，P 自己的 X 副本
也会被标 `disabled`（此时被覆盖的 global X 反而不出现在清单里）。
接口注释（:15-21）明确写了这个口径：「本期负清单只有 project 域写入路径，故直接以 project 行为准」。
**判定：intentional，按协议不作为问题上报**，此处仅登记以免下一轮重复讨论。
真正有风险的是 global X 与 project X 并存时给 global X 改名会让 P 的 (P,X) 负清单行变孤儿——
`skills.service.ts:576-580` 已把这条写进「已知边界（文档化不处理）」，同样 intentional。

**置信**：intentional

### F-core-skills-17 | P3 | docs/apm/RULE.md:29（与 :83 冲突）

```text
编辑已存在技能走 VFS 乐观锁——保存须透传 read 时拿到的 version（writeSkillFile 的
expectedVersion），否则必撞 CONFLICT。
```

**描述**：RULE 内部自相矛盾。:29 说 `writeSkillFile` 有 `expectedVersion`、不传必撞 CONFLICT；
:83 说「底层乐观锁已按用户 2026-09-06 拍板全拆（60af90b），write 固定 last-write-wins」。
代码站在 :83 一侧：全仓 `rg expectedVersion`（排除测试）**零命中**，
`SkillWriteOptions`（`service/skills/skills.port.ts:53-55`）只有 `builtinSeed`，
`writeSkillFile` 的实现注释白纸黑字写着「版本比对已从 VFS 底层移除：last-write-wins」
（`skills.service.ts:368`）。即 :29 是一段**已失效的操作指引**。
危害不在运行时，在于下一个 agent（或人）读 :29 去「修」一个不存在的必撞 CONFLICT，
或者照着去加 `expectedVersion` 参数，把用户 2026-09-06 拍板拆掉的东西又加回来。
本区自身不携带此问题（`skill-paths.ts` 的注释对此表述准确），但 RULE 是全 agent 的决策输入，
必须修。

**建议**：删掉 :29 的乐观锁尾句，或改写为「乐观锁已于 2026-09-06 全拆（见「VFS write/edit/skill
的并发语义」条），编辑走 last-write-wins + pathTail 同路径串行化」并指向 :83。
按协议我不能改 `docs/apm/`，请主代理或 reduce 阶段处理。

**置信**：confirmed（`rg expectedVersion` 全仓零命中 + service 注释 + port 定义三方印证）

## 争议与存疑

1. **F-core-skills-4 该选 (a) 还是 (b)，我无法单方裁定。** `.strict()` 是有意照
   `agent-definition.schema.ts` 的模式做的（`skill.schema.ts:4-5` 注释明说），而
   `withSkillFrontMatterValues` 的「保留其余键」也是有意为之。两条意图各自合理，冲突是组合产生的。
   放宽 schema 会让「拼错键名」（`descripton:`）静默通过、把问题推迟到运行时；保持 strict 则必须
   给用户一条修得动的路。**建议主代理把这条交给 reduce 阶段做产品判断，不要在 W2 内单方面定调。**

2. **F-core-skills-6 的可达性我只能证到「公共类型暴露」这一层。** 我确认了
   `characterCardJsonToMdTree` 这条唯一的生产生成器路径产不出 `.` 段 key
   （`sanitize-entry-filename.ts:7` 把 `/` `\` 全替换掉），但没有逐一枚举
   `parseCharacterCardToMdTree` / `characterCardJsonToMdTree` 在 `public/vfs.ts` 之外的所有调用方
   （rg 只找到 service 一处 + 导出本身）。若 W3 的「导出面」机位能证明双端确实存在
   直接构造 `MdTree` 的调用方，这条应从 P3 升到 P2。**建议 W6 验证代理下钻一次。**

3. **F-core-skills-12 的 400MB 峰值是推算，不是实测。** 我按 UTF-16 字符串存储（2 字节/字符）
   逐步累加了 latin1 字符串 / atob binary string / Uint8Array / TextDecoder 字符串四份驻留，
   没有在 Node 或 Hermes 上跑内存剖面。**方向确定（多份全尺寸拷贝），量级待测。**

4. **F-core-skills-1 我确认了「preview 在 renderer、闸门在 main」这个结构事实，
   但没有构造真实 zip bomb 验证 OOM。** 缺的是「`parseVfsZip` 的 fflate 回退分支
   （`vfs-zip-parse.ts:23-36` 的 `unzipSync`）是否在无 `filter` 的情况下一次性展开全部条目」
   这一条的实测——`unzipSync` 不带 `filter` 时确实是全量解压，但我没跑。
   另需注意：中央目录分支（`parseZipCentralDirectory`）是**逐条**解压的，
   理论上可以在这里提前 abort；现在的写法没有做。**这条的严重度取决于双端实际内存余量，
   建议 P1 复核时实测一个 10MB→1GB 的压缩比样本。**

5. **本区 18 个文件里有 6 个在 `packages/core/test/` 下无对应用例**
   （`skill-paths.ts` / `with-skill-front-matter-values.ts` / `validate-md-tree-paths.ts` /
   `sanitize-entry-filename.ts` / `character-card-to-md-tree.ts` / `parse-character-card-json.ts` /
   `sqlite-skill-disabled-rule.repository.ts`）。我没有把「缺测试」本身列为独立发现
   （按 P3 归入会稀释台账），但它是我把 F-core-skills-3 / F-core-skills-4 定为 P2 的加重因素之一：
   这两处都是「单源口径分裂」类问题，恰恰最需要回归测试兜底，而 core 侧没有。
   **建议 reduce 阶段把「核心纯函数域测试缺口」单独立一条 backlog，不要淹没在单点发现里。**

6. **`skill-paths.ts` 被 RULE:83 称为「合成单源」，我核实通过**
   （service 与 tool 分类器确实 import 同一份，无第二份实现）。但要注意
   `SkillDetailView.tsx:34` 在 desktop renderer 里**又本地声明了一份**
   `const SKILL_ENTRY_FILE = "SKILL.md"`（该常量未从 `public/skills.ts` 导出），
   `buildNewSkillDoc`（`skill-ui.ts:21-35`）也在 UI 侧手拼 front matter 而不复用
   `withSkillFrontMatterValues` 的无块分支。**这两处属 apps 域、不在本区、我未深查**，
   但它们是「单源抽取没抽干净」的同型问题，建议 W3 的「双端重复实现」机位一并覆盖。
