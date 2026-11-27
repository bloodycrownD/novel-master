# CR Fix Spec: MCP 连接模型（core + 双端）

## 元信息
- repo / base_sha / head_sha：`D:\worktree\mcp-support`（feat/mcp-support）/ `1a1857623` / `2361358b0`
- prd_path：无（以 spec 为准绳）/ spec_path：`docs/Iterations/mcp-connect-model/spec.md`
- review_round / dag_version：1 / 1
- 审查方式：四个只读审查者并行且互盲（core 工具与连接模型 / 移动端 / 桌面端 / 全局跨切面）；主代理未自审
- 状态：draft

## Must-fix（按 P0 → P1 → P2）

### 执行记录
六条已全部改完并提交。验证范围：

- core：类型检查通过，`test/mcp` 158 条通过（含 CR-06 改动）；core 产物已重建。
- 移动端：类型检查通过，全量 273 组 2431 条通过（比之前少 1 条，是 CR-01 删掉的透传用例）。
- 桌面端：类型检查通过。桌面测试未跑（Metro 开着会崩），CR-04 的断言与 CR-03 的改动都待停 Metro 后补跑。
- 风格：本轮增量（含测试）签名 / 顶层 let / 链式三元均为 0。
- CR-03 的验收原文写的是「handler 测试里补断言」，但重复发起出在渲染层，桌面渲染层只有静态渲染测试、跑不了副作用，所以改成人工确认（见下方「合并后 QA」）。
- CR-05 的验收原文写的是「单测断言日志被调用」，没有补：这两个界面的现有测试不覆盖该分支，暂以类型检查与人工确认为准。

P0 无。

### CR-01 [P1] 移动端 slice 的 `connectUnconnected` 是零消费的透传
- 维度：C、C-orch
- 文件：`apps/mobile/src/services/mcp-config.store.ts:45`、`:160`；`apps/mobile/__tests__/mcp-config.store.test.ts:10`、`:188-193`
- 问题：两个真实触发点（`McpServersScreen.tsx:122`、`ChatTabProvider.tsx:441`）都直调 `connectionManager.connectUnconnected()`，slice 上的同名包装只有测试在调。同一端口方法有「经 slice」与「直连」两条路径。
- 定性说明：两位审查者给了相反方向（移动端审查者主张让调用点改走 slice，全局审查者主张删包装）。按仓库口径「零消费的单行转手删掉」，采用删除。显式动作 `connect` 的 slice 包装有 4 个界面消费方，保留不动。
- 改法：删 `McpRuntimeSlice.connectUnconnected`（接口成员与实现）与测试里的透传用例、文件头注释中对应的一句；两个触发点不动。
- 验收/测试：移动端类型检查通过；`mcp-config-store.test.ts`、`mcp-servers-screen-connect-round.test.tsx` 通过。
- 来源：review-global F2（round 1）；移动端 MF1 提出了另一方向，由主代理裁定

### CR-02 [P1] 两个移动端旧测试夹具还挂着已删除的 `snapshotTools`
- 维度：C（死代码）
- 文件：`apps/mobile/__tests__/agent-editor-form-delete-confirm.test.tsx:36`、`apps/mobile/__tests__/agent-editor-form-dirty.test.tsx:39`
- 问题：runtime mock 里仍有 `mcp: {connectionManager: {snapshotTools: jest.fn()}}`。该方法已不在端口上，`AgentEditorForm` 也不再消费 `runtime.mcp`。
- 改法：两处删掉整个 `mcp` 切片；若删后用例因缺 mock 失败，再按新端口形状补。
- 验收/测试：两个文件用例通过（当前各 3 条）。
- 来源：review-global F1；移动端审查者同样发现

### CR-03 [P2] 桌面端列表页每次写操作都会替别的服务器再发起一轮连接
- 维度：C-orch、A（两端一致性）
- 文件：`apps/desktop/renderer/features/settings/McpServersView.tsx:45-58`
- 问题：「进列表发起一轮连接」写在共用的 `reload()` 里，而 `runWrite`（`:77`）与 `removeServer`（`:102`）每次写完都调 `reload()`。只要还有从未尝试或已断开的服务器，页面上任意一次开关、保存、测试、删除都会让它们再连一次。移动端用 `roundFired` 挡住了这类重复发起，桌面端没有。
- 改法：把「算 idle 并发起」那段从 `reload()` 拆成独立函数，只在挂载时跑一次（发起后的两次重读一并挪过去）；`runWrite` / `removeServer` 之后只重读列表与状态。
- 验收/测试：桌面 handler 测试里补一条——写操作触发的重读不增加 `connectUnconnected` 的调用计数。渲染层这段没有自动化测试，改完人工确认：列表页开关一台服务器，另一台「已断开」的服务器状态不应变化。
- 来源：review-global F3（round 1）

### CR-04 [P2] 桌面端 handler 测试锁不住「行清单走的是详情页读取面」
- 维度：G、A
- 文件：`apps/desktop/test/mcp-handlers-mock-runtime.ts`、`apps/desktop/test/mcp-handlers.test.ts`（T-D3）
- 问题：审查时 mock 的 `cachedTools` 忽略实参，把 `handlers/mcp.ts` 里传给它的参数删掉，两个用例照样通过。CR 之后读取面已拆成独立的 `serverTools(serverId)`，CR-05 提交里顺带改了 mock 与 T-D3 的断言，但桌面测试因为 Metro 在跑还没执行过。
- 改法：已改完，待验证——mock 记录 `serverTools` / `cachedTools` 各自的调用次数，T-D3 断言 `[1, 0]`。
- 验收/测试：停掉 Metro 后跑桌面测试；把 handler 里的 `serverTools` 换回 `cachedTools`，T-D3 应转红。
- 来源：桌面端 MF-1（round 1）

### CR-05 [P2] 移动端连接调用把编程错误静默吞掉
- 维度：B
- 文件：`apps/mobile/src/screens/stack/McpServerDetailScreen.tsx:437-438`、`apps/mobile/src/screens/stack/McpServersScreen.tsx:149`
- 问题：`mcp.connect(id).catch(() => undefined)` 会吞掉「服务器不在配置里」这类断言异常。业务失败本来就不走 reject（由状态行显示），所以这个 catch 实际只挡编程错误，且不留任何痕迹，用户看到的是「点了没反应」。
- 改法：catch 分支里打一条 warn 日志（用 `mcp-config.store.ts:28` 已有的日志器），界面行为不变。
- 验收/测试：单测里让 `connect` reject，断言日志被调用且 `testing` 状态复位。
- 来源：移动端 MF2（round 1）

### CR-06 [P2] `to-nm-tool.ts` 一段注释挂错了位置
- 维度：C
- 文件：`packages/core/src/domain/mcp/logic/to-nm-tool.ts:44`
- 问题：属于 `McpToolCallDeps` 接口（`:48`）的说明挂在了 `TOOL_RESULT_LINE_WIDTH` 常量头上。
- 改法：注释块移到接口声明之前。
- 验收/测试：纯注释移动；`node scripts/run-tests.mjs --dir test/mcp` 保持 158 条通过。
- 来源：core MF-1（round 1）

## Spec deviations（实现与 spec 不一致，待用户确认后回填 spec）
1. **端口多了一个详情页读取面 `serverTools(serverId)`**（spec §C 端口草图只有 `cachedTools()`）。三个审查者一致认为必要且正确；CR 之后按用户意见从「`cachedTools` 加布尔参数」改成独立方法（agent 用与界面用是两套逻辑，不复用接口）。已回填 spec「开发期变更」。
2. **测试矩阵缺两个编号**：T-C21b（详情页读取面不看开关与状态）、T-C32（重连握手期间预算到点按失败返回、状态已断开）已在代码里，spec 矩阵没登。已补登到「开发期变更」。
3. **桌面端「测试连接」仍是先静默保存再连接，一次动作连两次**（`McpServerDetailView.tsx:333-335`）。spec 只说「改调 connect(id)」，没说保留也没说删除。属既有行为。需你定：保留（回填 spec）还是改成只连一次。

## Open questions / 待拍板
- **`heldSession` 字段只写不读**：连接条目上的这个字段在三处被保留和采集，但重连判据实际读的是 `client.sessionId()`（`create-mcp-connection-manager.ts:374`）。与 spec §C「连接条目记录 heldSession」字面相符。我的建议是删掉这个字段、以 `client.sessionId()` 为准并回填 spec；它不影响行为，所以没列为必修，等你定。
- **两端「已断开」标签没有文案断言**：spec 测试矩阵没列，靠人工验收。补一条渲染断言成本很低，要不要补你定。

## 已豁免（用户确认不修）
无。

## 合并后 QA（manual_user）
- 列表页把一台服务器关掉再打开，另一台「已断开」的服务器不应被带动重连（CR-03 的界面确认）。
- 详情页工具卡：关掉一个工具后仍在列表里且能重新打开（`2361358b0` 已修，真机已确认）。
- 桌面端详情页 OAuth 授权成功后，状态行要重进页面或点「测试连接」才刷新（spec 明文接受）。

## K 节建议（下游执行时闭合）
- CR-01、CR-02 改完后，`apps/mobile/__tests__` 里再 grep 一次 `snapshotTools` 与 `mcp.connectUnconnected`，应为零。
- 改了 core 文件（CR-06）要先重建 core 产物再跑两端类型检查。
- 桌面端测试只能在 Metro 停掉后跑（`packaging.test.js` 会让 Metro 崩溃）。

## Fix-Spec Closure
| 项 | 状态 |
| --- | --- |
| fix-spec-ready | 待确认（按「无 P0 即收」的约定，第 1 轮后未再派终态认证） |
| fix_spec_path | `docs/Iterations/mcp-connect-model/cr-fix-spec.md` |
| dag_version / review_round | 1 / 1 |
| review-global 每轮参与 | yes |
| 末轮 review-final | 未派 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 2 / 4 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | 3 条待确认（均为有意或既有行为） |
| C-orch | 有发现（CR-01、CR-03） |
| C 类合并后 QA | 3 条，不阻塞 |
