# CR Fix Spec: global-fs-manager 只读物理树

## 元信息

- repo：/home/bloodycrown/Dev/novel-master（评审与执行对象均为**主仓库** `feat/skills-integration` 分支，head fb7cf95；勿在 `.woktree/global-fs` 落改——该工作树停在 3015f12，缺 label 增强与 mobile 返回拦截 5 个提交；下文文件路径均为仓库相对路径）
- base_sha / head_sha：5f8aba0 / fb7cf95
- prd_path：docs/Iterations/global-fs-manager/prd.md
- spec_path：docs/Iterations/global-fs-manager/spec.md
- review_round：1
- dag_version：2
- 状态：fix-spec-ready（round 2；主代理依 review-full 预判判定，N-1～N-4 四处修订已按其指示落地）

## Must-fix（按 P0 → P1 → P2）

### meta/C-orch-1 [P0] meta 域逻辑路径双前缀：物理树拼装与 SkillsService 约定不一致
- 维度：C-orch（波及 A/G）
- 文件：
  - `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts`
  - `packages/core/src/service/vfs/impl/physical-vfs.service.ts`
  - `packages/core/test/vfs/vfs-path-mapper.test.ts`（meta 物理前缀改空串/`/projects/{pid}` 后既有 meta 断言须同步改）
  - `packages/core/test/vfs/physical-vfs.test.ts`（造数与断言改造，见验收）
- 问题：SkillsService 在 meta 域 scoped vfs 中写逻辑路径 `/meta/skills/{name}/SKILL.md`（SKILLS_ROOT = `/meta/skills`，spec 明文「逻辑路径 /meta/skills/... 不变」）；而物理树服务把 meta 域逻辑路径当作剥掉挂载段后的相对路径，再拼一次挂载前缀 → 真实技能落在 `/meta/meta/skills/...`。结果 `list('/meta/skills')` 为空、`read('/meta/skills/x/SKILL.md')` NOT_FOUND，PRD 验收「根下可见 meta/skills/demo/SKILL.md」失败。现有 T-PB1/T-PB2 造数用 `globalMetaVfs().write('/skills/...')`，恰好用了错误约定，掩盖了这层冲突。
- 改法（物理侧统一，技能侧不动）：
  - `scopePhysicalPrefix` / `toPhysicalPath`：global-meta 的物理前缀按**空串**处理（物理路径 = 逻辑路径原样）；project-meta 按 `/projects/{pid}` 处理（物理 = 前缀 + 逻辑路径）。这样 global-meta 的 `/meta/skills/...` 物理 = `/meta/skills/...`，project-meta 物理 = `/projects/{pid}/meta/skills/...`，与 spec 树形描述完全一致。
  - `resolvePhysicalPath` read 分流同步：`/meta/...` → global-meta，逻辑路径保持原样；`/projects/{pid}/meta/...` → project-meta，逻辑路径 = 剥掉 `/projects/{pid}`、保留 `/meta/...`。
  - **list 链路输入侧（关键，不可省）**：list 分流传给 `listScopeFirstLevel` 的目录参数须从「挂载段之下的相对路径」切换为**物理形态目录**（global-meta 传 `'/meta' + rest`；project-meta 传 `'/projects/{pid}/meta' + rest`），`listScopeFirstLevel` 以该物理目录为 `base` 切直接子项、输出 `base + '/' + name`——即 list 链路中 `scopePhysicalPrefix` 退化为 base 本身，仅 read 输出 path 拼装仍用。若只改输出侧 prefix 不改输入侧 base：`list('/meta')` 会切出 `meta` 段自指循环（展开 `/meta` 得到 `/meta`）或断链为 `/skills`；project-meta 会拼出 `/projects/{pid}/projects` 废路径。
  - 核对 `packages/core/src/domain/vfs/logic/strip-known-physical-prefixes.ts`：其 regex 独立写死，按上述规则不受影响，仅核对确认，不改动（若核对发现冲突，回到本条修订而不是绕开）。
- 验收/测试：
  - T-PB1/T-PB2 造数**改经 SkillsService 创建技能**（禁止 `globalMetaVfs().write('/skills/...')` 直写，防两种约定再次并存）。
  - 断言 `list('/meta')` 直接见 `skills/`；`read('/meta/skills/{name}/SKILL.md')` 返回内容。
  - core 全量测试绿。
- 来源：review-scope-mobile / round 1（缺陷在 core，击穿 mobile 文件浏览器验收）

### desktop/B-1 [P1] physical BFS 全树拉取无错误隔离
- 维度：B
- 文件：`apps/desktop/src/main/ipc/handlers/physical.ts`
- 问题：BFS 每层 await 期间若某项目/会话被删除会抛 vfsNotFound，整个请求 `ok:false`，面板整树空白、无降级——一个子树坏拖垮全树。
- 改法：per-directory try/catch。vfsNotFound 跳过该子树（其余行照常返回）；其他异常可作为错误占位行返回（不中断整树）。
- 验收/测试：IPC 测试补失败注入（BFS 中途删除项目 / 造 NOT_FOUND），断言其余域的行仍正常返回。测试落点：既有 `apps/desktop/test/physical-vfs-ipc.test.ts`（追加用例）。
- 来源：review-scope-desktop-cli / round 1

### core/B-1 [P2] compareEntries 排序键混用 label ?? 完整路径
- 维度：B
- 文件：`packages/core/src/service/vfs/impl/physical-vfs.service.ts`
- 问题：无 label 的行以 `/projects/{uuid}` 整路径为排序键，`/` 字符序恒小于普通字母 → 未命名行恒排最前，与有 label 行的两组割裂。
- 改法：排序键统一为 `label ?? 路径末段（basename）`。
- 验收/测试：在 `packages/core/test/vfs/physical-vfs.test.ts` 补排序断言（命名/未命名项目混排，断言按展示键稳定排序、未命名不再恒排最前）。
- 来源：review-scope-core / round 1

### core/C-1 [P2] 两处整洁：冗余三元与错字注释
- 维度：C
- 文件：
  - `packages/core/src/service/vfs/impl/physical-vfs.service.ts`
  - `packages/core/src/service/template/logic/initialize-session-workspace.ts`
- 问题：`listScopeFirstLevel` 中 `dirPart = base === "" ? "" : base` 恒等于 `base`，冗余；`initialize-session-workspace.ts` 注释「全部内容部带入」有错字。
- 改法：前者直接用 `base`（删掉恒等三元）；后者注释改为「都带入」。
- 验收/测试：现有 core 全量测试绿（纯整洁改动，无行为变化）。
- 来源：review-scope-core / round 1

### core/G-1 [P2] 测试缺口：BFS 子 agent 会话展开 + 跨项目 sid 守卫零覆盖
- 维度：G
- 文件：`packages/core/test/vfs/physical-vfs.test.ts`（补用例）
- 问题：BFS 子 agent 会话展开（`listByParentSession` 逐层）无任何测试；跨项目 sid 守卫（`session.projectId !== projectId` → NOT_FOUND）也无测试。
- 改法：补两例——① 多层子 agent 会话经 `listByParentSession` 逐层展开进树；② 用 A 项目的路径 + B 项目的 sid 读取，断言 NOT_FOUND。
- 验收/测试：两例均绿并覆盖上述分支。
- 来源：review-scope-core / round 1

### core/G-2 [P2] 测试缺口：read 五个挂载点根应抛 NOT_FOUND 未验证
- 维度：G
- 文件：`packages/core/test/vfs/physical-vfs.test.ts`（补断言）
- 问题：read 五个挂载点根（`/template`、`/meta`、`/projects/{pid}/meta`、`/projects/{pid}/template`、`/projects/{pid}/sessions/{sid}` 等）应抛 NOT_FOUND，未验证；若实际抛 INVALID_PATH 会破坏「无此文件」语义。
- 改法：补五处挂载点根的 read 断言，期望 NOT_FOUND；若实测非 NOT_FOUND，随 meta/C-orch-1（P0）修复一并归一为 NOT_FOUND。
- 验收/测试：断言齐全且全部绿。
- 来源：review-scope-core / round 1

### mobile/B-1 [P2] beforeRemove 拦截器无条件 preventDefault，吞掉 RESET/POP_TO_TOP
- 维度：B
- 文件：`apps/mobile/src/screens/stack/GlobalTemplateScreen.tsx`（约 L53-59 的 `beforeRemove` 监听）
- 问题：当前监听只判断 `fileRef.current?.canGoUp()`，满足即无条件 `e.preventDefault()` 并 `goUp()`；未来登出清栈等 RESET / POP_TO_TOP 导航动作会被吞成「上翻一级」。
- 改法：判断 `e.data.action.type`，只拦截侧滑返回 / POP 类动作；RESET / POP_TO_TOP 放行（不 preventDefault、不 goUp）。
- 验收/测试：见 mobile/G-1 用例②（子目录 POP 被拦 + 根目录/RESET 放行）。
- 来源：review-scope-mobile / round 1

### mobile/G-1 [P2] 测试缺口：合并后三修复零用例
- 维度：G
- 文件：`apps/mobile/__tests__/`（建议新建，如 `global-template-screen.back.test.tsx`；顶栏断言可落 `vfs-file-manager.session.integration.test.tsx` 或新建）
- 问题：合并后的三个修复——返回逐级上翻 / beforeRemove 拦截（`GlobalTemplateScreen.tsx`）、`labelByPathRef` 面包屑累积（`apps/mobile/src/components/vfs/VfsFileManager.tsx`）、`mapVfsListEntry` label 回退——均无用例。
- 改法：至少补两例：
  - ① list 返回带 label 的行后，顶栏路径逐段替换为展示名（`labelByPathRef` 累积生效）；
  - ② 子目录时 beforeRemove 被拦（preventDefault + goUp），根目录时放行。
- 验收/测试：两例均绿；`mapVfsListEntry` label 回退若未覆盖则在②的用例中顺带断言。
- 来源：review-scope-mobile / round 1

### desktop/B-2 [P2] BFS 全树 × listScopeFirstLevel 每次 read 全子树 = O(行数×深度) 重复读
- 维度：E（性能）
- 文件：
  - `packages/core/src/service/vfs/physical-vfs.service.ts`（或 `physical-vfs.port.ts` + 工厂，新增批量接口）
  - `apps/desktop/src/main/ipc/handlers/physical.ts`（改用批量接口）
- 问题：desktop BFS 全树拉取时，core `listScopeFirstLevel` 每层调用 `listEntriesUnderPrefix` 读全子树再切第一层，整树 = O(行数 × 深度) 重复读。
- 改法（二选一，**建议前者**，UI 模式不动）：core 加批量接口——一次 prefix 查询返回全行，应用层递归切层，供 desktop 全树拉取使用；或 desktop 改按需懒加载。
- 验收/测试：desktop IPC 测试断言全树结果不变（可与 desktop/G-1 的断言合并）；core 新接口补单测（一次查询、递归切层正确）。
- 来源：review-scope-desktop-cli / round 1

### desktop/C-1 [P2] nav-workspace 面板槽位替换后 global 成死分支
- 维度：C
- 文件：`apps/desktop/renderer/state/nav-workspace.ts`
- 问题：面板槽位 global → physical 替换后，`WorkspaceScope` union 的 `global` 成员与 `WORKSPACE_TITLES.global` 成死分支。
- 改法：删除该 union 成员及对应 title；`syncWorkspaceWithNav` 的兜底 `?? "global"`（约 nav-workspace.ts:34）会随 union 收窄类型报错，一并改兜底值（如 `?? "physical"`）或删兜底。**注意两处保留**：shared 侧 `WorkspacePanelScope` 的 `'global'` 要保留（main handler 与 CLI 仍用）；`ShellNavProvider:187` 附近的 global 判定保留（它匹配 main 推送通知）。
- 验收/测试：desktop 相关测试全绿；确认 main handler / CLI / ShellNavProvider 引用未受影响。
- 来源：review-scope-desktop-cli / round 1

### desktop/G-1 [P2] label 透传全链零断言；docstring 与实际覆盖不符
- 维度：G
- 文件：`apps/desktop/test/physical-vfs-ipc.test.ts`（追加用例）
- 问题：label 透传全链无断言（现有 deepEqual 恰好选了不带 label 的行）；测试 docstring 声称覆盖「面板只读渲染」但只测到 IPC 层。
- 改法：IPC 测试补 `/projects/{id}` 行的 label 断言；并修正 docstring 措辞，或补一个最小组件测试真正覆盖面板渲染。
- 验收/测试：label 断言存在且绿；docstring 与实际覆盖一致。
- 来源：review-scope-desktop-cli / round 1

### cli/G-2 [P2] 「命令已下线」无负向断言
- 维度：G
- 文件：`apps/cli/test/template-pull-e2e.test.ts`（补用例）
- 问题：`project template pull` 已下线，但无负向测试证明下线行为。
- 改法：补 `runNm(["project","template","pull",...])` 断言非 0 退出码且 stderr 含 usage。
- 验收/测试：负向用例绿。
- 来源：review-scope-desktop-cli / round 1

## Spec deviations

状态：open（3 条，均附处置建议，待用户确认后流转 fixed）

1. **label 展示名增强（含 label 排序行为）** —— 实现超出 spec 字面（合成目录行携带项目名/会话名 label、顶栏面包屑替换、排序键含 label）。建议：按现状收窄，回写 spec 附录（展示名字段与排序语义）。
2. **系统返回逐级上翻三路拦截** —— mobile 侧返回键/手势被拦截为逐级上翻，spec 未写。建议：按现状收窄，回写 spec 附录（与 mobile/B-1 的 action.type 白名单一并写明）。
3. **desktop BFS 全树 vs spec「懒加载」字面** —— 与 desktop/B-2 关联。建议：desktop/B-2 修法拍板后（批量接口 = 保持全树；懒加载 = 改按需）回写 spec 对应段落。

## Open questions / 待拍板

- mobile 面包屑缓存改名陈旧：项目/会话改名后 `labelByPathRef` 旧值残留（展示小瑕疵，仅影响顶栏显示）。
- preload channel 运行时白名单：预存设计，另立条目跟踪，不属本迭代修复范围。
- physical 面板数据陈旧窗口：外部变更后不自动刷新，靠常驻监听 + 手动刷新兜底，是否需要额外推送待拍板。
- `confirmBatchDelete` / `runBatchMove` 依赖数组写 vfs 而实际用 `writableVfs`（运行时同一对象）：是否顺手统一写法。

## 已豁免（用户确认不修）

- 无。

## 合并后 QA（manual_user）

- 无（manual_user 不阻塞；如有用户验收项后续追加于此）。

## K 节建议（下游执行时闭合）

- 无额外。lint/format 由下游执行本 spec 时统一跑，不在本轮列入步骤。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/global-fs-manager/cr-fix-spec.md |
| dag_version / review_round | 2 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 1 / 10 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open ×3（label 增强/返回拦截/BFS 全树，均待用户确认回写或收窄；不阻塞执行 P0/P1） |
| C-orch | ✅（meta 双前缀 P0 已入） |
| C 类合并后 QA | 无 |
