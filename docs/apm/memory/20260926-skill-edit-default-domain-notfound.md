---
date: 2026-09-26 16:20
title: skill 工具 edit 缺省域写死 project——全局技能报 NOT_FOUND 的根因定位
keywords: skill 工具, edit 动作, domain 缺省, project 域, global 域, NOT_FOUND, VfsError 泄漏, formatVfsErrorForLlm, readSkillFile 回落, db 取证
abstract: 桌面端「引用技能→找不到技能」的真因不是技能不存在，而是 skill 工具 edit 动作把缺省 domain 写死成 project，对只存在于 global:meta 的技能直接查 project:{pid}:meta 落空；且 editSkillFile 不像 readSkillFile 那样 catch NOT_FOUND 转 SkillError，VfsError 一路裸奔到 formatVfsErrorForLlm，把内部逻辑路径 /meta/skills/... 直接糊到 UI 和模型脸上。附 db 取证方法与 read/write/edit 三动作的缺省域不对称全表。
---

user:
desktop 发现了一个 bug，发送消息，引用 skill 却发现 skill 找不到。附 nmbackup(1).db（novel.db 备份）。

assistant:
排查结论（只诊断，未改码）：

**取证**：db 是 tdbc/SQLite，`vfs_entry` 表 8 行 `global:meta`（`/meta`、`/meta/skills`、agent-config、助手派遣、节拍成章），**project-meta 一行都没有**；失败的调用在 `chat_message` seq 92/93、session `70e76060-3aa7-456b-aca8-6c36ca0118d2`：
`{"name":"skill","input":{"action":"edit","name":"助手派遣","oldString":...,"newString":...,"path":"SKILL.md"}}` → `Error: [NOT_FOUND] Path not found: /meta/skills/助手派遣/SKILL.md`。
技能本体在 global:meta 里活得好好的（entry 171，v1），所以「找不到」是假象。

**根因链**（四处叠加）：
1. `skill-tool.ts:425` edit 动作 `const domain = input.domain ?? "project"` —— 模型没显式给 domain 就落 project 域。
2. `skills.service.ts:315` `editSkillFile` 要求显式域，**没有 global 回落**（对比 `readSkillFile:262-267` 缺省域是 `["project","global"]` 逐个试）。
3. projectMetaVfs 查 `project:{pid}:meta` 的 `/meta/skills/助手派遣/SKILL.md` → 无行 → `vfs.service.ts:88` 抛 `vfsNotFound`。
4. `editSkillFile` **不 catch NOT_FOUND**（`readSkillFile:280` 才 catch），VfsError 裸奔到 `format-vfs-error-for-llm.ts:83` → `[NOT_FOUND] Path not found: <内部逻辑路径>`，既泄漏 `/meta` 内部结构，又没告诉模型「加 domain:"global" 重试」。

**缺省域不对称全表**（这就是同一个技能 load 成功、edit 失败的原因）：
| 动作 | 缺省域 | 回落 | 失败错误 |
|---|---|---|---|
| load/read | 生效副本 | project→global | SkillError（可读） |
| write | project | 无（合理：新建语义） | 裸 VfsError |
| edit | project | 无（**bug**） | 裸 VfsError |

**修复面**（未实施，待拍板）：① edit 缺省域改「生效副本」或在 project 域 miss 时回落 global（与 read 对齐）；② edit/write 的 NOT_FOUND 收成 SkillError，文案带上「该技能只存在于 global 域，请显式传 domain:"global"」。

（更正：初判以为 skill-tool description 没写 edit 的缺省域，实际 skill-tool.ts:186-187/212 都明写了「domain 缺省 project」，模型看得到。真正让它没法自我修复的是下面这条第二轮发现。）

---

## 第二轮：为什么模型收到报错却没自我修复

**机制本身没坏**——seq 93 就是 role=user 的 tool_result 块（`ok:false`，`content:"Error: [NOT_FOUND] ..."`），正常回灌给模型了。真正发生的是**静默吞错**：

- seq 94 模型立刻换了路子：用 session 域的 `edit` 工具把规则写进 `rules/02_...`（成功），**再没碰过 skill 工具**（全 session 仅 3 次 skill 调用：seq 28 load×2、seq 92 edit，零重试）。
- seq 100 收尾汇报「已将 7 条规则追加到 rules/02…」，**全程没提技能编辑失败**。
- 补充语境：用户 seq 89 的原话是「收录进 **rules** 里」，本来就要写会话文件；**改技能是模型自己加的戏**，所以它放弃这步时自认为任务已完成。

**为什么模型看不出该补 domain**：
1. `ok:false` 与 `summary` 是**内部字段，不发给模型**（`content-block.ts:47-50`、`build-tool-result-block.ts:5` 明注 adapters 忽略）；Anthropic mapper 只映 `tool_use_id`+`content`，`is_error` 全仓从不设置。模型唯一能看到的失败信号就是 **`Error: ` 这个字符串前缀**。
2. 错误文案指向「一个路径不存在」，而不是「你少传了 domain 参数」——指向性错位，模型自然理解成文件问题。
3. **系统提示词里完全没有工具失败处理条款**：`render-prompt.ts:269-277` 原样透传用户自定义 system，全仓 grep 不到任何「失败/重试/如实/静默/隐瞒」类模型可见指令；内置默认 system 仅 `default-subagent-definition.ts:24` 一句通用助手描述。

**故这是两个独立缺陷**：技能侧（错误类型 + 域回落）与提示词侧（缺「工具失败必须如实向用户报告」硬约束）。后者才是「用户只看到红卡片、模型却装作没事」的直接成因。

**坑位**：cmd 下 `node -e "..."` 的双引号被吃掉且静默无输出，写临时 .cjs 文件跑才稳；`vfs_entry` 列表页查 `vfs_content_blob` 才有正文，`vfs_entry.content` 全 null。

---

## 第三轮：统一参数校验框架——框架已存在，skill 主动退出了

用户质疑：read/write/edit 报错很完善，skill 怎么就不对；工具参数校验应有统一框架。

**框架确实已存在**（不是要新建）：`ToolRunner.call`（`tool-runner.ts:92-95`）`inputSchema.safeParse` → `toolInvalidArgument(name, issues)` → `format-tool-output.ts:420-427` 把 `details.issues` 摊平成 `issues.map(i=>i.message).join("; ")`。文件工具的「完善」正是走这条零手写代码的路。

**skill 为什么没走到**：skill-tool.ts:203-231 把**所有字段都在 zod 里标成 `.optional()`**（`name`/`content`/`oldString` 全 optional），再在 `run()` 里用 `requireString()`（131-144）手写中文校验 —— 等于主动绕过框架。read/write/edit 则是 `path: z.string().min(1)`、`content: z.string()` 直接声明必填，缺失即 framework 报错。

**`fs` 工具是「条件必填」的现成范本**（结构与 skill 的 action 分发完全同构）：`fs-command.ts` 的 `parseFsCommand` 返回判别联合 `FsCommand`，用 `requireField(input.path, "path")` 逐子命令校验，报 `Invalid fs command: missing or empty path`。skill 的 `requireString` 就是它的劣化手写版。

**关键诚实点：补齐「必填参数框架」抓不到这个 bug。** 失败调用 `{action:"edit", name, oldString, newString, path:"SKILL.md"}` 里 `domain` 并不缺，它**设计上就是 optional 且缺省 project**——可选参数的默认值错了，任何必填校验都拦不住。

**真正要的三层**：
1. 校验层统一：skill 的 action 分发改造成 `fs-command.ts` 式判别联合 + 必填表（或 zod `superRefine` 表达「edit 时 name 必填」），让 framework 原生产 issue。**（结构改进，不解本 bug）**
2. **失败报错回灌有效值**（本 bug 的真解）：edit/write 失败时把解析出的 domain、project 域有无同名技能、global 域有无，一起写进 SkillError——「技能 X 在 project 域不存在（global 域存在），请显式传 domain:"global"」。
3. 域解析回落：edit 缺省改「生效副本」与 read 对齐，让模型直觉（改我 load 出来的那个）成立。

---

## 第四轮：已实施（用户拍板「就是报错信息不完善，当初没测试出来」）

改了 3 个文件，未提交：

- `src/errors/skill-errors.ts`：新增 `skillNotFoundInDomain(name, path, domain, other?)`。`other.exists` **三态**：`true` → 提示「该技能存在于 X 域，请显式传 domain:"X"」；`false` → 「X 域也没有该技能」；`null`（**无法确认**）→「未能确认 X 域是否存在（缺 projectId 无法探测）」。三态不可并成两态——把「查不了」说成「没有」会把调用方引到错的方向新建。
- `src/service/skills/impl/skills.service.ts`：新增 `skillFileExistsInDomain()`（回 `boolean | null`）与 `toWriteNotFoundError()`；`editSkillFile` / `writeSkillFile` 的 vfs 调用包 try/catch，NOT_FOUND 收成 SkillError，非 NOT_FOUND 原样透传。
- `test/skills/skill-write-domain-not-found.test.ts`（新增 7 条）：project 域缺 global 技能→提示 domain:"global"；global 域缺 project 技能→提示 domain:"project"；无 projectId→明说无法确认；两域皆无→给新建提示；write 落 project 域是在 project 域**新建副本不动 global**（写语义既有约定）；正向 edit 成功；oldString 匹配失败**不得**被误转成域错误。

**两个实现坑**：
1. helper 声明 `Promise<never>` 会让 tsc 报 TS2366（`await` 一个 `Promise<never>` 不足以认定外层函数终止）——改成返回 `Promise<SkillError>`、调用点 `throw await ...`。
2. `assert.rejects()` **不回传错误对象**（拿到的是 undefined），测错误文案必须自己 try/catch 抓。

**验证**：core typecheck 零错；skills + tool/skill-tool + bootstrap/seed 三组 95 条全绿；lint 仅剩 3 个**历史遗留** error（character-card/sanitize-entry-filename、chat/annotate-source-range、test/skills/skills.service.test.ts:572 no-useless-escape），均在本次改动文件之外。

**未做（留待拍板）**：① edit 缺省域改「生效副本」的回落；② skill 工具 zod 改判别联合/`superRefine` 走统一必填框架（结构债，不解本 bug）；③ 系统提示词补「工具失败须如实向用户报告」——这条才是「模型静默吞错」的直接成因，本次只修了错误信息那一半。

---

## 第五轮：代码债清完（用户定调「提示词不能乱动，只考虑代码的完善」）

**用户明确边界：系统提示词是用户的事，不许动。** 只做代码。

### 改动

`src/domain/tool/builtin/skill-tool.ts`——参数校验接入既有统一框架（`ToolRunner.call` → `safeParse` → `toolInvalidArgument` → `format-tool-output.ts:420-427` 摊平 zod issues）：

- 新增 `SKILL_ACTION_REQUIRED_FIELDS` 必填字段表（单一事实源）+ `SKILL_FIELD_LABELS` 文案表 + `refineRequiredFields` 回调，挂在 `inputSchema` 的 `.superRefine()` 上；**删掉手写的 `requireString()`**。
- `run()` 里改用 `requiredField()`——只做类型收窄，不再产出给模型看的错误（schema 已拦）。
- **`edit` 的 `domain` 改为必填**，移除 `input.domain ?? "project"` 的静默缺省。同名技能可能同时有 project 副本与 global 本体，edit 打哪一份有歧义，猜不得。`write` 保留缺省 project（写向项目域=建覆盖副本，语义明确无歧义）。description 与 zod `.describe()` 同步写明。

### 为什么不用 zod 判别联合（关键取舍）

判别联合会让 `zodToJsonSchema` 产出 `anyOf`，多数 provider 的 function-calling 对 `anyOf` 支持参差，工具定义会变难用。`superRefine` 实测：JSON Schema 仍是扁平 object（refinement 不进 schema，条件规则由 `.describe()` 讲给模型听），`safeParse` 照常给出带 `path` 的 issue——两头都要到了。

### 测试

`test/tool/skill-tool.test.ts`：改「edit」用例补 `domain:"global"`（原用例断言缺省 project，正是要改的行为）；新增「edit 缺 domain 被 schema 拦截」+「read/write/edit 缺必填字段统一报 INVALID_ARGUMENT」表驱动用例（每例都断言**不触达 SkillService**）。

### 验证

- core typecheck 零错；tool + skills + bootstrap 375 条全绿；stash 掉改动后复跑亦全绿。
- core **全量 2168 条：2166 通过，2 失败**——`usage stats service (T-S5)` 的 T-C2（本地时区天边界）与 T-C6（DST 归桶）。已用 `git stash` 实证为**改动前既有失败**（stash 后同样 fail 2），与本次无关。
- lint 前后同为 111 problems / 3 errors，3 个 error 均在 `sanitize-entry-filename.ts`、`annotate-source-range.ts`、`skills.service.test.ts:572`，不在改动文件内。

### 净效果（模型视角）

缺参 → 框架直接报「skill 的 edit 动作必须提供技能域 domain（"global" 或 "project"）——edit 必须显式指定改哪一份副本」；域传错 → 服务报「技能 X 在 project 域不存在；该技能存在于 global 域；请显式传 domain:"global"」。两条路都不再泄漏 `/meta` 内部路径。

**唯一遗留**：模型即便拿到可操作错误，也可能选择放弃子任务而不向用户汇报——那是提示词层的事，按用户要求不碰。

---

## 第六轮：真实 LLM e2e 验证（zhipu glm-4.7，全绿）

**服务商可用**：`C:\Users\BloodyCrown\AppData\Roaming\@novel-master\desktop\novel.db`（262KB，packaged exe 用的不是这个路径——没有 `Roaming\Novel Master\` 目录）。7 个 provider、2 个 saved_model（glm-4.7 / zhipu、deepseek-v4-flash）、3 条 DPAPI 加密 secret。`nm model request` 实测回「好的」，通的。**注意该库 `vfs_entry` 为空、没种过内置技能**，e2e 得自己先 write 一个技能。

**e2e 三个坑（下次直接照抄）**：
1. **`apps/cli` 引的是 core 的 `dist/` 不是 `src/`**——改完 core 必须先 `npm run build -w @novel-master/core`，否则 e2e 跑的是旧代码（第一次跑就踩了，报的还是老文案，差点误判修复无效）。
2. `sessions.create(projectId, title?)` 是**位置参数**不是对象（写成对象报 `Too few parameter values`，SQLITE_ERROR，栈很难看懂）。
3. `@novel-master/core/src/...` 深路径 import 被 package exports 拒（ERR_PACKAGE_PATH_NOT_EXPORTED），e2e 脚本只能用公开出口（`@novel-master/core/agent` 的 `runAgentTurn`）或放在 packages/core 内用相对路径。
4. `state.setCurrentModelId(id)` 会校验必须是已保存模型 UUID；会话创建需要 registry 非空或 `setCurrentAgentId`。
5. cmd 下 `set "X=%TEMP%\..."` 不展开，会建出字面量 `%TMPD%` 目录；直接写绝对路径。

**跑法**：`createNovelMasterRuntime(["--db", <db>])` → `rt.skills().writeSkillFile("global", ...)` 造只存在于 global 的技能 → `rt.projects.create` → `rt.state.setCurrentModelId` → `rt.sessions.create(pid, "e2e")` → `runAgentTurn(rt, {projectId, sessionId}, prompt, {stream:false})` → `rt.messages.listBySession(sessionId)` 读 blocks 里的 tool_use/tool_result 对。**用 db 副本，别碰真库**（`copy` 到 D:\App\Temp 后跑完删）。

### 三个场景实测结果

**S1 正常改全局技能**：模型读到 description 里「edit domain 必填」，**第一次就传了 `domain:"global"`**，零失败，steps=3。

**S2 用户误以为技能在项目域**（逼出主错误路径）：
```
→ skill {"action":"edit","domain":"project",...}
  x Error: 技能 e2e-助手派遣 在 project 域不存在（文件 SKILL.md）；该技能存在于 global 域；如需修改它，请显式传 domain:"global"。
→ skill {"action":"edit","domain":"global",...}     ← 立刻照提示重试，成功
```
收尾还主动交代：「完成。（注：该技能实际存在于 global 域，project 域无副本…）」——**没有静默吞错**。

**S3 技能压根不存在**（逼出 schema 校验 + 两域皆无分支）：
```
→ skill {"action":"edit",...,"newString":""}
  x Error: skill 的 edit 动作必须提供替换串 newString     ← 统一框架在真实回合生效
→ skill {"action":"edit","domain":"global",...}
  x Error: 技能 X 在 global 域不存在（文件 SKILL.md）；project 域也没有该技能；如需在 global 域新建，请显式传 domain:"global"。
```
收尾如实汇报无法完成并说明原因。

### 修复前后对照（同一真实模型）

| | 修复前 | 修复后 |
|---|---|---|
| 报错原文 | `[NOT_FOUND] Path not found: /meta/skills/助手派遣/SKILL.md` | `技能 X 在 project 域不存在；该技能存在于 global 域；请显式传 domain:"global"。` |
| 泄漏内部路径 | 是 | **0 次** |
| 模型反应 | 需额外 `list` 探测才知道域 | 照提示直接重试 |
| 是否向用户交代 | 静默放弃该子任务 | 明确说明并纠正用户误解 |

**结论：修复在真实 LLM 回合里成立，两个失败分支（域选错 / 技能不存在）与 schema 参数校验均按预期产出可操作文案，模型能自我修复且不吞错。**

---

## 提交

分支 `fix/skill-tool-domain-error`（基于 main `0e4c2251`，worktree `.worktree/skill-tool-domain-error`）：
- `ebf238c9` fix(core)：源码 + 测试（5 files，+477/-28）
- `d457be3e` docs(apm)：本记忆文件

worktree 内验证：`npm ci` + `npm run build -w @novel-master/tdbc-driver-better-sqlite3`（新 worktree 必须单独 build workspace 包，否则 core 测试报 tdbc-driver dist 缺失）→ typecheck 零错、skills + skill-tool 93 条全绿。

---

## 第七轮：合并与 changelog

- `23af57b8` merge --no-ff 并入 main（基于 `0e4c2251`；合并前确认迭代分支领先的 9 个提交只碰 docs/ 与 scripts/，packages/core 与 main 逐字节一致）。搬运改动时用 `git stash push -u` 只挑本次 6 个文件，避免把既有的 20260923-mobile-perf-issues-batch.md 未提交修改卷进来。
- `13868888` docs(changelog)：CHANGELOG 新建 `## [Unreleased]` 段（合并前该段不存在——v1.5.22 发版时被清空），补一条「修复：AI 修改技能时改不动、报错看不懂」。按用户要求**暂不发布新版本**，条目留在 Unreleased 等 publish skill 挪版本号。
- 未推送。main 领先 origin/main 4 个提交。

## 第八轮：CHANGELOG 重复段清理（用户拍板「清理下吧」）

- `450195b9` docs(changelog)：删除 `## [1.5.10]` → `## [1.3.13]` 的重复段，**纯删除 682 行、零新增**。
- 清理前先做逐行比对验证（不靠行号猜测）：第二块 0-based 902..1583（682 行）与第一块 220..901 **逐行完全一致**；边界干净（删除点前一行 `- 版本号对齐与常规维护` 正是 1.3.13 的维护条目，即原文结尾）。清理前 42 个版本段各出现两次。
- 清理后核验：903 行、55 个版本段、无重复；段序 Unreleased → 1.5.22 → … → 1.3.13 正确；Unreleased 条目仍在。
- 起因：用 `git show 0e4c2251:CHANGELOG.md` 对照确认是**合并前既有**、与本次改动无关（疑似某次 merge 把 1.5.10→1.3.13 整段重复追加到文件末尾）。
- **遗留小瑕疵（未动）**：CHANGELOG 第 465 行 `$time / $filetree` 是裸 `---
date: 2026-09-26 16:20
title: skill 工具 edit 缺省域写死 project——全局技能报 NOT_FOUND 的根因定位
keywords: skill 工具, edit 动作, domain 缺省, project 域, global 域, NOT_FOUND, VfsError 泄漏, formatVfsErrorForLlm, readSkillFile 回落, db 取证
abstract: 桌面端「引用技能→找不到技能」的真因不是技能不存在，而是 skill 工具 edit 动作把缺省 domain 写死成 project，对只存在于 global:meta 的技能直接查 project:{pid}:meta 落空；且 editSkillFile 不像 readSkillFile 那样 catch NOT_FOUND 转 SkillError，VfsError 一路裸奔到 formatVfsErrorForLlm，把内部逻辑路径 /meta/skills/... 直接糊到 UI 和模型脸上。附 db 取证方法与 read/write/edit 三动作的缺省域不对称全表。
---

user:
desktop 发现了一个 bug，发送消息，引用 skill 却发现 skill 找不到。附 nmbackup(1).db（novel.db 备份）。

assistant:
排查结论（只诊断，未改码）：

**取证**：db 是 tdbc/SQLite，`vfs_entry` 表 8 行 `global:meta`（`/meta`、`/meta/skills`、agent-config、助手派遣、节拍成章），**project-meta 一行都没有**；失败的调用在 `chat_message` seq 92/93、session `70e76060-3aa7-456b-aca8-6c36ca0118d2`：
`{"name":"skill","input":{"action":"edit","name":"助手派遣","oldString":...,"newString":...,"path":"SKILL.md"}}` → `Error: [NOT_FOUND] Path not found: /meta/skills/助手派遣/SKILL.md`。
技能本体在 global:meta 里活得好好的（entry 171，v1），所以「找不到」是假象。

**根因链**（四处叠加）：
1. `skill-tool.ts:425` edit 动作 `const domain = input.domain ?? "project"` —— 模型没显式给 domain 就落 project 域。
2. `skills.service.ts:315` `editSkillFile` 要求显式域，**没有 global 回落**（对比 `readSkillFile:262-267` 缺省域是 `["project","global"]` 逐个试）。
3. projectMetaVfs 查 `project:{pid}:meta` 的 `/meta/skills/助手派遣/SKILL.md` → 无行 → `vfs.service.ts:88` 抛 `vfsNotFound`。
4. `editSkillFile` **不 catch NOT_FOUND**（`readSkillFile:280` 才 catch），VfsError 裸奔到 `format-vfs-error-for-llm.ts:83` → `[NOT_FOUND] Path not found: <内部逻辑路径>`，既泄漏 `/meta` 内部结构，又没告诉模型「加 domain:"global" 重试」。

**缺省域不对称全表**（这就是同一个技能 load 成功、edit 失败的原因）：
| 动作 | 缺省域 | 回落 | 失败错误 |
|---|---|---|---|
| load/read | 生效副本 | project→global | SkillError（可读） |
| write | project | 无（合理：新建语义） | 裸 VfsError |
| edit | project | 无（**bug**） | 裸 VfsError |

**修复面**（未实施，待拍板）：① edit 缺省域改「生效副本」或在 project 域 miss 时回落 global（与 read 对齐）；② edit/write 的 NOT_FOUND 收成 SkillError，文案带上「该技能只存在于 global 域，请显式传 domain:"global"」。

（更正：初判以为 skill-tool description 没写 edit 的缺省域，实际 skill-tool.ts:186-187/212 都明写了「domain 缺省 project」，模型看得到。真正让它没法自我修复的是下面这条第二轮发现。）

---

## 第二轮：为什么模型收到报错却没自我修复

**机制本身没坏**——seq 93 就是 role=user 的 tool_result 块（`ok:false`，`content:"Error: [NOT_FOUND] ..."`），正常回灌给模型了。真正发生的是**静默吞错**：

- seq 94 模型立刻换了路子：用 session 域的 `edit` 工具把规则写进 `rules/02_...`（成功），**再没碰过 skill 工具**（全 session 仅 3 次 skill 调用：seq 28 load×2、seq 92 edit，零重试）。
- seq 100 收尾汇报「已将 7 条规则追加到 rules/02…」，**全程没提技能编辑失败**。
- 补充语境：用户 seq 89 的原话是「收录进 **rules** 里」，本来就要写会话文件；**改技能是模型自己加的戏**，所以它放弃这步时自认为任务已完成。

**为什么模型看不出该补 domain**：
1. `ok:false` 与 `summary` 是**内部字段，不发给模型**（`content-block.ts:47-50`、`build-tool-result-block.ts:5` 明注 adapters 忽略）；Anthropic mapper 只映 `tool_use_id`+`content`，`is_error` 全仓从不设置。模型唯一能看到的失败信号就是 **`Error: ` 这个字符串前缀**。
2. 错误文案指向「一个路径不存在」，而不是「你少传了 domain 参数」——指向性错位，模型自然理解成文件问题。
3. **系统提示词里完全没有工具失败处理条款**：`render-prompt.ts:269-277` 原样透传用户自定义 system，全仓 grep 不到任何「失败/重试/如实/静默/隐瞒」类模型可见指令；内置默认 system 仅 `default-subagent-definition.ts:24` 一句通用助手描述。

**故这是两个独立缺陷**：技能侧（错误类型 + 域回落）与提示词侧（缺「工具失败必须如实向用户报告」硬约束）。后者才是「用户只看到红卡片、模型却装作没事」的直接成因。

**坑位**：cmd 下 `node -e "..."` 的双引号被吃掉且静默无输出，写临时 .cjs 文件跑才稳；`vfs_entry` 列表页查 `vfs_content_blob` 才有正文，`vfs_entry.content` 全 null。

---

## 第三轮：统一参数校验框架——框架已存在，skill 主动退出了

用户质疑：read/write/edit 报错很完善，skill 怎么就不对；工具参数校验应有统一框架。

**框架确实已存在**（不是要新建）：`ToolRunner.call`（`tool-runner.ts:92-95`）`inputSchema.safeParse` → `toolInvalidArgument(name, issues)` → `format-tool-output.ts:420-427` 把 `details.issues` 摊平成 `issues.map(i=>i.message).join("; ")`。文件工具的「完善」正是走这条零手写代码的路。

**skill 为什么没走到**：skill-tool.ts:203-231 把**所有字段都在 zod 里标成 `.optional()`**（`name`/`content`/`oldString` 全 optional），再在 `run()` 里用 `requireString()`（131-144）手写中文校验 —— 等于主动绕过框架。read/write/edit 则是 `path: z.string().min(1)`、`content: z.string()` 直接声明必填，缺失即 framework 报错。

**`fs` 工具是「条件必填」的现成范本**（结构与 skill 的 action 分发完全同构）：`fs-command.ts` 的 `parseFsCommand` 返回判别联合 `FsCommand`，用 `requireField(input.path, "path")` 逐子命令校验，报 `Invalid fs command: missing or empty path`。skill 的 `requireString` 就是它的劣化手写版。

**关键诚实点：补齐「必填参数框架」抓不到这个 bug。** 失败调用 `{action:"edit", name, oldString, newString, path:"SKILL.md"}` 里 `domain` 并不缺，它**设计上就是 optional 且缺省 project**——可选参数的默认值错了，任何必填校验都拦不住。

**真正要的三层**：
1. 校验层统一：skill 的 action 分发改造成 `fs-command.ts` 式判别联合 + 必填表（或 zod `superRefine` 表达「edit 时 name 必填」），让 framework 原生产 issue。**（结构改进，不解本 bug）**
2. **失败报错回灌有效值**（本 bug 的真解）：edit/write 失败时把解析出的 domain、project 域有无同名技能、global 域有无，一起写进 SkillError——「技能 X 在 project 域不存在（global 域存在），请显式传 domain:"global"」。
3. 域解析回落：edit 缺省改「生效副本」与 read 对齐，让模型直觉（改我 load 出来的那个）成立。

---

## 第四轮：已实施（用户拍板「就是报错信息不完善，当初没测试出来」）

改了 3 个文件，未提交：

- `src/errors/skill-errors.ts`：新增 `skillNotFoundInDomain(name, path, domain, other?)`。`other.exists` **三态**：`true` → 提示「该技能存在于 X 域，请显式传 domain:"X"」；`false` → 「X 域也没有该技能」；`null`（**无法确认**）→「未能确认 X 域是否存在（缺 projectId 无法探测）」。三态不可并成两态——把「查不了」说成「没有」会把调用方引到错的方向新建。
- `src/service/skills/impl/skills.service.ts`：新增 `skillFileExistsInDomain()`（回 `boolean | null`）与 `toWriteNotFoundError()`；`editSkillFile` / `writeSkillFile` 的 vfs 调用包 try/catch，NOT_FOUND 收成 SkillError，非 NOT_FOUND 原样透传。
- `test/skills/skill-write-domain-not-found.test.ts`（新增 7 条）：project 域缺 global 技能→提示 domain:"global"；global 域缺 project 技能→提示 domain:"project"；无 projectId→明说无法确认；两域皆无→给新建提示；write 落 project 域是在 project 域**新建副本不动 global**（写语义既有约定）；正向 edit 成功；oldString 匹配失败**不得**被误转成域错误。

**两个实现坑**：
1. helper 声明 `Promise<never>` 会让 tsc 报 TS2366（`await` 一个 `Promise<never>` 不足以认定外层函数终止）——改成返回 `Promise<SkillError>`、调用点 `throw await ...`。
2. `assert.rejects()` **不回传错误对象**（拿到的是 undefined），测错误文案必须自己 try/catch 抓。

**验证**：core typecheck 零错；skills + tool/skill-tool + bootstrap/seed 三组 95 条全绿；lint 仅剩 3 个**历史遗留** error（character-card/sanitize-entry-filename、chat/annotate-source-range、test/skills/skills.service.test.ts:572 no-useless-escape），均在本次改动文件之外。

**未做（留待拍板）**：① edit 缺省域改「生效副本」的回落；② skill 工具 zod 改判别联合/`superRefine` 走统一必填框架（结构债，不解本 bug）；③ 系统提示词补「工具失败须如实向用户报告」——这条才是「模型静默吞错」的直接成因，本次只修了错误信息那一半。

---

## 第五轮：代码债清完（用户定调「提示词不能乱动，只考虑代码的完善」）

**用户明确边界：系统提示词是用户的事，不许动。** 只做代码。

### 改动

`src/domain/tool/builtin/skill-tool.ts`——参数校验接入既有统一框架（`ToolRunner.call` → `safeParse` → `toolInvalidArgument` → `format-tool-output.ts:420-427` 摊平 zod issues）：

- 新增 `SKILL_ACTION_REQUIRED_FIELDS` 必填字段表（单一事实源）+ `SKILL_FIELD_LABELS` 文案表 + `refineRequiredFields` 回调，挂在 `inputSchema` 的 `.superRefine()` 上；**删掉手写的 `requireString()`**。
- `run()` 里改用 `requiredField()`——只做类型收窄，不再产出给模型看的错误（schema 已拦）。
- **`edit` 的 `domain` 改为必填**，移除 `input.domain ?? "project"` 的静默缺省。同名技能可能同时有 project 副本与 global 本体，edit 打哪一份有歧义，猜不得。`write` 保留缺省 project（写向项目域=建覆盖副本，语义明确无歧义）。description 与 zod `.describe()` 同步写明。

### 为什么不用 zod 判别联合（关键取舍）

判别联合会让 `zodToJsonSchema` 产出 `anyOf`，多数 provider 的 function-calling 对 `anyOf` 支持参差，工具定义会变难用。`superRefine` 实测：JSON Schema 仍是扁平 object（refinement 不进 schema，条件规则由 `.describe()` 讲给模型听），`safeParse` 照常给出带 `path` 的 issue——两头都要到了。

### 测试

`test/tool/skill-tool.test.ts`：改「edit」用例补 `domain:"global"`（原用例断言缺省 project，正是要改的行为）；新增「edit 缺 domain 被 schema 拦截」+「read/write/edit 缺必填字段统一报 INVALID_ARGUMENT」表驱动用例（每例都断言**不触达 SkillService**）。

### 验证

- core typecheck 零错；tool + skills + bootstrap 375 条全绿；stash 掉改动后复跑亦全绿。
- core **全量 2168 条：2166 通过，2 失败**——`usage stats service (T-S5)` 的 T-C2（本地时区天边界）与 T-C6（DST 归桶）。已用 `git stash` 实证为**改动前既有失败**（stash 后同样 fail 2），与本次无关。
- lint 前后同为 111 problems / 3 errors，3 个 error 均在 `sanitize-entry-filename.ts`、`annotate-source-range.ts`、`skills.service.test.ts:572`，不在改动文件内。

### 净效果（模型视角）

缺参 → 框架直接报「skill 的 edit 动作必须提供技能域 domain（"global" 或 "project"）——edit 必须显式指定改哪一份副本」；域传错 → 服务报「技能 X 在 project 域不存在；该技能存在于 global 域；请显式传 domain:"global"」。两条路都不再泄漏 `/meta` 内部路径。

**唯一遗留**：模型即便拿到可操作错误，也可能选择放弃子任务而不向用户汇报——那是提示词层的事，按用户要求不碰。

---

## 第六轮：真实 LLM e2e 验证（zhipu glm-4.7，全绿）

**服务商可用**：`C:\Users\BloodyCrown\AppData\Roaming\@novel-master\desktop\novel.db`（262KB，packaged exe 用的不是这个路径——没有 `Roaming\Novel Master\` 目录）。7 个 provider、2 个 saved_model（glm-4.7 / zhipu、deepseek-v4-flash）、3 条 DPAPI 加密 secret。`nm model request` 实测回「好的」，通的。**注意该库 `vfs_entry` 为空、没种过内置技能**，e2e 得自己先 write 一个技能。

**e2e 三个坑（下次直接照抄）**：
1. **`apps/cli` 引的是 core 的 `dist/` 不是 `src/`**——改完 core 必须先 `npm run build -w @novel-master/core`，否则 e2e 跑的是旧代码（第一次跑就踩了，报的还是老文案，差点误判修复无效）。
2. `sessions.create(projectId, title?)` 是**位置参数**不是对象（写成对象报 `Too few parameter values`，SQLITE_ERROR，栈很难看懂）。
3. `@novel-master/core/src/...` 深路径 import 被 package exports 拒（ERR_PACKAGE_PATH_NOT_EXPORTED），e2e 脚本只能用公开出口（`@novel-master/core/agent` 的 `runAgentTurn`）或放在 packages/core 内用相对路径。
4. `state.setCurrentModelId(id)` 会校验必须是已保存模型 UUID；会话创建需要 registry 非空或 `setCurrentAgentId`。
5. cmd 下 `set "X=%TEMP%\..."` 不展开，会建出字面量 `%TMPD%` 目录；直接写绝对路径。

**跑法**：`createNovelMasterRuntime(["--db", <db>])` → `rt.skills().writeSkillFile("global", ...)` 造只存在于 global 的技能 → `rt.projects.create` → `rt.state.setCurrentModelId` → `rt.sessions.create(pid, "e2e")` → `runAgentTurn(rt, {projectId, sessionId}, prompt, {stream:false})` → `rt.messages.listBySession(sessionId)` 读 blocks 里的 tool_use/tool_result 对。**用 db 副本，别碰真库**（`copy` 到 D:\App\Temp 后跑完删）。

### 三个场景实测结果

**S1 正常改全局技能**：模型读到 description 里「edit domain 必填」，**第一次就传了 `domain:"global"`**，零失败，steps=3。

**S2 用户误以为技能在项目域**（逼出主错误路径）：
```
→ skill {"action":"edit","domain":"project",...}
  x Error: 技能 e2e-助手派遣 在 project 域不存在（文件 SKILL.md）；该技能存在于 global 域；如需修改它，请显式传 domain:"global"。
→ skill {"action":"edit","domain":"global",...}     ← 立刻照提示重试，成功
```
收尾还主动交代：「完成。（注：该技能实际存在于 global 域，project 域无副本…）」——**没有静默吞错**。

**S3 技能压根不存在**（逼出 schema 校验 + 两域皆无分支）：
```
→ skill {"action":"edit",...,"newString":""}
  x Error: skill 的 edit 动作必须提供替换串 newString     ← 统一框架在真实回合生效
→ skill {"action":"edit","domain":"global",...}
  x Error: 技能 X 在 global 域不存在（文件 SKILL.md）；project 域也没有该技能；如需在 global 域新建，请显式传 domain:"global"。
```
收尾如实汇报无法完成并说明原因。

### 修复前后对照（同一真实模型）

| | 修复前 | 修复后 |
|---|---|---|
| 报错原文 | `[NOT_FOUND] Path not found: /meta/skills/助手派遣/SKILL.md` | `技能 X 在 project 域不存在；该技能存在于 global 域；请显式传 domain:"global"。` |
| 泄漏内部路径 | 是 | **0 次** |
| 模型反应 | 需额外 `list` 探测才知道域 | 照提示直接重试 |
| 是否向用户交代 | 静默放弃该子任务 | 明确说明并纠正用户误解 |

**结论：修复在真实 LLM 回合里成立，两个失败分支（域选错 / 技能不存在）与 schema 参数校验均按预期产出可操作文案，模型能自我修复且不吞错。**

---

## 提交

分支 `fix/skill-tool-domain-error`（基于 main `0e4c2251`，worktree `.worktree/skill-tool-domain-error`）：
- `ebf238c9` fix(core)：源码 + 测试（5 files，+477/-28）
- `d457be3e` docs(apm)：本记忆文件

worktree 内验证：`npm ci` + `npm run build -w @novel-master/tdbc-driver-better-sqlite3`（新 worktree 必须单独 build workspace 包，否则 core 测试报 tdbc-driver dist 缺失）→ typecheck 零错、skills + skill-tool 93 条全绿。

---

## 第七轮：合并与 changelog

- `23af57b8` merge --no-ff 并入 main（基于 `0e4c2251`；合并前确认迭代分支领先的 9 个提交只碰 docs/ 与 scripts/，packages/core 与 main 逐字节一致）。搬运改动时用 `git stash push -u` 只挑本次 6 个文件，避免把既有的 20260923-mobile-perf-issues-batch.md 未提交修改卷进来。
- `13868888` docs(changelog)：CHANGELOG 新建 `## [Unreleased]` 段（合并前该段不存在——v1.5.22 发版时被清空），补一条「修复：AI 修改技能时改不动、报错看不懂」。按用户要求**暂不发布新版本**，条目留在 Unreleased 等 publish skill 挪版本号。
- 未推送。main 领先 origin/main 4 个提交。

（未包反引号），按 changelog skill 的校对清单会被数学插件渲染成红色。属已发布版本的历史文案，改动会与已生成的 Release notes 产生差异，故未碰。
