---
date: 2026-09-14
---

# 常驻保活通知（resident-keepalive-notification）技术规格（SPEC）

## 设计目标

将 keepalive 前台服务通知从「随 run 启停」改为「随消息通知开关 + app 存活常驻」，绕开 EMUI 对冷启动前台服务通知的 10 秒延迟展示（机制背景与拍板见 `docs/Iterations/resident-keepalive-notification-2026-09/prd.md`，依赖 `docs/Iterations/init-busy-yield-2026-09/prd.md`）：

1. 开关开启 → app 启动（runtime 桥装配完成）即启动前台服务通知，空闲态文案「novel master · 空闲」；此后 run 受理（标签查回后）/收尾只更新通知内容，不再启停服务。
2. 开关默认改关；`prefBridge` 的 appUi 未就绪降级口径从 `true` 改 `false` 与之对齐。
3. 开关切换即时启停（含生成中关开关立即停，run 继续仅失去保活）。
4. 通知权限申请前移到「开关从关切到开」；设置页新增「通知权限」行（状态展示 + 点击申请，被拒后跳系统设置）。

## 总体方案

**期望态模型重构（agent-finished-notification.ts）**：现状 `keepAliveDesired`（布尔）由 start/stop 入队参数写入（run 生命周期驱动）。改造为：

- 核心不变量：**标签操作永不直接置 true**——`desired` 的 true 只能来自 `setKeepAliveResidentEnabled(true)`，start/stop 的标签分支一律传 `keepAliveResident`，服务启停决策权完全收归开关态。
- 新增模块级开关态 `keepAliveResident: boolean`（默认 false），**服务运行 ⇔ keepAliveResident**。
- 新导出 `setKeepAliveResidentEnabled(enabled: boolean): Promise<void>`：写 `keepAliveResident` 并 `enqueueKeepAliveSync(enabled)`——开关的唯一驱动入口。
- `startAgentKeepAliveService(sessionId?, label?)`：**只操作标签表**（登记/刷新标签，标签有变化时 labelsVersion++），不再写 `keepAliveDesired=true`；改为 `enqueueKeepAliveSync(keepAliveResident)` 触发内容刷新（resident=false 时为 no-op，见下）。
- `stopAgentKeepAliveService(sessionId)`：只摘标签；带 sessionId 的两个入队分支——「其它会话仍在跑」的 size>0 分支（现状 L313-315 的 `enqueueKeepAliveSync(true)`）与「最后一个标签摘除」分支（现状 `enqueueKeepAliveSync(false)`）——**全部**改传 `enqueueKeepAliveSync(keepAliveResident)`。常驻开则 reconcile 刷新/维持内容（size>0 刷剩余会话、清零刷回空闲文案，服务不停），常驻关则停服务（异常残留兜底）。size>0 分支若维持现状的 true，常驻关时就要靠短路兜底才不出错——正确性必须由入参本身保证，不依赖兜底分支。
- `stopAgentKeepAliveService()`（无参）：语义改为「清空标签 + 停服务（无论 resident）」——保留为 dispose 专用全停。
- `reconcileKeepAlive` 增加短路：`keepAliveResident === false && desired === true` 的入队按 no-op 处理，对齐 displayedVersion 后直接返回。因标签操作已全部改传 `keepAliveResident`，该组合在正常路径不可达——短路降级为**纯防御兜底**（防未来回归把 true 重新写进标签路径），不再是正确性依赖（正确性由入参保证，T-K11 锁定）。
- `buildKeepAliveContent()` 增加空闲分支：`labels` 为空 → `{title: 'novel master · 空闲'}`（不设 body）；有标签时维持现状（「正在生成 · 会话名」+ scope + 总数行 + 固定尾行）。受理后标签查回前维持空闲文案（第一段无标签 start 在常驻模式下是 no-op：受理时该会话无标签，delete 不改版本，reconcile 不刷新）。
- `resetKeepAliveStateForTests()` 扩复位 `keepAliveResident = false`（签名不变，五个调用文件零改动）。

**常驻启动挂点（novel-master-context.tsx）**：挂点逻辑提取为模块级导出函数 `ensureKeepAliveResidentBoot(appUi: AppUiPreferences | undefined): Promise<void>`——函数体首行 null 分支守卫（undefined 时直接返回），随后直读 storage 层 `readMessageNotificationEnabled(appUi)`（**不走 prefBridge**，避免降级口径干扰），开则 `void setKeepAliveResidentEnabled(true)`；桥注入 effect 在 `setScopeBridge` 装配后以 `ensureKeepAliveResidentBoot(appUiRef.current)` 调用（T-K8 直测该函数，不必渲染整个 context）。类型窄化：`appUiRef.current` 为 `AppUiPreferences | undefined`（ref 声明类型），而 `readMessageNotificationEnabled` 参数非空——守卫收在函数体内，签名显式接受 undefined（typecheck 强制）。时序上该 effect 触发时 appUi 必已就绪（`setRuntime` 与 `setAppUi` 同批设置），守卫是 typecheck 强制而非时序需要。该 effect 依赖 `[runtime]`，retry 重建后自动重跑（dispose 全停 → 重新拉起，秒级闪断，PRD 已接受）。同文件 prefBridge 装配处：`appUiRef.current == null` 的降级返回从 `true` 改为 `false`（与默认关对齐，防装配早期误判开）；装配逻辑同样提取为模块级导出工厂 `createNotificationPrefBridge(getAppUi: () => AppUiPreferences | undefined)`（返回 `{isNotificationEnabled}`），effect 内改为调工厂——T-K9 直测其降级分支。两函数的直测落点为新轻量测试文件 `__tests__/keepalive-resident-boot.test.ts`（源码侧仍零新增文件）。

**manager 解耦（session-stream-unit-manager.service.ts）**：
- `startKeepAliveFor`：保留开关检查与两段式调用序列（受理先无标签 `startAgentKeepAliveService(sessionId)`、标签 `Promise.all` 查回后带标签刷新），但其意义变为「受理链路登记意图 + 标签查回后刷新」——第一段无标签 start 在常驻模式下是 no-op（受理时该会话无标签，labels.delete 返回 false、labelsVersion 不变，reconcile 命中 no-op，零刷新、通知维持空闲文案），标签查回后的带标签刷新才把内容切到「正在生成 · 会话名」；开关关时 skip 的语义仍正确（PRD 需求 2：开关关闭时受理不产生任何通知刷新）。
- `stopKeepAliveFor` / finally 兜底：不改（调 `stopAgentKeepAliveService(sessionId)` 摘标签，模块内部按新语义回空闲）。
- `maybeEnsureNotificationPermission` 与其调用点、`permissionEnsured` 字段：整体退役（权限申请挪至开关切换处）。
- `dispose()` 尾部无参全停：保留（retry 闪断 + 测试 afterEach 防泄漏依赖它）。

**权限链路（agent-finished-notification.ts 新导出 + ChatConfigScreen）**：
- 现有 `ensureAgentNotificationPermission`（含 permissionDenied 降级）复用为「开关开启时申请」的入口——拒绝过一次后不再自动弹（保留降级，避免反复骚扰）。
- 新导出 `getAgentNotificationPermissionStatus(): Promise<'authorized' | 'denied'>`：Android<33 恒 `authorized`；否则 `notifee.getNotificationSettings()` 按 `authorizationStatus`（AUTHORIZED=1 / PROVISIONAL=2 → authorized；DENIED=0 → denied；iOS 不在范围，非 Android 返回 authorized 与现状口径一致）。
- 新导出 `requestAgentNotificationPermissionManually(): Promise<'authorized' | 'denied'>`：手动路径**绕过 permissionDenied 降级**直接 `notifee.requestPermission()`；返回 DENIED 则调 `notifee.openNotificationSettings()`（不带 channelId，应用通知设置总页）并返回 denied。口径依据：notifee 9.1.8 无法区分软拒绝/永久拒绝（Android 仅返回 DENIED/AUTHORIZED），采用行为推断——手动申请被拒即跳设置页，无需三态区分。
- ChatConfigScreen「通知权限」行：`ProfileMenuItem`（icon 🔔、label「通知权限」、value 短文案「已授权」/「未授权」/「申请中…」——受 `maxWidth: 42%` 单行截断约束）。onPress：`getAgentNotificationPermissionStatus()` 已 authorized 则 no-op；否则调手动申请，回执直接 setState 更新 value。状态刷新时机：`useFocusEffect` 挂入现有 refresh 链 + 申请回执驱动（权限弹窗关闭不触发 navigation focus，回执是可靠源）。非 Android 平台**整行不渲染**（`Platform.OS !== 'android'` 时隐藏；PRD 已声明 iOS 不在范围，权限链路其余导出维持现状的「非 Android 返回 authorized」口径不变）。
- mock 顺手修正：`notifee-mock.ts` 的 `AuthorizationStatus.DENIED` 由 4 改 0（与真实枚举一致；现状碰巧行为等价未爆雷），并同步 `agent-finished-notification.test.ts` 中 `authorizationStatus: 4` 的写法。

**开关默认关与设置页**：
- 默认值翻转是**两处联动**，缺一不可：
  - `message-notification-pref.ts`：`readBoolPref` 第三参 `true → false`，头注释改写新语义（「默认开」→「默认关」）。这只覆盖 appUi 为 null、get 异常与非法值三条回退路径。
  - `app-ui-keys.ts`：`APP_UI_DEFAULTS[APP_UI_KEY_MESSAGE_NOTIFICATION]` 从 `'true'` 改 `'false'`（现状 L41），key 上方「默认开」注释（L13-16）同步改写。该表是 KKV 未写值时的**功能性回退**：`createAppUiPreferences.get` 在 KKV 抛 NOT_FOUND 时返回 `defaults[key]`（app-ui-prefs.ts），`readBoolPref` 的 `raw === 'true'` 分支随即直返 true——**只改第三参时，「从未写过该 key 的存量用户」get 回退拿到的永远是 `'true'`，根本走不到第三参**，默认关对他们不生效。
- 副标题两态：开 = `进入应用即常驻状态栏保活，生成中显示状态，结束后台提醒`；关 = `无常驻通知、无提醒（生成行为不受影响）`。
- `ChatConfigScreen` 开关初始值 `useState(true)` 改 `useState(false)`（现状 L46-47）：默认关口径下防首帧闪「开」（refresh 异步回填真实值前的过渡帧会显示旧初始值）。
- `onValueChange` 扩展：`persistSwitchWithRollback` persist 成功后追加 `void setKeepAliveResidentEnabled(enabled)`；**关→开**时附带 `void ensureAgentNotificationPermission()`（权限申请前移到「开关从关切到开」，与设计目标 4 一致）。通知模块启停失败**只 toast 不回滚**（进程级副作用不易回滚；存储已持久化，下次启动按存储态收敛）。分层依据：screens 直接 import services 是仓库通行做法（CloudSyncConfigScreen/StorageConfigScreen 等 15+ 先例）。

## 最终项目结构

源码零新增文件，全部为既有文件改动；测试侧新增一个轻量用例文件（T-K8/T-K9 直测落点）：

```
apps/mobile/src/
  services/agent-finished-notification.ts      # 期望态重构（标签操作永不直接置 true）+ 空闲文案 + 权限新导出
  services/session-stream-unit-manager.service.ts  # manager 解耦 + 权限申请退役
  runtime/novel-master-context.tsx             # 常驻挂点（ensureKeepAliveResidentBoot 导出）+ prefBridge 降级（createNotificationPrefBridge 工厂导出）
  screens/stack/ChatConfigScreen.tsx           # 默认关（含 useState 初始值 false）+ 副标题 + 即时启停 + 权限行（非 Android 隐藏）
  storage/message-notification-pref.ts         # readBoolPref 第三参默认 false
  storage/app-ui-keys.ts                       # APP_UI_DEFAULTS 'true'→'false' + key 注释改写（未写值回退链闭合）
apps/mobile/test-utils/notifee-mock.ts         # 扩 getNotificationSettings/openNotificationSettings + DENIED=0
apps/mobile/__tests__/agent-finished-notification.test.ts       # 断言反转 + 新用例（T-K11）
apps/mobile/__tests__/message-notification-pref.test.ts         # 既有「默认开」断言反转 + defaults 回退新断言
apps/mobile/__tests__/keepalive-resident-boot.test.ts           # 新增：T-K8/T-K9 直测落点
apps/mobile/__tests__/session-stream-unit-manager.service.test.ts  # 断言反转 + 计数重排
```

## 变更点清单

| 文件 | 变更 |
|------|------|
| `services/agent-finished-notification.ts` | `keepAliveResident` 状态 + `setKeepAliveResidentEnabled` 导出；start/stop 语义改标签操作（**标签分支全部传 `keepAliveResident`，永不直接置 true**）；`reconcileKeepAlive` resident 短路（纯防御兜底）；`buildKeepAliveContent` 空闲分支；`getAgentNotificationPermissionStatus`/`requestAgentNotificationPermissionManually` 导出；`resetKeepAliveStateForTests` 扩复位 |
| `services/session-stream-unit-manager.service.ts` | `maybeEnsureNotificationPermission` + `permissionEnsured` 退役；startRun 调用点删权限申请；其余启停调用零改动（语义由模块内部吸收） |
| `runtime/novel-master-context.tsx` | 桥 effect 末尾常驻拉起：提取模块级导出 `ensureKeepAliveResidentBoot(appUi)`（含 null 分支守卫）；prefBridge 装配提取 `createNotificationPrefBridge` 工厂，降级 `true → false` |
| `screens/stack/ChatConfigScreen.tsx` | 副标题两态改写；开关初始值 `useState(true)` → `useState(false)`（防首帧闪「开」）；开关回调接 `setKeepAliveResidentEnabled`（+关→开时申请权限）；新增权限行（state + refresh + onPress；非 Android 不渲染） |
| `storage/message-notification-pref.ts` | `readBoolPref` 第三参默认 `false` + 注释 |
| `storage/app-ui-keys.ts` | `APP_UI_DEFAULTS[APP_UI_KEY_MESSAGE_NOTIFICATION]` `'true'` → `'false'` + key 注释改写（KKV 未写值回退链的功能性默认，与第三参联动才闭合） |
| `test-utils/notifee-mock.ts` | 新增两个 mock fn；`DENIED` 4→0 |
| 四个测试文件（含新增一个） | 见测试策略 |

## 详细实现步骤

- Step 1 — phase-keepalive-resident-core — blocking: yes — qa: auto：通知模块改造（resident 期望态、setKeepAliveResidentEnabled、start/stop 标签化且标签分支全传 `keepAliveResident`、reconcile 短路降防御、空闲文案、权限两个新导出、reset 扩位）+ `notifee-mock` 扩面与 DENIED 修正 + `agent-finished-notification.test.ts` 断言反转与新增用例（T-K1~K4、T-K7、T-K11）。
- Step 2 — phase-manager-decouple — blocking: yes — qa: auto：manager 侧退役权限申请（删方法/字段/调用点）+ `session-stream-unit-manager.service.test.ts` 断言反转与计数重排（T-K5、T-K6）。
- Step 3 — phase-resident-boot — blocking: yes — qa: auto：context 常驻挂点提取 `ensureKeepAliveResidentBoot` + prefBridge 装配提取 `createNotificationPrefBridge`（降级口径改 false）；T-K8/T-K9 直测落在新测试文件 `__tests__/keepalive-resident-boot.test.ts`；`typecheck` 全绿。
- Step 4 — phase-config-ui — blocking: yes — qa: auto：storage 默认关两处联动（readBoolPref 第三参 + `APP_UI_DEFAULTS`）+ 设置页（useState 初始值、副标题、开关即时启停回调、权限行）（T-K10 为 typecheck+行为逻辑走查，含 defaults 回退断言与 `message-notification-pref.test.ts` 断言反转；界面观感归 Step 5 真机）。
- Step 5 — phase-realdevice-accept — blocking: no — qa: manual_user：真机验收 GWT-1/2/4/5/6/7/8（GWT-3 已由 auto 用例覆盖行为层；GWT-7 在 auto 侧仅通知模块直调级覆盖（T-P4，agent-run-parallel-and-notify 迭代既有用例），manager 级「后台 + FINISHED → 完成通知」零改动风险低，真机顺手复核；真机复核 EMUI 无 `delay` 行的 logcat 双证沿用本轮排查方法论）。

> 实施节奏备注：Step 1 完成点上跑全量套件会红——manager 既有用例（`session-stream-unit-manager.service.test.ts:579-613`/`:615-662`）按计划挂到 Step 2 才修；验证阶段对 Step 1 的验收以本 Step 自管测试文件为准，若须跑全量套件则以 Step 1+2 合并后的状态验收。

## 测试策略

### 测试用例

- T-K1 — blocking: yes — `setKeepAliveResidentEnabled(true)`：displayNotification 以 `asForegroundService`+`ongoing` 调用且 title `'novel master · 空闲'`；`(false)`：`stopForegroundService` 调用（Step 1）。
- T-K2 — blocking: yes — 空闲文案：resident 开 + labels 空 → title `'novel master · 空闲'`、无 body；登记标签后 title `'正在生成 · X'`；摘标签回空闲（Step 1）。
- T-K3 — blocking: yes — 反转原 L409 断言：多会话最后一个收尾后 `stopForegroundService` **不**被调用，display 刷新为空闲文案（GWT-3 行为层）（Step 1）。
- T-K4 — blocking: yes — resident=false 时的标签操作为 no-op（display/stop 均不调用）；常驻关但 labels 非空的兜底摘除路径停服务（经 stopForegroundService 挂起窗口构造在途瞬态，或由 T-K11 前半场景等效覆盖）（Step 1）。
- T-K7 — blocking: yes — 权限：状态查询两态；手动申请 authorized/denied 分支；denied 时 `openNotificationSettings` 被调；permissionDenied 降级不影响手动路径（Step 1）。
- T-K11 — blocking: yes — 生成中关开关：resident 开 + labels 非空（先 `setKeepAliveResidentEnabled(true)` 再带标签 start）→ `setKeepAliveResidentEnabled(false)` 后 `stopForegroundService` 被调用；标签保留——重开开关后 display 内容为「正在生成 · S1」而非空闲文案（证明关开关未清标签）；关开关状态下再做标签操作（再 start 新会话 / stop 既有会话）零 display、零新增 stop（GWT-4 行为层）（Step 1）。
- T-K5 — blocking: yes — manager 计数重排：两段式调用序列保留、第一段为 no-op；带标签刷新内容「正在生成 · 会话名」同 id；FINISHED 后 stop **不**被调用且回空闲（反转原 L612）；开关关时受理零 display（Step 2）。
- T-K6 — blocking: yes — dispose 无参全停保持；afterEach `resetKeepAliveStateForTests → dispose` 顺序不破坏（防泄漏语义）（Step 2）。
- T-K8 — blocking: yes — 直测提取函数 `ensureKeepAliveResidentBoot(appUi)`（落点 `__tests__/keepalive-resident-boot.test.ts`）：开关开（appUi get 返回 'true'）→ `setKeepAliveResidentEnabled(true)` 被调；开关关（get 返回 'false'）→ 不调；入参 undefined → 守卫分支直接返回不抛错（Step 3）。
- T-K9 — blocking: yes — 直测提取工厂 `createNotificationPrefBridge(getAppUi)`（落点同上文件）：getAppUi 返回 undefined → `isNotificationEnabled()` resolve false（降级口径）；返回 appUi → 走 `readMessageNotificationEnabled` 真读（Step 3）。
- T-K10 — blocking: yes — 设置页：默认关两路径断言——`readBoolPref` 的 appUi 为 null 路径回退第三参 false（`readMessageNotificationEnabled` 参数非空，测试对 io 层直测）；appUi 非 null 且 KKV 未写值（get 走 NOT_FOUND → `APP_UI_DEFAULTS` 回退 `'false'`）→ false（锁 defaults 表翻转）；开关回调 persist 成功后调 `setKeepAliveResidentEnabled`；权限行状态流转（authorized/denied/申请中）（Step 4，逻辑层；无 screen 渲染测试基建则以导出函数单测 + typecheck 覆盖）。

### 既有用例影响（精确清单）

- `agent-finished-notification.test.ts:366-376`（带标签启动）、`:378-393`（同 id 重发刷新）、`:419-423`（同标签重复登记不刷新）→ 三条均直调 `startAgentKeepAliveService` 且断言 display 计数/取值，改造后 start 传 `keepAliveResident`、resident=false 时 no-op 零 display，**三条全挂**；均需前置 `setKeepAliveResidentEnabled(true)`（空闲态先 display 一次）并重排计数与取值下标：`:366-376` 1→2（calls[0] 空闲、calls[1] 带标签）、`:378-393` 2→3（calls[0] 空闲、calls[1] S1、calls[2] S2）、`:419-423` 1→2（空闲 + 带标签一次，第二次同标签仍不刷新）。
- `agent-finished-notification.test.ts:395-410`（最后收尾停服）→ 反转（T-K3）；`:412-417`（未运行收尾 no-op）→ 用例名/注释改写，行为保留；`:289-350`（MF-4 串行化三条）→ 按新导出面重写驱动源（start/stop 直调改为 setKeepAliveResidentEnabled + 标签操作组合）；`:200-209`（权限降级）→ 保留 + 扩 T-K7。
- `session-stream-unit-manager.service.test.ts:579-613`（FINISHED 停服）→ 反转（T-K5）；`:589-603` 与 `:615-662`（两段式计数）→ 受理段 display 断言改为〔前置空闲 1 次（若用例构造常驻前置）+ 带标签 1 次〕共 2 次的口径；T-N1 的「通知出现先于标签查询完成」锚点失效（常驻下受理不再是通知首次出现时机），改锚为「标签查回后立即刷新（display 同 id）且受理链路不被标签查询阻塞」；`:664-674`（开关关零 display）→ 保留加强。
- `message-notification-pref.test.ts:22-25/40-43/45-55`（三条「默认开」断言）→ 随默认值翻转反转为 false；并新增「appUi 非 null、KKV 未写值经 NOT_FOUND → `APP_UI_DEFAULTS` 回退 `'false'`」断言（T-K10 defaults 路径的落点）。
- `notifee-mock.ts` DENIED 修正波及 `authorizationStatus: 4` 字面量写法（同文件同步改 0）。

## 兼容性或迁移说明

- 偏好 key 不变（`messageNotification`），默认值翻转落在 `readBoolPref` 第三参与 `APP_UI_DEFAULTS` 两处（联动生效）：存量已显式设置的用户不受影响；从未设置过的用户从「默认开」变「默认关」——用户已拍板接受（无迁移）。
- init-busy-yield 的验收文档不回改（历史锚点由本 spec GWT-2/PRD 接替声明）；其 T-N1 用例的「通知出现先于标签查询完成」锚点随 Step 2 的 manager 测试改造同步改锚（见「既有用例影响」）。
- 通知 id/channel 均不变（`nm-agent-keepalive` / `agent-keepalive` IMPORTANCE_LOW），系统侧无迁移。
- desktop/iOS 零影响（iOS 维持现状门禁直接跳过）。

## 风险与回滚方案

- **EMUI 首启压制仍在**（发生在进 app 时刻，PRD 风险节已接受）；「启动后 10 秒内极速发送切桌面」场景与现状持平——真机验收（Step 5）以 logcat `delay` 行 + `onNotificationPosted` 时序双证。
- **Android 14+ dataSync 6 小时限额**：超时系统按外力关闭处理，下次打开重新常驻（用户已拍板接受，不做 serviceType 变更）。
- **开关切换与在途标签操作竞态**：「标签操作永不直接置 true」的不变量保证「关开关后标签操作不会复活服务」——正确性由入参保证（T-K4/T-K11 锁定），reconcile 的 resident 短路仅作纯防御兜底（防未来回归）；串行链 `keepAliveChain` 保持，MF-4 串行化语义保持。
- **回滚**：整体 revert 即可恢复「随 run 启停」现状（无存储/协议迁移）；偏好默认值翻转对回滚无阻碍（已显式写入的值不受默认值影响）。
