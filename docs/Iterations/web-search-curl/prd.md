---
date: 2026-11-12
dependency: [Iterations/web-search-tool/prd.md]
---

# 搜索 curl 化改造 PRD（web-search-curl）

## 背景

v1.5.15 上线的 AI 搜索（web-search-tool 迭代）内置五引擎硬编码适配器（bocha/tavily/brave/searxng/duckduckgo），接入新引擎必须写代码、随发版交付；工具入参只有 query/maxResults/engine 三项，各引擎原生高级参数（时间过滤、域名过滤、正文抓取开关等）模型完全用不上。

上一代 PRD 曾拍板「搜索引擎 API 无通用协议，不做任意引擎请求模板、不做连通性测试按钮」（web-search-tool/prd.md 不包含范围）。本次反转该口径：搜索 API 虽无行业协议，但**任意搜索 API 都可表达为「一次 HTTP 请求 + 响应字段映射」**——把这份模板做成可视化配置（用户给一条 curl 形态的请求，URL 与密钥由配置隐藏），即可接入任意引擎。用户原话：「其实就是 curl，对应的 url 和 ak 被隐藏，替换为 engine，参数和 curl 一样。」

配套两项能力：工具入参开放 `params` 自由 JSON 透传（引擎方言参数直达）；每引擎增加启用开关（默认全关仅 DDG 开），控制「是否进串行链 + 参数说明是否透传给 agent」。

## 目标（含成功指标）

| # | 目标 | 成功指标 |
|---|---|---|
| 1 | 接入任意 HTTP 搜索 API 不再依赖发版 | 用户从粘贴 curl 命令（或照厂商文档填表单）到测试搜索成功 ≤ 5 分钟、全程不发版 |
| 2 | 引擎供给全部模板化 | bocha/tavily/brave/searxng 适配器退役为出厂模板，与 DeepSeek/智谱出厂模板同机制；DDG 保留唯一代码兜底 |
| 3 | agent 获得引擎原生参数能力 | agent 按引擎说明传 params（如 DeepSeek need_content、bocha freshness）实际生效于请求体 |
| 4 | 引擎可见性由用户管控 | 默认仅 DDG 启用；关闭的引擎不进串行链、其说明不出现在工具描述、agent 无法感知其存在 |

## 用户与场景

| 用户 | 场景 | 旅程 |
|---|---|---|
| 配置者 | 想接入文档里看到的任意搜索 API（如 DeepSeek、聚合站、自部署服务） | 搜索配置页新建自定义引擎 → 粘贴 curl 命令自动填表单（或手填）→ 补响应字段映射 → 测试搜索通过 → 打开开关挂上串行链 |
| 写作者 | 写作中让 AI 检索资料 | agent 调 search，按工具描述中的引擎说明组装 params 方言参数（时间范围、域名过滤、正文开关等） |
| 管控者 | 只想用免费兜底或某一家付费引擎 | 其余引擎开关全关，agent 视野里只剩启用的引擎 |

## 范围

### 包含范围

1. **core 模板执行器**：占位符（`{{query}}`/`{{count}}`/`{{apiKey}}`/`{{baseUrl}}`）结构化替换 + 响应点路径字段映射（title/url/snippet/可选 answer），统一超时/错误脱敏/降级错误语义。
2. **六份出厂预置模板**：bocha/tavily/brave/searxng（适配器收编）+ DeepSeek（api.deepseek.com/v1/tools/search）+ 智谱（open.bigmodel.cn/api/paas/v4/web_search）；DDG 保留 HTML 解析代码适配器。
3. **自定义引擎**：多实例新建/编辑/删除，模板含 method/URL/headers/body JSON 模板/响应映射/参数说明；curl 命令粘贴导入；测试搜索按钮。
4. **引擎开关**：每引擎独立启用/停用（含 DDG 可关），默认全关仅 DDG 开；关 = 不进串行链 + 说明不透传 + agent 不可见。
5. **search 工具参数面**：query + engine（值域放宽为已启用引擎 id）+ maxResults + params（自由 JSON，原样透传合并进请求体，引擎自行忽略未知字段）；砍除 recencyFilter/domainFilter 统一面及适配器内映射实现。
6. **per-engine 参数说明**：出厂模板内置说明文案，自定义引擎由用户填写；经装配期快照拼进工具描述（关闭引擎的说明不拼入）。
7. **存量处置**：已存的 key/engineOrder/searxng baseUrl 不迁移不读取（读路径不再触达，视为全新状态）；不主动清除。
8. **发布配套**：iterations.yaml 登记取代关系；CHANGELOG 随下次发版号条目记入。

### 不包含范围

- DDG 模板化（HTML 解析无法模板表达，保留代码适配器作内置免费兜底）
- CLI 端搜索装配（延续 known limitation：不装配、返回可读错误）
- recencyFilter/domainFilter 跨引擎统一参数面（砍除；引擎方言过滤全走 params）
- 搜索结果全文抓取 / fetch 类能力（curl 工具 + 超预算落盘 + read 续读已覆盖）
- 模板版本管理 / 模板导入导出分享

## 核心需求

### R1 模板引擎执行器与出厂预置模板（全收编）

core 新增模板执行器：输入「引擎模板定义 + query + maxResults + params + apiKey 明文（请求瞬间现读）」，输出统一 `SearchResponse`。

- 模板定义字段：显示名称、HTTP method（GET/POST）、URL 模板、headers 键值对模板、body JSON 模板（POST 时）、响应映射（结果列表点路径 + title/url/snippet 字段名 + 可选 answer 路径）、参数说明文本。
- 占位符四个：`{{query}}`（URL 与 body 内均可）、`{{count}}`（maxResults 归一后值）、`{{apiKey}}`（URL/headers/body 均可）、`{{baseUrl}}`（URL 内引用实例地址）。body 内替换在 JSON 结构层面进行（先 parse 模板再遍历字符串值替换注入，防 query 含引号/反斜杠打坏 JSON；整值 `"{{count}}"` 替换为数字，保持整数字段类型）；URL 内仅 `{{query}}` 做百分号编码，`{{apiKey}}`/`{{baseUrl}}` 原样替换（apiKey 落在 URL query 时遇 `&`/`=` 可能打坏参数，建议放 header）。
- 响应映射：点路径（如 `data.webPages.value`）定位结果数组，逐条按字段名取 title/url/snippet；answer 路径选填、取到非空才透传。
- 出厂预置模板六份：bocha/tavily/brave/searxng（现有适配器行为收编为模板数据，适配器源文件与 dispatch switch 退役）+ DeepSeek + 智谱（按官方文档预置）。预置模板用户可编辑（存覆盖副本）、可恢复默认。
- 统一行为口径：超时 30s（原 bocha/tavily 60s 收敛统一）、非 2xx 与解析失败错误统一脱敏（错误消息对 apiKey 明文 redact）、0 结果视为合法空结果（DDG 除外，其改版感知语义保留在代码适配器内）。
- 串行降级链、显式 engine 钉死不降级、120s 链总预算、attempts 轨迹四个行为口径**原样保留**（现测试锁 T-S3 ①②③④ 语义不变）。

### R2 搜索配置页模板化改造（双端）

- 列表页：动态引擎集合（出厂模板行 + 自定义实例行 + DDG 行）平级混排；上移/下移调优先级（顺序即串行链）；每行增加启用开关控件；「+ 新建自定义引擎」入口。
- 模板编辑表单（自定义引擎 + 预置模板的覆盖编辑共用）：基础（名称/method/URL）+ 认证（key 密码框 + {{apiKey}} 注入方式快捷选择）+ headers 键值对 + body JSON 模板（带占位符插入按钮与基本校验）+ 响应映射（列表路径 + 三字段名 + answer 可选）+ 参数说明文本框。
- curl 命令粘贴导入：解析 `-X`/`-H`/`-d`/`--data-raw`/`-G` 基本形态自动预填表单；疑似密钥值识别后替换为 `{{apiKey}}` 占位符（密钥明文随表单草稿携带，保存时才存入 SKSP）；解析失败整体拒绝并提示原因，不半填。
- 测试搜索按钮：草稿直测——照云同步配置页「填完即测、坏配置不先落库」先例，输入一个测试词发起真实请求，展示映射后的前 5 条结果（title/url/snippet）或错误摘要；未保存的草稿模板、实例地址与密钥即可直测（测试不写 KKV/SKSP）；消耗引擎配额需界面提示。
- 状态展示：开关（启用/停用）与配置完整度（key 已设/未设）两维独立呈现。
- 详情页路由守卫放宽：引擎 id 从固定枚举变动态集合（自定义 id 形如 `custom:xxx`）。

### R3 search 工具参数面 curl 化

- inputSchema：`query`（必填）、`engine`（string，值域=已启用引擎 id，缺省走链）、`maxResults`（默认 5 clamp 1..20 不变）、`params`（自由 JSON object，原样合并进请求体；与模板/适配器标准字段同名时以 params 为准；DDG 无 body 时忽略）。
- 砍除：`SearchToolOptions.recencyFilter/domainFilter` 及五适配器内全部映射实现与纯函数（parseDomainFilters/matchesDomainFilters/各 freshness 映射），对应测试锁同步删除；search-tool.ts「⚠️ 生产恒不带 / 勿当死码删」注释随本次改造正式作废。
- outputSchema 的 engine 从 `z.enum(ENGINE_IDS)` 放宽为 string（formatter/summary 本就按形状判断，天然兼容）。

### R4 引擎开关

- 每引擎独立启用/停用状态（出厂模板、自定义实例、DDG 全部可关），存 KKV `nm-search` 模块；默认状态：全部关闭，仅 duckduckgo 启用。
- 关 = 该引擎不进串行链（无论是否配了 key）、其参数说明不进工具描述、agent 无法通过任何途径感知（engine 值域也不含它）。
- 全关（含 DDG）为合法状态：search 调用返回可读提示（「未启用任何搜索引擎，请在设置→搜索配置开启」），不报错崩溃。
- 开关与 key 配置解耦：关闭不删 key，重开即恢复（key 仍在 SKSP）。

### R5 per-engine 参数说明透传

- 出厂模板内置说明文案（本迭代随模板写定；例：DeepSeek 说明 query 语法 site:/after: 与 need_content/ori_question 参数）；自定义引擎说明由用户在表单填写。
- 工具描述 = 静态通用段（query/engine/maxResults/params 语义 + 串行链行为）+ 逐引擎段（启用引擎的 id、名称、参数说明，按串行链顺序）。经装配期快照注入（照 skills.effective / agents 先例，description 同步消费装配期数据，不运行时读 KKV）。
- 说明限长：单引擎说明 ≤ 500 字符，保存时超长拒绝（装配期再做防御性截断，防多引擎拼爆系统提示）。
- 双端 agent 工具 catalog 的 search 描述文案同步改写（现写死「五引擎」会漂移）。

### R6 存量处置与发布配套

- 存量 SKSP key（search/{bocha|tavily|brave}/apiKey）、KKV engineOrder/searxngBaseUrl：**不迁移、不读取、不主动清除**（用户拍板「就当不存在，丢弃」）；新读路径从全新默认状态起步（仅 DDG 启用）。旧 SKSP 遗留密钥留在原处（安全卫生上可接受：读路径死亡即无人触达）。
- iterations.yaml 补登 web-search-tool 条目与新条目的取代关系（notes 注明「反转其不包含范围第 3 条：请求模板」）。
- CHANGELOG 随下次发版号条目记入（仓库现状无 Unreleased 段）：新增自定义搜索引擎模板/引擎开关/params 参数，变更五引擎收编与存量配置失效。

## 验收标准

### 模板执行器与出厂模板

- Given 全新安装，When 打开搜索配置页，Then 引擎列表含六份出厂模板 + DDG，仅 DDG 开关为开，其余全关。
- Given 用户在 DeepSeek 预置模板行填入 key 并打开开关，When 对话中让 AI 搜索，Then 请求发往 api.deepseek.com/v1/tools/search 且 Authorization 为 Bearer + key，结果按 results[].title/url/snippet 映射展示。
- Given 模板 body 为 `{"q":"{{query}}","n":"{{count}}"}`，When query 含英文双引号与反斜杠，Then 实际请求体为合法 JSON、query 值与输入语义一致且 n 以数字类型发出（结构化替换生效）。
- Given 自定义引擎响应映射列表路径填 `data.webPages.value`，When 引擎返回嵌套结构，Then 正确抽出该数组并逐条映射 title/url/snippet。
- Given answer 路径未填，When 引擎响应含可-answer 字段，Then 输出不含 answer；填了路径且取到非空则透传。
- Given 串行链上首位引擎 401，When 未显式指定 engine，Then 自动降级尝试下一个启用引擎，attempts 轨迹如实记录；显式指定 engine 时失败直接报错不降级；链总预算 120s 行为不变。
- Given 引擎返回非 2xx 且响应体回显 key，When 错误透出，Then 错误消息中 key 已脱敏。

### 配置页

- Given 用户粘贴合法 curl 命令（-X POST + -H Authorization + -d JSON），When 点导入，Then 表单自动填好 method/URL/headers/body，疑似密钥值已替换为 {{apiKey}}（保存时才存入 SKSP）。
- Given 粘贴内容不是合法 curl 命令，When 点导入，Then 整体拒绝并提示原因，表单保持原状。
- Given 用户在自定义引擎表单填好配置（未保存亦可），When 输入测试词点「测试搜索」，Then 直接以草稿发起请求并展示映射后前 5 条结果或错误摘要（草稿直测，无需先保存，测试不落库）。
- Given 用户关闭某已配 key 的引擎，When 查看列表行，Then 开关呈关、key 状态仍为已设，重开后无需重填 key。
- Given 自定义引擎与出厂模板并存，When 上移/下移，Then 全部引擎实例平级重排且串行链顺序随之生效。
- Given 用户编辑出厂模板后改坏，When 点「恢复默认」，Then 模板回到出厂定义（key 不动）。
- Given 用户删除自定义引擎实例，When 确认删除，Then 从列表与串行链移除，SKSP key 同步清除。

### 工具参数面与说明透传

- Given DeepSeek 已启用，When agent 调 search 传 `params: {"need_content": true}`，Then 实际请求体含 need_content:true 且引擎按文档行为返回正文。
- Given agent 传 params 含引擎不认识的字段，When 走串行链，Then 各引擎原样透传（引擎自行忽略），不因此报错。
- Given bocha 与 DeepSeek 均启用，When agent 未指定 engine，Then 链按用户配置顺序尝试；工具描述含两引擎各自的说明段。
- Given 用户关闭 DeepSeek，When 新回合查看 search 工具描述，Then 描述中无 DeepSeek 字样，engine 值域不含其 id。
- Given 全部引擎关闭（含 DDG），When agent 调 search，Then 返回可读提示（指引到设置开启），不崩溃。
- Given 工具 schema，Then query 必填、maxResults clamp 1..20、engine 为 string、params 为 object；recencyFilter/domainFilter 不存在于 schema。

### 存量与回归

- Given 存量用户升级（曾配 bocha key + 排序），When 打开新版，Then 一切从默认状态起步（仅 DDG 启用），旧 key 静默留在 SKSP 不被读取，无报错无迁移提示。
- Given 任一引擎执行，When 结果总量超 50KB，Then 落盘机制照常（路径 + msg + read 续读），行为与现状一致。
- Given mobile 端，When 配置页与搜索全流程操作，Then 与 desktop 同构可用（core-shim 同步新增导出）。

## 约束与默认决策

- 存储沿用现有模式：模板/开关/顺序等非机密配置走 KKV `nm-search`，key 明文只走 SKSP ref（`search/{engineId}/apiKey`，自定义实例 ref 形如 `search/custom:{id}/apiKey`）；模板落库永远只有 {{apiKey}} 占位符，保存时对模板做明文密钥启发式检测（命中则拒绝保存并提示改用占位符）。
- 超时统一 30s（模板执行器；DDG 维持现状 30s）；无 SSRF 拦截（照 curl 工具拍板「简单搞」）。
- 工具描述动态化走装配期快照（description 同步签名不变），回合内引擎配置变更下回合生效可接受。
- 出厂模板定义在 core 内置常量（非 KKV 种子），用户覆盖副本才落 KKV——版本升级可携带模板修正。
- engineOrder 从「ENGINE_IDS 全排列不变量」改为「动态 id 列表 + 容错归一（未知 id 丢弃、缺失补默认序）」。

## 风险与待确认项

- **测试锁大面积重写**：search-engines.test.ts 五引擎请求形状锁、search-config.test.ts 全排列/engineOrder 锁、T-A5/T-A6 等随收编与砍除全部作废重写（约 8+ 处映射锁、20+ 处链/配置断言），工作量集中且易漏——spec 阶段须列全量测试锁处置清单。
- **模板执行器是新核心路径**：占位符结构化替换的转义边界、点路径解析、错误脱敏需充分单测（含恶意/畸形响应）。
- **明文密钥检测为启发式**：不能保证拦截全部内嵌 key 形态，属已知让渡（文档提示用户使用占位符）。
- **出厂模板随厂商 API 漂移**：引擎改版时模板可编辑、用户可自行修正或等版本携带修正——不再依赖发版正是本改造的目标，风险敞口反而小于硬编码适配器。
- **桌面端无搜索设置专项测试**：本次 UI 改动大（模板表单/导入/测试按钮/开关），spec 阶段评估补关键路径测试。
- 待确认（不阻塞 PRD，spec 前可改）：迭代目录名 `web-search-curl`；说明限长 500 字符的具体值；测试搜索结果展示条数（5）。
