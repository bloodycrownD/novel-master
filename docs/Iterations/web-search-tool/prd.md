---
date: 2026-09-06
dependency: []
---

# AI 搜索工具与工具输出防护（web-search-tool）PRD

## 背景

novel-master 的 AI 聊天目前内置 10 个工具（task/read/write/edit/fs/glob/grep/skill/agent/curl），没有联网搜索能力。用户在写作中需要查资料（背景考据、事实核验、资料收集），目前只能靠 curl 手动抓页面，模型无法主动检索。

经过对参考实现 `.reference/pi-web-access`（pi 的 web 搜索扩展）的探索确认：**搜索引擎 API 没有通用协议**（各家端点、认证、参数、响应格式互不相同，无 OpenAI 协议式的事实标准），可行做法是内置若干常用引擎的适配器 + 统一内部接口 + 用户手动配置 API key。

同时，现状 curl 工具的输出预算（256KB）是全仓库离群值——read/grep 共用 50KB 帽，curl 是其 5 倍。256KB 文本折算数万 token，对 128K 上下文模型一次工具结果即可占掉半数上下文，形同未设防（该值源自 fetch-tool → curl 升级时的拍板，本次正式收回）。此外 curl 超预算采用「首段截断、后文丢弃」，模型无法取回被截内容。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 模型获得联网搜索能力 | 对话中模型可自主调用 search 工具完成检索并引用来源 |
| 搜索引擎可手动配置 | 用户在双端设置页完成引擎选择与 key/baseUrl 填写，无需接触文件或数据库 |
| 工具输出不再威胁上下文 | curl/search/read/grep 四工具输出预算统一 50KB；超预算内容落会话工作区可续读，无永久丢失 |
| 落盘内容用户可见可查 | 双端文件树中可看到并打开落盘文件 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 小说作者（主用户） | 写作中问 AI「查一下 XX 年代的 YZ 制度」，AI 调 search 检索并基于结果回答 |
| 有海外搜索服务账号的用户 | 配置 tavily/brave key 使用国际引擎 |
| 自托管/隐私敏感用户 | 部署 SearXNG（可聚合百度/搜狗等中文引擎），在设置中填 baseUrl，免费无 key |
| 任何使用 curl 的用户 | 抓取大响应（API JSON、网页）时不再爆上下文，全文落盘后可让模型分页续读 |

## 范围

### 包含范围

1. 新增内置工具 `search`（五引擎：bocha / tavily / brave / searxng / duckduckgo）
2. 搜索引擎手动配置界面（桌面 + 移动）与凭证/元数据存储
3. curl 工具输出预算 256KB → 50KB，超预算自动落盘机制
4. search 工具输出超预算同机制落盘
5. read 工具截断口径简化（50KB 单一预算 + 字节偏移续读）

### 不包含范围

- 搜索引擎连通性「测试」按钮（沿用「拉取模型」式事实验证：首次调用即验证）
- 工具卡展开查看完整结果（现有 summary 一行展示；后续增强）
- 智谱/百度/阿里/字节等 LLM 平台绑定型搜索（形态为 LLM 插件非独立 API，且智谱已被明确移除）
- 任意搜索引擎通用接入（无协议可依赖，不做请求模板）
- 搜索结果的全文抓取（includeContent 类能力，后续迭代）
- grep/glob 的截断口径调整（仅动 read）
- SSRF/私网拦截（沿用 curl 升级拍板：简单搞，不设安全门）

## 核心需求

### R1 search 工具与引擎适配

- 注册内置工具 `search`，入参至少含 `query` 与结果条数；输出 `{answer?, results: [{title, url, snippet}]}`，遵循统一内部接口
- 五引擎适配器：bocha（Bearer + POST）、tavily（Bearer + POST）、brave（X-Subscription-Token + GET）、searxng（无 key + GET `{base}/search?q=...&format=json`，用户自填 baseUrl）、duckduckgo（无 key + GET `html.duckduckgo.com/html/?q=...` HTML 端点解析，内置兜底免密钥；忽略 recencyFilter；解析 0 结果报 invalid 供串行链感知改版）

#### R1.2 内置 DuckDuckGo 兜底（第三轮新增）

- duckduckgo 恒 configured（无 key 无 baseUrl），默认序固定队尾，参与排序可上移（免费用户可挪至首位即纯免费搜索）
- 未配置任何 key/baseUrl 时链 = [duckduckgo]，搜索开箱即用；「未配置」提示仅作为链空的防御路径保留（常规不可达）
- 帮助弹窗引擎优先级段补一句：未配置时由内置 DuckDuckGo 兜底（免费、无需密钥）
- UI：列表行状态标签「内置」；详情页为只读说明（无表单无保存）
- 未配置任何引擎时调用返回明确的「未配置」提示（含配置入口指引），不报错崩溃
- 参考实现 `.reference/pi-web-access` 的 bocha.ts / tavily.ts / brave.ts / searxng.ts 可直接借鉴

#### R1.1 引擎优先级与串行请求链（修订轮新增，取代「默认引擎」概念）

- 引擎优先级 = 用户可调的引擎顺序（存 KKV 偏好，缺省取内置默认序；新增引擎不在存量顺序中时按默认序补到队尾）；不设独立「默认引擎」状态，列表第一位即默认
- 解析链：`input.engine` 显式指定时钉死该引擎（未配置→顺位回落至该引擎起截取链中第一个已配置引擎，不回落到排位更前的引擎——尊重显式指定的位置意图；请求失败不静默换引擎，报错让模型自行决策）；未指定时按顺序取第一个已配置引擎
- 运行时串行降级：选定的引擎请求失败（认证失效/超时/限流/网络错误等任何错误类型）→ 按顺序尝试下一个已配置引擎，直到成功或全链失败
- 全链失败时返回聚合错误：每个失败引擎一行摘要（引擎名 + 错误摘要），不泄漏 key 明文
- 串行链总预算 120s（各引擎自身超时照旧；总预算耗尽即带已收集的错误返回，防最坏 3 分钟挂死对话）
- 成功输出附尝试轨迹（如「bocha 失败(401) → tavily 成功」一行），便于调试与观察

### R2 搜索配置（修订轮：改名 + 两级结构 + 排序优先级）

- 入口与标题改名：「AI 搜索」→「搜索配置」（双端：桌面设置 AI 组、移动「我的 → 配置」）
- 两级结构（参考服务商配置模式，双端同构）：
  - **引擎列表页**：每行 = 引擎名 + 配置状态（已配置/未配置，口径：key 引擎 = 有 key；searxng = 有 baseUrl）；列表显示顺序即串行链优先级；行上「更多菜单」提供**上移/下移**（首位引擎「上移」置灰、末位「下移」置灰；移动端底部弹菜单、桌面端同形态菜单）
  - **引擎详情页**：点击行进入该引擎独立配置表单——bocha/tavily/brave 为 API key 表单（密码框、留空不改、清除入口），searxng 为 baseUrl 表单（空串保存即清除）；不再有默认引擎选择器（优先级由列表顺序表达）
- 存储：key 经 SKSP（ref `search/{engineId}/apiKey`）；引擎顺序与 baseUrl 存偏好（KKV nm-search：engineOrder、searxngBaseUrl；原 defaultEngine 键移除——功能未发布无存量数据）；不新增数据库表

### R3 curl 输出预算调整与超预算落盘

- inline 输出预算从 256KB 降为 50KB（与 read/grep 共用 `TOOL_OUTPUT_MAX_BYTES` 口径）
- 超预算时：响应全文自动写入**当前会话工作区** VFS `/tmp/` 目录（目录不存在则创建；子代理场景落父会话工作区），工具结果返回 `{savedPath, message}`（含文件路径与说明），不返回正文
- 未超预算时照常返回正文；10MB content-length 预检与非文本占位路径维持现状
- 落盘配套与 write 工具对齐：file_cache upsert、目录规则补齐

### R4 search 超预算落盘（同机制复用）

- search 结果超过 50KB 时走与 curl 相同的落盘机制（正常结果约 15KB 封顶，此项为保险丝）

### R5 read 截断口径简化

- 移除 2000 行 / 单行 2000 字符作为截断保护层，50KB 字节预算成为唯一硬帽
- 分页续读保留，坐标维持行号（不新增字节偏移——超长单行属非常规文件，不为其增加工具复杂度）
- 超长单行文件（如压缩 HTML）读到预算内前缀即止，尾部不保证可续读（known limitation）
- 对正常多行文本/代码文件行为几乎无变化（原字节帽本就先于行帽触发）

### R6 工具注册配套同步

- `BUILTIN_TOOL_CATALOG` 增加条目；双端 AgentEditor 工具策略 hint 文案更新（内置工具数 10 → 11，含 search）；移动端文案计数测试同步
- curl 的 description、formatter、summary、catalog 四处口径保持一致

## 验收标准

### search 工具

- Given 用户已配置 bocha key，When 在对话中让 AI 检索，Then 模型调用 search 返回结果列表（title/url/snippet），回答引用来源
- Given 用户配置 searxng baseUrl（自托管实例），When 调用 search，Then 经该实例返回结果，全程无 key
- Given 用户未配置任何引擎，When 调用 search，Then 返回未配置提示与配置指引，无异常
- Given 某引擎 key 无效，When 未显式指定引擎且存在后续已配置引擎，Then 串行降级至下一引擎（见串行请求链节）；Given 显式以该引擎调用，Then 返回可读的错误信息（不泄漏 key 明文）

### 配置界面（修订轮）

- Given 双端任一端，When 打开搜索配置入口（桌面「设置 → AI → 搜索配置」/ 移动「我的 → 配置 → 搜索配置」），Then 见引擎列表页（行 = 名称 + 状态），点击行进入该引擎详情页可完成 key/baseUrl 填写保存，双端配置互通（同一存储）
- Given 列表页，When 打开某行更多菜单点「上移」，Then 该引擎上移一位且串行链优先级同步；首位引擎的「上移」不可用、末位的「下移」不可用
- Given 详情页，When 保存，Then 无默认引擎控件（优先级仅由列表顺序表达）

### 串行请求链（修订轮）

- Given 已配置 bocha（key 失效 401）与 tavily（正常），顺序 bocha→tavily，When 调用 search，Then 返回 tavily 结果且输出含尝试轨迹（bocha 失败 → tavily 成功）
- Given 仅 bocha 已配置但 key 失效，When 调用 search，Then 返回聚合错误（含 bocha 失败摘要），不静默空结果
- Given 显式指定 engine=bocha 且失败，When 调用，Then 直接报错不换引擎（模型可自行决策重试）
- Given 多个引擎均挂起，When 链耗时达 120s 总预算，Then 带已收集的错误返回，不继续等待

### curl 落盘与预算

- Given 响应体 30KB，When curl，Then 照常返回正文（未触预算）
- Given 响应体超过 50KB，When curl，Then 工具结果含 {savedPath, message}（正文已落盘、不随结果返回）；会话工作区 `/tmp/` 下存在全文文件；随后 read 该文件可分页读出内容
- Given 子代理内触发超预算 curl，When 落盘，Then 文件位于父会话工作区 `/tmp/`，主代理可 read
- Given 响应 content-length 超过 10MB，When curl，Then 维持不下载的占位行为（现状不变）

### read 简化

- Given 单行 300KB 的压缩 HTML 落盘文件，When read，Then 返回预算内的内容前缀（不再截为 2000 字符；尾部续读不保证，属 known limitation）
- Given 普通多行代码文件（<50KB），When read，Then 输出与现行行为一致（全文）

### 配套

- Given 任一端打开 AgentEditor 工具策略，When 查看默认模式提示，Then 文案列出的内置工具数与名单含 search
- Given 存量 agent 配置了 tools.allow 名单（不含 search），When 运行，Then 该 agent 不见 search 工具（运行时过滤逐字生效，属预期行为）

## 约束与依赖

- 凭证一律经 SKSP 存储，明文 key 不得出现在日志、错误信息或工具输出中
- 不动 llm_provider 表（protocol CHECK 约束限制），不新增数据库表；如实现中确需 schema 变更须回用户重新确认
- curl 预算 256KB → 50KB 属已发布行为变更，需记入 CHANGELOG（Unreleased）
- 落盘文件出现在双端文件树中（VFS 树无过滤），属预期可见行为；生命周期随会话（会话删除即消失）

## 风险与待确认项

- **存量 allow 名单静默**：配了 allow 名单的 agent 不会自动获得 search（现状惯例，无提示机制）；本期不加迁移或提示，如需可后续迭代
- **搜索结果展示有限**：工具卡仅 summary 一行（约 120 字符），用户看不到完整检索列表——列不包含范围，观察反馈后再议
- **bocha/tavily/brave 计费**：付费引擎按次计费，模型自主调用会消耗配额；依赖「未配置即不可用」控制意外开销，暂不做调用频率限制
- **searxng 公共实例**：不内置任何公共实例地址（限流不稳），仅支持用户自填
