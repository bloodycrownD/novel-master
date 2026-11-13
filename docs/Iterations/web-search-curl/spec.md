---
date: 2026-11-12
---

# 搜索 curl 化改造技术规格（SPEC）

## 设计目标

需求来源：`docs/Iterations/web-search-curl/prd.md`（R1-R6）。用户拍板要点：**全收编**——bocha/tavily/brave/searxng 四适配器退役为出厂模板数据，DeepSeek/智谱新增两份出厂模板（共六份），DDG 保留唯一代码适配器兜底；工具参数面 `query/engine/maxResults/params`（params 自由 JSON 透传）；引擎开关默认仅 DDG 启用；per-engine 参数说明经装配期快照拼进工具描述；存量 key/顺序/baseUrl 不迁移不读取不主动清除。

**与 PRD 的口径微调**（探索后修订，理由附）：

1. 测试搜索「先保存再测」→ **「草稿直测」**：双端统一、填完即测、坏配置不先落库（mobile 云同步 `CloudSyncConfigScreen` 同款先例）。PRD R2 措辞随本 spec 修订。
2. 占位符 3 → 4 个：新增 `{{baseUrl}}`——searxng 无 key 但需用户自填实例地址，模板 URL 必须能引用。
3. 五处适配器精细行为随收编丢弃：brave「域名过滤时 count 强制 20」、bocha「客户端域名过滤兜底」（域名过滤统一走 params 后无从触发）、tavily「snippet 折叠空白」与「title 缺省回填 `Source N`」（纯展示优化，统一为 title 缺省回填 url）、bocha「envelope msg→message 双候选回退」（msgPath 单路径，取空落通用错误文案）。收编保住的真行为是**候选字段容错**与**信封业务码校验**。
4. curl 导入时序：`parseCurlCommand` 是**纯解析**（识别出的密钥值替换为 `{{apiKey}}` 占位符并随表单草稿携带），密钥真正落 SKSP 发生在**保存时**——PRD 验收「点导入 → 已替换并存入 SKSP」的时序按此修订。
5. URL 内占位符编码：仅 `{{query}}` 做 encodeURIComponent（PRD 原文「URL 内做百分号编码」按此收窄）；`{{apiKey}}`/`{{baseUrl}}` 原样替换——apiKey 落在 URL query 时遇 `&`/`=` 可能打坏参数，属已知让渡（六份出厂模板的 apiKey 全部走 header，自定义模板同形态推荐，配置页表单提示走 header）。
6. paramHint 超长处置：保存时**拒绝**（PRD R5 原文「建议 ≤500，超长截断」按此收紧为硬校验）+ 装配期防御性截断双道——拒绝优于静默截断（截断会吃掉 paramHint 尾部的引擎方言说明）（**v3 作废，拍板 A2**：paramHint **不限长**——保存仅 trim 与明文密钥检测、装配期不截断，本条双道口径整体作废，见 spec-v2 §9）。

## 总体方案

### 1. 引擎模型

引擎实例分三类，对上层（串行链/UI/描述快照）统一为 `id: string`：

| 类别 | id 形态 | 模板来源 | 配置存储 |
|---|---|---|---|
| 内置代码 | `duckduckgo` | 无模板（HTML 解析适配器保留） | 无（恒存在） |
| 出厂预置 | `bocha`/`tavily`/`brave`/`searxng`/`deepseek`/`zhipu` | core 常量 `PRESET_ENGINE_TEMPLATES` | 覆盖副本落 KKV `presetOverrides`（可恢复默认） |
| 自定义实例 | `custom:{nanoid8}` | 用户编辑，存 KKV `customEngines` | 同左 |

`EngineId` 联合类型退役为 `string`（`KeyEngineId` 类型别名随常量一并删除），`ENGINE_IDS`/`KEY_ENGINE_IDS` 常量删除；旧枚举渗透点（search-tool input/outputSchema 的 `z.enum`：inputSchema 一处 + outputSchema 两处、`SearchToolInput.engine` 的 `typeof ENGINE_IDS)[number]` 派生类型、dispatch switch、UI `Record<EngineId,…>` 索引、`BuiltinToolSearchContext.resolveEngineChain` 形参、core-shim 白名单）逐一放宽。

**已知 id 全集**（动态）：`六预置 id ∪ {duckduckgo} ∪ customEngines 现存 id`。engineOrderV2 的容错归一、`setEngineOrder` 校验、显式 engine 的已知性判定、dispatch 的模板查找，全部以该动态全集为准。

### 2. 模板数据结构（core `search/types.ts` 新增）

```ts
interface SearchEngineTemplate {
  name: string;                      // 显示名（"博查搜索" 等）
  method: "GET" | "POST";
  url: string;                       // 可含 {{query}}/{{count}}/{{apiKey}}/{{baseUrl}}
  headers: Readonly<Record<string, string>>;   // 值可内插占位符（"Bearer {{apiKey}}"）
  bodyTemplate?: string;             // POST 时的 JSON 文本模板（合法 JSON，占位符在字符串值内）
  resultPath: string;                // 点路径定位结果数组（"" = 根节点即数组；如 "data.webPages.value"）
  fieldMap: {                        // 候选字段名列表：按序取第一个非空字符串
    title: readonly string[];
    url: readonly string[];
    snippet: readonly string[];
  };
  answerPath?: string;               // 顶层点路径，取到非空字符串则透传 answer
  envelope?: {                       // 可选业务信封校验（bocha 形态）
    codePath: string;                // 点路径（如 "code"）
    okValues?: readonly (string | number)[];  // 缺省 [200, "200"]
    msgPath?: string;                // 错误消息点路径（脱敏后入错误文案）
  };
  paramHint: string;                 // 参数说明（≤500 字符，拼进工具描述）（**v3**：不限长，无 500 上限）
}

interface CustomEngineDef {
  id: string;                        // custom:{nanoid8}
  name: string;
  template: SearchEngineTemplate;
  createdAt: string;                 // ISO 8601
}
```

**模板校验契约**（`validateSearchEngineTemplate(template): Result<SearchEngineTemplate, AppError>`，保存路径统一走它；错误码 `TOOL_SEARCH_TEMPLATE_INVALID` + i18n key `error.tool.search_template_invalid`）：

- method ∈ {GET, POST}；url 为非空 http(s) URL；resultPath 为合法点路径（空串=根）；fieldMap 三键各至少一个候选。**占位符感知校验**：url 校验前先把 `{{baseUrl}}` 替换为 `https://example.invalid`、`{{query}}`/`{{count}}`/`{{apiKey}}` 替换为合法示例值再 `new URL()` parse（searxng 形态 `{{baseUrl}}/search?...` 必须能通过校验）（**v3**：该校验机制保留，但六份出厂模板 URL 已不含任何占位符——`{{baseUrl}}` 分支仅自定义模板可触发）。
- **点路径语法**（resultPath/answerPath/envelope.codePath/msgPath 共用同一解析实现，全仓唯一）：`^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$`，不支持数组索引。
- POST 必有 bodyTemplate 且为合法 JSON 对象文本；模板内占位符只允许 `{{query}}/{{count}}/{{apiKey}}/{{baseUrl}}` 四个（未知占位符拒绝）。
- paramHint ≤500 字符（保存时拒绝超长；装配期快照再做防御性截断，双道）（**v3 作废，拍板 A2**：不限长——保存仅 trim 与明文密钥检测，双道口径作废）。
- url/headers/bodyTemplate 不含明文密钥特征（见 §5 密钥检测）。

**占位符替换语义**（模板执行器核心，全仓唯一实现）：

- URL：`{{query}}` → encodeURIComponent；`{{apiKey}}`/`{{baseUrl}}` → 原样替换；`{{count}}` → 归一后数字字符串；占位符缺值（如模板引用 `{{baseUrl}}` 但无值可解析）→ 执行器抛 invalid（防御，正常被链过滤提前拦下）。
- headers 值：字符串内插原样替换（apiKey 不编码）。
- body：**结构化遍历替换**——先 `JSON.parse(bodyTemplate)`，遍历所有字符串值：整值 === `"{{count}}"` 时替换为 number（保持 integer 字段类型；非整值的 `{{count}}` 校验拒绝）；否则字符串内插 `{{query}}`/`{{apiKey}}`/`{{baseUrl}}` 替换。**不做文本级替换**（query 含引号/反斜杠天然安全）。
- GET 的 query 参数：标准参数已在模板 URL 内；params 合并时追加/覆盖同名 query 参数。
- params 合并：POST → `Object.assign(standardBody, params)`（同名以 params 为准）；GET → URLSearchParams 合并；DDG 忽略 params。

### 3. 出厂模板六份（`search/preset-templates.ts` 常量，请求形状由测试锁快照锁定）

| id | method/URL | 鉴权 | body 模板 | resultPath / fieldMap | 特殊 |
|---|---|---|---|---|---|
| bocha | POST `https://api.bochaai.com/v1/web-search` | `Authorization: Bearer {{apiKey}}` | `{"query":"{{query}}","count":"{{count}}","summary":true}` | `data.webPages.value`；title:[title,name] url:[url,link,href] snippet:[summary,snippet,description,content] | envelope code/msg；freshness 不再默认携带（原 noLimit 缺省省略，params 可传，支持日期区间） |
| tavily | POST `https://api.tavily.com/search` | Bearer | `{"query":"{{query}}","search_depth":"basic","max_results":"{{count}}","include_answer":"basic","include_raw_content":false}` | `results`；title:[title] url:[url] snippet:[content] | answerPath `answer` |
| brave | GET `https://api.search.brave.com/res/v1/web/search`（**v3**：URL 已去 `?q={{query}}&count={{count}}` 尾参，搜索词/条数全走 params） | `X-Subscription-Token: {{apiKey}}` + Accept | — | `web.results`；title:[title] url:[url] snippet:[description] | |
| searxng | GET `https://searx.example.com/search?format=json`（**v3**：出厂示例完整端点，不再用 `{{baseUrl}}` 占位、不含 `q=`，搜索词走 params 的 q） | 无（Accept: application/json） | — | `results`；title:[title] url:[url] snippet:[content] | **v3**：「未配置实例」判据改 URL 等于出厂示例值（isUnconfiguredSearxng，驱动 needsBaseUrl 与 canRun 特判）；URL 不含 count（searxng 无此参数）；不传 language（保留自托管实例偏好语义，参数说明提示可经 params 传） |
| deepseek | POST `https://api.deepseek.com/v1/tools/search` | Bearer | `{"query":"{{query}}","count":"{{count}}"}` | `results`；title:[title] url:[url] snippet:[snippet] | 参数说明收录 query 语法（site:/-site:/"/lang:/after:/before:）与 need_content/ori_question/localization |
| zhipu | POST `https://open.bigmodel.cn/api/paas/v4/web_search` | Bearer | `{"search_query":"{{query}}","search_engine":"search_std","search_intent":false,"count":"{{count}}"}` | `search_result`；title:[title] url:[link] snippet:[content] | search_engine 固化 search_std（params 可覆盖换 pro 系）；参数说明收录 search_engine/search_intent/content_size/search_domain_filter/search_recency_filter/request_id |

**「需 key / 需 baseUrl」判定规则**（配置完整过滤与 UI 状态共用）：模板的 url/headers/bodyTemplate 文本中含 `{{apiKey}}` → 需 key（SKSP 有值）；含 `{{baseUrl}}` → 需 baseUrl（`engineBaseUrls[id]` 非空）。预置与自定义同一判据（**v3**：出厂模板零 `{{baseUrl}}` 引用——searxng 的「未配置」改由 isUnconfiguredSearxng（URL=出厂示例值）判定，`engineBaseUrls` 仅剩自定义模板可达）。

各模板 paramHint 另含引擎通用提示（params 透传语义）；文案全文随 Step 1 常量落定，长度 ≤500 字符（**v3**：不限长——出厂 paramHint 实际为带字段示例的多行说明，如 brave 的 `{"q":"低代码平台","count":10,...}`）。

**POST 模板 headers 补充**：四份 POST 模板（bocha/tavily/deepseek/zhipu）headers 均含 `Content-Type: application/json` 与 `Accept: application/json`（fetch 对 string body 缺省补 `text/plain` 会被 JSON API 拒收，照 bocha 现适配器行为）；GET 模板（brave/searxng）带 Accept 头照现状。T-P 断言覆盖鉴权头与 Content-Type。

**DDG 出厂展示常量**：DDG 无模板，但描述快照/列表 UI 需要其 name 与 paramHint——在 `preset-templates.ts` 同文件落 `DUCKDUCKGO_ENGINE_META`（name: "DuckDuckGo"，paramHint 短文案：免费无 key、忽略 params、无高级语法），快照与 UI 共用。

### 4. 模板执行器（`search/engines/template-engine.ts` 新增，四适配器源文件删除）

`runTemplateEngine(template, resolved, query, options, params, fetchFn)`（独立 template 参数恒等 `resolved.template`，签名保留二者仅为可读性）：**模板由 `ResolvedEngineConfig` 扩展字段 `template: SearchEngineTemplate` 携带**——链解析（resolveEngineChain）是**全仓唯一查模板点**（出厂 ∪ presetOverrides 合并 ∪ customEngines 在此一次完成，配置完整过滤同源消费），dispatch 只按 id 路由到执行器或 DDG 适配器，不做二次查找。流程：构造请求（占位符替换 + params 合并）→ fetch（30s 统一超时，AbortController）→ 非 2xx 走 `engineApiErrorMessage`（body 前 300 字符 + redactSecret 统一脱敏）→ JSON parse 失败 / resultPath 找不到或非数组 → 抛 `engineFailed` 可读错误（`TOOL_SEARCH_FAILED`，供串行降级——运行时错误与 Step 1 的模板校验错误码无关）；envelope 校验（**codePath 取值缺失/undefined = 视为通过**——收编 bocha 现语义；取到值且不在 okValues 抛错，msg 脱敏）；resultPath 取数组（空数组=合法空结果）→ 逐条 fieldMap 候选取值（**跳过判据 = url 候选全空**；title 缺省回填 url；snippet 缺省空串）→ answerPath 可选透传 → 客户端截断到 maxResults → 返回 `SearchResponse`（engine=id）。

`dispatch.ts` 改造：`duckduckgo` 走原适配器；其余进模板执行器（模板来自 resolved 携带）；未知 id / 无模板 → 抛 `engineFailed` 可读错误（含引擎 id）。**presetOverrides 合并语义**：浅合并、嵌套对象（fieldMap/envelope）整体替换（`{...preset, ...override}`）。

**错误通道与 logger 口径**（全 spec 统一，见本节）：

- 模板执行器沿用适配器先例 **throw** `engineFailed(AppError TOOL_SEARCH_FAILED)` / `engineTimeoutError`——search-tool 的 run 循环是唯一 throw 边界（catch 收 failureLines 降级），执行器内部**不引入 Result**。
- **logger**：模板执行器不新增 logger（错误经 throw 通道 + attempts 轨迹呈现，与四适配器现状一致）；`testEngine` 失败与装配期 readConfig 降级各一条 `createLogger("tool.search")` debug/warn（见 §7/§8）。

### 5. 存储布局（KKV 模块 `nm-search`，全部新键；旧键 `engineOrder`/`searxngBaseUrl` 读路径删除——存量丢弃）

| 键 | 形态 | 缺省 |
|---|---|---|
| `enabledEngines` | `string[]`（启用的实例 id） | `["duckduckgo"]` |
| `engineOrderV2` | `string[]`（全部已知 id 的排序） | 六预置 + DDG 出厂序，DDG 恒队尾 |
| `customEngines` | `CustomEngineDef[]` | `[]` |
| `presetOverrides` | `Record<string, Partial<SearchEngineTemplate>>` | `{}` |
| `engineBaseUrls` | `Record<string, string>`（**v3**：仅自定义实例的 `{{baseUrl}}` 模板可达；出厂模板零引用） | `{}` |

- SKSP ref 沿用 `search/{engineId}/apiKey`（自定义实例即 `search/custom:{id}/apiKey`）；模板落库永远只有 `{{apiKey}}` 占位符；保存时对 url/headers/body 做明文密钥启发式检测命中拒绝。**密钥检测单一实现**：`search` 模块内一个共享纯函数（sk- 前缀、Bearer 长串、X-API-KEY/X-Subscription-Token 等赋值形态），`parseCurlCommand` 的密钥识别与保存校验两处调用同一实现，测试样例随常量落定（正例：sk-xxx、Bearer 后 ≥20 字符；反例：`{{apiKey}}` 占位符自身、短 token）。
- **key 写入通道**（预置与自定义统一）：`saveEngineKey(engineId: string, key)` / `clearEngineKey(engineId: string)` 签名从 `KeyEngineId` 放宽为 `string`（自定义实例唯一落 key 路径）；`createCustomEngine` / `updateCustomEngine` 入参携带可选 `apiKey`/`baseUrl`，创建/更新时拆分落 SKSP / `engineBaseUrls`（`CustomEngineDef` 本体仍只存模板，不含明文）。
- **readConfig 新读模型**（`SearchConfigPublic`，双端 UI 与装配快照共用）：
  ```ts
  interface SearchConfigPublic {
    engines: readonly { id: string; name: string; enabled: boolean; needsKey: boolean; hasKey: boolean; needsBaseUrl: boolean; baseUrl?: string; isCustom: boolean }[];  // 按 engineOrderV2 序，含 DDG（needsKey/needsBaseUrl=false）
    customEngines: readonly CustomEngineDef[];
    presetOverrides: Readonly<Record<string, boolean>>;  // 覆盖状态回显（恢复默认按钮可见性）
    canRun: readonly string[];                            // enabled ∩ 配置完整（= 串行链成员）
  }
  ```
- **容错归一**：engineOrderV2 损坏/含未知 id → 按 §1 动态全集丢弃未知项、已知项保序、缺失项按出厂序补尾（出厂缺省序 DDG 队尾，append 后无队尾特权）；`enabledEngines` 读路径同样按动态全集归一（dangling id 丢弃）。`setEngineOrder` 校验放宽为「动态已知 id 的不重复序列；**缺项容忍**（读侧容错归一补齐），含未知 id 拒绝」。
- **收录契约**：`createCustomEngine` 同步把新 id append 进 engineOrderV2；`deleteCustomEngine` 同步从 engineOrderV2 **与 enabledEngines** prune。读写均以动态全集为准——否则自定义引擎永不入链。
- `resolveEngineChain(deps, inputEngine?)`：order → 过滤 `enabledEngines` ∩ 配置完整（模板就绪 + 按占位符判据 key/baseUrl 就绪）→ 显式 engine 分支（见下）；DDG 不再恒入链（enabled 决定）。
- **显式 engine 三分支语义**（收编现状「顺位回落」语义）：
  1. id 已知且通过 enabled+配置完整过滤 → 钉链首（该引擎单发，失败不降级）。
  2. id 已知但未通过过滤（关闭/未配置）→ 沿 order 从该 id 起截尾，取截尾后第一个通过过滤的引擎（**保留现状顺位回落**：尊重显式指定的位置意图，不回落到排位更前的引擎；截尾后链空则走链空路径）。
  3. id 不在动态全集 → `resolveEngineChain` 抛 `AppError` + i18n key `error.tool.search_engine_not_found`（params 带引擎 id，照本层 `TOOL_SEARCH_INVALID_ARGUMENT` 先例），search-tool 边界照常映射为工具失败。
- 链空 = 合法常态（全关），工具层返回专门提示文案。
- 开关与 key 解耦：`setEnabled(engineId, on)` 只动 enabledEngines。
- `normalizeSearxngBaseUrl` 泛化为 `normalizeEngineBaseUrl`（http(s) 校验 + 尾斜杠剥离，逻辑不变），服务 `setEngineBaseUrl(id, url)`。

### 6. 工具面（`search-tool.ts`）

- inputSchema：query（必填）/ maxResults（int）/ **engine: `z.string().min(1)`**（description 注明值域=当前启用且配置完整的引擎 id，缺省走链）/ **params: `z.record(z.unknown())`**（自由 JSON，原样透传引擎方言参数，引擎忽略未知字段）（**v3 收口，拍板 A3**：schema 只含 **engine（string，可选）+ params（object，可选）** 两参——顶层 query/maxResults 作废，搜索词按 `q`/`query`/`search_query` 取首个非空字符串、条数按 `count`/`max_results`/`maxResults` 回落归一，测试锁 T-S1 反锁两参形态）。
- outputSchema 两处 `z.enum(ENGINE_IDS)` → `z.string()`。
- `SearchToolOptions.recencyFilter/domainFilter` 及 `SearchRecency/DomainFilters/parseDomainFilters/matchesDomainFilters` 全删；bocha mapFreshness/tavily time_range 与 domains/brave buildBraveQuery 与 count 常量/searxng buildSearxngQuery/DDG 过滤兜底分支全删；search-tool.ts 中「⚠️ 生产恒不带 domainFilter/recencyFilter」注释随本次正式作废删除。
- `SEARCH_NOT_CONFIGURED_MESSAGE` 改写为链空场景**中性**文案（「当前没有可用的已启用搜索引擎，请在 设置 → 搜索配置 开启或配置引擎」——同时覆盖全关与「显式指定不可用引擎且截尾后链空」两种到达路径，不谎报「未启用任何」）；不枚举引擎 id；同步处置 i18n catalog 中的死 key（见 §10）。
- 串行链循环、显式钉死不降级、120s 预算、attempts 轨迹、50KB 落盘五契约**原样保留**（不动 search-tool run 主流程）。

### 7. 描述快照与装配（`builtin-tool-context.ts` + `run-agent-turn.ts`）

- `BuiltinToolSearchContext` 扩展：`engineSnapshot: readonly { id: string; name: string; paramHint: string }[]`。**快照口径与串行链同款**：`enabledEngines` ∩ 配置完整（key 存在性查 `secretStore.has`，装配期一次 IO），按 engineOrderV2 序——描述只透传真能跑的引擎，与 PRD R5「按串行链顺序」一致；「启用但未配置」的引擎对 agent 不可见（R4 精神）。paramHint 超长防御性截断 500（**v3 作废，拍板 A2**：不限长、装配期不截断）。
- `assembleSearchToolContext(store)` 改 async：装配期 `readConfig()` 一次预读拼快照（照 `skills.effective` 先例；`Tool.description` 是同步 `(ctx)=>string`）。主/子代理两注入点同步 await。**装配失败降级**：readConfig 抛错 → 空快照 + `createLogger("tool.search")` warn 一条，search 工具照旧装配（链解析在 run 内自会报错）——不让搜索配置读取失败击穿整个 agent turn。
- `searchTool.description(ctx)` 改为消费快照：**通用段重写为引擎无关文案**（只描述 query/engine/maxResults/params 语义与串行链/120s 预算/50KB 落盘口径，不枚举任何引擎 id、不承诺 DDG 恒在——现骨架三处硬编码五引擎与「未配置自动用 DDG」的承诺随改造作废）+ 逐引擎段（`- {id}（{name}）：{paramHint}`）（**v3**：通用段实际描述 engine/params 两参语义——搜索词与条数在 params 内按引擎方言字段传入，结果格式段照旧）。
- 回合内改配置不即时反映（下回合生效）——照 skills 快照既有语义。

### 8. 配置页（双端）

- **core store 新方法**：`createCustomEngine(input: { def: CustomEngineDef; apiKey?: string; baseUrl?: string })`（校验 + append orderV2 + key/baseUrl 拆分落库）/ `updateCustomEngine(id, patch)` / `deleteCustomEngine(id)`（prune orderV2 与 enabledEngines + 清 SKSP ref）/ `updatePresetOverride(id, patch)` / `resetPresetOverride(id)` / `setEnabled(id, on)` / `setEngineBaseUrl(id, url)` / `testEngine(input)`；`saveEngineKey`/`clearEngineKey` 参数放宽为 `string`（预置与自定义统一 key 通道，见 §5）。
- **（v3 作废，拍板 A4——testEngine 整链退役，本段随 spec-v2 §9 作废）** `testEngine({ engineId?, draft?, query, maxResults? })`：**草稿直测**（不落库，KKV/SKSP 零写入）；`draft = { template: SearchEngineTemplate; apiKey?: string; baseUrl?: string }`（baseUrl 供 searxng 形态未保存实例地址直测；占位符解析优先级 draft > KKV 现存值 > 空）。`engineId` 模式（无 draft）三分支：**预置** = SKSP 现读 key + presetOverrides 合并 + engineBaseUrls；**自定义实例** = 模板取 `customEngines[id].template` + SKSP 现读 key + engineBaseUrls（已存实例测试按钮的通道——SKSP 不回读明文，UI 拿不到 key，只能走本模式）；**DDG** = 直接走原适配器。DDG 仅支持 engineId 模式（draft 对 DDG 无意义）；draft 与 engineId 同传时 draft 优先。返回 `Result<TestEngineSuccess, TestEngineFailure>`：成功 `{ resultCount, sample: SearchResult[≤5] }`；失败 `TestEngineFailure = { message: MessageDescriptor }`（骨架走 i18n key `error.tool.search_test_failed`，引擎响应摘要进 params，整体脱敏）。
- `parseCurlCommand(text): Result<CurlCommandDraft, CurlParseError>`（core 新增，双端共用；返回 `Result` 而非自造 `{ok}` 字面量——仓内 `errors/either.ts` Result 是既定基建）：支持 `-X`/`-H`/`-d`/`--data-raw`/`-G` 基本形态；疑似密钥值识别（§5 共享检测函数）→ 表单草稿携带「密钥明文 → {{apiKey}}」替换对，保存时落 SKSP；`CurlParseError = { message: MessageDescriptor }`（key `error.tool.search_curl_parse_failed`）。解析失败整体拒绝，UI 展示 reason。
- **desktop**：IPC 新增 `ipcSearchSetEnabled`/`ipcSearchTestEngine`/`ipcSearchCreateCustomEngine`/`ipcSearchUpdateCustomEngine`/`ipcSearchDeleteCustomEngine`/`ipcSearchUpdatePresetOverride`/`ipcSearchResetPresetOverride`/`ipcSearchSetEngineBaseUrl`（完整链路：`shared/ipc-types.ts` → `renderer/ipc/{invoke-registry.ts, client.ts}` 再导出 → `src/main/ipc/handler-registry.ts` → `handlers/search.ts` 薄封装；testEngine 的 `Result` 在 handler 边界翻译——`TestEngineFailure.message` descriptor 经 `coreT` 译成中文封进 `IpcResult`，照 `format-ipc-error.ts` 先例）（**v3，拍板 A4**：`ipcSearchTestEngine` 通道连同 TestEngine DTO、invoke-registry 条目与 handlers/search.ts 封装随 testEngine 退役删除，IPC 收敛为七通道）；**旧 `ipcSearchSetSearxngBaseUrl` 通道与 `SearchConfigDto.searxngBaseUrl` 字段退役**，searxng baseUrl 编辑改走 `ipcSearchSetEngineBaseUrl("searxng", url)`；`SearchConfigDto` 扩展（engines 值加 enabled/needsKey/hasKey/needsBaseUrl/baseUrl 回显字段、customEngines 列表、presetOverrides 状态——形状照 §5 `SearchConfigPublic`）。列表页：动态行（六预置+自定义+DDG）+ 每行开关 + 上移下移（动态 id）+ 删除（自定义）+「新建自定义引擎」入口。详情页分支：DDG 只读 / 预置（key 表单（需 key 模板）+ baseUrl 表单（需 baseUrl 模板）+ 模板高级编辑折叠区（含恢复默认）+ 测试按钮）/ 自定义（**key 表单（含 `{{apiKey}}` 注入方式快捷选择）+ baseUrl 表单（模板引用 `{{baseUrl}}` 时）**+ 全量模板表单 + 测试按钮 + 删除）（**v3，拍板 A4**：详情页收缩为 mobile 同款极简形态——DDG 行不进详情页、删 defaultBody 编辑 / 注入方式快捷选择 / 宏校验 / 测试按钮，只留连接（method+URL，内置模板只读）+ 认证三态 + paramHint（内置只读））；「新建」= Detail view 的 **create 模式**（复用 `searchEngineDetail` viewId + `navState.editingEngineId` 哨兵值，不新增 viewId——`settings-nav.ts`/`settings-overlay-views-stub.ts` 零改动）。curl 导入：新建页粘贴域 + 解析预填（失败整体拒绝 toast）（**v3**：仅桌面端保留）。模板编辑表单：method/URL/headers（JSON 文本域，照 ProviderFormView headersJson 先例）/bodyTemplate（JSON 文本域）/resultPath/fieldMap 三行候选（逗号分隔）/answerPath/envelope（可选）/paramHint；保存前走 `validateSearchEngineTemplate`。
- **mobile**：同构改造（列表开关/BottomSheetMenu 增删除项/详情模板表单照 FormField/FormTextInput 骨架/详情 create 模式**含 curl 导入粘贴域**——parseCurlCommand 双端共用，非 desktop-only）（**v3 实现事实**：mobile 详情/新建页已删 curl 导入粘贴域、测试搜索按钮与 DDG 详情入口，create 模式不预填 defaultBody 字段，认证为三态快捷选择——parseCurlCommand 剩 desktop 单端消费）；descriptor 翻译：`TestEngineFailure.message`/`CurlParseError.message` 经 translator（toast 通道现有翻译入口）译后展示（**v3**：TestEngineFailure 随 testEngine 退役消亡，剩 CurlParseError 单项）；`navigation/types.ts` route 参数 `engineId: EngineId` → `string`；`isKnownEngineId` 从静态表改查 config 动态清单；ENGINE_LABELS/HINTS 从 SearchEnginesScreen 抽到独立 meta 模块（Detail 屏反向 import 解耦）；**新方法由 UI 直接 `getSearchConfigStore(runtime).<method>()` 消费，不在 `search-config.store.ts` 造转手便捷函数**（现状 readSearchEngineConfig/setSearchEngineOrder 的 PASS_THROUGH 形态不再新增；`KEY_ENGINE_IDS` 再导出行随 Step 7 删除）；**core-shim 只补 mobile 生产/测试实际引用的新导出、删除 `ENGINE_IDS`/`KEY_ENGINE_IDS` 旧条目**（生产代码走 metro 直连 dist barrel，shim 是 Jest 白名单）。
- 帮助弹窗文案更新（**双端**：desktop SearchHelpModal + mobile SearchEnginesScreen helpVisible；开关语义 + 模板说明 + 「测试消耗引擎配额」提示）。

### 9. 配套

- 双端 `agent-tool-catalog` search 条目文案改写（去五引擎枚举，改「按配置的引擎串行检索」）。
- CHANGELOG 随下次发版号条目；iterations.yaml 补登 web-search-tool（superseded-by 本迭代）+ 本迭代条目。

### 10. i18n 契约

**口径分层**：LLM-facing 文案（工具 description 通用段、paramHint、SEARCH_NOT_CONFIGURED_MESSAGE、formatter 输出）**硬编码中文**——现状先例，不进 catalog；**用户可见错误**走 `AppError(code, {key})` + catalog descriptor——`search-config.ts` 现状先例；双端设置页 UI 静态文案**硬编码中文**——双端 settings 现状，本次延续，不接 MessageDescriptor 通道（**v3 作废并替代**：设置页 UI 文案已迁入 settings 域双语 catalog——153 key 真源 + locales settings.{zh-CN,en-US}.json + core `./settings` 子入口 + 双端 settingsTranslator，spec Δ 清单与 iteration-state spec_deviations 已补登；translator 暂固定 zh-CN，en-US 运行时不可达，属备案口径，见 spec-v2 §9 第 7/8 条）。

| 处置 | key / 位置 | 内容 |
|---|---|---|
| 新增 | `error.tool.search_template_invalid` | 模板校验失败（params 带具体字段原因） |
| 新增 | `error.tool.search_secret_detected` | 明文密钥检测命中拒绝保存 |
| 新增 | `error.tool.search_engine_not_found` | 显式 engine 未知 id（params 带引擎 id） |
| 新增 | `error.tool.search_test_failed` | testEngine 失败骨架（params 带脱敏摘要） |
| 新增 | `error.tool.search_curl_parse_failed` | parseCurlCommand 失败骨架（params 带原因） |
| 改写 | `error.tool.search_engine_order_invalid` | 现文案「必须是五引擎的合法排列」失真 → 「必须是已知引擎 id 的序列」 |
| 改写 | `error.tool.search_searxng_base_url_invalid` | 随 `normalizeEngineBaseUrl` 泛化失真（非 searxng 引擎也触发）→ 「实例地址无效：仅支持 http/https」 |
| 删除 | `error.tool.search_not_configured` | 现为死 key（生产零消费，常量硬编码同文）→ 随 SEARCH_NOT_CONFIGURED_MESSAGE 改写一并删除，声明「工具输出文案硬编码」口径 |

同步动作：`i18n/keys.ts` + `catalog/zh-CN.yaml` + 重跑 `packages/core/scripts/gen-i18n-catalog.mjs`（generated-catalog.ts）；新增 key 随 Step 2、死 key 删除与文案改写随 Step 3、order_invalid 文案改写断言随 Step 8 各自波次落地（en-US.yaml 为部分覆盖骨架，缺 key 回退 zh-CN——新增 key 可不提供英文翻译，删除项在 en-US 本就不存在）。

## 最终项目结构（Δ）

```
packages/core/src/domain/tool/builtin/search/
  types.ts                  [改] 删过滤类型/枚举；新增 SearchEngineTemplate/CustomEngineDef/校验契约
  preset-templates.ts       [新] 六份出厂模板常量
  search-config.ts          [改] 新 KKV 键布局/store 新方法/testEngine/容错归一/收录契约
  search-tool.ts            [改] schema 放宽/params/描述快照/砍过滤/清注释
  engines/
    template-engine.ts      [新] 模板执行器（占位符/映射/信封/脱敏/客户端截断）
    dispatch.ts             [改] 模板路由 + DDG 特判；未配置文案改写
    duckduckgo.ts           [改] 删过滤兜底分支（解析主体保留）
    bocha.ts / tavily.ts / brave.ts / searxng.ts   [删]
  curl-import.ts            [新] parseCurlCommand + 共享密钥检测
packages/core/src/domain/tool/builtin/builtin-tool-context.ts   [改] engineSnapshot
packages/core/src/service/agent/logic/run-agent-turn.ts         [改] async 装配 + 两注入点 + 降级
packages/core/src/index.ts  [改] 导出面增删
packages/core/src/errors/error-codes.ts   [改] 追加 TOOL_SEARCH_TEMPLATE_INVALID
packages/core/src/i18n/{keys.ts, catalog/zh-CN.yaml, generated-catalog.ts}   [改] §10 清单
packages/core/src/domain/settings/i18n/keys.ts   [新] settings 域 UI 文案 key 真源（153 key；v3 settings i18n 落地，spec §10 旧口径作废）
packages/core/locales/settings.{zh-CN,en-US}.json   [新] settings 域双语 catalog（zh/en 双源）
packages/core/src/public/settings.ts   [新] core `./settings` 子入口（SettingsMessageDescriptor/Key/Like 三类型 re-export）
packages/core/package.json   [改] exports 增 `"./settings"` 子路径
apps/desktop/shared/logic/settings-i18n.ts；apps/desktop/renderer/i18n/settings.ts；apps/mobile/src/i18n/settings.ts   [新] settings 域 translator 共享逻辑与双端入口（暂固定 zh-CN，locale 接线留待设置层）
apps/desktop/shared/ipc-types.ts；renderer/ipc/{invoke-registry.ts, client.ts}；src/main/ipc/handler-registry.ts / handlers/search.ts   [改] 新 IPC + DTO + 旧 searxng IPC 退役
apps/desktop/renderer/features/settings/SearchEnginesView.tsx / SearchEngineDetailView.tsx / search-engine-meta.ts；shared/logic/search-engines.ts   [改]
apps/desktop/shared/config-forms/agent-tool-catalog.ts   [改]
apps/mobile/src/screens/stack/SearchEnginesScreen.tsx / SearchEngineDetailScreen.tsx（含 create 模式）；navigation/types.ts；services/search-config.store.ts；config-forms/agent/agent-tool-catalog.ts；test-utils/core-shim.ts + jest.config.js   [改]
packages/core/test/tool/search-tool.test.ts / search-config.test.ts / duckduckgo.test.ts   [改]
packages/core/test/tool/search-engines.test.ts   [删]（整文件退役，语义由新测试承接，见处置总表）
[新] packages/core/test/tool/{template-engine,preset-templates,curl-import}.test.ts
[新] apps/desktop/test/search-engines-view.test.tsx（T-U1/U2；desktop node:test + react-test-renderer 先例齐备）
apps/mobile/__tests__/{search-engines-screen-reorder,search-engine-detail-screen-save-reload}.test.tsx   [改]（T-U3/U4 归入既有文件）
docs/Iterations/iterations.yaml、CHANGELOG.md   [改]
```

## 详细实现步骤

> qa 口径（**跨包编译红时间线**已推演，防口径互斥）：Step 2-5 属 core 改造波，验收 = **core 包编译绿 + core 测试锁允许红（存量锁由 Step 8 收口）**；期间 desktop/mobile 对 core 旧形态（`SearchConfigDto.searxngBaseUrl` 必填字段、`ENGINE_IDS`/`KEY_ENGINE_IDS` 值引用、`setSearxngBaseUrl` 接口）的编译红**属预期窗口，容忍至 Step 6/7 各端收口**——任何 Step 均不要求全仓 build 绿；desktop 于 Step 6、mobile 于 Step 7 各自收口双端编译绿 + 该端 UI 测试绿。

- Step 1 — phase-template-core — blocking: yes — qa: auto：`types.ts` 新增模板类型族与 `validateSearchEngineTemplate`（过滤类型/纯函数**不动**，随 Step 3 与引擎文件同波删）；`errors/error-codes.ts` 追加 `TOOL_SEARCH_TEMPLATE_INVALID` 码；新写 `preset-templates.ts` 六常量 + `DUCKDUCKGO_ENGINE_META`（paramHint 文案随本步落定）；新写 `template-engine.ts` 执行器（占位符替换、params 合并、候选 fieldMap、answerPath、envelope、30s 超时、统一脱敏、客户端截断）。
- Step 2 — phase-config-store — blocking: yes — qa: auto：`search-config.ts` 新键布局 + 动态全集容错归一（orderV2 + enabledEngines）+ 收录契约 + `SearchConfigPublic` 新读模型 + resolveEngineChain 双过滤与显式三分支 + store 新方法（`ResolvedEngineConfig` 扩展 `template` 字段；`saveEngineKey`/`clearEngineKey` 放宽 string；校验走 Step 1 的 validate，写路径 throw AppError+key）+ `testEngine` + 新写 `curl-import.ts`（parseCurlCommand + 共享密钥检测）；i18n 新 key 落 keys.ts/catalog yaml/gen；删旧键读写与全排列校验（desktop/mobile 消费方编译红属预期窗口，见 qa 口径）。
- Step 3 — phase-dispatch — blocking: yes — qa: auto：`dispatch.ts` 改模板路由（DDG 特判保留、未知 id engineFailed、模板取自 resolved 携带；新增 params 形参**可选缺省 `{}`**，Step 4 才接线透传）；删 bocha/tavily/brave/searxng.ts 四文件与 DDG 过滤兜底分支；**删 `SearchRecency/DomainFilters/parseDomainFilters/matchesDomainFilters` 与 `SearchToolOptions` 过滤字段及五文件全部引用**（与引擎文件同波，时序安全；core `index.ts` 的 `SearchRecency` 等过滤符号再导出行随本步同波前置删除，保 core 编译绿）；`SEARCH_NOT_CONFIGURED_MESSAGE` 改写 + catalog 死 key 删除（gen 重跑）。
- Step 4 — phase-tool-surface — blocking: yes — qa: auto：`search-tool.ts` schema 放宽 + params 透传进 dispatch + 清死码注释；`builtin-tool-context.ts` 扩 engineSnapshot（`resolveEngineChain` 形参同步放宽 string）+ `run-agent-turn.ts` async 装配（readConfig 失败空快照 + warn 降级）与两注入点；`searchTool.description` 改拼快照（引擎无关通用段 + 逐引擎段）。
- Step 5 — phase-exports-shim — blocking: yes — qa: auto：core `index.ts` 导出面增删（删 ENGINE_IDS/KEY_ENGINE_IDS 等、增模板类型/store 类型/parseCurlCommand）**与 `types.ts` 旧常量/类型本体（`ENGINE_IDS`/`KEY_ENGINE_IDS`/`EngineId`/`KeyEngineId`/`SearchEngineStatus`）同波删除**；同步更新 `packages/core/test/package-exports/snapshots/main-entry-allowlist.json`（导出快照精确锁，Step 5 必红锁）；desktop `shared/logic/search-engines.ts` 再导出收敛与 **`search-engine-meta.ts` 动态化**（`as EngineId`/`as KeyEngineId`/`as readonly EngineId[]` 断言 5 处按符号名清理：handlers/search.ts `as KeyEngineId` ×2 + `as readonly EngineId[]` ×1、search-engine-meta.ts `ENGINE_IDS as readonly string[]` + `KEY_ENGINE_IDS as readonly EngineId[]`）——desktop UI View/Screen 层（SearchEnginesView 等）的值引用红容忍至 Step 6；mobile `core-shim.ts` 补实际引用 + `jest.config.js` 同步（mobile 生产再导出红容忍至 Step 7）。
- Step 6 — phase-desktop-ui — blocking: yes — qa: auto：**desktop 全端收口**——DTO/IPC 扩展与 handler + client.ts 再导出 + 旧 searxng IPC 退役；列表页动态行 + 开关 + 删除 + 新建入口（Detail create 模式）；详情页分支重写（key/baseUrl 表单 + 模板表单 + curl 导入 + 测试按钮 + 恢复默认）；`search-engine-meta.ts` 收敛为预置 meta + 动态清单；帮助弹窗文案；desktop 编译绿 + T-U1/U2 绿。
- Step 7 — phase-mobile-ui — blocking: yes — qa: auto：**mobile 全端收口**——同构改造（列表/详情含 create 模式与 curl 导入/meta 抽模块/UI 直调 store 方法/`KEY_ENGINE_IDS` 再导出行删除/core-shim 补实际引用）；mobile 编译绿 + T-U3/U4 绿。
- Step 8 — phase-tests-rewrite — blocking: yes — qa: auto：测试锁全量处置（见处置总表：删 22 / 改 19 / 留 32，新增/改写合计 28）+ catalog 双份文案改写与断言；**全仓编译 + 全部测试绿收口**。**nm-code-style 交付门（仓规 #179 强制）**：对本迭代触达路径跑 `check-style.mjs` 循环 ≥2 轮至 PASS，收尾一次 `--all` 全仓扫，未处理 DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE 项随迭代报告列表化。
- Step 9 — phase-docs-release — blocking: no — qa: manual_user：CHANGELOG 条目、iterations.yaml 补登、PRD 口径同步（测试按钮草稿直测 / curl 导入 SKSP 时序 / URL 编码收窄 / paramHint 超长拒绝 / PRD 验收例 `{"n":{{count}}}` 裸占位符改为合法 JSON 形态 `"n":"{{count}}"` 五句随 spec 修订）；双端真机/桌面手动回归（合并后用户验收）。

## 测试策略

**处置总表**（逐文件，以实际用例数为权威）：

| 文件 | 实测用例 | 处置 |
|---|---|---|
| core test/tool/search-tool.test.ts | 20 | 改 7（T-S1/S2/S4、钉死未知 id、SEARCH_NOT_CONFIGURED 断言、dispatch 路由、默认链口径）/ 留 13（含 assembleSearchToolContext 调用点 await 机械适配约 12 处） |
| core test/tool/search-engines.test.ts | 20 | **整文件删**：语义承接 = 8 条语义改层级重锁（超时、bocha msg 脱敏、tavily answer 缺省、tavily 401 脱敏、searxng 非 2xx、bocha 业务码、baseUrl 缺失防御 → T-E1/E4/E5；tavily 折叠断言随用例退役）+ 9 条由 T-P 模板数据锁替代（bocha/tavily/brave/searxng 端点与字段映射×4、四条 clamp → T-E6）+ 3 条随过滤行为退役（bocha/brave/searxng domainFilter×3，brave count-20 同条） |
| core test/tool/duckduckgo.test.ts | 8 | 删 2（domainFilter 白名单、recencyFilter 忽略）/ 改 1（解析用例入参去过滤参数造形）/ 留 5（请求形状、解析、截断、0 结果 invalid、非 2xx） |
| core test/tool/search-config.test.ts | 13 | 改 7（默认序+开关、order 校验、容错归一、resolveEngineChain 双过滤+三分支、DDG 链语义、searxng 首发零 key 读取、全空状态——含点名 172 setSearxngBaseUrl→setEngineBaseUrl、263 存量 order 归一改写为 engineOrderV2 语义、282/337 DDG 恒链尾/恒在链取消、323 searxng 需 enabled）/ 留 6 |
| core test/package-exports/main-entry-allowlist.test.ts | 1 | 留 1（快照 `snapshots/main-entry-allowlist.json` 随 Step 5 导出面增删同步更新——确定性必红锁，已入 Step 5 清单） |
| mobile search-engines-screen-reorder.test.tsx | 7 | 改 4（动态 fixture 化：顺序渲染、上移断言、下移断言、状态标签）/ 留 3 |
| mobile search-engine-detail-screen-save-reload.test.tsx | 4 | 留 4（key 分支语义不变；mock store 扩方法） |
| **合计** | **73** | **删 22 / 改 19 / 留 32（含 package-exports 快照锁 1）** |

### 测试用例（新增/改写）

- T-E1 — Step 1/3 — blocking: yes：URL 占位符替换（query 百分号编码、count 数字串、apiKey/baseUrl 原样、**缺值占位符抛 invalid**）与 GET params 合并（追加/覆盖同名 query 参数）。
- T-E2 — Step 1 — blocking: yes：body 结构化替换——query 含 `"` 与 `\` 时请求体仍为合法 JSON 且语义正确；整值 `"{{count}}"` 替换为 number；POST params 浅合并同名覆盖。
- T-E3 — Step 1 — blocking: yes：候选 fieldMap 按序取首个非空（bocha url/link/href、snippet 四候选）；**跳过判据 = url 候选全空**；title 缺省回填 url；snippet 缺省空串（tavily `Source N` 回填退役断言）。
- T-E4 — Step 1 — blocking: yes：envelope 校验——**codePath 取值缺失 = 通过**（收编 bocha 现语义）、code!==200 抛错、msg 脱敏、okValues 缺省；answerPath 取到非空透传/未填不透传（tavily answer 缺省省略承接）。
- T-E5 — Step 1 — blocking: yes：非 2xx / JSON parse 失败 / resultPath 找不到或非数组 → 各自可读错误（invalid 供降级）；空数组=合法空结果；30s 超时「timed out after」（超时用例改层级承接）；错误消息无 apiKey 明文（redactSecret，含 body 回显脱敏）。
- T-E6 — Step 1 — blocking: yes：maxResults 客户端截断（所有模板引擎统一，承接 searxng 无 count 参数形态）；{{count}} 归一（0→5、99→20，承接四条 clamp 用例）。
- T-P1..P6 — Step 1 — blocking: yes：六份出厂模板请求形状快照锁（端点/method/鉴权头/body 字段逐一断言 + 响应样例映射出 title/url/snippet；智谱 search_query 字段名与 search_engine 固化值；searxng URL 不含 count/language）。
- T-C1..C5、C7 — Step 2 — blocking: yes（落点：`search-config.test.ts` 扩）：
  - T-C1 新键缺省态（enabledEngines=[duckduckgo]、orderV2 出厂序、customEngines=[]）；旧键写入后读路径不触达（存量丢弃语义）。
  - T-C2 engineOrderV2 容错归一（按动态全集：未知 id 丢弃/缺失补尾/损坏回默认）+ enabledEngines dangling id 归一 + setEngineOrder 放宽校验（不重复完整序列；未知 id 拒绝）。
  - T-C3 resolveEngineChain 双过滤（enabled ∩ 配置完整；占位符判据：模板含 {{apiKey}} 无 key → 不完整；DDG 不再恒入链）+ 显式三分支（钉链首 / 顺位回落 / 未知 id 抛 AppError 含引擎 id）+ `ResolvedEngineConfig.template` 携带断言。
  - T-C4 customEngines CRUD（创建 nanoid id + **append orderV2**、更新、删除 **prune orderV2 与 enabledEngines** + 清 SKSP ref）+ createCustomEngine/updateCustomEngine 入参 apiKey/baseUrl 拆分落库（SKSP/`engineBaseUrls` 断言）+ presetOverrides 写/清 + 浅合并子对象整体替换 + setEnabled 独立性。
  - T-C5 testEngine 草稿直测（KKV/SKSP 零写入断言）+ draft.baseUrl 优先级（draft > KKV > 空）+ engineId 模式（预置合并 override/现读 key；DDG 走适配器）+ 失败返回 descriptor 且脱敏（**v3 作废，拍板 A4**：testEngine 整链退役，相关用例随退役处置，见 spec-v2 §9）。
  - T-C7 validateSearchEngineTemplate 全规则（method 枚举/URL http(s)/bodyTemplate 合法 JSON/未知占位符拒绝/paramHint 超长拒绝/fieldMap 空/点路径语法）+ **保存路径密钥检测命中拒绝**（core 层，createCustomEngine/updatePresetOverride 双入口）。
- T-C6 — Step 2 — blocking: yes（落点：新 `curl-import.test.ts`）：parseCurlCommand——合法 curl（-X POST -H Authorization -d JSON）解析预填、密钥值识别替换 {{apiKey}}（与保存校验共用同一检测实现）、非法输入 Result.err 返回原因。
- T-S1 — Step 4 — blocking: yes：inputSchema 放宽（engine 任意 string 通过、params object 通过、outputSchema 接受自定义 id）（**v3**：改锁两参收口形态——schema 只含 engine（可选）+ params（可选），顶层 query/maxResults 不存在，search-tool.test.ts:200-209 已反锁）。
- T-S2 — Step 4 — blocking: yes：params 透传 e2e——模板引擎 body 含 params 字段（need_content:true 生效于请求体）；DDG 忽略 params。
- T-D1 — Step 4 — blocking: yes（落点：`search-tool.test.ts` 新 describe；编号避开仓内存量 describe「T-S3 串行链四口径」——那组语义归 T-R1）：启用两引擎时描述含两段说明且按链序；**快照口径=链同款（启用未配置引擎不出现）**；关闭引擎后描述无其字样（含 DDG 关闭后无 duckduckgo 字样）；DDG 启用时描述含 `DUCKDUCKGO_ENGINE_META` 逐引擎段；paramHint 超 500 截断（**v3**：改锁「不限长、装配期不截断」——search-tool.test.ts 已反锁新口径）；装配 readConfig 失败 → 空快照降级不击穿 turn；回合内配置变更不刷新。
- T-S4 — Step 3/4 — blocking: yes：全关场景（含 DDG 关闭）search 返回新全关提示（不崩溃）；SEARCH_NOT_CONFIGURED_MESSAGE 断言改写。
- T-R1 — Step 4 — blocking: yes：串行链四口径回归（401 降级轨迹/全链聚合错误/钉死不降级/120s 预算——沿用原用例改 fixture 为模板引擎）+ 50KB 落盘回归。
- T-U1 — Step 6 — blocking: yes：desktop 列表动态渲染（预置+自定义混排）、开关切换 IPC、上移下移动态 id、删除自定义（apps/desktop/test/search-engines-view.test.tsx 新文件）。
- T-U2 — Step 6 — blocking: yes：desktop 详情模板表单保存/校验（headers JSON 非法拒绝——UI 层走 validate 的 Result 展示；自定义引擎 key 表单与 `{{apiKey}}` 注入方式选择）、baseUrl 回显（DTO engines 值 baseUrl 字段）、curl 导入预填、测试按钮 busy 互斥与结果展示。
- T-U3 — Step 7 — blocking: yes：mobile 同构用例（动态列表/开关/表单；含 core-shim 映射生效——新导出在 Jest 可解析）。
- T-U4 — Step 7 — blocking: yes：mobile reorder 测试锁改写（动态 fixture）+ detail key 分支回归保持绿。

## 风险与回滚方案

- **测试锁大面积重写是最大工作量**（73 存量用例处置 + 28 条新增/改写用例）：按处置总表逐文件执行，Step 8 单列防漏。
- **模板执行器为净新核心路径**：占位符/转义/点解析以 T-E1..E6 全覆盖；畸形响应（超深嵌套/巨数组）取值有 try/catch 兜底（invalid 供降级）。
- **EngineId 放宽是跨包 breaking**：Step 5 收口导出面，编译期兜住（desktop 4 处 as 断言按符号名清单同步清理）。
- **智谱/DeepSeek 端点无仓内参考实现**：模板字段以官方文档为准（探索报告已核对字段名/必填性）；发布后以测试按钮真机验证，模板可编辑可热修（不依赖发版——本改造的目标能力）。
- **明文密钥检测为启发式**：不能保证拦截全部内嵌形态，已知让渡（帮助文案引导使用占位符）；检测实现单一、样例常量化可测。
- **回滚**：纯代码改造无 schema migration/数据迁移，revert 分支即回滚；新 KKV 键留存无害（旧版读路径不触达）。存量旧键数据全程未动，回滚到旧版即恢复原行为。

## 验收矩阵

- PRD 验收标准「模板执行器与出厂模板」「工具参数面与说明透传」「存量与回归」三组 → T-E/T-P/T-C/T-S/T-D1/T-R 全绿 + Step 8 nm-code-style PASS + Step 9 手动项。
- PRD「配置页」组 → T-U1..U4 + 合并后双端手动验收（qa: manual_user）。
