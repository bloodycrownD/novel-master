---
zone: w8-skills-adv
agent: advocate（辩护人 / 对抗对 A 侧）
files_scanned: 30
  - packages/core/src/domain/skills/logic/{effective-skills,parse-skill-front-matter,preview-skill-zip,skill-paths,with-skill-front-matter-values}.ts
  - packages/core/src/domain/skills/model/{skill-name,skill.schema}.ts
  - packages/core/src/domain/skills/repositories/skill-disabled-rule.port.ts
  - packages/core/src/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.ts
  - packages/core/src/service/skills/{skills.port,create-skills-service}.ts
  - packages/core/src/service/skills/impl/skills.service.ts
  - packages/core/src/domain/character-card/logic/{character-card-limits,character-card-to-md-tree,extract-png-chara,parse-character-card-json,parse-character-card-to-md-tree,sanitize-entry-filename,validate-md-tree-limits,validate-md-tree-paths}.ts
  - packages/core/src/domain/character-card/model/character-card.ts
  - packages/core/src/domain/vfs/logic/{vfs-zip-parse,vfs-zip-validate,vfs-zip-path,vfs-zip-central-dir,vfs-path-mapper,extract-mutating-paths}.ts
  - packages/core/src/service/vfs/impl/{vfs-zip-io.service,character-card-import.service}.ts
  - packages/core/src/service/vfs/logic/{clear-session-prompt-caches,ensure-import-dir-rules}.ts
  - packages/core/src/service/vfs/create-{vfs-zip-io,character-card-import}-service.ts
  - packages/core/src/service/vfs/impl/scoped-vfs.service.ts
  - packages/core/src/domain/tool/{builtin/skill-tool.ts,logic/fs-command-classify.ts}
  - packages/core/src/domain/workplace/logic/{front-matter,workplace-scope}.ts
  - packages/core/src/bootstrap/skills/{seed-builtin-skills,skills-schema}.ts
  - packages/core/src/errors/{skill-errors,vfs-zip-errors,character-card-errors}.ts
  - apps/desktop/renderer/features/skills/{NewSkillModal,skill-ui}.tsx|ts
  - apps/desktop/src/main/ipc/handlers/skills.ts
  - apps/mobile/src/components/skills/NewSkillModal.tsx
  - apps/mobile/src/services/{vfs-zip.service,vfs-character-card.service}.ts
  - docs/apm/RULE.md（技能域 / 导入缓存对齐 / 目录规则 / 并发语义四条）
---

## 摘要

技能域（两域 SKILL.md 目录 + 负清单）、角色卡（PNG/JSON → md 树）与 VFS ZIP 导入链。
技能存 VFS 独立 meta 域，front matter 解析/重写是 domain 层单源，内置保留名有两道门；
导入链统一「Phase A 全量校验在任何 delete 之前 → 单事务替换 → 提交后 best-effort 对齐缓存」。

## 职责与边界

- **技能域**（`domain/skills` + `service/skills`）：两域（global / project）技能的清单、合并视图、
  文件读写、启停（负清单）、整目录删除、重命名 + 描述同事务。存储落在 VFS 的
  `global:meta` / `project:{pid}:meta` 两个 scope 的 `/meta/skills/{name}/` 逻辑前缀下，
  负清单单独落 `skill_disabled_rule` 表。
- **角色卡**（`domain/character-card`）：SillyTavern 卡片（PNG `tEXt/chara` / JSON）→ 规范化字段
  → 相对路径 md 树。**纯逻辑，无 IO**；落库由 `service/vfs/impl/character-card-import.service.ts` 负责。
- **VFS ZIP 导入链**：`domain/vfs/logic/vfs-zip-*.ts`（解析/校验/路径映射）+ `service/vfs/impl/
  vfs-zip-io.service.ts` 与 `character-card-import.service.ts`（事务编排）。技能 ZIP 安装复用后者
  之外的 `vfs-zip-io`，只是 scope 换成 meta 域。
- **不属于本区**：workplace 规则引擎本体、checkpoint 补点算法本体、skill 工具的模型可见文案
  （`domain/tool/builtin/skill-tool.ts` 只在本区作为消费方出现）。

## 对外接口

`packages/core/src/public/skills.ts` barrel 出：`createSkillsService` / `SkillService` 全端口 /
`computeEffectiveSkills` / `parseSkillFrontMatter` / `withSkillFrontMatterValues` /
`previewSkillZip` / `skillFrontMatterSchema` / `BUILTIN_SKILL_NAMES` / `SKILL_NAME_PATTERN` /
`validateSkillName`。
`public/vfs.ts` 出：`createVfsZipIoService` / `createCharacterCardImportService` /
`parseCharacterCardToMdTree` / `CharacterCardError` / 四个 limits 常量 / `MdTree`。

## 数据访问

| 载体 | 位置 | 触点 |
|---|---|---|
| `vfs_entry` / `vfs_revision` / `vfs_content_blob` | scope_key `global:meta` / `project:{pid}:meta` | `skills.service.ts:143-164,437-461,523-592`；两个 import service 的事务体 |
| `skill_disabled_rule` | scope_key 固定 `project:{pid}`（**不跟随 meta 重定位**） | `skills.service.ts:104-113`、`sqlite-skill-disabled-rule.repository.ts:24-114` |
| `workplace_dir_rule` | 导入事务内补默认启用行 | `ensure-import-dir-rules.ts:93-134` |
| `message` / `message_checkpoint` | 仅 session scope 导入事务内补 baseline | `vfs-zip-io.service.ts:232-243`、`character-card-import.service.ts:169-181` |
| `session_kkv`（`rule_snapshot` / `file_cache` / `prompt_tokens` / `usage_stats`） | 事务**提交后** | `clear-session-prompt-caches.ts:29-54` |
| `kkv_entry`（module `nm-seeds`） | 内置技能 seed 版本台账 | `seed-builtin-skills.ts:146-163` |

## 依赖关系

- **import 了谁**：`domain/vfs/logic/vfs-zip-*`、`vfs-path-mapper`、`vfs-tree-copy`（sweep/release）、
  `domain/tool/logic/fs-command-classify`（反向依赖 skills 的 `skill-paths`）、`bootstrap/skills/skills-schema`、
  `infra/serialization/parse-text`（yaml）、`domain/workplace/logic/front-matter`。
- **被谁消费**：`service/agent`（`ctx.skills.effective` 装配）、`domain/tool/builtin/skill-tool`、
  `bootstrap/skills/seed-builtin-skills`、`service/chat/impl/project.service`（项目删除/复制带负清单）、
  双端 UI（desktop IPC handlers/skills.ts + renderer；mobile runtime 直调）、
  `domain/vfs/logic/physical-vfs.service.ts`（五前缀只读物理树含两个 meta 域）。
- **注意到的依赖方向合理性**：`domain/tool/logic/fs-command-classify.ts` 反向 import
  `domain/skills/logic/skill-paths.js`——tool 层要技能路径单源来合成 pathTail 排队键，
  是有意的复用（见辩护 D7），不是循环依赖（skills 侧不 import tool 层）。

---

# 辩护理由清单

## D1 — meta 域隔离是刻意的架构决策，不是「顺手加的 scope」

**证据**：
- `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts:19-23`——global-meta 物理前缀**空串**，
  因为域内逻辑路径自带 `/meta` 段；project-meta 只再拼 `/projects/{pid}` 项目段。
- 同文件 `:110-120`（`toPhysicalPath`）、`:164-180`（`toLogicalPath`）、`:198-203`（`scopeKey`）
  三处口径一致，且 `toLogicalPath` 对 project-meta 额外校验物理路径必须形如
  `/projects/{pid}/meta[...]`，否则抛「not in project meta scope」——**回程比去程更严**。
- `packages/core/src/service/template/logic/initialize-session-workspace.ts:44-47` 的注释是这条
  决策的直接收益证明：「技能已重定位到独立 meta 域，project 域全部内容都带入 session，
  **无需排除项**」——历史上有 `excludePrefixes: ['meta/skills']` 这类排除清单，域隔离之后整段删除。
- `docs/apm/RULE.md:29` 明确记为设计条目（双端支持新建/编辑/启停/ZIP 导入导出，独立 meta 域）。

**辩护**：域隔离换来的三样东西都是硬的——① 技能不进会话工作区，所以 checkpoint / 回滚 /
`file_cache` 完全不必为技能失效；② `global` 与 `project` 同名技能天然物理隔离，pathTail
排队键不必跨域串行（见 D7）；③ 只读物理树可以安全地把 `/meta` 与 `/projects/{pid}/meta`
拼进来给用户浏览（`physical-vfs.service.ts:46-87` 的五前缀解析，顺序敏感且每条都带注释）。
代价是路径映射多两个 case，这是有意的复杂度，不是疏漏。

## D2 — front matter 确实是单源，双端已无私有实现

**证据**：
- 解析：`domain/skills/logic/parse-skill-front-matter.ts:37-78`，内部复用
  `domain/workplace/logic/front-matter.ts:25-52` 的 `splitMarkdownFrontMatter`（与工作区展示
  共用同一个 markdown front matter 切分器），再过 `skill.schema.ts:18-23` 的 zod `.strict()`。
- 重写：`domain/skills/logic/with-skill-front-matter-values.ts`，文件头 `:1-16` 明写
  「语义对齐原 desktop / mobile 两份 UI 私有实现（**回收为单源**）」。
- 消费侧只 re-export，无副本：`apps/desktop/shared/logic/skills.ts:6-11`、
  `apps/mobile/src/components/skills/skill-ui.ts:11`、
  `apps/desktop/renderer/features/skills/skill-ui.ts:37-38`（「已回收为 core 单源，
  本文件不再持有私有实现」）。
- 有回归护栏：`apps/desktop/test/skill-zip-import.test.tsx:141-170` 直接对 core 单源做表驱动断言。

**辩护**：这是一个**已经发生过漂移并被修好**的收敛点，不是「目前恰好没漂移」。
`withSkillFrontMatterValues:60-67` 里那两条「replacement 必须用函数形式」的注释就是漂移留下的
伤疤（`$$` / `$&` 序列会静默损坏 front matter）——能把这种坑写进注释并配测试，说明单源是真的
被当契约维护。

## D3 — 解析与重写职责分离，且「不改无效技能」是显式决策

**证据**：`skills.service.ts:554-574`——front matter 同步前先
`parseSkillFrontMatter(source).valid`，invalid（含缺 SKILL.md）**跳过重写**；
`with-skill-front-matter-values.ts:14-16` 反向声明「本函数不做解析校验——调用方先过
parseSkillFrontMatter」。

**辩护**：如果重写函数自己兼做校验，「改名顺手把一个坏技能治好」就会成为默认行为，
用户会看到一个自己没改过的 front matter 被系统动了。这里的选择是：**结构操作（改名）
与内容修复（重写 front matter）解耦**，宁可留下 name 与目录名不一致的坏技能等用户显式修。
这是有意识的语义边界，不是遗漏。

## D4 — 导入链的「事务 + 缓存对齐」口径是全仓统一且被文档固化的

**证据**：
- Phase A 全在任何 delete 之前：`vfs-zip-io.service.ts:189-196`（`parseVfsZip` →
  `validateVfsZipEntries` → 才进 `conn.transaction`）、`character-card-import.service.ts:130-140`
  （`validateMdTreeForImport` → `validateMdTreeLimits` → 才进事务）。
- 缓存对齐在**提交之后**：`vfs-zip-io.service.ts:257-260`、`character-card-import.service.ts:195-198`。
- 错误口径**有意不同**且写进了 helper 自身的文档：
  `clear-session-prompt-caches.ts:20-27`——「顺序与置位/压缩一致，但错误口径**有意不同**：
  这里整体 try/catch 吞错 + `console.warn`……置位/压缩清空失败意味着会话状态错乱，
  裸 await 上抛是刻意的」。
- `docs/apm/RULE.md:17` 把这套口径写成项目级条目，并注明「导入缓存对齐（session 导入三件套）」。

**辩护**：这是本区最值得肯定的设计。关键在于它**没有假装两个场景一样**——置位/压缩的清空失败
是状态错乱（必须炸），导入的清空失败只是下次提示词重评估不准（文件已落库，炸了反而让用户
以为导入失败）。把差异写进 helper 的 TSDoc 而不是靠后人读代码猜，是正确的做法。
门闸 `VfsScope.kind === "session"` 也与 RULE 一致：技能 ZIP 安装走 meta 域，**天然不触发**
缓存对齐——这不是漏了，是设计上就不该触发（技能不进工作区前缀，见 D1）。

## D5 — 目录规则补行在事务内吞错，是被测试守卫的显式取舍

**证据**：`ensure-import-dir-rules.ts:10-14` 的 TSDoc 逐字解释了为什么在事务**内**吞错是安全的
（「依赖 SQLite 语句级失败不自动 ROLLBACK、后续语句可继续提交的行为」），并注明
「由 T-I5 故障注入用例守卫」；两个 import service 都注入了 `createWorkplaceRepo` 故障注入钩子
（`vfs-zip-io.service.ts:43-47`、`character-card-import.service.ts:41-46`）。

**辩护**：这是一种**反直觉但被论证过**的选择。通常「事务内吞错」是反模式；这里之所以敢这么做，
是因为它同时被（a）逐目录 + 外层双层 try/catch 兜住、（b）专门造的故障注入测试钉住语义。
辩护立场：如果要改，应该改成把补行挪到提交后，而不是简单地「去掉事务内吞错」——那会引入
「文件已落库但目录规则缺失导致新目录默认 rule_off」的新窗口。

## D6 — 内置技能的四道校验链 + seed 特权通道，边界清楚

**证据**：`skills.service.ts` 内 `updateSkillInfo` 的校验链 1-7 逐条有编号注释
（`:487-508` 链 1-3 在事务外，`:525-536` 链 4 域内查重**在事务内收口 TOCTOU**，
`:548-574` 链 5-6 目录迁移 + front matter 同步，`:576-591` 链 7 负清单迁移）。
`BUILTIN_SKILL_NAMES`（`seed-builtin-skills.ts:33-35`）是删除/新建/改名/查重**四处共用的单源**。
seed 特权 `options.builtinSeed` 只由 bootstrap 传（`seed-builtin-skills.ts:194-201`），
端口注释明写「用户路径（UI / IPC / LLM 工具）一律不传」（`skills.port.ts:47-55`）。

**辩护**：「存在性检查放事务外、避免错误被事务包装器包裹」（`:430-435`、`:515-520`）和
「事务内重查收口 TOCTOU」（`:525-526`）是一对看起来矛盾、实际互补的安排，作者把理由都写在
注释里了。同理 `:593-600` 显式解包 `TdbcError(SQLITE_ERROR).cause` 还原 SkillError 错误码——
这是**为了 IPC 透传业务错误码**而做的、不做就会让 UI 拿到 SQLITE_ERROR 的必要处理。

## D7 — pathTail 排队键复用 domain 层路径单源，避免第二份路径逻辑

**证据**：`domain/tool/logic/fs-command-classify.ts:65-99` 的 `classifySkillToolCall` 直接
import `SKILLS_ROOT` 与 `resolveSkillRelPathCore`（`domain/skills/logic/skill-paths.ts:14,34-53`），
合成 `skill:{domain}:{逻辑路径}`；`skill-paths.ts:3-6` 的模块注释明写抽到 domain 的原因
「tool 层的同路径串行化分类器需要同一套口径——抽到这里供两层共用，**防止出现第二份路径逻辑**」。
`skill-paths.ts:44-46` 还显式拦截了 `..` 段（因为 `normalizePath` 会把 `..` 消化成目录回溯
而不是拒绝），失败返回结构体不抛错，tool 层据此**保守放弃串行化**。
`docs/apm/RULE.md:83` 把这条记为「合成单源在 `domain/skills/logic/skill-paths.ts`，与 service 共用」。

**辩护**：这是本区设计意图最清晰的一处——「同一口径写两遍」是这类系统最常见的漂移源，
作者不仅抽取了，还把**失败语义**也统一了（纯函数不抛、service 包成 SkillError、tool 放弃排队）。
`skill:{domain}:` 前缀的双重目的（与工作区路径天然隔离 / global 与 project 同名不互串）
也在 `:56-64` 写清了。

## D8 — 角色卡的三闸 + 读取侧降级是同一份常量驱动的

**证据**：`character-card-limits.ts:15-37` 集中定义四闸（输入 48MB / 总量 32MB / 单文件 8MB /
条目 5000），文件头 `:3-10` 写明来历（原生 OOM，try/catch 拦不住，直接杀进程；
毒数据落库后形成「重启必崩」循环）。阈值**刻意对齐 ZIP 侧**
（`vfs-zip-validate.ts:17-19` 的 32MB / 5000 —— 常量被 `validate-md-tree-limits.ts:5-6`
的注释显式指认为对齐对象）。`character-card-limits.ts:27-37` 还诚实标注了压缩比折算的
方向性取舍（按 4× 压缩比折算、方向上刻意保守、极端高压缩比理论上可绕过）。
`docs/apm/memory/20260907-huge-card-import-crash-fix.md` 记录了完整决策史。

**辩护**：「读取侧复用导入侧的单文件上限」这个选择避免了双套数字漂移；压缩比折算的
不确定性被**显式写出来并选择了保守方向**，而不是假装精确。`:39-84` 的 `utf8ByteLength`
连 Hermes 缺 `TextEncoder` 的兜底都写了，还正确处理了落单代理（计 3 字节，与 TextEncoder 一致）。

## D9 — 负清单的 scopeKey 语义与 VFS meta 重定位「故意不同步」

**证据**：`skills.service.ts:104-113`：
```
 * `skill_disabled_rule` 行的 scopeKey 语义固定为 `project:{pid}`
 * （setDisabled / effectiveSkills / 项目删除的 removeScope 同源），
 * **与 VFS 重定位到 meta 域无关，不得跟随改写**。
```
`skills-schema.ts:14-17` 的 DDL 注释同样声明「scope_key 取值约定为 `project:{pid}`……
全局域禁用行（如 `global`）本期无 UI 写入路径，**表结构预留**」；
`effective-skills.ts:15-20` 解释了「负清单只有 project 域写入路径，故直接以 project 行为准」。

**辩护**：这是最容易在后续重构中被「顺手修正」的一处——看到 VFS 已经搬到
`project:{pid}:meta`，任何人都会想把负清单的 key 也改掉。注释用「**不得**跟随改写」
这种命令式措辞提前堵住了这个误改。表结构预留全局域也是「先留接口不写实现」的
一致做法（不是所有预留都是技术债）。

## D10 — 错误文案的「三态」不可并成两态

**证据**：`skill-errors.ts:120-146` 的 `skillNotFoundInDomain` 注释：
「`exists: null` 表示**无法确认**（如未提供 projectId 而另一域是 project），
此时不得断言该域没有该技能」；`skills.service.ts:166-172` 的 `skillFileExistsInDomain`
返回 `boolean | null` 并注明「三态不可并成两态：把『查不了』说成『没有』会误导调用方
去错误的方向新建」。
来源可追：`docs/apm/memory/20260926-skill-edit-default-domain-notfound.md` 第四轮
（`[NOT_FOUND] Path not found: /meta/skills/...` 泄漏内部路径 + 模型无法自我修复的真机事故）。

**辩护**：这条在中文错误文案里是很少见的自觉——大多数系统会把「不知道」塌缩成「没有」。
作者不仅保留了三态，还把它写进端口注释与测试断言
（`skill-write-domain-not-found.test.ts` 覆盖「无 projectId → 明说无法确认」分支）。

## D11 — ZIP 导入的物理路径安全门是分层且有意不对称的

**证据**：`vfs-zip-validate.ts:42-74` 的 `assertZipEntryNameAllowed` 覆盖长度上限 /
反斜杠 / `..` / Windows 盘符 / `projects/` 跨域前缀；`:181` 的
`assertZipEntriesNotDomainRootPrefixed` 在**任何写库前**硬失败且**不剥前缀**
（`vfs-zip-path.ts:180-173` 的错误文案明说「系统不会自动剥离」）。
角色卡侧则**故意不套**这两道（`validate-md-tree-paths.ts:72-76`：
「**不调用** `assertZipEntriesNotDomainRootPrefixed` / `validateVfsZipEntries`」），
只保留自己的相对路径校验 + `assertLogicalPathAllowed`。

**辩护**：这个不对称是**对的**——ZIP 的 entry 名来自不可信归档，必须防「带目录名前缀」的
误导性嵌套；md 树的 key 全部是代码自己合成的固定串（`角色描述.md` / `开场/开场NNN.md` /
`世界书/{name}.md`，见 `character-card-to-md-tree.ts:116-142`），不存在归档携带路径的
风险，套 ZIP 校验反而是无意义的成本。作者在 TSDoc 里把这个「为什么不套」写清楚了。

---

# 让步清单（辩护人承认的缺陷 / 薄弱点）

## A1 — P2 | `domain/vfs/logic/vfs-zip-parse.ts:41` + `vfs-zip-io.service.ts:189-191`：解压炸弹绕过体积闸

**引文**：
```ts
const rawEntries = parseVfsZip(zipBytes);          // vfs-zip-io.service.ts:189
const { files, directories } = validateVfsZipEntries(scope, rawEntries, directoryPath); // :191
```
```ts
const inflated = inflateSync(compressed);          // vfs-zip-central-dir.ts:101
```

**描述**：`VFS_ZIP_MAX_UNCOMPRESSED_BYTES = 32MB`（`vfs-zip-validate.ts:17`）是在
**全部条目已经解压进内存之后**才检查的。`parseVfsZip` 走中央目录路径时逐条 `inflateSync`
并把结果塞进 `Map`（`vfs-zip-central-dir.ts:224-230`），中央目录解析失败时回退
`unzipSync`（`vfs-zip-parse.ts:23-36`，同样无上限）。因此一个几百 KB 的高压缩比归档
可以在闸门生效前把进程内存打满。`previewSkillZip`（`preview-skill-zip.ts:35`）更直接——
它**没有任何体积闸**，在 renderer 里就调 `parseVfsZip`。

**加重项**：移动端选 ZIP 的入口 `apps/mobile/src/services/vfs-zip.service.ts:128-145`
的 `pickZipFileBytes` **没有 `maxBytes`**；而同一个 app 里角色卡的选文件入口**有**
（`apps/mobile/src/services/vfs-character-card.service.ts:32`，注释明写「与 core 层
`importFromBytes` 的 `bytes.length` 闸门同阈值双保险」）。两条相邻的文件选择链路，
一条双保险一条裸奔。

**建议**：`parseZipCentralDirectory` 的循环里累加 `uncompressedSize`，超
`VFS_ZIP_MAX_UNCOMPRESSED_BYTES` 立即抛 `PAYLOAD_TOO_LARGE`（中央目录里每条都带
`uncompressedSize`，不需要真解压就能判）；`previewSkillZip` 复用同一闸门；
`pickZipFileBytes` 补 `maxBytes`（对齐角色卡的做法）。
**置信**：confirmed（限制位置可从代码直接读出；未实测构造炸弹）

## A2 — P2 | `with-skill-front-matter-values.ts:51` 与 `front-matter.ts:7-8`：解析与重写对 front matter 的文法定义不一致

**引文**：
```ts
const FRONT_MATTER_START = /^---\s*$/;   // front-matter.ts:7 —— 分隔符允许尾随空白
const FRONT_MATTER_END   = /^---\s*$/;   // :8
```
```ts
const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);  // with-skill-front-matter-values.ts:51
```

**描述**：解析侧接受 `--- `（尾随空格）为分隔符；重写侧的正则要求分隔符**恰好**是 `---`。
我实测（`node -e` 跑两段文法对同一输入）：

```
source = "---\nname: a\ndescription: b\n--- \n\nbody"
parser start ok: true   parser closed: true   → parseSkillFrontMatter: valid
writer match: false                          → withSkillFrontMatterValues: 走「无 front matter」分支
```

后果：重写函数走 `with-skill-front-matter-values.ts:53-55` 的**前置补块**分支，
产出一个**含两个 front matter 块**的文件（新块在前、旧块变成正文）。这个文件再被解析时，
读到的是新块（值是对的），但旧块连同 `---` 全部泄漏进正文，会被当作技能说明喂给模型。
`updateSkillInfo` 的「invalid 才跳过重写」保护在这里帮不上忙——文件是 valid 的。

**建议**：把重写侧的正则换成 `/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/`，
或更彻底地——**复用 `splitMarkdownFrontMatter`**，用它返回的行区间做替换，从根上消灭
第二份文法定义（这才是 D2「单源」的完整形态：现在单源的是「重写算法」，不是「front matter
的识别文法」）。
**置信**：confirmed（文法分歧已实测；具体文件产出未落库复现，但两段代码的行为已直接验证）

## A3 — P2 | `character-card-to-md-tree.ts:57-77` + `sanitize-entry-filename.ts:13-23` + `validate-md-tree-paths.ts:42-47`：超长世界书标题让整张卡导入失败

**引文**：
```ts
return `${baseName}.md`;   // character-card-to-md-tree.ts:80
```
```ts
if (relativePath.length > VFS_ZIP_MAX_ENTRY_PATH_LEN) {   // validate-md-tree-paths.ts:42
  throw characterCardError("INVALID_PATH", `md tree path exceeds ${VFS_ZIP_MAX_ENTRY_PATH_LEN} characters: ...`);
```

**描述**：`resolveEntryBaseName`（`:57-77`）优先用 entry 的 `comment`（SillyTavern 世界书
条目标题，现实中相当长）作基名，`sanitizeEntryFilename` 只做非法字符替换与首尾点/空格
清理，**没有长度上限**。合成路径是 `世界书/{baseName}.md`（9 字节前缀 + 后缀），
一旦 `comment` 超过约 500 字符，`assertMdTreeRelativePathAllowed` 抛 `INVALID_PATH`，
而这个校验在 `character-card-import.service.ts:134` 是**在任何写库之前**执行的——
结果是**整张角色卡导入失败**，而不是「这条世界书条目名字太长被跳过」。
`allocateUniqueName`（`:79-92`）只处理重名，不处理长度。

**建议**：`sanitizeEntryFilename` 加长度截断（按 UTF-8 字节截到 512 - 前后缀余量，
注意别截在代理对中间；`character-card-limits.ts` 里已有现成的 `utf8ByteLength` 可复用），
截断后再进 `allocateUniqueName` 保证唯一性。
**置信**：confirmed（代码路径确定；未构造真实超长 comment 的卡片实测）

## A4 — P2 | `apps/desktop/renderer/features/skills/NewSkillModal.tsx:120-123,147-169` vs `apps/mobile/src/components/skills/NewSkillModal.tsx:130,186-208`：ZIP 导入这条新建通道**不校验技能名**，双端口径还不一致

**引文**（desktop）：
```ts
if (!isValidSkillNameInput(trimmedName)) { ... }   // :120 —— 只有 SKILL_NAME_PATTERN
...
const importRes = await ipcVfsZipImportBytes({
  workspaceScope: domain === "global" ? "global-meta" : "project-meta",
  directoryPath: `/meta/skills/${trimmedName}`,    // :168 —— 直接拼进 VFS 写路径
```

**描述**：
1. **两条新建通道的校验强度不同**。ZIP 导入这条通道只过 `assertSkillNameNotReservedForCreate`
   （`:150-154`），它**只管内置保留名**（`skills.service.ts:612-633`），不管 `validateSkillName`。
   非 ZIP 通道走 `ipcSkillsWrite` → `writeSkillFile` → `assertValidSkillName`
   （`skills.service.ts:357`）→ 会拒 `SKILL.md` 保留名（`skill-name.ts:24-36`）。
2. **desktop 允许输入保留名**。`isValidSkillNameInput`（`apps/desktop/.../skill-ui.ts:41-43`）
   只跑 `SKILL_NAME_PATTERN`（`skill-name.ts:20-22` = `^(?:[^\s/.][^\s/]*)$`），
   `"SKILL.md"` **能通过**（首字符 `S` 合规，尾部无空白无斜杠）。
   同仓的 `SkillInfoEditModal.tsx:63` 与 mobile 的 `NewSkillModal.tsx:130` 用的都是
   完整的 `validateSkillName`。**同一产品两个端的「新建技能」表单名校验强度不同。**
3. **后果**：desktop 端输入 `SKILL.md` + 选 ZIP → 保留名门放行（不在 `BUILTIN_SKILL_NAMES` 里）
   → `ipcVfsZipImportBytes` 把归档落到 `/meta/skills/SKILL.md/`，产出一个名为 `SKILL.md`
   的技能目录。`readSkillFile("SKILL.md")` 会解析成 `/meta/skills/SKILL.md/SKILL.md`，能工作，
   于是这个非法技能**静默存在**并出现在技能清单里。

**建议**：把「ZIP 导入前的技能名合法性」下沉到 core——在 `SkillService` 上新增一个
「创建前全量校验」入口（合并 `assertSkillNameNotReservedForCreate` + `validateSkillName` +
目录存在性），让双端都调它；或者退一步，desktop 的 `isValidSkillNameInput` 直接换成
`validateSkillName`（对齐同仓 `SkillInfoEditModal` 与 mobile，成本最低）。
**置信**：confirmed（正则行为已读；未在真机走完整 UI 流程）

## A5 — P3 | `skills.service.ts:480-483` + `:566-574`：只提交「同值 newName」会产生一次无意义的新 revision

**引文**：
```ts
if (newName == null && description == null) { return; }   // :481-483 —— 只有两个都 null 才早退
const renaming = newName != null && newName !== location.name;  // :485
```
```ts
if (source != null && parseSkillFrontMatter(source).valid) {
  await vfs.write(entryPath, withSkillFrontMatterValues(source, { ...(newName != null ? { name: newName } : {}) }));
}   // :566-574
```

**描述**：`newName` 提交了但等于现名（`renaming === false`）且 `description` 为 null 时，
早退条件不成立（因为 `newName != null`），代码一路走到 front matter 同步，
用**同一个 name 值**重写 SKILL.md —— bump version、写一条新 revision、内容逐字节相同。
`skills.port.ts:154-159` 的端口注释也把这条路径描述成合法（「newName 须过技能名校验」，
没区分同值），所以这不是被文档化的边界，是一条没人测到的小路。

**建议**：把早退条件扩成「无实质变更」——`newName` 为 null 或等于 `location.name`
且 `description` 为 null 时直接 return。
**置信**：confirmed

## A6 — P3 | `skills.service.ts:260-264,268-300`：`listSkills` 是 N+1 读，且被 `effectiveSkills` 放大一倍

**引文**：
```ts
for (const [name, files] of filesBySkill) {
  items.push(await this.summarizeSkill(vfs, domain, name, files));   // :261 —— 串行 await
}
```
```ts
const [global, project, disabledNames] = await Promise.all([
  this.listSkills("global"), this.listSkills({ projectId }), ...    // :303-306
]);                                                                 // :307
```

**描述**：`summarizeSkill` 对每个技能做一次 `vfs.read(SKILL.md)`（`:276`），
在 `for` 循环里**串行 await**；`effectiveSkills` 又把两域清单各拉一遍。
`effectiveSkills` 的产物是**每轮 agent 装配期**都要算的提示词索引
（`ctx.skills.effective`，见 `skill-tool.ts:233`）。N 个技能 → 2N 次串行读 + 1 次目录 list。
RULE 里已经有 `workplace` 工厂每次 new、`file_cache` 命中无条件返回等性能纪律的记录，
这个 N+1 串行读在同一批装配期 IO 里是个真实成本。

**建议**：`summarizeSkill` 批量化（`vfs.read` 并发化，或在 `listSkills` 里用一次
`scanContents` 拿全量正文再解析）；`effectiveSkills` 已有 `Promise.all` 包两域，
把 `summarizeSkill` 的读也并发化即可。
**置信**：confirmed（结构确定；未实测耗时）

## A7 — P3 | `skills.service.ts:225-265` + `:268-300`：`listSkills` 对「只有目录没有文件」的技能目录不可见，且这会漏过 UI 的重名检查

**引文**：
```ts
const slash = rel.indexOf("/");
if (slash < 0) { continue; }        // :246-249 —— 一级文件/目录自身不计入
if (entry.kind !== "file") { continue; }   // :251-253
filesBySkill.set(skillName, files);        // :254-256 —— 只有 file 才建表项
```

**描述**：`filesBySkill` 只在见到 **file** 条目时建键。若某个技能目录存在但其下只有
子目录、没有任何文件（或 SKILL.md 缺失且无其他文件），该技能**不出现在 `listSkills` 里**。
后果是双端的「新建前重名检查」都会放行：
`NewSkillModal.tsx:138`（desktop，`listRes.data.some(s => s.name === trimmedName)`）、
`NewSkillModal.tsx:182`（mobile，同款）。随后 ZIP 导入的
`releaseAndDeleteVfsPrefix`（`vfs-zip-io.service.ts:203`）会**无条件删掉该目录整棵子树**
再重写——即「新建」通道实际具备「覆盖」语义，与 UI 文案「整包覆盖语义只在复制/提升链路，
新建不覆盖」（mobile `:178` 注释）矛盾。
core 侧 `updateSkillInfo` 有事务内查重（`:525-536`）说明作者知道 TOCTOU 要收口，
但 ZIP 导入通道没有对应的 core 侧「仅当目录不存在」门。

**建议**：ZIP 导入走技能通道时，在 core 侧加一道「目标技能目录必须不存在」的前置断言
（与 `assertSkillNameNotReservedForCreate` 同一个位置），把「新建不覆盖」从 UI 约定
变成 core 契约。
**置信**：confirmed（`listSkills` 的过滤逻辑与 `releaseAndDeleteVfsPrefix` 的无条件删都可直接读出；
空技能目录这一状态本身由 VFS mkdir-only 操作可达——mobile `SkillDetailScreen.tsx:145`
的 `VfsFileManager` 明确支持在技能目录内新建子目录）

## A8 — P3 | `ensure-import-dir-rules.ts:93-134` + `workplace-scope.ts:20-23`：技能 ZIP 导入会往 meta 域写**无人消费的**目录规则行

**引文**：
```ts
const targetScopeKey = workplaceScopeKey(scope);   // ensure-import-dir-rules.ts:99
```
```ts
case "global-meta": return "global:meta";         // workplace-scope.ts:20-21
case "project-meta": return `project:${scope.projectId}:meta`;   // :22-23
```

**描述**：技能 ZIP 安装走 `vfs-zip-io.service.ts:224-231` 的
`ensureImportDirRules`，scope 是 `global-meta` / `project-meta`，于是往 `workplace_dir_rule`
写 scope_key 为 `global:meta` / `project:{pid}:meta` 的行。但 meta 域**没有工作区视图**——
`RULE.md:30` 的目录规则口径讲的是 agent 与用户操作的工作区（session / project / global 域），
技能域按 D1 刻意不参与。实际消费者只有 desktop 的删除/改名路径
（`apps/desktop/src/main/ipc/handlers/vfs.ts:238,269,285` 调
`getWorkplaceForScope(...).deleteRulesUnderLogicalPrefix`），mobile 的技能文件管理器
**不传 workplace**（`apps/mobile/src/screens/stack/SkillDetailScreen.tsx:82-83`：
「技能域直接复用 VfsFileManager（workplace 不传，纳入/目录规则菜单自动隐藏）」）。
所以这些行在 mobile 上是纯死数据。

**建议**：meta scope 的导入跳过 `ensureImportDirRules`（加一个
`scope.kind.endsWith("-meta")` 的早退），或在 `workplace-scope.ts` 的 meta 分支上
注明「仅供 desktop 删除路径清理 meta 域规则残留」。当前是无声的净写入。
**置信**：confirmed（写入点与唯一消费点都已定位；未实测库里是否已有存量行）

## A9 — P3 | `extract-png-chara.ts:45-51,72`：latin1 逐字符拼接 + 一个死分支

**引文**：
```ts
function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) { out += String.fromCharCode(bytes[i]!); }
  return out;
}
```
```ts
if (crcEnd > bytes.length || length < 0) {   // :72 —— readUInt32BE 返回 >>> 0，恒非负
```

**描述**：`decodeLatin1` 对每个字节做一次 `String.fromCharCode` + 字符串拼接。
一个 30MB 的 `chara` tEXt 块要走 3000 万次循环 + 3000 万次 rope 拼接。
这正是 `docs/apm/memory/20260907-huge-card-import-crash-fix.md` 记录的原生 OOM 链条
「`extract-png-chara` `decodeLatin1` 逐字节拼接」这一环——当时选的修法是加 48MB 输入闸门
（把最坏情况封住），**没有改这个函数本身**。这不是说修法错了（闸门是有效的第一道防线），
而是这个已知的 O(n) 放大因子仍在，且它在一个已经有 `TextDecoder` 的运行时里
（`character-card-limits.ts:50-58` 就用了 `TextEncoder`）。
另外 `:72` 的 `length < 0` 是死分支：`readUInt32BE`（`:35-43`）末位 `>>> 0`，
返回值恒在 `[0, 2^32)`，`length < 0` 永不成立。

**建议**：`decodeLatin1` 改用 `String.fromCharCode(...bytes)` 分块（如每次 8192 字节）
或 `TextDecoder('latin1')`（RN Hermes 是否支持 latin1 需实测，不支持则分块）；
删掉 `length < 0`。
**置信**：confirmed（代码事实）／`TextDecoder('latin1')` 的 Hermes 可用性 suspected

## A10 — P3 | `preview-skill-zip.ts:15-27`：`fileCount` 会被用户当成「创建后全部带入」的承诺，但无任何上限校验

**引文**：
```ts
readonly fileCount: number;   // preview-skill-zip.ts:24 —— "zip 内文件数（不含目录标记条目）"
```
```ts
`已导入 ZIP · ${imported.preview.fileCount} 个文件（创建后全部带入）`   // NewSkillModal.tsx:227
```

**描述**：UI 把 `fileCount` 直接渲染成「创建后全部带入」的承诺。实际落盘时
`validateVfsZipEntries` 会按 `VFS_ZIP_MAX_ENTRY_COUNT = 5000` 与 32MB 总量拒
（`vfs-zip-validate.ts:196-207`），`previewSkillZip` 一概不查。所以一份 6000 条目的
ZIP 会显示「已导入 ZIP · 6000 个文件（创建后全部带入）」，点创建后才报
`PAYLOAD_TOO_LARGE`。这不是数据安全问题（闸门在落库前，零写库），是**预检与落盘口径不一致**
导致的用户体验落差——而 `preview-skill-zip.ts:5-6` 的模块注释自称「新建弹窗预填用」的
只读预检，读者会以为它反映了导入的真实约束。

**建议**：`previewSkillZip` 复用 `VFS_ZIP_MAX_ENTRY_COUNT` / `VFS_ZIP_MAX_UNCOMPRESSED_BYTES`
做一次只读判定，命中就把结论放进 `SkillZipPreview`（如 `oversize: boolean`），
UI 在选完 zip 时就提示「该 ZIP 超出导入上限」，而不是创建时才失败。
**置信**：confirmed

---

## 争议与存疑（不抹平）

1. **A1 的严重度我与「按 ZIP 归档不可信」的标准判定可能有分歧**。我把 A1 定为 P2 而非 P1，
   理由是触发路径是**用户自己从本地文件系统选一个 ZIP**，不是网络输入；但如果主代理掌握
   仓库里存在「接收并导入他人分享的 ZIP」的链路（例如云同步 / 会话分享携带归档），
   A1 应升 P1。我在本区范围内 grep 未找到这样的入口（`git grep` 覆盖
   `apps/{cli,desktop,main,mobile}` 的 `importVfsZip*` / `pickZipFileBytes` 调用点，
   全部是本地文件选择器），**这条需要主代理或对抗方 B 侧独立确认**。

2. **A2 的「双 front matter」后果严重度取决于下游怎么用正文**。如果技能正文里多出一段
   `--- name: a ... ---` 文本，模型看到的是一份自相矛盾的技能说明。我没有找到
   「SKILL.md 正文会被完整喂给模型」的强证据链（`skill-tool.ts:380-405` 的 load 确实返回
   `result.content` 全文，但带 `TOOL_OUTPUT_MAX_LINES` 截断），所以我把 A2 定为 P2 而非 P1。
   若 B 侧能证明「未截断的完整 SKILL.md 正文进提示词且参与技能选择判断」，应重估。

3. **A4 是否算本区缺陷有边界争议**。`ipcVfsZipImportBytes` 是**通用 VFS ZIP 导入**通道，
   它按设计不该懂「技能名」；说它有缺陷等于要求通用通道背领域规则。我的让步立场是：
   缺陷在**双端 UI 的技能新建弹窗**（desktop 用了弱校验 + mobile 用了强校验），
   而不在 `vfs-zip-io`。我把 A4 的 file:line 指向 UI 而非 core，正是这个立场。
   但如果 B 侧主张「core 应提供 `createSkillFromZip` 之类的领域入口」，
   那是架构分歧，需要主代理裁决而不是我单方面让步。

4. **`decodeLatin1` 是否该在本轮修**（A9）。`docs/apm/memory/20260907-huge-card-import-crash-fix.md`
   记录的拍板口径是「导入闸门 + 读取侧降级」两道，`decodeLatin1` 未在当时的修复面内。
   把它列为让步而非缺陷，是因为它**当前不越闸**（48MB 输入闸在上游）。
   但我倾向于认为它应该进 backlog——它是一个已知的、已定位的 O(n) 内存放大因子，
   留在代码里只等下一个绕过输入闸的调用方。

5. **我没能覆盖的邻接面**（诚实标注，不假装扫过）：
   - `domain/vfs/logic/vfs-zip-central-dir.ts` / `vfs-zip-filename-decode.ts` 我只按
     「与 A1 相关」的角度读过（解压路径 + 尺寸字段），**没有做完整的畸形归档健壮性审计**；
   - `service/vfs/impl/physical-vfs.service.ts` 我只读了五前缀解析（`:34-100`），
     **没有审计整个只读物理树服务**（它消费 meta 两域，但不属于本区声明范围）；
   - `message-checkpoint` 补点算法本体（`backfill-baseline-checkpoints.ts`）我只读了
     被 import 的入口与返回契约，**没有审计其正确性**（它属于 w9-checkpoint 的地盘）；
   - 双端 UI（`SkillsManageView` / `SkillsSettingsScreen` / `SkillInfoEditModal`）我只读了
     与本区断言直接相关的片段（保留名门调用、重名检查、front matter 重写），
     **没有做完整的 UI 状态机审计**。
