---
date: 2026-09-06
---

# AI 搜索工具与工具输出防护（web-search-tool）技术规格（SPEC）

## 设计目标

需求来源：`docs/Iterations/web-search-tool/prd.md`（R1 四引擎搜索工具 / R2 手动配置 / R3 curl 50KB+落盘 / R4 search 同机制 / R5 read 简化 / R6 配套同步）。

用户拍板要点：引擎 bocha+tavily+brave+searxng（无智谱）；key 走 SKSP、引擎元数据走 KKV；超预算自动落**会话工作区** VFS `/tmp/`（非全局区、非宿主 fs）返回 `{savedPath, message}`；四工具输出预算统一 50KB（复用 `TOOL_OUTPUT_MAX_BYTES`）；read 截断简化为 50KB 单一硬帽、分页维持行号（不加字节偏移）；配置 UI 参考 agent 配置嵌套卡片 / 服务商表单思路。

## 总体方案

五个互相咬合的模块（全部落在既有架构缝隙里，零数据库 schema 变更）：

1. **引擎适配层（core，纯函数）**：统一接口 + 四引擎适配器，请求/响应映射照 `.reference/pi-web-access` 同名文件，但 HTTP 超时必须换成 curl-tool 的 `AbortController + setTimeout` 模式（RN/Hermes 兼容，不用 `AbortSignal.timeout/any`）、剥掉参考实现的 SSRF 层与凭证解析层。
2. **配置存储（core 纯逻辑 + 双端薄壳，修订轮）**：SKSP ref `search/{engineId}/apiKey` + KKV 模块 `nm-search`（`engineOrder`（JSON 数组，优先级即串行链）、`searxngBaseUrl`；`defaultEngine` 键移除——未发布无存量），形态照 cloud-sync 先例。
3. **search 工具（core）**：照 curl-tool 模板；配置经 `BuiltinToolContext.search?` 闭包注入（照 skills/agents 先例），key 在 run 内经 secretStore 现读不驻留。
4. **超预算落盘公共机制（core）**：`overflow-sink` helper 供 curl/search 共用——超 50KB 全文写会话 VFS `/tmp/`，工具输出回 `{savedPath, message}`；配套复用 vfs-tools 的 `file_cache` upsert 与目录规则补齐。
5. **双端配置 UI**：桌面设置 AI 组单一表单 View（每引擎一张嵌套卡片）；移动「我的 → 配置」新屏（FormSectionCard 复用）。IPC 走 desktop 三层链。

## 最终项目结构

```
packages/core/src/domain/tool/builtin/search/
  types.ts                  # SearchResponse/SearchResult/SearchToolOptions/EngineId
  search-config.ts          # ref/kkv-key 常量、校验、读写纯逻辑（入参 SecretStore+KkvService）
  engines/bocha.ts          # searchWithBocha(resolved, query, options, fetchFn)
  engines/tavily.ts
  engines/brave.ts
  engines/searxng.ts
  engines/dispatch.ts       # 引擎分发 + 未配置提示文案
  search-tool.ts            # Tool 本体（schema/run）
packages/core/src/domain/tool/builtin/overflow-sink.ts   # 落盘公共 helper
apps/mobile/src/services/search-config.store.ts          # 照 cloud-sync-config.store
apps/desktop/src/main/services/search-config.store.ts    # 照桌面 cloud-sync factory
apps/mobile/src/screens/stack/SearchEnginesScreen.tsx
apps/desktop/renderer/features/settings/SearchEnginesView.tsx
```

## 变更点清单

**packages/core**

| 文件 | 变更 |
|---|---|
| `domain/tool/builtin/search/*`（新） | 引擎适配 + 配置逻辑 + 工具本体 |
| `domain/tool/builtin/overflow-sink.ts`（新） | `sinkOversizedOutput(ctx: BuiltinToolContext, {tool, content, contentType})` → `{savedPath, message}`（直接收 ctx，与 `upsertFileCacheAfterWrite(ctx, path, content)`/`ensureDirRulesForNewPath(ctx, ...)` 签名咬合）；文件名 `/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}`，ext 按 content-type 映射（html/json/txt） |
| `domain/tool/builtin/vfs-tools.ts` | 导出 `upsertFileCacheAfterWrite`、`ensureDirRulesForNewPath`（现为模块私有） |
| `domain/tool/builtin/curl-tool.ts` | `CURL_MAX_BODY_BYTES` 引用改 `TOOL_OUTPUT_MAX_BYTES`（50KB）；超预算路径改走 overflow-sink；输出加 `savedPath?` 字段；description 同步 |
| `domain/tool/builtin/vfs-tools.ts`（read 部分） | 截断改 50KB 单一预算（见 R5 步骤） |
| `domain/tool/logic/tool-output-limits.ts` | 新增 `capUtf8BytesFill`（预算内尽量填满、末行允许截到预算点、返回 truncated 标记）；**不改动**既有函数（fs ls 等仍在用） |
| `domain/tool/builtin/builtin-tool-context.ts` | 加 `search?: BuiltinToolSearchContext`（`loadEngineConfig(engineId)`、`resolveActiveEngine(inputEngine?)`） |
| `domain/tool/builtin/register-builtin-tools.ts` | 注册 searchTool；头注释 10→11 |
| `service/agent/logic/run-agent-turn.ts` | `AgentTurnRuntimePort` 加 `searchConfig?: SearchConfigStore`（可选声明——旧测试 mock 零改动；装配见 Step 3：desktop/mobile runtime 各补一行、CLI 无 kkv 不装配，search 返回可读错误）；主/子两装配点（L505/L739）注入 `search` 闭包，vfs/workplace/sessionKkv 复用装配点既有实例（子代理天然落父工作区） |
| `domain/tool/logic/format-tool-output.ts` | `isSearchOutput`/`formatSearchOutput` + 分派链插在 `isCurlOutput` 前；curl formatter 加 savedPath 分支 |
| `domain/tool/logic/build-tool-result-block.ts` | `summarizeToolSuccess` 加 search 分支（`bocha · 5 条结果`）；curl 落盘 summary（`已落盘 /tmp/…`）；`CURL_MAX_BODY_BYTES` import 与 summary 尺寸档位判定（L196-198）同步换 `TOOL_OUTPUT_MAX_BYTES` |
| `config-forms/agent/agent-tool-catalog.ts` | search 条目（label「search」，中文描述）+ curl 条目 description 补落盘口径（超预算自动保存到 /tmp/） |
| `index.ts` | 导出 search 模块公共面（SearchConfigStore 工厂、类型） |

**apps/desktop**

| 文件 | 变更 |
|---|---|
| `src/main/runtime/create-desktop-runtime.ts` + `types.ts` | runtime 暴露 `searchConfig`（用 core 导出的工厂包 `kkv + secretStore`，与 mobile 同构） |
| `shared/ipc-types.ts` | `nm:search/getConfig`、`saveEngineKey`、`clearEngineKey`、`setSearxngBaseUrl`、`setEngineOrder`（修订轮：取代 setDefaultEngine；DTO 不含 key 明文，只有 `configured: boolean`；getConfig 返回 `engineOrder: EngineId[]`） |
| `src/main/ipc/handlers/search.ts`（新）+ `handler-registry.ts` | 绑定到 main runtime 的 search-config store |
| `renderer/ipc/invoke-registry.ts` / `client.ts` | 薄封装 |
| `renderer/features/settings/SearchEnginesView.tsx`（新，修订轮改两级） | **引擎列表页**：每行 = 引擎名（`ENGINE_IDS` 派生顺序）+ `ApiKeyStatusTag` + 行菜单（上移/下移，首/尾对应项禁用，照 ProvidersView 菜单形态）；点击行 push 详情；**`SearchEngineDetailView.tsx`（新）**：单引擎表单（key 引擎 = 密码框 + 留空不改 + 清除；searxng = baseUrl 表单，空串保存即清除；URL 校验含 userinfo 前置于提交前），无默认引擎控件 |
| `renderer/features/settings/settings-nav.ts` + `renderer/layout/SettingsOverlay.tsx` | AI 组加 `searchEngines`（列表）与 `searchEngineDetail`（详情，navState 携 engineId）两级 ViewId（照 providers/providerDetail 先例）；文案「搜索配置」 |
| `renderer/features/settings/AgentEditorView.tsx` L769-770、`AgentDefinitionEditorForm.tsx` L620-621 | hint 文案 10→11、名单加 search（后者为未挂载组件，照旧同步） |

**apps/mobile**

| 文件 | 变更 |
|---|---|
| `src/services/search-config.store.ts`（新） | 照 `cloud-sync-config.store.ts`（KKV `nm-search` + SKSP ref；对外只回 `configured: boolean`） |
| `src/runtime/create-mobile-runtime.ts` + `types.ts` | runtime 暴露 `searchConfig` |
| `src/screens/stack/SearchEnginesScreen.tsx`（新，修订轮改两级） | **列表屏**：每行 = 引擎名 + `ApiKeyStatusTag` + 行菜单按钮 → `BottomSheetMenu`（上移/下移，首/尾对应项禁用，照 ProvidersScreen 先例）；点击行导航详情；**`SearchEngineDetailScreen.tsx`（新）**：单引擎表单（key 引擎 = `FormTextInput` 密码框 + 留空不改 + 清除入口；searxng = baseUrl，空串保存即清除；校验前置），无默认引擎控件 |
| `src/navigation/types.ts` + `RootNavigator.tsx` + `header-config.ts` | `SearchEngines`（列表）与 `SearchEngineDetail`（详情，params 携 engineId）两个路由（withStackLayout）；标题「搜索配置」 |
| `src/screens/tabs/ProfileTabScreen.tsx` | CONFIG_MENU 加「搜索配置」 |
| `src/components/agent/agent-editor/AgentEditorToolsSection.tsx` L61-62 | hint 10→11 |

**测试锁同步（R6，共 8 处）**：`apps/mobile/__tests__/agent-editor-form-tool-count.test.tsx`（10→11 + 名单）、`apps/desktop/test/tool-policy-picker.test.tsx`（3 处 `/10`→`/11`，**隐藏雷勿漏**）、`apps/mobile/__tests__/tool-policy-picker.test.tsx` 全部 8 处 `/10` 断言（L137/141/177/199/206/232/258/269）→ `/11`（分母是 `BUILTIN_TOOL_CATALOG.length` 动态生成，组件零改动，**只改断言勿漏 6 处**）、`packages/core/test/config-forms/agent-tool-catalog.test.ts`、`packages/core/test/tool/skill-tool.test.ts` L130、`packages/core/test/tool/agent-tool.test.ts` L124（registry 计数 10→11）、`packages/core/test/tool/tool-schema-descriptions.test.ts` L26（registry.list().length===10）、`packages/core/test/tool/vfs-tools.test.ts` L45（同上）。

## 详细实现步骤

- Step 1 — phase-search-core — blocking: yes — qa: auto：`search/types.ts` 定义统一接口（`SearchResponse{answer?, results, engine}`、`SearchResult{title,url,snippet}`、`SearchToolOptions{maxResults?, recencyFilter?, domainFilter?}`、`EngineId`）；四引擎适配器按字段映射表实现（bocha：POST `api.bochaai.com/v1/web-search`、Bearer、`{query,count,freshness(oneDay/oneWeek/oneMonth/oneYear/noLimit),summary:true}`、响应 `data.webPages.value[]` 字段容错 url/link/href、summary/snippet/description/content、业务码 code≠200 抛错；tavily：POST `/search`、Bearer、`{query,search_depth:"basic",max_results,include_answer:"basic",time_range,include_domains/exclude_domains}`、原生 answer 透传；brave：GET `/res/v1/web/search`、`X-Subscription-Token`、`count`（有 domainFilter 时强制 20 + 客户端 `matchesDomainFilters` 兜底）、`freshness` pd/pw/pm/py、`q` 拼 `site:`/`NOT site:`、响应 `web.results[].description`；searxng：GET `{baseUrl}/search?q&format=json[&time_range]`、无 key、baseUrl 规范化（http/https、禁 userinfo、剥尾斜杠）、`q` 的 exclude 用 `-site:`、响应 `results[].content` + `answers[]`）。超时全部 `AbortController+setTimeout`（brave/searxng 30s、bocha/tavily 60s），错误统一 `` `${Engine} API error ${status}: ${body.slice(0,300)}` `` 范式（**绝不把 key 拼进消息**），`toolFailed("search", cause)` 包装。answer 策略：仅 tavily 透传原生，其余省略。默认条数统一 5、clamp 1..20。searxng 不传 language（实例配置决定）；duckduckgo（第三轮新增）：GET `https://html.duckduckgo.com/html/?q=...`、无 key、Accept: text/html、UA 自报轻客户端、30s 超时、正则解析 `.result` 块（跳过 `result--ad`）内 `result__a`（标题+uddg 重定向解码）与 `result__snippet`、HTML 实体解码、domainFilter 客户端过滤、忽略 recencyFilter、解析 0 可解析结果抛 invalid response（供串行链降级感知改版）、answer 省略（与其它非 tavily 引擎同口径）、maxResults clamp 共用。
- Step 2 — phase-search-core — blocking: yes — qa: auto：`search/search-config.ts`（修订轮）：`SEARCH_KKV_MODULE='nm-search'`、`searchApiKeyRef(engineId)` → `search/{engineId}/apiKey`、`readSearchConfig({secretStore, kkv})`（`kkv.get` engineOrder/searxngBaseUrl + `secretStore.has` ×3 → `SearchConfigPublic{engineOrder: EngineId[], searxngBaseUrl, engines: Record<EngineId,{configured:boolean}>}`；engineOrder 解析容错：非法/缺项时按 `ENGINE_IDS` 默认序补齐去重（默认序含 duckduckgo 固定队尾）；searxng 的 `configured` = `searxngBaseUrl` 非空；duckduckgo 恒 `configured = true`（内置兑底，无存储依赖））、`resolveEngineChain({secretStore, kkv, engineId?})`（返回按序排列的候选引擎数组，run 内现读 key 明文；显式 engineId 时从该引擎起截取）、`setEngineOrder(order)`（core 内校验为 ENGINE_IDS 的合法排列，非法抛错）、保存/清除函数（key 明文只经 SKSP set，不落 KKV/日志）。
- Step 3 — phase-search-core — blocking: yes — qa: auto：`BuiltinToolContext.search?` 闭包类型；`AgentTurnRuntimePort.searchConfig?`（可选声明——旧测试 mock 零改动；desktop/mobile runtime 各补一行装配，用 core 导出的工厂包 kkv+secretStore；CLI 无 kkv 不装配，search 返回可读的未装配错误（known limitation，注释照 preferences Pick 先例））；`run-agent-turn.ts` 两装配点注入闭包（engine 解析（修订轮）：`input.engine` 显式指定时从该引擎起取链（未配置→顺位回落；请求失败不静默换引擎，报错让模型自行决策）；未指定时按 `engineOrder` 顺序取第一个 configured；全无 → 返回未配置提示，非错误）。
- Step 4 — phase-search-core — blocking: yes — qa: auto（修订轮串行链）：`search-tool.ts`（zod schema：`query` 必填、`maxResults` 可选默认 5、`engine` 可选；run：闭包解析候选链 → **串行执行**：从链首（或显式指定引擎）起依次请求，失败（任何错误类型）→ 尝试链中下一个 configured 引擎，全链失败返回聚合错误（每引擎一行摘要，不泄漏 key）；**链总预算 120s**（每引擎自身超时照旧，总预算耗尽带已收集错误返回）；成功输出 `{engine, answer?, results, attempts?}`（attempts = 尝试轨迹如「bocha 失败(401) → tavily 成功」，首发成功时省略）；**显式 engine 且失败不降级**（钉死语义）；结果 JSON 序列化超 50KB 走 overflow-sink → 输出 `{engine, savedPath, message}`）；`register-builtin-tools.ts` 注册 + 注释；`format-tool-output.ts` `isSearchOutput`/`formatSearchOutput`（含 attempts 行展示）；`build-tool-result-block.ts` summary 分支；`agent-tool-catalog.ts` 条目；工具 description 补串行链口径（多引擎按配置顺序降级）。
- Step 5 — phase-overflow-sink — blocking: yes — qa: auto：`overflow-sink.ts` + `vfs-tools.ts` 导出两个配套函数；落盘写 `ctx.vfs.write(path, content)` 后执行 `upsertFileCacheAfterWrite` + `ensureDirRulesForNewPath`（失败不阻断，照 write 工具口径）。
- Step 6 — phase-overflow-sink — blocking: yes — qa: auto：curl 改造——预算常量换 `TOOL_OUTPUT_MAX_BYTES`；正文超预算时全文（截断前）落盘、`body` 置空串占位（zod schema 必填不变，避免破坏现有消费者；url/method/status 等 meta 字段保留）、输出加 `savedPath` 与 `message`、`truncated: true`、`originalBytes` 保留；`CURL_MAX_RESPONSE_BYTES`（10MB 预检）与非文本占位维持现状；curl formatter/summary/description/catalog 条目四处同步（PRD R6 口径：catalog curl 条目 description 补落盘口径；文案「超预算自动保存到会话工作区 /tmp/，可用 read 读取」）；search-tool 接线 overflow-sink。
- Step 7 — phase-read-simplify — blocking: yes — qa: auto：`tool-output-limits.ts` 新增 `capUtf8BytesFill`（末行截到预算点后该行不完整，nextOffset 跳过该行——尾部不可续读，truncated 提示注明）；`vfs-tools.ts` read 路径：移除 `truncateLine` 应用、`capUtf8Bytes` 换 `capUtf8BytesFill`、`sliceLinesFromOffset` 行号分页保留、truncated 提示语更新；grep/glob/fs ls 路径**不动**（仍用旧函数）。
- Step 8 — phase-desktop-ui — blocking: yes — qa: manual_user（修订轮两级）：IPC 五通道（setDefaultEngine 换 setEngineOrder）+ handler + invoke 封装 + `SearchEnginesView`（列表：行菜单上移/下移）+ `SearchEngineDetailView`（单引擎表单）+ settings-nav 两级导航 + 双处 hint 文案；入口文案「搜索配置」；表单校验仅非空/URL 形状含 userinfo（无连通性测试，PRD 口径）。
- Step 9 — phase-mobile-ui — blocking: yes — qa: manual_user（修订轮两级）：`search-config.store`（补 setEngineOrder 封装）+ runtime 装配 + `SearchEnginesScreen`（列表 + BottomSheetMenu 上移/下移）+ `SearchEngineDetailScreen`（单引擎表单）+ 导航两级 + CONFIG_MENU「搜索配置」+ hint 文案；mobile 测试跑法 `NODE_ENV=test npx jest`（约束 #22）、类型检查用官方 `typecheck` 脚本（约束 #38）。
- Step 10 — phase-tests-sync — blocking: yes — qa: auto：R6 八个测试锁同步（清单见上）；core 新增单测（见测试策略）；curl-tool 既有截断用例（L176-218）按新行为更新。
- Step 11 — phase-build-verify — blocking: yes — qa: auto：`npm run build -w @novel-master/core` 重建 dist（mobile 经 metro 消费 dist，规则 #10）；桌面 typecheck；CHANGELOG Unreleased 补两条（search 工具新增；curl 输出预算 256KB→50KB + 超预算自动落盘，按 skill `novel-master-changelog` 分类）。开发在 `.worktree/web-search-tool` worktree 进行（规则 #23，独立 npm install + 重建 core/tdbc/tokenizer-driver dist），完成后并入 dev 分支（规则 #37），只 add 显式路径。

## 测试策略

### 测试用例

- T-A1..T-A4 — blocking: yes — 四引擎适配器单测（mock fetchFn）：断言端点/认证头/请求字段映射（tavily 的 time_range、brave 的 freshness pd、bocha 的 freshness oneDay、searxng 的 format=json）、响应字段抽取（bocha 的 link/href 容错、brave 的 web.results）、非 200 抛错文案含 status。
- T-A5 — blocking: yes — maxResults clamp（0→5、99→20）与 brave domainFilter 时 count 强制 20 + 客户端过滤兜底。
- T-A6 — blocking: yes —（第三轮新增）duckduckgo 适配器：mock HTML 响应断言请求（GET+q+UA）、解析（标题/uddg 解码/snippet/实体解码/广告块跳过）、domainFilter 客户端过滤、0 可解析结果抛 invalid、恒 configured、链尾兑底（无任何 key/baseUrl 时链=[duckduckgo] 且请求真实发出——T-S1 语义随之更新）。
- T-C1 — blocking: yes — search-config 读写（SKSP/KKV mock）：保存后 `readSearchConfig` 的 configured 状态、清除后回落、searxng 仅配 baseUrl 即 configured=true、engineOrder 存取与非法容错（缺项补齐/重复去重）、明文不出现在任何返回值。
- T-C2 — blocking: yes — key 无效（401）时错误信息不含 key 明文。
- T-S1 — blocking: yes — 未配置任何引擎：run 返回含配置入口指引的提示，不抛错。
- T-S2 — blocking: yes — 引擎解析链（修订轮：input.engine 钉死起步 > engineOrder 顺序第一个 configured）；含 searxng-only 用例：仅配 baseUrl（无任何 key）也能被解析链命中。
- T-S3 — blocking: yes —（修订轮新增）串行请求链：①链首 401 → 降级到下一 configured 引擎成功，输出含 attempts 轨迹；②全链失败返回聚合错误（每引擎一行摘要，无 key 明文）；③显式 engine 且失败 → 直接报错不降级；④多引擎挂起 → 120s 总预算耗尽带已收集错误返回（mock timers）。
- T-O1 — blocking: yes — curl 30KB 响应照常返回正文（savedPath 为空）。
- T-O2 — blocking: yes — curl >50KB：输出含 savedPath/message/truncated/originalBytes（body 为空串占位，url/method/status 等 meta 字段保留），`/tmp/` 下存在全文，后续 read 该文件可读出内容；并含子代理装配断言（runChildAgent 的 toolCtx.vfs 指向父会话 VFS——复用现有断言或新增），锁「子代理落盘落父会话工作区」。
- T-O3 — blocking: yes — search 结果序列化 >50KB 走同一 sink（构造超长 snippet 的 mock 响应）。
- T-O4 — blocking: yes — 10MB 预检与非文本路径行为不变（沿用既有用例口径）。
- T-R1 — blocking: yes — read 单行 300KB 文件：返回预算内前缀（不再是 2000 字符），truncated 标记正确；多行正常文件（<50KB）输出与旧行为一致（快照对照）。
- T-T1 — blocking: yes — catalog 计数 11、三处 hint 文案含 search、八个测试锁全绿。
- T-D1 / T-M1 — blocking: no — qa: manual_user（修订轮）：桌面/移动搜索配置：列表页排序菜单（上移/下移、首尾禁用）、详情页填 key/baseUrl 保存后状态刷新、searxng baseUrl 校验、清除 key；走查项含「落盘文件在双端文件树可见」；合并后用户双端走查（mobile 无 webview 改动，metro reload 即生效）。

## 风险与回滚方案

- **行为变更面**：curl 预算收紧 + read 截断简化都是已发布行为的变更（CHANGELOG 记档）；回滚即 revert 对应 commit，无数据迁移（落盘文件是普通 VFS 文件，无清理义务——随会话生命周期）。
- **引擎适配质量**：字段映射来自参考实现行级核对，但真实 API 可能漂移——T-D1/T-M1 用户走查覆盖；单引擎故障只影响该引擎（未配置/报错提示可读）。
- **用户中断不取消搜索**：`BuiltinToolContext` 无 signal 透传（现状架构如此），搜索请求仅受超时 abort——写入本节作为 known limitation，不本期解决。
- **落盘失败降级路径（实现补全 spec 未覆盖面）**：`vfs.write` 失败时 curl 降级回字节截断（正文最大可到 10MB，必须守住预算）、search 降级回完整输出（maxResults≤20 天然封顶）；两分支不对称是有意设计，代码注释已留痕。read 末行截断不给 nextOffset（被截行是文件末行时无内容可续，防 offset 超界）属跳过语义的自然边界。
- **`AgentDefinitionEditorForm.tsx` 为未挂载组件**：照旧同步文案（一行成本）；若未来删除不牵连本迭代。
- **KkvService 获取方式**：mobile/desktop 的 store 照 cloud-sync-config.store 同构获取；若实现时发现 runtime 未暴露所需入口，在装配点注入处补薄工厂（不动公共端口）。
- **CLI known limitation**：CLI 端无 kkv，`searchConfig` 不装配，search 工具返回可读的未装配错误（不崩溃，模型可感知不可用）；后续迭代 CLI 接入 kkv 后补一行装配即可启用。（CR 轮拍板：按现状收窄——实现为可读错误而非未配置提示，与双端主入口行为不影响。）
- **worktree 注意**：core 测试需先重建 core/tdbc/tokenizer-driver 三包 dist（规则 #23/#31）；mobile webview 无改动，不需要 `npm run android` 全量重装。
