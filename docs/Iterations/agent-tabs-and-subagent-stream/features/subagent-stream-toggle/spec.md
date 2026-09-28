---
date: 2026-09-28
---

# 子会话流式开关 技术规格（SPEC）

## 设计目标

依据 `prd.md`（dependency: `iterations/agent-tabs-and-subagent-stream/prd.md`）：新增「子会话流式」偏好开关，与「父会话流式」并排（mobile 聊天配置页 / desktop 工作区聊天偏好）；默认开（升级零变化）；关闭后子会话（含递归）走非流式调用、消息完整落库、生命周期事件照常、实时增量与实时速率消失；与主会话开关互相隔离；CLI 经偏好命令可配。

## 总体方案

1. **偏好三段式照抄 `chat.llmStream` 先例**：port 显式类型化方法（v2 契约，UI 禁裸写 key）+ key 常量 + impl（`getBooleanPref(key, true)` 默认开）；key 命名 `chat.subagentStream`，方法命名 `get/set/resetSubagentStreamEnabled`（`Enabled` 后缀先例）。
2. **消费点收在 `runChildAgent` 内部**（子代理两路探索一致推荐）：读 `runtime.preferences?.getSubagentStreamEnabled()`，替换 `run-agent-turn.ts:870` 的硬编码 `stream: true`。三端 runtime 已注入完整 `preferences` 对象（desktop `create-desktop-runtime.ts:98,156` / mobile `create-mobile-runtime.ts:86,156` / cli `runtime.ts:195,239`），**app 端零改动**；task 工具闭包（:582-598）与孙代理闭包（:822-837）闭包捕获同一 runtime 实例，读一次即覆盖全部递归层级。
3. **容错口径与 thinkingContext 先例一致**：可选链 + `?? true` 兜底（`AgentTurnRuntimePort.preferences` 声明为可选正是为不破旧测试 mock——core 6 个 mock 文件均无该字段）；`PreferencesError`（脏值）catch 后回退 true 并 `console.error` 标签日志，不炸 run。
4. **每 run 快照语义**：`runChildAgent` 每次调用读一次，run 进行中切开关不影响当次子 run（与 thinkingContext 口径一致，spec 固化该语义）。
5. **desktop IPC 五件套与 mobile 开关行照抄 llmStream 全链**：通道 `nm:preferences/getSubagentStream` / `nm:preferences/setSubagentStream`；UI 紧邻「父会话流式」。
6. **不触碰**：`RunChildAgentOptions`（task 工具入参来自 LLM，不挂用户偏好）、`agent-runner.ts` deps（不扩 runner Pick，避免牵动 `agent-runner.test.ts:1731` partial mock）、主会话 `options.stream` 链路。

## 最终项目结构

```
packages/core/src/
  service/persistent-preferences/
    persistent-preferences.port.ts        [改] +get/set/resetSubagentStreamEnabled（注释注明默认 true）
    impl/preference-keys.ts               [改] +PREF_KEY_CHAT_SUBAGENT_STREAM = "chat.subagentStream"
    impl/persistent-preferences.service.ts [改] +三段实现（getBooleanPref(key, true)）
  index.ts                                 [改] 导出新 key 常量
  service/agent/logic/run-agent-turn.ts    [改] preferences Pick +新方法；runChildAgent 读偏好替换 :870
apps/cli/src/preferences-cmd/commands.ts   [改] KNOWN_KEYS + get/set/reset 三 case
apps/desktop/
  shared/ipc-types.ts                      [改] +PREFERENCES_GET/SET_SUBAGENT_STREAM 两通道
  src/main/ipc/handlers/preferences.ts     [改] +2 handler（转调 rt.preferences）
  src/main/ipc/handler-registry.ts         [改] +bindNoArg/bindBool 两绑定
  renderer/ipc/invoke-registry.ts          [改] +noArg/withBool 两项
  renderer/ipc/client.ts                   [改] +2 导出
  renderer/features/settings/WorkspaceSettingsView.tsx [改] +state/refresh/SettingsSwitchRow（紧邻父会话流式）
apps/mobile/src/
  screens/stack/ChatConfigScreen.tsx       [改] +state/refresh/ProfileSwitchItem + persistSwitchWithRollback
packages/core/test/
  persistent-preferences/persistent-preferences.test.ts [改] +新 describe（T-P1~T-P4）
  service/agent/run-agent-turn-subagent-stream.test.ts  [新增] T-S1~T-S4
apps/cli/test/                             [改或增] T-L1（preferences e2e 族）
apps/desktop/test/
  preferences-handlers.test.ts             [新增] T-D1
  workspace-settings-subagent-stream.test.ts [新增] T-D2（源码断言）
apps/mobile/__tests__/
  chat-config-screen-switch.test.tsx       [改] mockRuntime +2 jest.fn；+新开关用例 T-M1
```

## 变更点清单

| # | 文件 | 变更 |
|---|------|------|
| 1 | `persistent-preferences.port.ts` | 接口追加三方法，JSDoc 注明「Subagent session SSE streaming (default `true` when unset)」——**注释默认值必须写准**（反例：thinkingContext 的 port 注释写 true 但 impl 默认 false，勿复刻该偏差） |
| 2 | `impl/preference-keys.ts` | `export const PREF_KEY_CHAT_SUBAGENT_STREAM = "chat.subagentStream";` |
| 3 | `impl/persistent-preferences.service.ts` | get → `getBooleanPref(PREF_KEY_CHAT_SUBAGENT_STREAM, true)`；set → `kkv.set(PREFERENCES_MODULE, key, formatBoolean(enabled))`；reset → `deletePref`（NOT_FOUND 容忍，照 llmStream :22-36） |
| 4 | `run-agent-turn.ts:140-148` | preferences Pick 增 `"getSubagentStreamEnabled"`（注释同步：未注入时等同默认开） |
| 5 | `run-agent-turn.ts:858-872`（runChildAgent） | `runner.run` 前读偏好：`let childStream = true; try { childStream = (await runtime.preferences?.getSubagentStreamEnabled()) ?? true; } catch (cause) { if (!(cause instanceof PreferencesError)) throw cause; console.error("[agent-run] subagentStream pref read failed", cause); }`（**对齐 thinkingContext 先例** `agent-runner.ts:307-310`：只兜 `PreferencesError`、其他异常重抛，不静默吞装配类 bug）；`stream: true` → `stream: childStream`；:867 注释更新（「流式与否由 chat.subagentStream 偏好决定，默认流式；非流式时子会话浏览页无实时增量，靠 STEP_COMMITTED 整步刷新」） |
| 6 | `apps/cli/src/preferences-cmd/commands.ts` | import 新常量 + `KNOWN_KEYS` 增 `PREF_KEY_CHAT_SUBAGENT_STREAM`（**完整 key `"chat.subagentStream"`**，与既有 `PREF_KEY_CHAT_LLM_STREAM` 惯例一致——isKnownKey 按完整字符串校验，勿用短名）+ getValue/setValue/resetValue 三 switch 各加 case（转调新方法；**新 key 不会自动出现，必须显式注册**；`list` 子命令在 set 过后自动包含） |
| 7 | desktop IPC 五件套 | 照 `PREFERENCES_GET/SET_LLM_STREAM`（ipc-types.ts:115-118）逐层复制：handler（handlers/preferences.ts 模式：getDesktopRuntime → rt.preferences → try/catch formatIpcError）、`bindNoArg`/`bindBool`（handler-registry.ts:329-336 邻接段）、`noArg<IpcResult<boolean>>`/`withBool<IpcResult<void>>`（invoke-registry.ts:439-446 邻接段）、client.ts import re-export |
| 8 | `WorkspaceSettingsView.tsx` | `const [subagentStream, setSubagentStream] = useState(true)`；refresh 的 `Promise.all` 增 `ipcPreferencesGetSubagentStream()`；「父会话流式」行下紧邻新增 `<SettingsSwitchRow label="子会话流式" desc="子智能体会话的实时输出；关闭后回复完成后一次性显示" checked={subagentStream} onChange={async (next) => { setSubagentStream(next); await ipcPreferencesSetSubagentStream(next); }} />`（desktop 既有行全部静态 desc，保持一致）。**顺带更名（用户拍板 2026-09-28）**：既有 `label="流式输出"` 行更名 `label="父会话流式"` 并补 `desc="主对话的实时输出；关闭后回复完成后一次性显示"`，与子会话行对仗。 |
| 9 | `ChatConfigScreen.tsx` | `const [subagentStreamEnabled, setSubagentStreamEnabled] = useState(true)`；refresh 回调族增一项（`runtime.preferences.getSubagentStreamEnabled()`，并入 useFocusEffect 刷新）；「父会话流式」ProfileSwitchItem 之后新增一项：icon `"🤖"`、label `"子会话流式"`、subtitle 动态（开 `'子智能体回复边生成边显示'` / 关 `'子智能体回复完成后一次性显示'`）、`persistSwitchWithRollback(() => runtime.preferences.setSubagentStreamEnabled(enabled), () => setSubagentStreamEnabled(!enabled))`。**顺带更名（用户拍板 2026-09-28）**：既有「流式输出」行更名「父会话流式」，subtitle 更新为 开 `'主对话回复边生成边显示（推荐）'` / 关 `'主对话回复完成后一次性显示'`。 |
| 10 | 三端 runtime 装配 | **零改动**（preferences 已是完整对象注入） |

## 详细实现步骤

- Step 1 — phase-core-pref — blocking: yes — qa: auto：偏好三段式（port/keys/impl/index 导出）；`persistent-preferences.test.ts` 新 describe：默认 true（T-P1）、round-trip（T-P2）、reset 恢复默认（T-P3）、直写脏值 get 抛 `PreferencesError code === "INVALID_VALUE"`（T-P4）；**用例尾必须 reset 清理**（同文件共享一条 in-memory DB，`list` 排序断言是全量 deepEqual，留脏会串扰后续用例）。
- Step 2 — phase-core-consume — blocking: yes — qa: auto：Pick 扩方法 + runChildAgent 读偏好替换硬编码；新测试 `test/service/agent/run-agent-turn-subagent-stream.test.ts`（照 `run-agent-turn-abort-registry.test.ts` 骨架：`novelMasterTestFixture` + `scriptedModel` 按调用序回放 + 手写 runtime，经 `runAgentTurn` 完整路径让 task 工具触发 `runChildAgent`，在 `ModelRequestService.request` 的 options 缝上断言 stream）：关偏好 → 子 run `stream === false`（T-S1）、开偏好 → `true`（T-S2）、runtime 不注入 preferences → `true`（T-S3，兼容口径）、偏好脏值（createKkvService 直写非法串）→ 回退 true 且 run 不炸（T-S4）。
- Step 3 — phase-cli — blocking: no — qa: auto：preferences 命令注册新 key（完整 key `chat.subagentStream`）；`apps/cli/test/` 补 e2e 用例：`nm preferences set chat.subagentStream false` → `get chat.subagentStream` 回 false → `reset chat.subagentStream` 回默认（T-L1，照 `preferences-e2e.test.ts` 子进程模式）。
- Step 4 — phase-desktop — blocking: yes — qa: auto：IPC 五件套 + WorkspaceSettingsView 开关行；新 `test/preferences-handlers.test.ts`（抄 `agent-registry-handlers.test.ts` 的 desktop-db-test-env 三件套直调 handler）断言 get 默认 true / set 后回读 false（T-D1）；`workspace-settings-subagent-stream.test.ts` 源码断言 SettingsSwitchRow「子会话流式」与两 invoke 引用存在（T-D2）。
- Step 5 — phase-mobile — blocking: yes — qa: auto：ChatConfigScreen 开关行 + 接线；`chat-config-screen-switch.test.tsx` mockRuntime.preferences 补 get/setSubagentStreamEnabled 两个 jest.fn，新增用例：乐观翻转 → 写入 reject → 回滚 + `showToast('保存失败：…')`（T-M1，照既有 B 组断言模式）。
- Step 6 — phase-verify — blocking: no — qa: manual_user：双端手动验收——关开关 → 发起 task → 子会话浏览页无逐字输出、step 完成后整段可见、终止按钮可用且 task 回流 `[用户停止，无已生成文本]` 占位、指标条无实时速率但历时计时正常、终态用量正常；重启后开关状态保留；主会话「父会话流式」行为不受影响。mobile 验收走 mobile-adb-vision 巡检（真机从 UI 操作，库只读）。

## 测试策略

CI 硬门禁四包 `npm test`。定向验收命令（Windows 实际可用形态）：

- core：`npm run test:fast -- test/persistent-preferences/persistent-preferences.test.ts`、`npm run test:fast -- test/service/agent/run-agent-turn-subagent-stream.test.ts`
- desktop：`node scripts/run-tests.mjs test/preferences-handlers.test.ts` 等（禁裸 `npm test`，cmd glob 假绿）
- mobile：先 `npm run build -w @novel-master/core`（jest 直连 dist，不 build 测旧码），再 `npx jest __tests__/chat-config-screen-switch.test.tsx`
- cli：`npm test -w @novel-master/cli`（或在 apps/cli 下 npm test）

### 测试用例

- T-P1~T-P4 — blocking: yes — core 偏好四件套（默认/round-trip/reset/脏值），映射 Step 1。
- T-S1~T-S4 — blocking: yes — runChildAgent stream 传导矩阵（关/开/未注入偏好/脏值回退），映射 Step 2；断言缝为 `ModelRequestService.request` options（与主 run 的 stream 传导同源，有牙：改错实现必红）。
- T-L1 — blocking: no — CLI set/get/reset e2e，映射 Step 3。
- T-D1 — blocking: yes — desktop handler 直调 get/set，映射 Step 4。
- T-D2 — blocking: yes — desktop UI 行源码断言，映射 Step 4。
- T-M1 — blocking: yes — mobile 开关乐观更新 + 失败回滚 + toast，映射 Step 5。
- 手动验收项（qa: manual_user）映射 Step 6，不阻塞合并门禁。

## 兼容性 / 迁移说明

- 无 DB schema 变更：偏好为 KKV 行，首次 set 才落键；升级用户零行为变化（默认 true = 现硬编码行为）。
- 旧测试兼容：core 6 个 `AgentTurnRuntimePort` mock 文件无 `preferences` 字段——可选链设计使其全部不受影响（T-S3 显式锁定该口径）。
- desktop IPC 纯新增通道，无签名变更。
- 卸载/回滚：revert 后残留 `chat.subagentStream` 键无人读取，无副作用。

## 风险与回滚方案

- **mobile 非流式中止限缩（已知现状，非本迭代引入）**：非流式走 `llm-native-fetch-shim`（native `request` 底座无 abort 面），停止时 JS promise 立即 AbortError、run 正确收尾（stopReason="cancelled"，task 回流占位文案），但**连接不真断**——与主会话关「父会话流式」的现状完全一致（模块头「已知限缩」注明）。desktop/CLI 非流式 fetch signal 直通、真取消。
- **非流式中断无 partial assistant**：流式经 `finishAnthropicSsePartial` 保留半程文本，非流式中断步无内容落库——task 工具 cancelled 占位文案兜底（`subagent-tool.ts:230-237`），Step 6 手动验收覆盖。
- **实时指标条降级**：非流式下 `EVENT_AGENT_STREAM_*` 四事件全部门控消失，指标条 live 速率省略、历时计时正常（startedAtMs 受理即置）——预期降级，PRD 已声明，无额外工作。
- **desktop 非流式无整调用超时**：裸 Node fetch——与主会话开关关闭时现状一致，PRD 明示不做处理。
- **回滚**：单 commit revert；偏好键残留无害。
