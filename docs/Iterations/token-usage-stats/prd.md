---
date: 2026-08-23
dependency: [Iterations/token-usage-persistence-and-rollback-refresh/prd.md, Iterations/model-aware-token-counting/prd.md]
---

# Token 用量数据统计页 PRD

> **边界**：本文件为产品需求（PRD），不含接口设计、库表结构、任务拆分等 spec 内容。
> **关联**：`token-usage-persistence-and-rollback-refresh`（usage 落库的地基，其「不包含范围」预留的「计费/统计报表另开迭代」即本需求）、`model-aware-token-counting`（token 计数口径）。

## 背景

`token-usage-persistence-and-rollback-refresh` 迭代后，每次模型调用的结构化 usage（`promptTokens`/`completionTokens`/`totalTokens`）已随 assistant 消息落库到 `chat_message` 表，但**没有任何读取出口**——用户看不到自己花了多少 token。

同时，LLM 供应商的 prompt cache 命中数据（Anthropic 的 `cache_read_input_tokens`、OpenAI 兼容渠道的 `prompt_tokens_details.cached_tokens`、Gemini 的 `cachedContentTokenCount`）在解析层（`usage-parser.ts`）就被丢弃，从未落库。用户无从得知缓存命中率——这直接影响长会话的实际开销。

本需求在「我的 → 配置」（Mobile）与「设置 → 数据」（Desktop）下新增**数据统计页**，按天/小时展示 token 用量与缓存命中率。

**统计口径（已拍板）**：

- 统计的是 **API 维度**：每条带 usage 的 assistant 消息行 = 一次模型调用（含工具循环的每个 step、含 task 子代理的调用——它们都落库）。
- `hidden` 消息**计入**统计（隐藏不等于没花钱）。
- usage 为 NULL 的行（abort 且未收到 usage）计为**缺失**，不参与求和，也不伪造 0。
- 缓存命中率 = 缓存命中的输入 token ÷ 全部输入 token（计费口径；各家协议字段语义差异由实现层归一，spec 处理）。
- 时间聚合按**本地时区**划分天/小时边界。
- 模型标识以**请求侧**为准（发起调用时配置的 provider 与模型），响应体字段仅用于历史回填——Anthropic 流式响应会丢 `model` 字段，不能作为采集来源。

## 目标（含成功指标）

1. 用户能在一个页面看到自己的历史 token 用量趋势（按天/小时）与缓存命中率。
2. 数字与数据库实际落库的 usage 一致：页面展示的总量 = `chat_message` 全部 assistant 行 usage 之和（含 hidden、含子代理）。
3. 新产生的模型调用开始积累缓存命中数据，命中率可追溯。
4. 成功指标：统计页可正确展示 `token-usage-persistence` 迭代之后产生的全部用量；命中率数据自本迭代上线起开始积累。

## 用户与场景

| 场景 | 描述 |
|------|------|
| 查看用量趋势 | 用户想知道最近一段时间（今天/本周/本月）用了多少 token，输入输出各占多少 |
| 排查开销异常 | 用户感觉某天 token 消耗异常，按小时钻取定位是哪段时间的会话烧的 |
| 关注缓存效率 | 长会话用户想确认 prompt cache 是否有效命中，命中率低说明每次都在全价重算输入 |
| 空数据冷启动 | 新用户或旧库用户打开统计页，看到友好的空态说明而非空白或报错 |

## 范围

### 包含范围

- Mobile「我的 → 配置」新增「数据统计」入口与页面（stack 路由）
- Desktop 设置「数据」分组（现 `dataManagement` 所在组）新增「数据统计」视图
- 筛选器：时间范围（近 7/30 天 + 自定义日期区间）与模型筛选（全部/指定模型）
- 用量总览（范围内：输入、输出、总 token、调用次数、命中率；另含今日卡片）
- 按天用量图表（输入/输出区分）与每日明细数值
- 按小时钻取（选中某天查看 24 小时分布）
- 分模型汇总（各模型用量、调用次数、命中率、占比；含「未记录」桶）
- 缓存命中数据采集：扩展 usage 解析与落库（新列），新消息起生效
- 模型调用信息采集：assistant 消息落库 provider 与模型标识（请求侧来源），新消息起生效
- 历史数据从 `raw_json` 尽力回填（cache 列与模型名；OpenAI/Gemini 可行，Anthropic 流式有已知缺口，见风险）
- 空态与数据缺失提示（无任何 usage 数据、命中率无数据等场景）

### 不包含范围

- **按服务商（渠道）分组统计**：模型维度已覆盖主要诉求，且同一模型可配多渠道，口径复杂，如有需要另开迭代
- **费用（金额）统计**：无价格表基础设施，另开迭代
- 跨设备/云端聚合（统计仅基于本地库）
- ephemeral（事件触发 agent）会话的用量（当前主树无此流量，预留能力）
- 统计页实时刷新（进入页面/手动刷新时查询即可）

## 核心需求

### 1. 统计入口（双端）

- Mobile：`ProfileTabScreen` 配置分组新增「数据统计」菜单项，点击进入新 stack 页面（路由注册遵循现有模式）。
- Desktop：设置 overlay 的「数据」分组新增「数据统计」导航项与对应视图（容器结构参照 `AboutView`）。

### 2. 筛选器（时间范围 / 自定义区间 / 模型）

- 时间范围：近 7 天 / 近 30 天 / 自定义（起止日期选择器，含边界），影响图表与汇总；自定义区间上限 366 天（避免超长区间查询变慢）
- 模型筛选：默认「全部模型」，可选具体模型；模型选项列表与服务商配置的模型列表同源（当前已保存模型，不从历史记录 distinct）；另有「**其他模型**」选项 = 未记录（model_name 为空）与不属于当前配置的历史模型名的归并桶（模糊可接受）
- 筛选条件组合生效（时间 × 模型）；总览、图表、分模型汇总均跟随当前筛选

### 3. 用量总览（汇总页签）

页面采用「汇总 / 明细」双页签，筛选栏（时间范围 + 模型）置顶共享：

- **汇总页签**：范围内总 token、输入、输出、调用次数、命中率五指标卡片 + 今日卡片（不受时间筛选影响，始终为今日），独占页签布局放宽
- **明细页签**：按天图表、按小时钻取、分模型列表；不提供命中率图表模式与分模型命中率列（命中率出口在汇总卡片与选中天汇总行）
- 数字使用现有格式化能力（K/M 压缩，复用 `formatTokenCount` 口径）

### 4. 按天用量视图

- 柱状图展示筛选时间内每天的输入与输出 token（堆叠）
- 支持查看某一天的明细数值
- 无数据的天显示为 0（区别于「无数据时期」——`token-usage-persistence` 迭代之前的历史天然无 usage，页面以空态/提示区分，不显示为 0）

### 5. 分模型汇总

- 汇总列表（汇总页签）：当前配置模型各一行；未记录与非当前配置的历史模型归并为「其他」行（用量/调用次数/总量占比，不提供命中率列）
- 无法回填模型信息的历史数据归入「未记录」行，保证总量对得上（不静默丢弃）

### 6. 按小时钻取

- 选中某一天后，可切换查看该天 24 小时的用量分布
- 小时边界按本地时区

### 7. 数据采集落库（缓存命中 + 模型调用信息）

- **cache 采集**：usage 解析层读取各协议的 cache 字段（OpenAI `prompt_tokens_details.cached_tokens`、Anthropic `cache_read_input_tokens`/`cache_creation_input_tokens`、Gemini `cachedContentTokenCount`），随消息落库（新增列，老库升级沿用既有 ALTER 机制）
- **模型信息采集**：assistant 消息落库时写入本次调用的 provider 与模型标识（`chat_message.provider` 列已存在但当前恒 NULL，本迭代开始写入；模型标识新增列），来源为请求侧配置，不依赖响应体
- **存储口径**：只存原始桶（缓存命中 token、缓存写入 token、provider、模型标识），比率与占比一律在展示层计算
- **cache 回填**：对历史消息从 `raw_json` 尽力回填 cache 列（一次性迁移）；无法回填的保持缺失，不计入命中率分母
- **模型信息回填**：历史消息从 `raw_json` 提取模型名（OpenAI `model`、Gemini `modelVersion`、Anthropic 非流式 `model`）；无法回填的（Anthropic 流式）在分模型统计中归入「未记录」
- 命中率无数据的时段/整体，显示「暂无数据」而非 0%

### 8. 空态与缺失提示

- 无任何 usage 数据（新用户/旧库）：展示说明文案（token 用量自某版本起开始记录）
- 命中率数据缺失（迭代上线前的消息）：明确提示「缓存数据自本版本起记录」

## 验收标准

### AC-1：双端入口可达

- **Given** Mobile 已安装新版
- **When** 进入「我的」→ 配置分组
- **Then** 存在「数据统计」入口，点击进入统计页
- **And** Desktop 设置 →「数据」分组同样存在「数据统计」项，点击展示统计视图

### AC-2：总览数字与库内数据一致

- **Given** 库中 `chat_message` 有若干 assistant 行，其中含 hidden 行、含子代理会话（`parent_session_id` 非空）的行、含 usage 为 NULL 的行
- **When** 打开统计页查看总览
- **Then** 总 token / 输入 / 输出 / 调用次数 = 全部非 NULL usage 行的对应求和（hidden 与子代理计入，NULL 行不计）

### AC-3：按天聚合按本地时区切界

- **Given** 一条消息的 `created_at_ms` 对应本地时间 2026-08-23 00:30（UTC 前一天 16:30）
- **When** 查看按天统计
- **Then** 该消息计入本地 2026-08-23，不计入 UTC 的前一天

### AC-4：按天/小时视图交互

- **Given** 近 7 天内至少 3 天有用量
- **When** 切换 7/30 天视图、并选中其中一天
- **Then** 图表正确切换粒度；选中天可查看按小时的分布（24 桶，本地时区）

### AC-5：新消息落库 cache 字段

- **Given** 新版下发起一次 OpenAI 兼容渠道的对话（响应含 `cached_tokens > 0`）
- **When** run 结束后查看该 assistant 消息
- **Then** cache 相关新列记录了命中的缓存 token 值（与响应一致）

### AC-6：命中率口径与展示

- **Given** 某天全部调用：输入 token 合计 100000，其中缓存命中合计 80000
- **When** 查看该天命中率
- **Then** 显示 80%（sum 命中 ÷ sum 全部输入，展示层计算）
- **And** 无 cache 数据的时期显示「暂无数据」，不显示 0%

### AC-7：历史回填尽力而为

- **Given** 历史消息的 `raw_json` 中保留了完整 usage（OpenAI 非流式/流式 final chunk、Gemini 响应）
- **When** 执行一次性回填迁移
- **Then** 这些消息的 cache 列被填充
- **And** `raw_json` 为占位对象（abort）或 usage 缺失的消息保持缺失，不报错

### AC-8：空态

- **Given** 全新用户（无任何带 usage 的消息）
- **When** 打开统计页
- **Then** 展示友好的空态说明（token 用量自某版本起开始记录），不展示空白页或报错

### AC-9：新消息落库 provider 与模型标识

- **Given** 新版下发起一次对话（请求侧配置了 provider 与模型）
- **When** run 结束后查看该 assistant 消息
- **Then** provider 列与模型标识列记录了本次调用的 provider 与模型（来自请求侧，即使响应体不含 model 字段也应有值）

### AC-10：模型信息回填与「未记录」桶

- **Given** 历史消息的 `raw_json` 含模型名（OpenAI/Gemini/Anthropic 非流式）
- **When** 执行一次性回填迁移
- **Then** 这些消息的模型标识列被填充
- **And** 无法回填的消息在分模型汇总中归入「未记录」，其用量计入总量

### AC-11：自定义日期区间与模型筛选

- **Given** 库中有 8 月 1 日至 31 日的用量，涉及模型 A 与模型 B
- **When** 筛选自定义区间 8-10 至 8-20、模型选 A
- **Then** 总览、图表、分模型汇总均只反映该区间内模型 A 的数据
- **And** 模型选项列表与服务商配置同源（当前已保存模型），含「其他模型」（未记录 + 非当前配置历史模型归并）

## 风险与待确认项

| 风险 | 说明 | 处置 |
|------|------|------|
| Anthropic 流式历史 raw 缺口 | `anthropic-sse-parser` 的 `streamRaw` 是覆盖式，只保留最后一个事件；`message_start` 里的 `input_tokens`/`cache_read_input_tokens`/`model` 可能被 `message_delta` 覆盖丢失，导致 Anthropic 流式历史消息无法回填 cache 与模型名 | 历史回填保持缺失：cache 不计入分母、模型归「未记录」（历史 raw 已被覆盖，无法恢复）；spec 阶段已验证并纳入本迭代（采集侧小改，双槽合并修复），新消息起不再产生该缺口 |
| Anthropic 流式新消息的 cache 采集 | 同上结构问题也影响**新消息**：若 final `message_delta` 不带 cache 字段，新落库的 cache 列也可能缺失 | spec 阶段已验证并纳入本迭代（采集侧小改，双槽合并修复：`message_start` 与 `message_delta` 双槽合并，不动统计口径） |
| abort 消息 usage 缺失 | 中断的调用可能已产生部分 token 但拿不到 usage，统计偏少 | 接受缺失，页面上不特殊处理（占比预期很小） |
| 旧库无 usage | `token-usage-persistence` 迭代之前的历史消息无 usage | 空态提示覆盖，不回算 |
| 命中率分母的协议差异 | OpenAI/Gemini 的 prompt token 含 cached，Anthropic 不含 | 实现层归一为「全部输入（计费口径）」，spec 定义各协议映射；存储只存原始桶 |
