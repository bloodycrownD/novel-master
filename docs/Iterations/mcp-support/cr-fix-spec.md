# CR Fix Spec: MCP 双端接入（feat/mcp-support）

## 元信息
- repo：D:/worktree/mcp-support（worktree，分支 feat/mcp-support）
- base_sha：7f3950754（main） / head_sha：c997c98cb
- prd_path：未提供 / spec_path：docs/Iterations/mcp-support/spec.md（「开发期变更（2026-11-25）」一节优先于其后各章）
- review_round：3 / dag_version：4
- 状态：已执行（2026-11-26；CR-01~CR-17 全部落地，另按用户要求补了桌面端每工具启停并把换 ID 编排、每工具启停收进 core）。合并前的人工 QA 见「合并后 QA（manual_user）」。

## 执行记录（2026-11-26）

分支 `feat/mcp-support`，提交区间 `d8896d8ed..ddae3c955`。

| 条目 | 落点 | 提交 |
| --- | --- | --- |
| CR-01（P0） | core：按 server 的代际表；`connectOnce` / `fetchSnapshot` 入口自捕获，成功与失败两个写回点都校验；`callTool` 的失败写回加守卫；`connecting.delete` 带身份判断。三条交错用例 | d8896d8ed |
| CR-02 / CR-03 / CR-04 | 两端新建改为 create 成功后写 bearer；换 ID 的 bearer 写入放进 core 编排的 `afterRename`（在回滚链内）；oauth 搬迁失败由 core 降级为未授权，移动端不再整体回滚 | d8896d8ed（core）、b7aaec11f（mobile）、4532a39a1（desktop） |
| CR-05 | 桌面传输下拉去掉 stdio 与对应 key | 0a210c080 |
| CR-06 | 移动端请求适配层缺 `headers` 时用 `contentType` 回填 | b7aaec11f |
| CR-07 | 桌面列表 connecting 时禁用行开关与行菜单，后台连接前后各重读一次状态 | 0a210c080 |
| CR-08 / CR-09 / CR-10 | 新增 `apps/desktop/test/mcp-handlers.test.ts`（6 条）、`apps/mobile/__tests__/mcp-config-store.test.ts`、`apps/mobile/__tests__/mcp-oauth-service.test.ts` | 5753f61a6、92da895d1 |
| CR-11 / CR-12 / CR-13 | 列表开关互斥改 state；`@babel/plugin-transform-class-static-block` 进 devDependencies；死注释与缩进 | 12dfcfb3c、0a210c080 |
| CR-14 | 移动端 `reorder` 及其注释删除 | b60c54f10 |
| CR-15 | 桌面 catalog 两个辅助函数收进 `AgentToolCatalog` namespace | 8b7efebe7 |
| CR-16 | ID 规则拒绝连续 / 首尾下划线，core 与桌面副本同步 | d8896d8ed、8b7efebe7 |
| CR-17 | 没有响应的传输错误归 network / retry | d8896d8ed |
| K 节 | port 注释与实际行为对齐；`closeAll` 两端仍未在应用退出时调用（注释已如实写明） | 168eb78fb |

超出 fix-spec 的收敛（用户要求「做干净」）：
- 换 ID 编排收进 core `McpToolRefs.renameWithRewrite`，两端不再各写一份；`rewriteAgentTools` 改返回 `Result`。
- 每工具启停上收 core：`McpConfigStore.listDisabledTools / setToolDisabled`、`remove` 连带清清单、连接管理器 deps 必填 `disabledTools` 并在 `snapshotTools` 出口过滤。移动端配置 store 改成 core 的薄镜像（写路径全部委托 core）；桌面端补了详情页「工具」卡与每工具开关（`nm:mcp/toolList`、`nm:mcp/setToolDisabled` 两条通道）。

执行后的验证（全部由主代理亲手跑）：
- core：tsc 0；`test/mcp` 126、`test/tool` 392、`test/i18n` 21、`test/common` 96 全过。
- desktop：typecheck 0；`mcp-handlers` / `agent-tool-catalog` / `agent-editor-state` / `tool-policy-picker` / `runtime` / `ipc-handlers` 六个文件 71 条全过（未跑 packaging，原因见 CR-08）。
- mobile：tsc 0；jest 273 套 2430 条全过。
- mobile bundle（android、`--dev false`）：11.56MB，`cross-spawn` / `child_process` / `eventsource` 零命中。
- nm-style：对分支改动的 40 个 MCP 相关文件跑 `check`，本次迭代引入的 hygiene 发现已清零；剩余 8 条是 main 上就存在的存量（`AgentEditorView.tsx` 7 条、`llm-native-fetch-shim.ts` 的 `fetchLike` 1 条，已在主仓同文件上复现确认）；dup gate 剩 3 组，均为保留理由明确的契约同名（两个页面的 UI 回调 `runWrite`、SDK 的 `send(message, options?)`、`listTools(signal)` 与 abort scope 的 `(signal)`）。
- 真机已 RELOAD 到最新代码，logcat 无启动期异常。

评审方式：code-review-loop · scope 模式，第 1 轮同 wave 四个只读审查者（review-scope-core / review-scope-mobile / review-scope-desktop / review-global，互盲）。合并口径：发现取并集、同问题去重、同文件同维度保留最高严重度。下表「来源」保留原始节点 id 以便回溯。

## Must-fix（按 P0 → P1 → P2）

### CR-01 [P0] 连接管理器：invalidate / closeAll 不感知在途连接，旧配置的连接会被「复活」
- 维度：B（正确性 / 竞态）+ C-orch
- 文件：`packages/core/src/infra/mcp/impl/create-mcp-connection-manager.ts`（`connectOnce` 的成功写回、`fetchSnapshot` 的成功与失败写回、`invalidate`、`closeAll`）；`packages/core/test/mcp/client-connection-manager.test.ts`
- 问题：`invalidate` 与 `closeAll` 只删表，不做废在途的 connect / listTools。在途操作完成后无条件 `connections.set`，会把旧配置（旧 URL、旧 token）的 client 与快照写回表。之后 TTL 命中返回旧工具；TTL 过期后复用旧 client，持续对旧端点 listTools / callTool，不会自愈。触发路径：保存 → `invalidate` → 重拉，与该 server 在途的连接交错；两端「测试连接」都先 `invalidate` 再重拉，连点即并发两条真实连接且旧结果回写。
- 改法：
  1. 闭包内新增按 server 的代际表 `generations: Map<string, number>`（不随 `invalidate` 删除）。`invalidate(serverId)` 把该 server 的代际 +1；`closeAll` 对所有已知 server 的代际 +1 再清表。
  2. `connectOnce` 在入口处、第一个 `await` 之前自行捕获 `generation = generations.get(config.id) ?? 0`，这样 `snapshotFor`（经 `fetchSnapshot`）与 `callTool` 两个调用点走的是同一套校验；`fetchSnapshot` 同样在入口捕获。
  3. `fetchSnapshot` 与 `connectOnce` 在每次 `await` 之后、写回 `connections` 之前校验代际：不一致则丢弃结果并 `return []`（fetchSnapshot）或抛 `McpTransportError("连接已被更新的配置取代")`（connectOnce）；若 client 是本次新建且表里没有别的条目持有它，`await client.close()` 后再返回。
  4. `.finally` 里清理 `inflight` 的身份判断保持不变。
  5. 执行注意（第三轮认证补充，非阻塞，但请照做）：
     - `fetchSnapshot` 有两个写回点（成功路径与 catch 里的失败路径），两处都要加代际校验；不要只守成功路径，让旧配置的失败结果也写回去。
     - `callTool` 的 catch 里也有一处 `connections.set`（写 `client: null` 的 failed 条目），顺手加同款守卫。
     - `connectOnce` 的 `connecting.delete(config.id)` 没有身份判断，极端交错下会误删新一代的 single-flight 登记导致重复建连；改为仅当 `connecting.get(config.id) === pending` 时才删。
- 验收/测试：
  - 新增用例「invalidate 与在途快照交错」：用可挂起的请求让 `snapshotTools()` 停在 initialize；`invalidate("srv")`；放行后断言该 server 状态不是 `ready`（`pending` 或 `failed`），表里没有旧 client；再次 `snapshotTools()` 走新配置（请求 URL / 调用次数可观测）。
  - 新增用例「invalidate 与在途 callTool 交错」：`callTool` 停在握手时 `invalidate`，放行后该次调用以错误结束，表里没有旧 client。
  - 新增用例「closeAll 与在途连接交错」：放行后旧 client 的 `close` 被调用，且不会写回。
  - 既有 `client-connection-manager.test.ts` 全部用例保持通过。
- 来源：review-scope-core core/B-1（P0）；与 review-global global/C-5（P2）是同一问题，按最高严重度记

### CR-02 [P1] 新建服务器时先写 bearer 密钥再 create，撞名会留下孤儿密钥或覆盖已有密钥
- 维度：B（数据安全）
- 文件：`apps/desktop/src/main/ipc/handlers/mcp.ts`（create 分支，约 119-126 行）；`apps/mobile/src/screens/stack/McpServerDetailScreen.tsx`（保存流程，约 226-242 行）
- 问题：两端都是先把 bearer 明文写进 `mcp/{id}/bearer`，再调 `create`。create 因 ID 已存在被拒时：移动端留下孤儿密钥；桌面端因为 renderer 预查与 main 的权威校验之间有竞态，可能无提示地覆盖已有同名服务器的密钥。
- 改法：两端都把「写入新 bearer」挪到 `create` 成功之后。编辑（非新建、非换 ID）分支的写入顺序不变。
- 验收/测试：桌面 handler 测试覆盖「create 撞名被拒时 SKSP 的 bearer 未被写入」（见 CR-08 的测试文件）；移动端在 CR-09 的 store 测试旁补一条详情页保存流程的用例，或至少补一条 store 级断言 `create` 拒绝后 `secretStore.set` 未被调用。
- 来源：review-scope-desktop desktop/B-1（P1）；review-scope-mobile mobile/B-2（P2）

### CR-03 [P1] 桌面端换 ID 时 bearer 密钥写入在回滚链之外
- 维度：B（事务完整性）
- 文件：`apps/desktop/src/main/ipc/handlers/mcp.ts`（约 149-152 行；回滚 try 块在 133-144 行）
- 问题：换 ID 成功后写 bearer 的 `secretStore.set / delete` 位于回滚 try 之外。这里抛错只会进外层 catch 报错，不回滚，留下「引用已改写、配置已改名、密钥没迁移」的半提交态；renderer 的 `previousId` 仍指旧 ID，重试保存会因 `rename(oldId)` 找不到而卡死。
- 改法：把换 ID 分支的 bearer 写入移进既有回滚 try 内（`rename` 成功之后、`invalidate` 之前），失败即走既有「反向改写 + rename 迁回」回滚链。
- 验收/测试：CR-08 的 handler 测试覆盖「换 ID 时 secretStore.set 抛错 → 返回错误，且配置与 agent 引用都回到旧 ID」。
- 来源：review-scope-desktop desktop/B-2（P1）

### CR-04 [P1] 移动端换 ID 时 OAuth 密钥搬迁失败的处理与 core、桌面端不一致
- 维度：C-orch（双端 parity）+ A
- 文件：`apps/mobile/src/services/mcp-config.store.ts`（`migrateStorage`，约 161-172 行）
- 问题：移动端 `migrateStorage` 里 oauth 的 `secretStore.set` 失败会让整个 rename 抛错并全量回滚；core 的 `rename` 与桌面端在同场景是捕获后降级为「未授权」继续换 ID（spec 开发期变更 #2 的口径）。
- 改法：移动端对 oauth 的搬迁单独 try/catch，失败时跳过（保持未授权）而不中断 rename；bearer / headers 的搬迁失败仍按失败回滚。
- 验收/测试：CR-09 的 store 测试覆盖「oauth set 抛错 → rename 仍成功，bearer / headers 已在新 ID 下」。
- 来源：review-global global/C-1（P1）

### CR-05 [P1] 桌面端传输类型仍有 stdio 选项，与移动端及用户决定不一致
- 维度：A + C-orch
- 文件：`apps/desktop/renderer/features/settings/McpServerDetailView.tsx`（传输下拉，约 180 行）；`packages/core/resources/i18n/settings.yaml`（`mcp.detail.transport_stdio.desktop` 等仅桌面 stdio 使用的 key）；`packages/core/src/domain/settings/i18n/keys.ts` 与生成目录
- 问题：桌面详情页传输类型提供 stdio，移动端只有 HTTP / SSE。用户已明确「支持什么就做什么，sse / streamable 就够了，没必要展示 stdio」。两端选项集分叉。
- 改法：桌面下拉去掉 stdio，只保留 HTTP / SSE；失去消费者的文案 key 删除并重新运行 `node scripts/gen-i18n-catalog.mjs`。已存的 stdio 配置读取路径（归一与「不可用」状态提示）保持不变。
- 验收/测试：桌面 `McpServerDetailView` 渲染断言下拉只有两项；core i18n 防漂移测试通过。
- 来源：review-global global/C-2（P1）；review-scope-desktop 记为可接受，按用户原话改判为必修

### CR-06 [P1] 旧 APK 配新 JS 时拿不到 content-type，MCP 整体不可用
- 维度：B（兼容性）
- 文件：`apps/mobile/src/services/mcp-request-adapter.ts`（约 172 行，`headers: result.headers ?? {}`）；`apps/mobile/__tests__/mcp-request-adapter.test.ts`
- 问题：`packages/llm-sse-native/src/types.ts` 的注释承诺旧 APK 缺 `headers` 时「按空对象处理并以 contentType 兜底」，但适配层没有回填。旧 APK 配新 JS 时 transport 读不到 content-type，所有 2xx 响应都落进「Unsupported content-type」。
- 改法：`headers` 缺失时，用返回值的 `contentType` 回填 `content-type` 键（`contentType` 非空才填），再交给 transport。
- 验收/测试：适配层测试补一条「原生返回值无 `headers`、有 `contentType` → 请求函数返回的 `headers["content-type"]` 等于该值」；既有「无 headers 无 contentType → 空对象」用例保留。
- 来源：review-global global/C-3（P1）

### CR-07 [P1] 桌面端列表在「连接中」没有禁用开关，也不刷新状态
- 维度：A + C-orch（双端 parity）
- 文件：`apps/desktop/renderer/features/settings/McpServersView.tsx`（行开关约 161 行、行菜单、`reload` 内的后台自动连接）
- 问题：移动端在连接进行中禁用该行开关并显示「连接中」；桌面端行开关只受 `busy` 约束，进列表触发的后台自动连接不走 `busy`，期间开关与行菜单都可点，可重复发起连接；状态只在 `reload` 时刻采样，后台连接期间看不到「连接中」。与 spec 开发期变更 #8 不符。
- 改法：
  1. 行开关与行菜单在 `status.state === "connecting"` 时禁用。
  2. 后台自动连接发起后立即重读一次状态（让「连接中」上屏），全部完成后再重读一次。
- 验收/测试：桌面侧至少补一条 renderer 级断言「状态为 connecting 的行，其开关为 disabled」；手动验收时在桌面列表观察「连接中 → 已连接 / 原因」的切换。
- 来源：review-scope-desktop desktop/A-1（P1）

### CR-08 [P1] 桌面端 MCP handler 零测试
- 维度：G
- 文件：新增 `apps/desktop/test/mcp-handlers.test.ts`（仿 `apps/desktop/test/ipc-handlers.test.ts` 等既有 handler 测试的写法）；被测 `apps/desktop/src/main/ipc/handlers/mcp.ts`
- 问题：换 ID 的改写与回滚顺序、create 撞名拒绝、保存后自动连接、`oauthStatuses` 的容错解析都没有测试。
- 改法：补 handler 测试，至少覆盖：create 撞名被拒且 SKSP 未被写入（CR-02）；换 ID 成功；`rewriteAgentTools` 失败时回滚（引用与配置回到旧 ID）；换 ID 时 bearer 写入失败回滚（CR-03）；`enabled` 保存后调用 `snapshotTools`；`enabled: false` 保存后不调用。
- 验收/测试：`node apps/desktop/scripts/run-tests.mjs test/mcp-handlers.test.ts` 全绿。**注意：不要为了跑这条测试去执行 `test/packaging.test.js`**（它会跑 electron-builder，Metro 在真机联调期间会被它搞崩）。
- 来源：review-scope-desktop desktop/G-1（P1）

### CR-09 [P1] 移动端镜像 store 的写路径零测试
- 维度：G
- 文件：新增 `apps/mobile/__tests__/mcp-config-store.test.ts`；被测 `apps/mobile/src/services/mcp-config.store.ts`
- 问题：`rename` 事务（引用改写失败反向回滚、SKSP 三 ref 迁移、KKV 原位替换）、`remove` 的清理、`setToolDisabled` 落库、`connect` 都没有测试。
- 改法：以 mock 的 kkv / secretStore / agentRegistry / connectionManager 补测试，至少覆盖：rename 成功；rewrite 失败回滚；撞名 throw；oauth 搬迁失败不中断（CR-04）；`create` 被拒时不写密钥（CR-02）；`connect` 先 `invalidate` 再 `snapshotTools`。
- 验收/测试：该文件在 `jest --maxWorkers=2` 下全绿。
- 来源：review-scope-mobile mobile/G-1（P1）

### CR-10 [P1] 移动端 OAuth 回调 service 零测试
- 维度：G
- 文件：新增 `apps/mobile/__tests__/mcp-oauth-service.test.ts`；被测 `apps/mobile/src/services/mcp-oauth.service.ts`
- 问题：回调 URL 的窄解析（`+` 号还原、编码异常跳过）、pending 登记路由、`code / state / error` 原样透传 `handleCallback`、冷启动 `getInitialURL` 分支都没有测试。
- 改法：mock `Linking` 与 runtime，补 service 级单测覆盖上述四点。
- 验收/测试：该文件全绿。
- 来源：review-scope-mobile mobile/G-2（P1）

### CR-11 [P2] 移动端列表行开关的全局互斥会悄悄吞掉点击
- 维度：B（交互反馈）
- 文件：`apps/mobile/src/screens/stack/McpServersScreen.tsx`（`togglingRef`，约 166-182 行）
- 问题：任一行开关写库在途时，其他行的 Switch 没有 disabled，点击被静默忽略，没有任何反馈。
- 改法：把「正在写库的 server id」放进 state，在途时禁用全部行开关（与 `deleting` 的现有口径一致），`togglingRef` 改为该 state 的等价物或保留做互斥、disabled 跟随它。
- 验收/测试：手动验收——快速连点两行开关，第二行呈禁用态而非无反应；如有现成的列表页测试基建则补一条断言。
- 来源：review-scope-mobile mobile/B-1（P2）

### CR-12 [P2] 移动端新增的 Babel 插件没有显式声明依赖
- 维度：C
- 文件：`apps/mobile/package.json`；`apps/mobile/babel.config.js`
- 问题：`@babel/plugin-transform-class-static-block` 被 babel 配置引用，但未在 `apps/mobile/package.json` 声明，靠根 node_modules 的传递依赖存在；依赖树一变构建就失败。
- 改法：加入 `apps/mobile` 的 devDependencies（版本与当前 node_modules 里解析到的一致），并确认 `package-lock.json` 随动。执行时只跑 `npm install`（或等价）更新 lock，不要跑 gradle。
- 验收/测试：`node -e "require.resolve('@babel/plugin-transform-class-static-block', {paths:['apps/mobile']})"` 通过；lock 文件 diff 只有这一条新增。
- 来源：review-scope-mobile mobile/C-1（P2）

### CR-13 [P2] 残留注释与缩进
- 维度：C
- 文件：`apps/mobile/src/screens/stack/McpServerDetailScreen.tsx`（约 102 行的「删除确认弹窗开关。」注释）；`apps/mobile/src/screens/stack/McpServersScreen.tsx`（约 94-110 行整块多缩进）；`apps/desktop/renderer/features/settings/McpServersView.tsx`（约 27 行注释里的「/ 导入」）
- 问题：对应的 state / 功能已删除，注释与缩进没跟上。
- 改法：删除死注释、修正缩进，不改任何逻辑。
- 验收/测试：类型检查与 lint 通过；diff 只有空白与注释。
- 来源：review-scope-mobile mobile/C-2；review-scope-desktop desktop/C-1

### CR-14 [P2] 移动端 store 的 `reorder` 已无调用方
- 维度：C（死代码）+ C-orch
- 文件：`apps/mobile/src/services/mcp-config.store.ts`（接口声明约 56 行、实现约 222-232 行）；`apps/mobile/src/runtime/types.ts`（若类型里有对应成员）
- 问题：列表的上移 / 下移入口已移除，`reorder` 全仓无消费点。
- 改法：删除接口成员与实现；同文件约 152 行注释里的「reorder」提法一并删掉；全仓 grep 确认无引用。
- 验收/测试：mobile 类型检查通过。
- 来源：review-global global/C-4（P2）

### CR-15 [P2] 两端 catalog 的辅助函数导出形态不一致
- 维度：C（结构 parity）
- 文件：`apps/desktop/shared/config-forms/agent-tool-catalog.ts`（约 95、106 行）；`apps/mobile/src/config-forms/agent/agent-tool-catalog.ts`（约 95、106 行）
- 问题：`buildToolsPolicyFromSelection` / `toolsSelectionFromDefinition` 桌面是顶层导出函数，移动端收在 namespace 里。条目、文案、顺序两端已对齐，只有结构约定不同。
- 改法：统一为 namespace 成员（与 nm-code-style 的 object namespace 口径一致），桌面调用点随动。
- 验收/测试：两端既有 catalog / picker 测试通过。
- 来源：review-global global/C-6（P2）

### CR-16 [P2] ID 允许连续下划线，会让换 ID 时的引用改写误伤别的服务器
- 维度：B（边界）
- 文件：`packages/core/src/domain/mcp/model/mcp-server-config.ts`（`isValidId`）；`apps/desktop/shared/logic/mcp-id.ts`（同值副本，两处必须同步）；`packages/core/src/domain/mcp/logic/rewrite-mcp-tool-references.ts`（`rewriteNames`）；对应测试
- 问题：工具名用 `mcp__<ID>__<工具>`，分隔符是双下划线。ID 规则允许 `__`，改写按 `mcp__<旧ID>__` 前缀匹配时，旧 ID 为 `a` 会把服务器 `a__b` 的条目 `mcp__a__b__x` 一并改掉，污染智能体配置。
- 改法：`isValidId` 拒绝包含连续下划线的 ID（例如 `^[A-Za-z0-9]+(_[A-Za-z0-9]+)*$`，首尾不以下划线开头结尾），两处正则同步；ID 非法的提示文案保持「只能使用英文字母、数字和下划线」不变；`rewriteNames` 补一条边界用例，`isValidId` 补「`a__b` 不合法」用例。
- 验收/测试：core 与 desktop 的相关用例通过；桌面 `mcp-id` 若有测试则同步。
- 来源：review-scope-core core/B-2（P2）

### CR-17 [P2] 请求函数自身失败（没有响应）被归到 unknown，而不是 network
- 维度：B（错误归一）
- 文件：`packages/core/src/infra/mcp/impl/create-mcp-connection-manager.ts`（`failureOf`，约 73 行）；`packages/core/src/infra/mcp/impl/http-mcp-transport.ts`（约 68-70 行）；`packages/core/test/mcp/model-classify-mcp-failure.test.ts` 或连接管理器测试
- 问题：网络断开等「没有响应」的失败被 transport 包成 `raw === null` 的 `McpTransportError`，`failureOf` 仍按 message 文本嗅探，多数落 `unknown / report`。7 个 kind 里的 `network → retry` 正是为这类准备的。
- 改法：`failureOf` 对 `raw === null` 的 `McpTransportError` 直接给 `{ kind: "network", action: "retry", detail: error.message }`，不再走文本嗅探。
- 验收/测试：补一条用例「transport 抛 raw 为 null 的错误 → `kind: "network"`、`action: "retry"`」。
- 来源：review-scope-core core/B-3（P2）

## Spec deviations
- none（open）。以下三处实现与 spec 旧文不同但与「开发期变更」一致，按文档同步处理（见 K 节）：
  - `McpConfigParser.parse` 被保留并收窄为 KKV 存储值的归一器（变更 #3 写的是「一并删除」）——实现正确，是 spec 表述需要改准。
  - spec §五 旧文「预算超时记 pending」已由变更 #8 改为 failed。
  - spec §四 旧文「请改用 Streamable HTTP」已由变更 #4 改为「请改用 HTTP 传输」。

## Fix-Spec Closure

| 项 | 状态 |
| --- | --- |
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/mcp-support/cr-fix-spec.md |
| dag_version / review_round | 4 / 3 |
| review-global 每轮参与 | yes（第 1 轮与三个 scope 同 wave、互盲） |
| 末轮 review-final | 通过（第三轮，发生在末次 spec-fix 之后的 read-after-write 认证；它对 CR-01 另给出三条非阻塞的执行注意，已作为 CR-01 改法第 5 步原样并入） |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 9 / 7 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅（双端 parity 三条：CR-04、CR-05、CR-07；死通道一条：CR-14；竞态一条并入 CR-01） |
| C 类合并后 QA | 见「合并后 QA（manual_user）」，不阻塞 |

> 说明：fix-spec-ready 只表示这份修复说明可执行，不表示代码已修完或可合并。

## Open questions / 待拍板
1. **单个工具的启停要不要也给桌面端补上**：目前只有移动端有（spec 变更 #6 已标待定）。若要补，禁用清单的存储键契约应从移动端私有常量上收到 core / shared。
2. **删除服务器时要不要顺带清理智能体名单里 `mcp__<id>__` 的引用**：spec 只规定了换 ID 场景。悬挂引用目前没有实际危害，但口径未定。
3. **换 ID 后 OAuth 搬迁失败，界面要不要给一句提示**：现在只靠授权状态标签间接体现。
4. **连接常驻的口径**：port 注释写的是「回合结束时调 `closeAll`」，实际 `run-agent-turn` 没有调用，连接常驻到应用退出（这与 spec §五「常驻连接、`closeAll` 挂应用退出」一致）。建议改的是注释而不是行为。
5. **slug 撞名检测在连接管理器与注册侧各有一份**：属于纵深防御还是应收敛为一处，待定（当前两处行为一致，不阻塞）。
6. **2xx 且 content-type 为 `application/json` 但 body 为空**时 transport 报「Unsupported content-type」，真实服务器是否会出现这种情况未验证。

## 已豁免（用户确认不修）
- 无。

## 合并后 QA（manual_user）
- 真机（荣耀）冒烟：旧 APK 配新 JS 的场景（CR-06）——先不重装 APK 只更新 JS，确认 MCP 仍能连上；再装新 APK 复测。
- 桌面端真实 OAuth server 授权走一遍（loopback 回调）。
- 荣耀真机 deep link 授权回调（需要用户在场确认）。
- 桌面列表观察「连接中 → 已连接 / 原因」的切换，以及连接中开关不可点（CR-07）。
- 快速连点两行开关，第二行呈禁用态（CR-11）。
- 对智谱端点的真实冒烟（spec Step 7）。

## K 节建议（下游执行时闭合）
- spec 文档同步（`docs/Iterations/mcp-support/spec.md`）：把「开发期变更」#3 里「`McpConfigParser.parse` 一并删除」改为「保留并收窄为 KKV 存储值归一器」；变更点清单里 `resolve-agent-tools.ts` 一行改为「行为无需改动，由 `tools-registration.test.ts` 的 T-M21 三条断言锁定」；Step 5 补注「`parse-sse-frames` 未复用 llm-sse 既有实现（既有实现面向流式 buffer）」。
- `packages/core/src/domain/mcp/ports/mcp-connection.port.ts` 里 `closeAll` 的注释改为与实际一致（常驻到应用退出时由 runtime 调用）。
- 收尾时跑：core tsc + `test/mcp` + `test/tool` + `test/i18n`、重建 core dist、mobile tsc + jest（`--maxWorkers=2`）、desktop typecheck + `test/mcp-handlers.test.ts`（不跑 packaging）、`nm-style check` 对 `packages/core/src/domain/mcp` 与 `packages/core/src/infra/mcp`、mobile bundle 产物确认不含 `cross-spawn` / `child_process` / `eventsource`。
- 修复期间 Metro 在真机联调中：不要跑 `apps/desktop/test/packaging.test.js`，不要跑 gradle（除非改了 Kotlin）。

## 执行顺序建议
1. CR-01（P0，core，其余依赖它的状态机稳定）
2. CR-02、CR-03、CR-04、CR-06（数据安全与一致性，两端）
3. CR-05、CR-07（双端对齐）
4. CR-08、CR-09、CR-10（测试补齐，可与上一组并行编写）
5. CR-11 ~ CR-17（P2）与 K 节收尾
