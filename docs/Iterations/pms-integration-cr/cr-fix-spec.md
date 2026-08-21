# CR Fix Spec: pms-integration 集成 CR 修复说明书

## 元信息
- repo: novel-master
- base_sha: 409ceca
- head_sha: a0ebc57（即当前 HEAD）
- 分支: feat/pms-integration（409ceca..a0ebc57，共 36 commit）
- review_round: 1
- dag_version: 2
- 状态: fix-spec-ready
- 来源: pms-integration CR scope review（A / B / C / D 四切片合并去重，共 7 条 must-fix）
- 模板对齐: docs/Iterations/chat-improvements-cr/cr-fix-spec.md（code-review-loop「fix-spec 文档结构」）
- 业务参考（只读）: docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/{prd,spec}.md、docs/Iterations/fetch-models-filter/{prd,spec}.md、docs/Iterations/agent-config-skill/{prd,spec}.md

> 修复顺序：P0 1 条（安全级拦截缺口）→ P1 2 条（死链路残骸 / iOS 键盘行为退化）→ P2 4 条（布局补漏 / 测试免维护 / 行为口径对称）。A-1/D-2 与 D-1 互不依赖，可并行；C-1 与 C-2 同属 mobile 键盘避让批次，建议同批改。

---

## Must-fix

### P0

#### D-1 [P0] ZIP 导入绕过内置保留名新建拦截——可在 project 域建 agent-config 副本遮蔽内置指南
- 严重度: P0（PRD 明示的验收口径被第二条新建通道绕过，静默产生遮蔽内置技能的副本）
- 维度: 行为口径 / 安全（A/B/C-orch）
- 文件:
  - `apps/desktop/renderer/features/skills/NewSkillModal.tsx`（imported 分支约 L147-162：`ipcVfsZipImportBytes` 以 `confirmed: true` 直写 `directoryPath: /meta/skills/${trimmedName}`，不经 writeSkillFile）
  - `apps/mobile/src/components/skills/NewSkillModal.tsx`（handleCreate 的 imported 分支约 L215-227：`zipSvc.import(scope, imported.bytes, { confirmed: true, directoryPath: /meta/skills/${name} })` 同样直写）
  - `packages/core/src/service/skills/impl/skills.service.ts`（writeSkillFile 内联的 D2② 门约 L295-309：`BUILTIN_SKILL_NAMES.has(name) && options?.builtinSeed !== true` 时做域目录存在性判定，不存在即抛 `skillBuiltinNameReserved`；`skillDirExists` 约 L399-409）
- 问题: 手进创建走 `writeSkillFile`，会撞 D2② 门（内置保留名 + 该域目录不存在 = 新建，拒绝）；但两条 ZIP 导入链路直接调 VFS zip import 落盘，完全不经这道门。project 域下导入名为 `agent-config` 的 zip 时，前置的域内查重（listSkills）在空项目里查不到同名，校验通过后整包写入 `/meta/skills/agent-config/`——project 域从此存在一个内置指南副本，合并视图（effectiveSkills 的 project 优先）会遮蔽 global 域内置本体。这违反 agent-config-skill PRD「任意域新建保留名被拒」的验收口径。
- 改法:
  1. 服务层把 writeSkillFile 内联的「内置名单 + 域目录不存在判定」抽成可复用入口 `assertSkillNameNotReservedForCreate(domain, name, projectId)`：名单外直接放行；名单内且该域技能目录不存在（新建语义）抛 `skillBuiltinNameReserved`（中文文案，沿用 skill-errors 既有错误）；目录已存在（编辑内置本体或历史副本）放行——与 D2② 门语义完全同源。writeSkillFile 改调该入口，行为不变（`builtinSeed` 豁免仅保留给 seed 通道）。
  2. 该入口暴露到 SkillService 接口；desktop 需经 IPC 可达（新增一条 skills 校验通道或在既有 skills 通道上扩展，实现时取改动最小者）。
  3. 双端 NewSkillModal 的 imported 分支在 zip 落盘前各接一次校验：desktop 在 `ipcVfsZipImportBytes` 之前、mobile 在 `zipSvc.import` 之前，命中保留名即报错返回、不落盘。
- 验收/测试:
  - core 层新增用例：`assertSkillNameNotReservedForCreate` 对 project 域 `agent-config`（目录不存在）抛 `skillBuiltinNameReserved`；目录已存在时放行；非名单名放行；`builtinSeed` 豁免仍仅 seed 通道有效。
  - 双端源码契约断言：desktop / mobile NewSkillModal 的 imported 分支含校验调用（轻量静态断言或 grep 契约）。
  - 既有 zip 导入相关测试零回归。
  - 对齐 PRD 口径：任意域以保留名新建（含 ZIP 通道）被拒且目录未创建。
- 依赖: 无。Spec deviations 第 1 条（agent-config-skill spec 补实现注）随本条同步。
- 来源: review-scope-D / round 1。

### P1

#### A-1/D-2 [P1] done 桥接 IPC 类型残骸——b8c7bdd 已删，edadb49（编辑器旧缓冲）带回两段类型定义
- 严重度: P1（死通道类型误导后续接线）
- 维度: 并发编排 / 死代码（C-orch）
- 文件（主代理复核实锤，仅两处；ChatComposer/client/invoke-registry/handler-registry/handlers 均已 grep 零命中，链路干净）:
  - `apps/desktop/shared/ipc-types.ts`（IPC_CHANNELS 的 `MESSAGES_APPEND_TOOL_TURN_BRIDGE` 约 L96；`MessagesAppendToolTurnBridgeRequest` 类型约 L755-757）
- 问题: b8c7bdd 删除了整条 done 桥链路；其后的 edadb49（编辑器旧缓冲带入）仅带回 ipc-types.ts 的通道常量与 Request 类型两段——全仓无 client 绑定、无 invoke-registry 注册、无 handler 实现、无 renderer 调用，属「看似可用、实际无 handler」的死类型定义，误导后续接线。
- 改法:
  1. 删除 ipc-types.ts 两段（通道常量 + Request 类型）。
- 验收/测试:
  - `git grep -n "MESSAGES_APPEND_TOOL_TURN_BRIDGE\|MessagesAppendToolTurnBridge"` 零命中（排除 `release/` 构建产物；`.woktree/` 旧工作区不计）。
  - desktop typecheck + test 全绿。
- 依赖: 无。
- 来源: review-scope-A/D / round 1；spec-fix 初稿误报为整链带回，主代理复核后修正为仅两段（trivial 直接执行）。

#### MF-8 [P1] mobile ZIP 导入重写 SKILL.md 不透传乐观锁版本——edadb49 只修了 desktop，mobile 同款链路漏修
- 严重度: P1（同一 bug 类修了一半的跨端不对称；触发后 zip 已落盘成半完成态，用户进退两难）
- 维度: 跨端一致性 / 行为退化（B/J）
- 文件: apps/mobile/src/components/skills/NewSkillModal.tsx（imported 分支约 L228-239：表单值与 zip 元数据不一致时 writeSkillFile 重写刚落盘的 SKILL.md，无 options）
- 问题: vfs.write 对已存在文件无 expectedVersion 必抛 CONFLICT；desktop 同款链路 edadb49 已修（先 read 拿 version 再写），mobile 未修。触发：mobile ZIP 导入后改动 name/description 再创建→重写必 CONFLICT，且 zip 已落盘（目录已建、front matter 为 zip 原值），重试又撞「目标域已存在同名技能」。
- 改法: 照 desktop edadb49 样板——重写前 readSkillFile 拿 version，writeSkillFile 传 { expectedVersion }；core SkillWriteOptions 已支持，mobile 直连零 IPC 改动。
- 验收/测试: mobile 源码契约断言（imported 重写分支含 read-拿版本再写）；真机 QA 并入合并后 QA 第 1 批（ZIP 导入 + 改名创建成功、front matter 为表单值）。
- 依赖: 无。
- 来源: review-full / round 2。

#### C-1 [P1] ToolPolicyPicker iOS 键盘避让退化——面板被键盘盖住 kb 高度、顶部留 kb 空隙
- 严重度: P1（相对改动前的行为退化，iOS 上可用列表比改造前更小）
- 维度: 体验 / 布局（B/J）
- 文件:
  - `apps/mobile/src/hooks/useAdaptiveKeyboardSheetStyle.ts`（translateY 仅 Android：约 L49 `Platform.OS === 'android' ? {transform: [{translateY: kb}]} : {}`；maxHeight 收缩两平台都生效）
  - `apps/mobile/src/components/agent/ToolPolicyPicker.tsx`（经 FormOverlayHost 渲染——`useFormOverlay().show` 挂载，渲染层是普通 View 无任何避让；hook 接入点约 L104 `useAdaptiveKeyboardSheetStyle(0.75)`）
- 问题: hook 的设计分工是「AppModal 体系的三个 sheet（FetchModelsSheet / DirectoryRuleSheet / NewSkillModal）iOS 外层已有 KeyboardAvoidingView padding 分支，hook 的 translateY 仅 Android 生效」；ToolPolicyPicker 是 FormOverlayHost 体系，无 KAV 外壳，但 hook 对 iOS 不做 translateY。结果 iOS 键盘弹起时：面板 maxHeight 随 `available = screenH + kb` 收缩（底部仍钉屏幕底），但面板整体不上移——底部被键盘盖住 kb 高度、顶部留出 kb 空隙，实际可用列表比改造前更小。
- 改法（评审给的三选一，选定推荐项 b 并说明）:
  - a) FormOverlayHost 加 KeyboardAvoidingView 外壳——渲染体系改动大，影响所有 overlay 使用方，否。
  - b)【推荐】hook 加 `iosTranslateY?: boolean` 选项（默认 false，既有三个 AppModal 接入点行为不变）；条件改为 `(Platform.OS === 'android' || iosTranslateY) && translateY(kb)`。ToolPolicyPicker 传 `iosTranslateY: true`，其 iOS 分支由 hook 自己 translateY。
  - c) ToolPolicyPicker 自己包 KAV——与 hook 的 maxHeight 收缩叠加后双重避让，否。
  - AppModal 三处不开此选项（iOS 已有 KAV padding 分支，避免与 translateY 双重避让）。
  - 与 min/maxHeight 收缩公式的协同：translateY 后 maxHeight 公式不变（仍按 `available` 收缩），视觉上面板底边贴键盘顶、顶部不出屏。
- 验收/测试:
  - hook 单测（现无该 hook 的测试文件，需新建）扩 `iosTranslateY` 两态：true 时 iOS 分支含 translateY、false 时不含；Android 分支两态都含。
  - ToolPolicyPicker 源码契约断言：传入 `iosTranslateY: true`。
  - 真机 iOS 验收列入合并后 QA（与 C-2 同批）。
- 依赖: 无。与 C-2 同文件族，建议同批次。
- 来源: review-scope-C / round 1。

### P2

#### C-2 [P2] DirectoryRuleSheet 缺 flexShrink——键盘收缩时底部按钮行被裁
- 严重度: P2（小屏双平台布局缺陷）
- 维度: 布局（C）
- 文件:
  - `apps/mobile/src/components/sheet/DirectoryRuleSheet.tsx`（styles.form 约 L300：`form: { maxHeight: 360 }`，四个键盘避让接入点中唯一没补 flexShrink 的）
- 问题: 键盘弹起导致面板 maxHeight 收缩时，超高内容不会向内收缩，底部按钮行（actions）被裁出可视区。对照 ToolPolicyPicker 的 list 写法 `{ maxHeight: 320, flexShrink: 1 }`。
- 改法: form 加 `flexShrink: 1`（对齐 ToolPolicyPicker list 写法）。
- 验收/测试: 源码契约断言或人工核对 styles.form 含 flexShrink；真机 QA（小屏 + 键盘弹出，按钮行可见可点）。
- 依赖: 无。与 C-1 同批改。
- 来源: review-scope-C / round 1。

#### D-3 [P2] empty-state 测试硬编码 agent-config——第二个内置技能入名单时再破
- 严重度: P2（测试守卫缺口，名单演进时误报）
- 维度: 测试守卫（C/G）
- 文件:
  - `packages/core/test/skills/empty-state.test.ts`（两处 `filter((n) => n !== "agent-config")`：listSkills 侧约 L22、effectiveSkills 侧约 L32）
- 问题: 断言把内置名硬编码成字符串排除项。`BUILTIN_SKILL_NAMES` 是内置名单的单一来源（seed / 删除拦截 / 新建拦截共用），将来第二个内置技能入名单时这两处会误报失败。
- 改法: import `BUILTIN_SKILL_NAMES`（与 skills.service 同一导出源），两处断言语义改为「除内置名单外为空」：`filter((n) => !BUILTIN_SKILL_NAMES.has(n))`。project 域断言（`assert.deepEqual(projectList, [])`）不动——project 域无内置种子。
- 验收/测试: 用例本身绿；语义对将来新增内置名免维护。
- 依赖: 无。
- 来源: review-scope-D / round 1。

#### D-4/B-nit [P2] agent 工具 get by-name 输入侧不 trim——与指南正文「两侧 trim」表述不符
- 严重度: P2（文档口径与实现不符，模型传带空白名时 get miss）
- 维度: 行为口径 / 文档一致性（A/C）
- 文件:
  - `packages/core/src/domain/tool/builtin/agent-tool.ts`（get 的 by-name 精确匹配约 L350-352 `defs.find((d) => d.name === input.name)`；对照 update 约 L401 `input.name!.trim()`）
  - `packages/core/src/bootstrap/skills/seed-builtin-skills.ts`（内置指南正文约 L45：「get / update 按 name 定位时精确匹配（两侧 trim）」）
- 问题: 指南正文承诺输入侧 trim，update 做了、get 没做——模型按指南传带空白的 name 时 get 直接 miss 报「未找到」。
- 改法（推荐实现侧，正文表述即准确）: get 的 `input.name` 也 trim 后再匹配（对齐 update）；指南正文不改。
- 验收/测试: `packages/core/test` 的 agent-tool 用例文件补一条：带空白名（如 `" writer "`）get 命中既有 agent。
- 依赖: 无。
- 来源: review-scope-B/D / round 1。

#### B-nit1 [P2] agent 工具 update by-agentId 过期 id 静默新建——应报「未找到」
- 严重度: P2（错误输入被静默当作 create 语义，与 get by-agentId 行为不对称）
- 维度: 行为口径（B）
- 文件:
  - `packages/core/src/domain/tool/builtin/agent-tool.ts`（update 的 by-agentId 分支约 L421-424：`agentId = input.agentId!` 后直达 `upsertWithTranslatedError`，无存在性检查；对照 get by-agentId 约 L364-372 的 `getRawWire` 判空样板——null 即报「未找到」）
- 问题: 拿过期/拼错的 agentId 更新时，upsert 会静默新建一行，模型以为更新成功；get 对同一 id 却会报未找到。spec backlog 升格。
- 改法: update by-agentId 分支在 upsert 前补 `getRawWire(agentId)` 判空，空则抛 INVALID_ARGUMENT「未找到该 agentId 对应的 agent」（对齐 get 的样板与错误风格）。
- 验收/测试: agent-tool 用例补两条：过期 agentId 更新报错；正常 agentId 仍可更新。
- 依赖: 无。与 D-4 同文件同函数族，建议同批次。
- 来源: review-scope-B（spec backlog 升格）/ round 1。

---

## Spec deviations
- agent-config-skill spec 需补实现注：技能新建存在第二条通道——ZIP 导入（desktop 走 `ipcVfsZipImportBytes`、mobile 走 `zipSvc.import`），不经 writeSkillFile 的 D2② 门；随 D-1 修复同步补记，避免后续读 spec 者误以为手进创建是唯一入口。（已随 D-1 闭合：实现注落在 agent-config-skill spec D2 条目下）
- edadb49（技能编辑保存透传 VFS 乐观锁版本）落地后，T-AS6 相关测试注释中「乐观锁墙」的表述过时——该 bug 已修复，注释仍描述旧行为；随 D 线用例更新时顺带修正。
- 建议补 `writeSkillFile` 带 `expectedVersion` 的正向用例（当前只有「不带版本撞 CONFLICT」的反向覆盖）；可并入 D-1 的用例批次，或单列 K 节跟进。
- edadb49 改了 desktop SkillDetailView / NewSkillModal / SkillsWriteRequest——属 agent-config-skill spec 声明「双端 UI 与 IPC 零改动」范围外的 drive-by 存量修复，无归属注记；在此补记出处（乐观锁透传修复），免得后人对照 spec 找不到这笔改动来源。

## Open questions（不阻塞修复，随修复批次顺带确认）
1. skill 工具 write 对已存在文件必 CONFLICT 且 input 无 version 通道，description「整文件覆盖写入」未说明——模型覆盖已有技能只能走 edit；与「UI 可覆盖写、模型不可」不对称（存量行为，非本分支引入；与第 4 条可合并考虑，至少改 description 口径：write 仅用于新建，修改已有文件用 edit）。
2. CHANGELOG Unreleased 缺 fetch-models 过滤（用户可见 feature）条目；K 节 3 的三个 drive-by（键盘 hook、dirty 修复、乐观锁修复）同待补。
3. seed 失败仅 `console.warn`——mobile release 构建下 console 不可见，种入失败的观测口径待拍板（升级为持久化日志或遥测？）。
2. `builtinSeed` 特权是布尔豁免（`options?.builtinSeed === true`），外部调用者可伪造；是否改为 symbol 隔离（模块内持 symbol 才能触发 seed 通道）。
3. VFS CONFLICT 错误文案为英文且无自动 reload——是否中文化并引导用户重读后再编辑。
4. desktop 用户输入直发路径无测试锁定（protocol-merge 的 T-PM5 仅 mobile）；A-1/D-2 修复后是否补 desktop 直发用例。
5. B 线发现：`summarizeToolInput` 输入侧无 agent 分支——agent 工具 create/update 提交大 definition 时回显为 JSON 截断（无结构化摘要）。是否升 P2 写入 must-fix 待用户认定，本轮不修。

## 已豁免
- 无。（本 round 无豁免条目。）

## 合并后 QA（manual_user）
1. iOS / Android × 四面板键盘真机验收：ToolPolicyPicker（重点：iOS 上移 + 收缩协同）、FetchModelsSheet、DirectoryRuleSheet（重点：底部按钮行不被裁）、NewSkillModal。
2. mermaid C4 全屏清晰度真机验收（protocol-merge-agent-tool-mermaid-sharp 迭代范围）。
3. agent-config skill 真机链路：首启种入、删除拦截（global 域内置名）、编辑保存（乐观锁透传后的正路）。

## K 节建议（经验沉淀）
1. 主仓 `git prune`（评审期间 gc 有警告）。
2. 清理 `.woktree/chat-fixes-2026-08`（及 `chat-improvements-2026-08`）旧工作区中的 asar 产物——本轮 grep 定位 A-1/D-2 时旧产物大量命中，干扰残骸范围判断；主仓 `apps/desktop/release/` 产物同理建议纳入忽略清单。
3. CHANGELOG 补 drive-by 修复条目：键盘避让 hook、dirty 修复、乐观锁修复。
4. edadb49 事件（编辑器旧缓冲把已删链路整链带回）的防护：涉及「删除整条链路」的合并前，对关键删除标识符跑一次 grep（限源码目录、排除产物），作为迭代 checklist 项沉淀。
