---
date: 2026-09-28
---

# 智能体配置页拆双 Tab 技术规格（SPEC）

## 设计目标

依据 `prd.md`（dependency: `iterations/agent-tabs-and-subagent-stream/prd.md`）：双端智能体配置页拆「主智能体 / 子智能体」双 tab；过滤口径与运行侧两处既有过滤完全一致；内置 `general` 以只读内置条目展示；新建默认作用域随 tab 落库；作用域下拉保留；tab 内既有操作零丢失。

## 总体方案

1. **过滤口径单点收口 core**：新增纯函数 `agentModeMatchesTab(mode, tab)`（`mode ?? "all"` 归一；主 tab = `!== "subagent"`、子 tab = `!== "primary"`），与 `subagent-tool.ts` / 双端 picker 的字面口径一致。双端 UI 只消费该函数，不各自内联判断。函数放 `config-forms/agent/` 子路径下，**barrel（`config-forms/agent/index.ts`）须具名导出**（该子路径 exports 指向 `dist/config-forms/agent/index.js`，mobile jest moduleNameMapper 也映射到该 index——不加 barrel 双端 import 不到）。
2. **照抄技能管理页模板**：双端均为「本地 tab state + SegmentedControl + 切 tab `batch.exit()` + 数据全量加载后前端过滤 + tab hint 文案 + 空态随 tab」。mobile 模板 `SkillsSettingsScreen.tsx`（L90/160-165/397-416）、desktop 模板 `SkillsManageView.tsx`（L43-51/125-128/263-297）。
3. **general 合成行**：数据源维持 `listAgentIds()`（不含虚拟 general），由 core 经 **`@novel-master/core/agent` 子路径**导出 `DEFAULT_SUBAGENT_DEFINITION` 常量（在 `src/public/agent.ts` 加 re-export；该子路径 exports 与 mobile jest 映射均已存在，**不走根 barrel**——mobile jest 把根 `@novel-master/core` 映射到 `test-utils/core-shim.ts` 白名单，走根 barrel 须改 shim，子路径则零额外改动），双端在**子 tab** 前端合成只读行（sentinel `agentId === "general"`）。不换数据源为 `registry.list()`（mobile 依赖逐 id `getRawWire` health 流、desktop 走 DTO）。
4. **general 只读详情走编辑器 sentinel 分支**：双端编辑器入口检测 `agentId === "general"` 渲染只读呈现，不新增路由/view（`get("general")` 本就 `AGENT_NOT_FOUND`，sentinel 与真实 id 不冲突——id 均为 `agent-<ts>` 格式且无自定义入口）。
5. **新建默认作用域随 tab 即时落库**：双端 createBlank（现状「创建即 upsert」）增加可选 `mode` 参数直接写进定义（主 tab → `"primary"`、子 tab → `"subagent"`；不传 = 现行为缺省 all，向后兼容）。
6. **desktop DTO 增量扩展**：`AgentRegistryListItemDto` 加可选 `mode`（invalid 行天然无该字段 → 按 all 双边）；createBlank 通道从无参改可选对象参数，handler 容忍 `undefined`。

## 最终项目结构

```
packages/core/src/
  config-forms/agent/agent-mode-tab.ts          [新增] agentModeMatchesTab + AgentSettingsTab 类型
  config-forms/agent/index.ts                   [改] barrel 具名导出 agentModeMatchesTab / AgentSettingsTab
  public/agent.ts                               [改] re-export DEFAULT_SUBAGENT_DEFINITION（经 /agent 子路径暴露）
apps/desktop/
  shared/ipc-types.ts                            [改] ListItemDto +mode?；+AgentRegistryCreateBlankRequest
  shared/logic/config-forms-agent.ts             [改] 镜像 re-export agentModeMatchesTab（自 /config-forms/agent）
  shared/logic/agent.ts                          [改] 镜像 re-export DEFAULT_SUBAGENT_DEFINITION（自 /agent，该文件为 /agent 既有专用镜像）
  src/main/ipc/handlers/agent-registry.ts        [改] list 带 mode；createBlank 落 mode
  src/main/ipc/handler-registry.ts               [改] createBlank 绑定改带参
  renderer/ipc/invoke-registry.ts                [改] ipcAgentRegistryCreateBlank 带参
  renderer/features/settings/SettingsViews.tsx   [改] AgentsSettingsView tab 化（布局对齐 SkillsManageView）
  renderer/features/settings/AgentEditorView.tsx [改] general 只读分支
  renderer/styles/shell.css                      [改] +.agents-manage__tabs（复刻 skills-manage__tabs）
  test/agent-registry-handlers.test.ts           [改] 补 T-D1/T-D2
  test/settings-agents-tabs.test.ts              [新增] T-D3（源码断言）
apps/mobile/src/
  components/agent/AgentList.tsx                 [改] tab state/过滤/合成行/徽标/空态/onCreate(tab)；import 走两个既有子路径
  components/agent/BuiltinAgentDetail.tsx        [新增] general 只读详情（import @novel-master/core/agent）
  screens/stack/AgentsSettingsScreen.tsx         [改] handleCreate 传 mode
  services/agent-create.ts                       [改] createBlankAgent +mode 参数
  screens/stack/AgentEditorScreen.tsx            [改] sentinel 分支渲染 BuiltinAgentDetail
apps/mobile/__tests__/
  agent-list-tabs.test.tsx                       [新增] T-M1/T-M3
  agent-create-mode.test.ts                      [新增] T-M2（或并入 agent-list-tabs）
scripts/e2e/case-agents-tabs.mjs                 [新增] T-E1
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `packages/core/src/config-forms/agent/agent-mode-tab.ts` + `index.ts` | 新增 `AgentSettingsTab = "primary" \| "subagent"` 与 `agentModeMatchesTab(mode: AgentDefinition["mode"] \| undefined, tab): boolean`；**barrel（config-forms/agent/index.ts）具名导出两者**（子路径 exports 与 mobile jest 映射均指向该 index） |
| 2 | `packages/core/src/public/agent.ts` | re-export `DEFAULT_SUBAGENT_DEFINITION`（现状仅 core 内部引用，未导出），经 `@novel-master/core/agent` 子路径暴露——mobile jest 对该子路径已有 moduleNameMapper 直连 dist 映射，**不动 core-shim、不动根 index.ts、不新增 exports 子路径**（子路径已存在，tsconfig.test.json paths 无需改） |
| 3 | `apps/desktop/shared/ipc-types.ts` | `AgentRegistryListItemDto` + `mode?: "primary"\|"subagent"\|"all"`；新增 createBlank 请求类型 |
| 4 | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | list 的 valid 分支从 `health.value` 带出 `mode`（`undefined` 时省略字段，JSON 序列化天然丢弃）；createBlank 读 `req?.mode` 落库，`undefined` 容忍 |
| 5 | `apps/desktop/src/main/ipc/handler-registry.ts` + `renderer/ipc/invoke-registry.ts` | createBlank 通道签名从 noArg 改可选 payload（照同文件既有 withXxx helper 模式，无合用者则新增） |
| 6 | `apps/desktop/renderer/features/settings/SettingsViews.tsx` | AgentsSettingsView 重排：tabs 置顶（`.agents-manage__tabs` + SegmentedControl）→ ManageHeader（title/hint 随 tab）→ 单个 SettingsListSection 前端过滤；general 合成行（子 tab、`settings-tag--primary`「内置」）；「默认（全部）」行加 `settings-tag--muted`「全部」徽标；新建传 mode；删除兜底 `remaining` 排除 `"general"`；general 行不进批量勾选、⋮ 菜单仅「查看」 |
| 7 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx` | `agentId === "general"` 时不走 `ipcAgentRegistryGet`，渲染只读卡片（经 `shared/logic/agent.ts` 镜像导出的 `DEFAULT_SUBAGENT_DEFINITION`：名称/描述/作用域/系统提示词/workplace 确记语），无 dirty 上报、无保存按钮 |
| 8 | `apps/mobile/src/components/agent/AgentList.tsx` | tab state（`'primary'` 默认）+ SegmentedControl（options：主智能体/子智能体）+ `switchTab`（setTab + `batch.exit()`）+ `rows` 按过滤 memo + general 合成行（子 tab 头部，内置胶囊样式参照 `SearchEnginesScreen.tsx` BuiltinTag）+「全部」badge + 空态文案随 tab + `onCreate?: (tab) => void`；general 行不可勾选、菜单仅「查看」 |
| 9 | `apps/mobile/src/services/agent-create.ts` + `AgentsSettingsScreen.tsx` | `createBlankAgent(runtime, id?, mode?)` 写入 `def.mode`；Screen 的 handleCreate 依 tab 传 mode |
| 10 | `apps/mobile/src/screens/stack/AgentEditorScreen.tsx` + `BuiltinAgentDetail.tsx` | `agentId === "general"` 分支只读呈现（导航参数不扩，sentinel 直用） |

不改动：picker 过滤（`handlers/agent.ts:108-120`、`agent-picker.ts:17-23`）、task 过滤（`subagent-tool.ts:182-189`）、`MODE_OPTIONS` 与编辑表单、`AgentRegistryService` 本体、`agent-registry.port.ts`（createBlank 维持 app 层组合）。

## 详细实现步骤

- Step 1 — phase-core-mode-tab — blocking: yes — qa: auto：新增 `agent-mode-tab.ts` 判定函数并经 `config-forms/agent/index.ts` barrel 具名导出；`DEFAULT_SUBAGENT_DEFINITION` 经 `public/agent.ts` re-export（`/agent` 子路径）；core 单测锁口径（T-C1）与常量内容（T-C2）；desktop 镜像分置：`agentModeMatchesTab` 进 `shared/logic/config-forms-agent.ts`（自 `@novel-master/core/config-forms/agent`），`DEFAULT_SUBAGENT_DEFINITION` 进 `shared/logic/agent.ts`（自 `@novel-master/core/agent`——该文件本就是 `/agent` 的专用镜像，避免 config-forms-agent.ts 头注释与内容不符）；shared 层不受 renderer eslint X1 gate 限制，renderer 统一走镜像，禁止 export *。
- Step 2 — phase-desktop-ipc — blocking: yes — qa: auto：ipc-types DTO/请求类型 + list/createBlank handler 改造 + 绑定与 invoke 封装同步；`agent-registry-handlers.test.ts` 补 T-D1（valid 带 mode / invalid 无 mode / undefined 省略）、T-D2（createBlank 带 mode 落库、不传兼容现行为）。
- Step 3 — phase-desktop-ui — blocking: yes — qa: auto：AgentsSettingsView tab 化 + 合成行 + 徽标 + 删除兜底排除 + general 只读分支 + CSS；`settings-agents-tabs.test.ts` 源码断言（T-D3：SegmentedControl/modeMatchesTab 引用/「内置」徽标/general sentinel 分支存在）。
- Step 4 — phase-mobile-ui — blocking: yes — qa: auto：AgentList tab 化 + createBlank mode + 只读详情；jest 测试 T-M1（tab 切换过滤 + 切 tab 退批量）、T-M2（onCreate 传 mode → createBlankAgent 落库）、T-M3（general 行子 tab 可见、主 tab 不可见、无删除入口）。
- Step 5 — phase-e2e-verify — blocking: no — qa: manual_user：新增 `scripts/e2e/case-agents-tabs.mjs`（照 `case-subagent.mjs` 骨架：导航 agentsSettings → 断言 tab 控件 → 切子 tab → 断言 general 行；T-E1）；双端手动走查（过滤矩阵、invalid 行双边、新建默认值、批量独立性）——mobile 走 mobile-adb-vision 截图巡检，desktop 走 dev 走查。

## 测试策略

CI 硬门禁为四包 `npm test` 全绿（`.github/workflows/ci.yml`）。定向验收命令（Windows 实际可用形态）：

- core：`npm run test:fast -- test/<file>.test.ts`（禁裸 `npx tsx --test`，会得到 tokenizer 假信号）
- desktop：`node scripts/run-tests.mjs test/<file>.test.ts`（禁裸 `npm test`，cmd 下 glob 假绿收集 0 条）
- mobile：core 改动后先 `npm run build -w @novel-master/core`（jest 经 moduleNameMapper 直连 dist），再 `npx jest __tests__/<file>.test.tsx`

### 测试用例

- T-C1 — blocking: yes — core `test/config-forms/agent-mode-tab.test.ts`：`primary→仅主 tab`、`subagent→仅子 tab`、`all→双`、`undefined→双`（四态 × 两 tab 断言矩阵；改错任一分支必红）。
- T-C2 — blocking: yes — 同文件或 `test/agent/`：`DEFAULT_SUBAGENT_DEFINITION` 具备 `name === "general"`、`mode === "subagent"`（防导出面漂移）。
- T-D1 — blocking: yes — `apps/desktop/test/agent-registry-handlers.test.ts`：list 返回项 valid 行含 mode（三 mode 值各一）且 **mode 缺省的 valid 行响应无 mode 字段**（未填写 = all 双边显示的语义支点）；invalid 行无 mode 字段。
- T-D2 — blocking: yes — 同文件：createBlank 传 `{mode: "subagent"}` 后 `getRawWire` 落库 wire 含 mode；不传 payload 落库无 mode（现行为回归）。
- T-D3 — blocking: yes — `apps/desktop/test/settings-agents-tabs.test.ts`（源码断言，抄 `settings-agents-delete-confirm.test.ts` 模式）：AgentsSettingsView 源码含 SegmentedControl、agentModeMatchesTab 调用、`"general"` sentinel、「内置」徽标类名。
- T-M1 — blocking: yes — `apps/mobile/__tests__/agent-list-tabs.test.tsx`（抄 `agent-list-delete-confirm.test.tsx` 骨架：mock useRuntime + react-native FlatList → `agent-row-<id>`）：默认主 tab 只见 primary/all 行；切子 tab 只见 subagent/all 行；切 tab 后批量态退出。
- T-M2 — blocking: yes — 同文件或独立：onCreate(tab) 透传 mode、`createBlankAgent` 收到并写入 upsert 参数（断言 mock 调用参数）。
- T-M3 — blocking: yes — 同文件：子 tab 存在 `agent-row-general` 且行内无删除菜单项；主 tab 无该行。
- T-E1 — blocking: no — `scripts/e2e/case-agents-tabs.mjs`：desktop 导航断言 tab 控件与 general 行可见（qa: manual_user，随桌面回归跑）。

## 兼容性 / 迁移说明

- 无 DB schema 变更、无偏好迁移；存量行 `mode` 缺省 = all = 双边显示（core 既定 fallback）。
- desktop createBlank 通道向后兼容：旧调用不传 payload → handler `req?.mode ?? undefined` → 落库无 mode（现行为）。
- `AgentRegistryListItemDto.mode` 为可选新增字段，旧消费方（picker 等）不读该字段，零影响。
- mobile 导航参数不扩（sentinel 复用既有 `agentId: string`）。

## 风险与回滚方案

- **general 合成行 × 既有操作矩阵**：批量删除以 id 为 key、desktop 删除兜底 `ipcAgentSetCurrent(remaining[0])`——合成行必须在批量选择集与 remaining 计算中结构性排除（Step 3/4 显式处理，T-M3 断言无删除入口）；core 层 `delete("general")` 本就拒绝（AGENT_NOT_FOUND），双保险。
- **invalid 行**：读不到 mode，按 all 双边显示并保留「配置已失效」标记（PRD 验收 7）；DTO 的 `mode` 缺省即表达该语义，无需额外标记。
- **mobile reload 为聚焦全量 N+1**：tab 仅前端过滤不重载，无新增开销；general 行在 reload 完成后由渲染层合成，不参与 N+1。
- **desktop e2e selector 手册**：`.agents/skills/desktop-e2e-vision/references/selectors.md` 若依赖旧文案（「暂无 Agent」等），空态文案变更后同步更新。
- **回滚**：全部为增量改动，单 commit revert 即回滚；无数据残留（不写库、不加列）。
