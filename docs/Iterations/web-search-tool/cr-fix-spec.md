# CR Fix Spec: web-search-tool

## 元信息

- repo：novel-master worktree（`/home/bloodycrown/Dev/novel-master/.worktree/web-search-tool`）
- base_sha：`85f67d6c`
- head_sha：`0439d95c`
- prd_path：`docs/Iterations/web-search-tool/prd.md`
- spec_path：`docs/Iterations/web-search-tool/spec.md`
- review_round：1
- dag_version：2
- 状态：fix-spec-ready

---

## Must-fix（按 P0 → P1 → P2）

> 本轮无 P0。P1 共 2 条（ui/B-1、ui/C-1），P2 共 8 条（core/B-1、core/B-2、ui/B-2、ui/B-3、ui/C-2、core/G-1、core/G-2、core/G-3）。

### ui/B-1 [P1] desktop clearKey↔保存互斥只修一半，反向竞态未设防

- 维度：B（正确性）+ UI
- 文件：
  - `apps/desktop/renderer/features/settings/SearchEnginesView.tsx`（`clearKey` / `save` 函数、清除按钮渲染处）
- 问题：
  - `clearKey` 入口有 `if (saving) return` 守卫，但 `save()` 没有对称的 `clearing` 守卫——`clearKey` 的 IPC 在途时点保存，两条序列交错；同一引擎「清除 vs 保存」并存时落库结果不确定。
  - mobile 端是完整双向互斥（`saving || clearingEngine != null` + 按钮 `disabled` + 在途文案），desktop 是 93f534ea 修的半成品，双端行为分叉。
- 改法：
  1. 照 mobile 口径补 `clearing` 状态（类型 `KeyEngineId | null`，标记「哪个引擎的清除 IPC 在途」）。
  2. `save()` 入口加 `if (clearing) return`。
  3. 清除按钮 `disabled={saving || clearing != null}`，并补在途文案（与 mobile 一致）。
  4. `clearKey` 起止处置位/复位 `clearing`（finally 复位防异常残留）。
- 验收/测试：
  - 清除在途时，保存按钮不可点且 `save()` 调用无效（early return）。
  - 双端互斥行为一致（mobile 口径为基准）。
- 来源：review-scope-ui round1

### ui/C-1 [P1] 引擎清单跨端 ≥3 处手工副本，core 单一真源未导出

- 维度：C（DRY）+ C-orch
- 文件：
  - `packages/core/src/index.ts`（公共导出面）
  - `apps/mobile/src/services/search-config.store.ts`（L23-34，`SEARCH_KEY_ENGINE_IDS` 副本）
  - `apps/desktop/renderer/features/settings/SearchEnginesView.tsx`（L35-38，本地 `type KeyEngineId` + `KEY_ENGINES` 数组）
- 问题：
  - core 的 `ENGINE_IDS` / `KEY_ENGINE_IDS`（定义于 `packages/core/src/domain/tool/builtin/search/types.ts` L22/L28）未从公共面导出。
  - mobile 的 `SEARCH_KEY_ENGINE_IDS` 是手工副本、自认同步义务；desktop 本地重定义 `type KeyEngineId`（core 其实已导出该类型）和 `KEY_ENGINES` 数组；双端 `ENGINE_LABELS` / `ENGINE_CARDS` 的键序还有多处手工同步点。
  - 正是记忆 #40 所述「多处口径失步」的温床：新增引擎时漏改任一副本会静默缺引擎，且无测试拦截。
  - 双端 renderer 已直接依赖 core，无打包约束，收敛无技术障碍。
- 改法：
  1. `packages/core/src/index.ts` 导出 `ENGINE_IDS`、`KEY_ENGINE_IDS` 常量（**改后须重建 core dist**，见 K 节）。
  2. mobile `search-config.store.ts` 删本地 `SEARCH_KEY_ENGINE_IDS` 副本，改用 core 导出。
  3. desktop `SearchEnginesView.tsx` 删本地 `type KeyEngineId` 与 `KEY_ENGINES` 数组，改 import core；卡片顺序由 `ENGINE_IDS` 派生（`ENGINE_CARDS` 改 `Record<EngineId, …>`，按 `ENGINE_IDS` 顺序遍历渲染）。
- 验收/测试：
  - 双端 typecheck 绿（mobile 须用官方 `typecheck` 脚本，见记忆 #38——`tsconfig.build.json` 排除 `__tests__`，裸跑 `tsc --noEmit` 会误报）。
  - UI 渲染顺序不变（改前改后双端配置页引擎列表逐项对照）。
  - `grep` 全仓无第二个硬编码 `['bocha','tavily','brave']` 字面量（唯一真源留在 core types.ts）。
- 来源：review-scope-ui round1

### core/B-1 [P2] bocha 业务码错误消息未过脱敏

- 维度：B（正确性）+ D（密钥安全）
- 文件：
  - `packages/core/src/domain/tool/builtin/search/engines/bocha.ts`（L139-145，`code ≠ 200` 业务码分支）
- 问题：
  - HTTP 非 2xx 分支经 `engineApiErrorMessage` 已有 `redactSecret`，但 `code ≠ 200` 分支直接拼 `envelope.msg` / `envelope.message`，未脱敏——若业务错误响应回显凭证，key 明文会进错误链。T-C2 的脱敏口径在该分支失守。
- 改法：
  - 将 `apiKey` 传入 `parseBochaResults`，`firstString(envelope.msg, envelope.message)` 的结果先 `redactSecret(msg, apiKey)` 再拼接进错误消息；或该分支整体改走 `engineApiErrorMessage` 范式（统一脱敏路径）。
- 验收/测试：
  - 新增用例：mock 业务码错误响应、其 `msg` 含 apiKey 明文时，断言最终错误消息里明文已被替换。
- 来源：review-scope-core round1

### core/B-2 [P2] sliceUtf8BytePrefix 块边界代理对缺陷

- 维度：B（正确性/边界）
- 文件：
  - `packages/core/src/domain/tool/logic/tool-output-limits.ts`（约 L100-135，`sliceUtf8BytePrefix` 块式切块逻辑）
- 问题：
  - 块式切块以 UTF-16 code unit 步进 8192，块尾恰好切在代理对（surrogate pair）中间时：孤儿 surrogate 编码为 U+FFFD 占 3 字节（虚高 `chunkBytes`，比真实值多 2 字节），且返回值可能含孤立代理——JSON 序列化会损坏。
  - 触发条件苛刻（emoji 恰跨 8192 边界 + 预算恰在该块耗尽）但缺陷可证明存在。
- 改法：
  - 切块时检测块尾 code unit 是否为 high surrogate（`0xD800-0xDBFF`）且后面还有字符，是则块边界右移 1（把代理对留在同一块内）。
  - 块起点用变量传递（而非固定步进推算），保证块边界右移后不重叠、不遗漏。
- 验收/测试：
  - 单测构造 `'a'.repeat(8191) + emoji + …` 且预算恰在 8192 附近的行，断言返回值无孤立代理、且字节数 ≤ 预算。
- 来源：review-scope-core round1

### ui/B-2 [P2] desktop save() 的 URL 校验在 key 已持久化之后，早退不回读

- 维度：B（正确性）+ UI
- 文件：
  - `apps/desktop/renderer/features/settings/SearchEnginesView.tsx`（`save()` 第 2 步，约 L122-127）
- 问题：
  - `save()` 先循环提交非空 key（IPC 已生效、key 已落库）之后才校验 baseUrl 形状；校验失败 `setError` 后直接 `return`，不 `reload()`——已生效的 key 变更在界面上无反映（`configured` 标签陈旧），与同函数内「IPC 失败路径必回读」的口径自相矛盾。
  - 另外 desktop 的 `isValidHttpUrl` 只查协议、不查 userinfo，与 mobile 版本（含 `!url.username && !url.password`）不一致——`http://u:p@host` 双端判定分叉。
- 改法：
  - 对齐 mobile 顺序：baseUrl 形状校验（含 userinfo 规则）**前置到任何 IPC 变更之前**，非法即 `setError` 早退、零副作用；key 提交（diff 逻辑）保留在校验之后不变。
- 验收/测试：
  - 填非法 URL + 非空新 key 点保存 → 无任何 IPC 写发生（key 未提交）。
  - 填 `http://u:p@host` 双端都被拦截（desktop `isValidHttpUrl` 补 userinfo 规则后与 mobile 一致）。
- 来源：review-scope-ui round1

### ui/B-3 [P2] mobile handleSave 失败路径不回读

- 维度：B（正确性）+ UI
- 文件：
  - `apps/mobile/src/screens/stack/SearchEnginesScreen.tsx`（`handleSave` catch 块，约 L139-143）
- 问题：
  - desktop 已在 93f534ea 修好「保存中途失败也回读」，mobile 的 catch 只 `toast` 不 `load()`——部分提交已生效（如 `saveEngineKey` 成功、`setSearxngBaseUrl` 失败）时，`ApiKeyStatusTag` 显示旧状态，直到用户手动重进页面。
- 改法：
  - catch 内 toast 之后补 `await load()`（`load` 自带 try/catch，不会二次抛出）。
- 验收/测试：
  - mock `setSearxngBaseUrl` 抛错而 `saveEngineKey` 成功时，保存失败后状态标签立即反映已生效的 `configured`。
- 来源：review-scope-ui round1

### ui/C-2 [P2] SegmentedControl 禁用态无样式，补挂项视觉不可辨

- 维度：C（质量/一致性）+ UI
- 文件：
  - `apps/desktop/renderer/components/ui/SegmentedControl.tsx`（L27-29，`is-disabled` class 挂载处）
  - `apps/desktop/renderer/styles/shell.css`（`.segmented-control__btn` 规则区，约 L864-876）
- 问题：
  - 组件已加 `is-disabled` class + 原生 `disabled` 属性，但 shell.css 没有对应规则、也没有 `button:disabled` 兜底——禁用项渲染与正常项视觉完全一致（选中态还会叠 `is-active`），点按无响应、用户无从感知。
- 改法：
  - shell.css 补 `.segmented-control__btn:disabled`（或 `.is-disabled`）规则：降低不透明度、`cursor: not-allowed`、屏蔽 hover 效果。
  - 确认与 `is-active` 叠加时仍可辨识「当前值但已失效」状态（如灰态上保留选中底色）。
- 验收/测试：
  - 默认引擎指向已清 key 引擎时，该段呈灰态不可点、其余段正常可点。
- 来源：review-scope-ui round1

### core/G-1 [P2] 引擎超时 aborted 分支无测试

- 维度：G（测试缺口）
- 文件：
  - `packages/core/test/tool/search-engines.test.ts`
- 问题：
  - spec Step 1 规定超时用 AbortController + setTimeout + 可读文案；`engineTimeoutError` 的 aborted 分支（产出如「Bocha search timed out after 60000ms」）无任何测试覆盖（curl 侧已有 T-CT4/T-CT17 对偶用例，search 侧缺失）。
- 改法：
  - 补适配器超时用例：mock `fetchFn` 挂起或抛 AbortError（模拟 `controller.signal.aborted = true`），断言错误文案含 `timed out after`。
- 验收/测试：
  - 至少一个引擎覆盖（三个引擎共用超时 helper，单点覆盖即可接受）。
- 来源：review-scope-core round1

### core/G-2 [P2] search 落盘失败降级无测试

- 维度：G（测试缺口）
- 文件：
  - `packages/core/test/tool/search-tool.test.ts`
- 问题：
  - `sinkOversizedOutput` 抛错 → `console.debug` → 回落完整 response 是 spec 风险节明示的分支，但无测试锁定（curl 侧有 T-CT3 降级用例对偶，search 侧缺失）。
- 改法：
  - 补用例：构造超 50KB 的搜索结果 + `vfs.write` 抛错的 mock ctx，断言工具输出为完整 SearchResponse（含 20 条 results、无 `savedPath` 字段）。
- 验收/测试：
  - 降级路径行为被测试锁定。
- 来源：review-scope-core round1

### core/G-3 [P2] 落盘主链路缺真实 VFS 集成测试

- 维度：G（测试缺口/集成）
- 文件：
  - `packages/core/test/tool/vfs-tools.test.ts`
- 问题：
  - T-O2/T-O3 全部基于内存 mock VFS，真实链路上的 `ensureParentDirectories`（`/tmp` 首次建目录）、`upsertFileCacheAfterWrite`、`ensureDirRulesForNewPath` 均无集成覆盖。
- 改法：
  - 在 `vfs-tools.test.ts` 的 integration 环境（`novelMasterTestFixture` 真实 VFS）补用例：写超 50KB 文件后经 curl 工具落盘，断言 `/tmp/` 下文件存在、read 工具读回全文一致。
- 验收/测试：
  - 落盘主链路有真实 VFS 的 e2e 覆盖。
- 来源：review-scope-core round1

---

## Spec deviations

- none（本轮评审未报告 open spec deviations）。

## Open questions / 待拍板（不阻塞 fix-spec-ready）

1. `rand4` 同日碰撞（1/65536 概率覆盖旧文件）是否加碰撞检测。
2. brave `hasDomainFilter` 全非法条目时仍强制 `count=20`（只多取几条、无功能损害，两可，暂不认定）。
3. 存量 `truncateToByteBudget` / `utf8ByteLength` 的同款代理对模式（非本 diff 引入）是否顺手统一修。
4. `resolveEngine` 竞态兜底（`has` 检查后 key 被并发清除）是否补测。
5. desktop `reload()` 成功路径是否顺手清 `error`。
6. desktop diff 提交 vs mobile 无条件幂等提交，是否统一为一种口径。
7. 双端配置页自动化渲染测试（当前 manual_user 定档）是否后续补。

## 已豁免（用户确认不修）
- CLI 未装配行为 spec deviation：用户拍板按方案 a 收窄（「CLI 怎么都行，按你建议来」）——spec 已修订为「返回可读错误」，视同 fixed，不新增 must-fix

- 暂无。

## 合并后 QA（manual_user，不阻塞）

- T-D1：desktop 配置页走查（引擎列表、key 配置/清除互斥、默认引擎段禁用态、错误回显）。
- T-M1：mobile 配置页走查（同上口径）。
- 落盘文件在双端文件树可见（超 50KB 搜索结果落 `/tmp/` 后，desktop 与 mobile 的 VFS 文件树均能看到该文件）。

## K 节建议（下游执行时闭合）

- 无额外收尾项：lint/format 已在各 impl commit 内闭合。
- ⚠️ 执行 ui/C-1 时会变更 core 公共导出面（`ENGINE_IDS` / `KEY_ENGINE_IDS`），**须重建 core dist**（`npm run build -w @novel-master/core`）——mobile 经 metro 消费 core 的 dist，不重建则 mobile 侧改动无法生效。


## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/web-search-tool/cr-fix-spec.md |
| dag_version / review_round | 2 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 2 / 8 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none（CLI deviation 已按方案 a 收窄，用户确认） |
| C-orch | ✅（双端 DRY 收敛已入 ui/C-1） |
| C 类合并后 QA | T-D1/T-M1 双端走查 + 落盘文件可见 |
