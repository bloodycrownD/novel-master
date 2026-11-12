/**
 * 六份出厂搜索模板（SPEC web-search-curl Step 1 常量，v2 透传形态）：bocha /
 * tavily / brave / searxng / deepseek / zhipu。请求形状（端点 / method / 鉴权头 /
 * 默认 body 字段）由 T-P 快照测试锁定，改动即行为变更。
 *
 * 口径（SPEC §3 + v2 §4）：
 * - 响应侧零映射配置（resultPath/fieldMap/answerPath/envelope 已废除）：执行器
 *   递归提取最长对象数组，JSON 文本回流；bocha 的业务码信封一并删除，其
 *   「HTTP 200 + body code 401」失败由「找不到数组」判据自然接住降级；
 * - 四份 POST 模板统一带 `Content-Type: application/json` 与 `Accept: application/json`
 *   （fetch 对 string body 缺省补 text/plain，JSON API 会拒收）；defaultBody 是
 *   **默认值**而非必填——agent 经 params 覆盖（同名浅合并）、部分传参补默认、
 *   全不传走纯默认；
 * - body 内 `{{count}}` 只以整值字符串出现（执行器结构化替换为 number，保住 integer 字段）；
 * - searxng 用 `{{baseUrl}}` 引用用户填写的实例地址，URL 不含 count（该引擎无此参数，
 *   响应数组全量透传，由 agent 自行取用），也不传 language（保留自托管实例偏好，
 *   需要时经 params 传）；
 * - 出厂模板只是初值：预设覆盖（presetOverrides）浅合并、嵌套对象整体替换。
 *
 * DUCKDUCKGO_ENGINE_META 是 DDG 的展示常量（无模板，HTML 解析适配器兜底），
 * 描述快照与设置页共用其 name / paramHint。
 *
 * @module domain/tool/builtin/search/preset-templates
 */

import type { SearchEngineTemplate } from "./types.js";

/** 出厂预置模板（键即引擎 id；对象顺序即出厂序，DDG 另在 meta 中、恒排其后）。 */
export const PRESET_ENGINE_TEMPLATES = {
  bocha: {
    name: "博查搜索",
    method: "POST",
    url: "https://api.bochaai.com/v1/web-search",
    headers: { Authorization: "Bearer {{apiKey}}", "Content-Type": "application/json", Accept: "application/json" },
    defaultBody: '{"query":"{{query}}","count":"{{count}}","summary":true}',
    paramHint: "博查：可经 params 透传 count（1..50）、freshness（noLimit/oneDay/oneWeek/oneMonth/oneYear）或日期区间（如 2024-01-01..2024-12-31）、summary 等原生字段；同名参数覆盖默认 body，未知字段由引擎忽略。",
  },
  tavily: {
    name: "Tavily 搜索",
    method: "POST",
    url: "https://api.tavily.com/search",
    headers: { Authorization: "Bearer {{apiKey}}", "Content-Type": "application/json", Accept: "application/json" },
    defaultBody: '{"query":"{{query}}","search_depth":"basic","max_results":"{{count}}","include_answer":"basic","include_raw_content":false}',
    paramHint: "Tavily：可经 params 透传 max_results（1..20）、search_depth（basic/advanced）、time_range（day/week/month/year）、include_domains/exclude_domains、include_answer 等原生字段；同名参数覆盖默认 body，未知字段由引擎忽略。",
  },
  brave: {
    name: "Brave 搜索",
    method: "GET",
    url: "https://api.search.brave.com/res/v1/web/search?q={{query}}&count={{count}}",
    headers: { "X-Subscription-Token": "{{apiKey}}", Accept: "application/json" },
    paramHint: "Brave：可经 params 透传 count（1..20）、freshness（pd/pw/pm/py）、safesearch（off/moderate/strict）、extra_snippets 等查询参数；同名参数覆盖 URL 查询串默认值，未知字段由引擎忽略。",
  },
  searxng: {
    name: "SearXNG",
    method: "GET",
    url: "{{baseUrl}}/search?q={{query}}&format=json",
    headers: { Accept: "application/json" },
    paramHint: "SearXNG：需先在设置中填写实例地址（baseUrl）；可经 params 透传 language、time_range、safesearch、categories 等实例支持参数；同名参数覆盖 URL 查询串，未知字段由引擎忽略。",
  },
  deepseek: {
    name: "DeepSeek 搜索",
    method: "POST",
    url: "https://api.deepseek.com/v1/tools/search",
    headers: { Authorization: "Bearer {{apiKey}}", "Content-Type": "application/json", Accept: "application/json" },
    defaultBody: '{"query":"{{query}}","count":"{{count}}"}',
    paramHint: "DeepSeek：query 支持 site:/ -site:/ 「短语」 / lang:/ after:/ before: 检索语法；可经 params 透传 count、need_content、ori_question、localization 等原生字段；同名参数覆盖默认 body，未知字段由引擎忽略。",
  },
  zhipu: {
    name: "智谱搜索",
    method: "POST",
    url: "https://open.bigmodel.cn/api/paas/v4/web_search",
    headers: { Authorization: "Bearer {{apiKey}}", "Content-Type": "application/json", Accept: "application/json" },
    defaultBody: '{"search_query":"{{query}}","search_engine":"search_std","search_intent":false,"count":"{{count}}"}',
    paramHint: "智谱：可经 params 覆盖 count（1..50）、search_engine（search_std/search_pro 等）、search_intent、content_size、search_domain_filter、search_recency_filter、request_id 等原生字段；同名参数覆盖默认 body，未知字段由引擎忽略。",
  },
} as const satisfies Record<string, SearchEngineTemplate>;

/** DDG 出厂展示常量（无模板；描述快照与设置页共用 name / paramHint）。 */
export const DUCKDUCKGO_ENGINE_META = {
  name: "DuckDuckGo",
  paramHint: "DuckDuckGo：免费、无需 API key；忽略 params 透传；不支持 site: 等高级检索语法。",
} as const satisfies Pick<SearchEngineTemplate, "name" | "paramHint">;
