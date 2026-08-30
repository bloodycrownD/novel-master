---
date: 2026-08-30
---

# 导入目录规则默认开启（角色卡 + ZIP）技术规格（SPEC）

## 设计目标

对应 PRD：`docs/Iterations/import-dir-rule-default-on/prd.md`。导入（角色卡 / ZIP）产生的所有新增目录（含任意深度嵌套）默认开启目录规则，由 Core 导入链路在事务内统一保证；mobile 删除 UI 层补行；desktop / CLI 走同一 Core 链路零改动受益。

## 总体方案

在 Core 侧新建共享 helper `ensureImportDirRules`：导入事务内、文件全部写入之后，用 `listDirectoryPathsUnderPrefix` 拿到导入目标前缀下的全部目录，与 workplace 规则表已有行求差，对无行目录补默认启用规则行（默认值复用 `DEFAULT_WORKPLACE_DIR_RULE`）。角色卡导入与 ZIP 导入两个服务在各自事务内调用同一 helper。

关键设计决策：

1. **补行位置在事务内**：与目录/文件写入同事务提交，从结构上消灭「reload 时行未落库」的竞态（mobile 现状 UI 时序问题的根因）。
2. **「无行才补」而非快照差集**：导入是先删前缀再重建（`releaseAndDeleteVfsPrefix` → `deleteRecursiveIfAny` 清整棵子树，不碰 workplace 表，已有规则行原样保留），因此「导入后前缀下的目录 ∖ 已有规则行」即为待补集合，天然满足「不覆盖已有设置（含 rule_off）」，mobile 的 `beforeDirPaths` 快照方案整个废弃。边界说明：前缀下不在导入内容里的旧目录会被连带删除、不进差集；导入内容里的同名目录属于重建产物，无行即补默认开（与 PRD 口径一致），不是范围外溢。
3. **走 repo 原语而非 WorkplaceService**：helper 直接使用事务级 `SqliteWorkplaceRepository`（与导入服务内四处 `new Sqlite*Repository(tx)` 的既有模式一致），按 `DEFAULT_WORKPLACE_DIR_RULE + ruleEnabled: true` 构造整行 `upsertDirRule`。构造成须与 `WorkplaceService.setDirRule({ logicalPath })` 的产物逐字段等价（含路径规范化与 `scopeKey`）。
4. **scope 键空间必须分开算**：vfs 的 `scopeKey`（session 为 `session:${projectId}:${sessionId}`）与 workplace 的 `workplaceScopeKey`（session 为 `session:${sessionId}`）是两套键空间。helper 内部一律用 `workplaceScopeKey(scope)`（`packages/core/src/domain/workplace/logic/workplace-scope.ts`），严禁把导入服务里的 vfs `sk` 直接传给 workplace repo。
5. **目标目录自身（prefix 自身）**：`listDirectoryPathsUnderPrefix` 含 prefix 自身，按「无行才补」统一处理（目标目录自身无行也补，有行不动），不做特殊跳过。
6. **容错口径**：helper 整体 try/catch 吞错 + `console.warn`（对齐 `clear-session-prompt-caches` 的导入侧口径：文件已落库，补行失败不应让导入报错）。与 clear-session 的差异须注意：它在事务提交**后**吞错，本 helper 在事务**内**吞错，依赖语句级失败不毒化事务（SQLite 语句失败不自动 ROLLBACK，后续语句可继续并提交），该行为由 T-I5 故障注入用例守卫验证。
7. **跳过根路径**：与 `ensureDirRulesForNewPath` 的既有约定一致，`/` 不补。
8. **既有测试契约更新**：`character-card-import.test.ts` T-C15 中「impl 源码不得出现 WorkplaceService 字样」的正则断言，与本需求的架构意图正面冲突。核实说明：该正则（`/WorkplaceService|createWorkplaceService|workplace\.service/i`）实际**不会拦截**计划引入的 `SqliteWorkplaceRepository` / `ensureImportDirRules` 标识符（字符串不匹配），技术上不存在硬冲突；但它守护的架构意图（导入路径不经 workplace 服务层）已被本方案实质突破，契约与实现意图脱节。因此仍**主动改写**为行为断言（不覆盖已有行）；实施者不得因「正则不拦」而跳过改写。

## 最终项目结构

新增：

- `packages/core/src/service/vfs/logic/ensure-import-dir-rules.ts` — 共享补行 helper

修改：

- `packages/core/src/service/vfs/impl/character-card-import.service.ts` — 事务内接入
- `packages/core/src/service/vfs/impl/vfs-zip-io.service.ts` — 事务内接入
- `packages/core/test/character-card/character-card-import.test.ts` — 改 T-C15 契约 + 新用例
- `packages/core/test/vfs/vfs-zip-io.test.ts` — 新用例
- `apps/mobile/src/components/vfs/VfsFileManager.tsx` — `runImport` 删除快照与补行

零改动受益：desktop（main 进程两个导入服务 + renderer）、CLI 两条导入命令、mobile 的 `vfs-zip.service.ts` / `vfs-character-card.service.ts` 薄封装。

可选（Step 5）：`packages/core/src/domain/tool/builtin/vfs-tools.ts` 的 `ensureDirRulesForNewPath` 改为复用抽取后的共享内核。

## 变更点清单

| 文件 | 变更 |
|---|---|
| `service/vfs/logic/ensure-import-dir-rules.ts`（新） | `ensureImportDirRules(deps: { vfsRepo, workplaceRepo, scope, directoryPath })`：目录全集求差、无行补默认行、吞错、跳过根 |
| `impl/character-card-import.service.ts` | 事务内文件写入完成后调用 helper（构造 `new SqliteWorkplaceRepository(tx)`，scopeKey 用 `workplaceScopeKey(scope)`） |
| `impl/vfs-zip-io.service.ts` | 同上（两条路径同构，落点一致：文件写入后、backfill 前后均可） |
| `test/character-card/character-card-import.test.ts` | T-C15 源码正则断言改为行为契约；补嵌套默认开 / rule_off 不覆盖 / workplace scopeKey 断言用例 |
| `test/vfs/vfs-zip-io.test.ts` | 补同口径用例 |
| `apps/mobile/src/components/vfs/VfsFileManager.tsx` | `runImport` 删除 before/after 快照与 `setDirRule` 循环，保留「导入 → `reloadVfsListOnly()` → toast」 |
| （可选）`domain/tool/builtin/vfs-tools.ts` | 复用共享内核 |

## 详细实现步骤

- Step 1 — phase-import-rule-helper — blocking: yes — qa: auto：新建 `ensure-import-dir-rules.ts`：输入事务级 vfs repo + workplace repo + scope + directoryPath；`listDirectoryPathsUnderPrefix(vfsRepo, sk, directoryPath)` 取目录全集（注意这里用 **vfs 的 sk** 查 VFS 表），`workplaceRepo.listDirRules(workplaceScopeKey(scope))` 取已有行（**workplace 键空间**），求差后逐目录 `upsertDirRule` 默认启用行（默认值构造成与 `setDirRule({ logicalPath })` 产物逐字段等价）；跳过 `/`；整体 try/catch + `console.warn`。配套单测（含 scope 键空间正确性、根路径跳过、吞错）。
- Step 2 — phase-import-card — blocking: yes — qa: auto：角色卡导入服务事务内接入 helper；**改写 T-C15 契约**——删除源码正则断言，替换为行为断言「导入后已有规则行（含 rule_off 与自定义 headCount）不被覆盖」；补用例：嵌套目录各层默认开、workplace scope_key 用 workplace 键空间断言。
- Step 3 — phase-import-zip — blocking: yes — qa: auto：ZIP 导入服务事务内接入 helper；补同口径用例（ZIP 显式 `directories` 场景 + 深嵌套场景）。
- Step 4 — phase-mobile-import-ui — blocking: yes — qa: auto：`VfsFileManager.tsx` 的 `runImport` 移除快照差集与补行代码块（约 844-902 行），时序变为「导入 → reload → toast」；`defaultDirRuleForm` 若仅剩新建目录弹窗引用则保留不删。
- Step 5 — phase-tool-kernel-reuse — blocking: no — qa: auto：将 `ensureDirRulesForNewPath` 的求差补行内核切换到共享逻辑（保持 `BuiltinToolContext` 依赖形状不变），`vfs-tools.test.ts` 既有用例全部保持绿。
- Step 6 — phase-import-manual — blocking: no — qa: manual_user：真机验收：导入含嵌套目录的角色卡与 ZIP，导入完成回到列表不进行导航，全部目录显示「开启」；对已显式关闭的目录导入后仍关闭。

## 测试策略

框架：`node:test` + `node:assert/strict`，集成测试走 `novelMasterTestFixture()`；「Core 服务内副作用」范式参照 `test/vfs/clear-session-prompt-caches.test.ts`（故障注入吞错），补规则断言范式参照 `test/tool/vfs-tools.test.ts:97/138/630`。

### 测试用例

- T-I1 — blocking: yes — 导入含多层嵌套目录的角色卡后，前缀下全部目录（含嵌套与目标目录自身）在 workplace 规则表有默认启用行，并经 WorkplaceService 文件树视图确认导入目录参与裁剪（覆盖 PRD 验收第 5 条）（映射 Step 2）
- T-I2 — blocking: yes — ZIP 导入同口径，且显式 `directories` 与隐式父链目录均被覆盖（映射 Step 3）
- T-I3 — blocking: yes — 导入前已存在规则行（rule_off、自定义 headCount:7）的目录，导入后原样保留（映射 Step 2/3，即 T-C15 行为契约）
- T-I4 — blocking: yes — 补入行的 `scope_key` 断言用 workplace 键空间（session 为 `session:${sessionId}`），防止误用 vfs sk（映射 Step 1/2）
- T-I5 — blocking: yes — workplace repo 写入抛错时导入仍成功、已写文件完整（故障注入，映射 Step 1/2）
- T-I6 — blocking: yes — helper 单测：根路径跳过、空差集零写入、吞错路径（映射 Step 1）
- T-I7 — blocking: no — `vfs-tools` 复用内核后既有用例不回归（映射 Step 5）

## 风险与回滚方案

- **scope 键写错**：若误用 vfs sk，规则行落到错误 scope_key 下、列表测试可能漏检——T-I4 用 workplace 键空间显式断言守卫。
- **默认行与 setDirRule 产物不等价**：直构 repo 行绕过了 `normalizePath` / 默认值填充，Step 1 实现时对照 `workplace.service.ts:61-92` 逐字段核对，用「helper 补行结果 === setDirRule 产物」的等价性测试锁定。
- **回滚**：Core 侧 helper 为纯增量、mobile UI 改动独立成 commit；出问题时 revert 对应 commit 即回到「UI 补行」现状，无数据迁移（补行是幂等的 upsert，回滚不产生脏数据）。
- **边界说明**：若未来导入链路接入「删规则行」类操作（如 desktop IPC 删除场景的 `deleteRulesUnderLogicalPrefix`），需重新评估与差集补行的交互。
