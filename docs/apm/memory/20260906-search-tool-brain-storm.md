---
date: 2026-11-12 01:05
title: pi-web-access 原理探索与 novel-master 搜索工具落点
keywords: pi-web-access, web search, 搜索工具, 搜索引擎 API, tavily, brave, bocha, searxng, duckduckgo, DDG 兜底, SKSP, 工具系统, 搜索协议, curl 截断, VFS 落盘, 输出预算, 50KB, curl 模板, 自定义引擎, HTTP 请求模板, 响应字段映射, DeepSeek search, 智谱 web_search, 引擎开关, params 透传, 工具描述动态化, web-search-curl
abstract: 搜索工具全程记忆：brainstorm（搜索 API 无通用协议，内置适配器+设 key 为行业做法）→ PRD/spec（四引擎+SKSP/KKV+50KB 统一预算+超预算落 VFS /tmp）→ 开发与两轮 CR 修复合入 main → 修订轮两级配置 UI+串行降级链 → DDG HTML 抓取兜底内置（含用户 DDG 背景问答）→ 后续轮次：curl 模板化二期（用户反转旧「不做请求模板」拍板——任意搜索 API=curl 形态 HTTP 请求+响应映射，配置页模板化+工具 params 透传+引擎开关，全收编老四家适配器，PRD 落盘 docs/Iterations/web-search-curl/prd.md 待确认）。
---

user:
@.reference/pi-web-access/ 使用 brainstorm，探索这个插件的原理，我现在想给 novel-master 也增加一个搜索工具，并希望能够支持手动配置搜索引擎 API。

assistant:
派了 3 个 scout 并行探索（插件核心架构 / 配置凭证系统 / novel-master 工具系统落点），抽查复核后结论如下：

pi-web-access 原理分四层：①工具层 index.ts 用 `export default function (pi: ExtensionAPI)` 入口 + `pi.registerTool` 注册 4 个工具（web_search/fetch_content/get_search_content/source_check），execute 返回 content（给模型）+ details（给 UI）；②provider 层每个引擎一个文件，统一契约 `isXAvailable() + searchWithX(query, options)`，类型三接口 SearchResult{title,url,snippet}/SearchResponse{answer,results,inlineContent}/SearchOptions{numResults,recencyFilter,domainFilter,signal} 定义在 perplexity.ts；③路由层 gemini-search.ts 维护 29 个 provider 注册表，auto 模式硬编码顺序链逐个试可用性，手动 searchRouting 按 fallbackOn 错误分类（11 种 kind）决定是否继续；④配置层单文件 ~/.pi/web-search.json 多模块各取所需，credential-source.ts 惰性解析凭证（$ENV/${ENV}/!command 命令、$$/$! 转义，请求时才解析、redact 脱敏），baseUrl 必须 https、跨域重定向剥凭证头。搜索结果只回 answer+来源列表+responseId，全文存本地缓存（1h TTL/128条/128MB），get_search_content 按 offset/limit 分页取，maxInlineContentChars 默认 30000 截断防撑爆上下文。

novel-master 落点：工具链路完全有 curl-tool 先例（zod schema/超时/UTF-8 字节截断/错误映射），新增搜索工具动 core 7 处（search-tool.ts、register-builtin-tools、format-tool-output 专属 formatter、build-tool-result-block summary、agent-tool-catalog、builtin-tool-context 闭包、run-agent-turn 装配）+ 三端工具名帮助文案 + 设置页。配置不走 llm_provider 表（protocol CHECK 约束 + 要 bump SCHEMA_BOOT_VERSION 的坑），推荐 SKSP 存 key（ref 如 search/{engineId}/apiKey）+ KKV preferences 存引擎元数据（baseUrl/选中引擎），双端 runtime 都已有 secretStore/preferences。mobile 端注意：pi-web-access 的 !command 凭证解析（exec 子进程）在 RN 沙盒不可用，要换成应用内等价物；聊天 UI 通用卡片零改动。关键取舍待用户拍板：接哪几个引擎（tavily 最省事：原生 answer+domain filter 全；brave 也简单；searxng 适合自托管）、是否要 fallback 链还是单选引擎、搜索结果要不要全文抓取。

user:
我觉得我们主要借鉴这个插件的如何集成搜索引擎，因为 novel-master 是原生支持不是插件，没它那么 hack。我想了解搜索引擎 API 有通用协议吗（类似 openai 这样的 llm 协议）？否则如何实现配置搜索引擎？还是说只能提供一些常用的付费引擎？

assistant:
定点验证 search1api/serper/openai-search 后确认：搜索引擎 API 没有通用协议。各家 REST 自定义（端点、认证头、参数名、响应字段全不同：brave 用 X-Subscription-Token+GET，tavily Bearer+POST，serper X-API-KEY+body{q,num,tbs}，searxng 无 key GET JSON，duckduckgo 抓 HTML），光认证方式就有四种。LLM 领域有 openai 协议是因为生态主动兼容，搜索领域卖的是数据本身、无收敛动力。接近「通用」的三个方向：SearXNG（自托管聚合器，一套自有 JSON API 聚合 70+ 引擎）、聚合网关（search1api 等，但格式还是各家自定义）、MCP（统一工具调用不统一搜索格式，novel-master 用不上）。实现方式就是行业通行做法：内置 N 个常用引擎适配器（每个 150~250 行，抽象面窄：query→[{title,url,snippet}]）+ 用户选引擎填 key。novel-master 原生支持可砍掉插件的 fallback 链/!command 凭证解析/29 个 provider，建议内置 3~5 个：bocha（中文最佳）、tavily/brave（国际主流）、searxng（自托管免费）；手动配置=设置页选引擎+填 key 存 SKSP；不做「任意引擎通用接入」（无协议可依赖，等于让用户填请求模板，体验差）。

user:
这里都是外国服务商，中国内部的阿里云、百度、腾讯、字节、智谱等互联网企业的 API 都没有。另外我突然想到之前 curl 工具没有做文字截断，有可能出现爆上下文的情况，需要加截断，同时增加 output 参数允许将内容落文件方便之后查看；这个原则给 search 工具也通用。

assistant:
派两个 scout 分别核实（curl 截断现状+VFS 落盘落点；国内搜索 API 格局+网络探测文档站），抽查复核后结论：

国内格局：pi-web-access 里国内引擎有 bocha（博查，唯一「中国+独立 REST」完整证据：POST api.bochaai.com/v1/web-search，Bearer，body {query,count,freshness,summary}，结果在 data.webPages.value[]，现成适配器可抄）、kimi（绑 Kimi Code Plan 订阅登录态，非独立 key，不适合通用后端）、search1api/anysearch/xcrawl（聚合/代理服务，归属未确认）。国内大厂搜索能力基本不独立卖 REST，都封装成自家 LLM 平台工具：智谱联网搜索挂在 GLM 对话 API 的 tool_calls 上（文档页 tool_calls 出现 202 次，另有 MCP broker 端点，独立按次计费但 wire 走 LLM 协议）、百度千帆搜索插件、阿里百炼、火山联网搜索。推荐引擎组合：bocha + 智谱（用户已有智谱 key，接入成本最低）+ tavily/brave + searxng（可聚合百度/搜狗中文引擎）。

curl 截断澄清：curl 实有三层防护（CURL_MAX_BODY_BYTES=256KB 字节预算首段截断+10MB content-length 预检不下载+非文本占位，curl-tool.ts:52/55），用户误记为「没截断」；但两个真实痛点成立：256KB 折算 token 仍能吃掉半个上下文；首段截断后模型无法取回后文（无 nextOffset 续读）。output 落盘方案：BuiltinToolContext.vfs 是必填字段（builtin-tool-context.ts:145），curl 现有 ctx 就能写 VFS，零新增依赖。方案骨架：output?: string（工作区相对路径）→ 全文 ctx.vfs.write → 返回 savedPath+小预览（建议 8~16KB 另设预算）+read 续读提示；照抄 write 工具配套（file_cache upsert+ensureDirRulesForNewPath）；边界：10MB 预检路径不下载 body（需决定是否放宽）、非文本不落盘（VFS 文本型）；命名：ToolRunner path policy 只认 path/filePath/from/to，output 不被校验。改动面：curl-tool.ts（schema+execute）、format-tool-output、build-tool-result-block、测试（curl 测试 ctx mock 现只有 fetchFn 需补 vfs）。待拍板：显式 output 参数 vs 超预算自动落盘 vs 折中；引擎名单；是否进 prd。

user:
引擎名单移除智谱，博查你的建议可以。自托管 SearXNG 我也想要，麻烦吗？什么原理？curl 落盘：超预算自动落盘，落盘位置 /tmp，目录不存在则创建，结果返回变成路径名与 msg。

assistant:
SearXNG 原理：元搜索引擎，自己不爬网不建索引，把查询并行转发给上游引擎（Google/Bing/DDG/百度/搜狗等，settings.yml 勾选）聚合去重后统一返回；JSON API 默认关闭需在 settings.yml 的 search.formats 加 json。部署就一行 docker + 改配置，可跑本地/NAS/VPS。对 novel-master 接入成本最低：无 key，GET {base}/search?q=...&format=json，照抄 searxng.ts；不硬编码公共实例（官方不建议，限流不稳），用户自填 baseUrl。

落盘 /tmp 验证出三个事实：① packages/core/src 全仓零 node:fs（环境无关设计），工具写宿主文件必须走注入（BuiltinToolContext 加可选 writeFile，desktop 主进程有 tmpdir 先例可注 node fs）；② apps/mobile 零 fs 类 native 依赖且 Android 无 /tmp（只有 cache 目录），手机落宿主文件要新增 native 模块，成本重；③ 宿主 /tmp 模型 read 读不回（read 是 VFS 域），超预算只返路径+msg 会让模型对内容全盲（再 curl 还是超预算，死锁）。给出两方案待用户选：A（推荐）落 VFS 隐藏目录（如 /curl-cache/），返回 {path,msg}+小预览（8KB），双端零新依赖+模型可 read 分页续读+app 内可看；B（尊重 /tmp）桌面落 /tmp/novel-master/ 注入 node fs，mobile 降级为截断预览或落 VFS，返回 {path,msg}+小预览（强烈建议保留预览防模型全盲）。超预算自动触发、目录不存在则创建、返回路径+msg 均照用户拍板。引擎名单定稿：bocha + tavily + brave + searxng（移除智谱；tavily/brave 可选保留）。

user:
我当然说的是 vfs 系统，不然呢？怎么和 read 工具结合使用，三端都读不了真实文件系统。

assistant:
理解纠正：用户说的 /tmp 是 VFS 逻辑路径（工作区根下 tmp 目录），不是宿主文件系统——上轮主代理误按宿主 fs 理解铺了 mobile native 依赖分析，用户设计本就自洽：落 VFS /tmp + 返回 {path,msg} + 模型用 read 分页续读，一点不盲，三端零新增依赖，相当于用自家 VFS 原生重写了 pi-web-access 的 responseId 二段式。方案定稿：① 搜索工具：bocha+tavily+brave+searxng，统一内部接口+每引擎适配器+SKSP key（search/{engineId}/apiKey）+KKV 元数据（searxng baseUrl），不动 llm_provider 表，搜索结果超长同样截断+落 VFS；② curl：超 256KB 全文自动落 VFS /tmp/（目录不存在则创建），返回 {path,msg}，未超预算照常，配套 file_cache upsert+目录规则，10MB 预检与非文本路径维持现状。PRD 阶段注意点：read 截断是 2000 行/单行 2000 字符口径，大 HTML 单行几十万字符会被单行截断读不全，需在 PRD 决定 read 字节偏移分页或接受限制。下一步：切 prd-generate。

user:
curl 超预算自动落 VFS /tmp？search 也是同理的，search 的返回结果是什么样子的？难道不会超预算？

assistant:
search 返回结构：{answer?（引擎摘要，几百字）, results: [{title, url, snippet}]}，默认 5 条最多 20 条；每条 200~700 字符，拉满 20 条+answer 约 15KB 封顶，离 256KB 预算线差十倍以上——纯搜索结果天然小，这也是 pi-web-access 搜索结果 inline、只全文抓取才落盘的原因。但为防异常（引擎超长 snippet/answer、count 拉满叠加）与将来 includeContent 全文抓取主路径，定稿补一条：search 与 curl 共用「超预算自动落 VFS /tmp + 返回 {path,msg}」公共机制，search 预算线建议 64KB（纯保险丝），具体在 PRD 定；将来加结果全文抓取时该机制升级为主路径（全文落 VFS、上下文只留 answer+标题列表+路径）。

user:
不是 256KB 作为上限？你疯了吧？一般最大也就 1M 上下文，少的可能就 128K，输出结果有个二三十 K 以内还算合理，更多就太大了。而且 read/grep 工具都没这么大的上限吧。

assistant:
用户纠正确认（代码验证）：read 是 2000 行+50KB 字节帽，grep 是 100 条+50KB 帽（tool-output-limits.ts 全工具共用），curl 的 256KB 是仓库离群值（5 倍），用户最初说「curl 没截断」的真实含义就是 256KB 形同虚设。修正定稿：预算线统一降为 read/grep 同量级——curl inline 预算废弃 256KB 改为 ~24KB（用户口径「二三十 K」，24KB 折算 6~12K token，128K 上下文模型占 5~9%）；search 保险丝同 24KB（正常结果 15KB 封顶几乎不触发）；超了全文落 VFS /tmp 返回 {path,msg}，read 续读受 50KB 帽约束口径一致；10MB 预检保留不动（网络/内存保护，与上下文体积无关）。curl/search/read/grep 四工具输出预算全在 24~50KB 同量级。具体数字 PRD 定死。

user:
24kb 大概多少汉字？20000 字？

assistant:
UTF-8 常用汉字 3 字节/字，24KB=24576÷3≈8192 汉字，不是 20000 字（那是按 1 字节算的 ASCII 思维）；20000 汉字≈60KB。参照：24KB≈8200 字（网文两三章，约 5~8K token），50KB≈17000 字（短篇报告），256KB≈87000 字（一本小书，故弃用）。

user:
那不如统一为 50KB 吧，更合理些。

assistant:
预算线终稿：四工具统一 50KB——curl inline 预算 50KB（超了全文落 VFS /tmp 返回 {path,msg}）、search 保险丝 50KB（正常 15KB 封顶纯防异常）、read/grep 维持 50KB 现状，直接复用现有常量 TOOL_OUTPUT_MAX_BYTES=50KB，一个口径管四工具（≈17000 汉字/次）。全部方案拍板完毕：bocha+tavily+brave+searxng、SKSP key+偏好元数据、超预算自动落 VFS /tmp、统一 50KB。待用户发令切 prd-generate。

user:
自动落 VFS /tmp/，你知道我说的是会话自己的 / 目录下，而不是全局区，你应该没理解错吧？

assistant:
确认无歧义：toolCtx 的 vfs 唯一来源是 runtime.sessionVfs(projectId, sessionId)（主 run L464 当前会话工作区；子 agent L695 落 parentSessionId 父会话工作区，代码注释即「VFS 工作区共享」），落盘写的 /tmp/ 是发起工具调用的会话自己的根下 tmp 目录，全局区不在链路上碰不到；临时产物生命周期随会话，会话删则缓存同灭，不在全局区留垃圾；子代理落盘落父会话工作区，主代理 read 可直接读。

user:
（切 prd-generate）read 既然有 50KB 的限制，「2000 行 / 单行 2000 字符」其实就没必要了。

assistant:
prd-generate 阶段：按 apm-usage 初始化（读 RULE.md + Iterations 目录惯例：大写 I、kebab-case、GWT 验收风格、fetch-tool→curl 三层产品口径全档可查），派 2 个 scout 补 PRD 视角素材（文档惯例/产品口径；双端设置与工具开关用户旅程），收获：落盘文件在双端 VFS 文件树自然可见（无过滤）；curl 256KB→50KB 是已发布行为变更需进 CHANGELOG；工具策略 hint 是硬编码文案且有测试锁。澄清轮用户拍板最后悬点：read 截断简化为 50KB 字节预算单一硬帽，移除 2000 行/单行 2000 字符保护层（冗余且单行截断是大 HTML 伤害源），分页保留、坐标支持字节偏移（单行大文件行号分页无效）。默认决策（用户默许）：目录名 web-search-tool、工具名 search、默认可用（未配置不扣费）、双端设置页 AI 搜索入口、不做测试连接按钮、工具卡展开不包含、grep 不动。PRD 已落盘 docs/Iterations/web-search-tool/prd.md（R1 search 工具四引擎/R2 手动配置 SKSP+KKV/R3 curl 50KB+落盘/R4 search 同机制/R5 read 简化/R6 配套同步，GWT 验收清单），待用户最终确认。

user:
坐标支持字节偏移？不需要，本来超长单行就不是合理文件，没必要增加工具复杂度。

assistant:
用户否决字节偏移：R5 修订为「50KB 单一硬帽 + 分页维持行号坐标（现状）」，超长单行读到预算内前缀即止、尾部不保证可续读（known limitation 写进 R5 与对应 GWT）。PRD 修订完毕，待用户最终确认。

user:
搜索引擎配置 UI 实现上，建议参考 agent 配置那种嵌套卡片或者服务商那种思路。生成 spec 吧。

assistant:
用户确认 PRD 并补充 UI 建议：搜索引擎配置参考 agent 配置的嵌套卡片或服务商配置的列表→详情→表单模式；切 spec-generate。spec 探索派 3 个 scout（配置存储 API 表面/四引擎字段映射/双端 UI 结构与测试锁），关键发现：① R2 正模板是 cloud-sync 先例（SKSP 固定 ref cloud-sync/s3-secret-key + KKV 模块 nm-cloud-sync，对外只回 keySet:boolean）；② AgentTurnRuntimePort 扩可选字段零 app 改动（三端 runtime 已带全量 secretStore/preferences，注释明说结构化兼容）；③ 桌面 tool-policy-picker.test.tsx 有 /10 计数断言是隐藏雷（共 5 个测试锁文件）；④ 适配器必须三处偏离参考实现（AbortSignal→AbortController+setTimeout RN/Hermes 兼容、剥 SSRF、凭证解析换 SKSP/KKV）；⑤ search 工具卡天然不可点击（白名单只 read/write/edit）、summary 走 JSON 兜底不加分支；⑥ AgentDefinitionEditorForm.tsx 是未挂载组件照旧同步。spec 已落盘 docs/Iterations/web-search-tool/spec.md（11 步：search-core 4 步/overflow-sink 2 步含 read 简化/desktop-ui/mobile-ui/测试锁同步/build-verify；拍板：answer 仅 tavily 原生、默认条数统一 5、searxng 不传 language、仅 searxng 可配 baseUrl），待用户确认。

user:
落盘文件名 /tmp/{tool}-{yyyyMMdd}-{随机4位}.{扩展名}。

assistant:
用户修正落盘文件名：日期粒度 yyyyMMdd + 随机 4 位，去掉时分秒；spec L49 已同步更新。随后切 spec-check-loop：首轮审查待派。

assistant:
spec-check-loop 共 2 轮：第 1 轮 No-Go（P0-1 桌面/CLI searchConfig 装配缺失与「零 app 端改动」假声明——preferences 先例成立是因三端 runtime 原有同名整字段，searchConfig 是新字段；P1 测试锁实为 8 处非 5 处；P1 searxng 无 key 致 keySet 恒 false，configured 语义须用 baseUrl 非空），worker doc-fix 24 处编辑全部闭合；第 2 轮 Go（装配可行性经代码核验），残留 P1-A mobile picker 实有 8 处断言（L137/141/177/199/206/232/258/269）非 2 处、P1-B curl catalog 四处口径、P2-A overflow-sink 改收 BuiltinToolContext——三条均 trivial 豁免由主代理直接闭合。现 execute-ready 待用户确认开工。（后续轮次：用户确认并触发 code-dev-loop，新建 worktree）

assistant:
code-dev-loop 启动：主 worktree 在 main 且 dev 分支不存在，先建 dev（基于 main HEAD b442d397）再切 web-search-tool 分支；迭代文档复制进 worktree 提交（85f67d6c）。worktree 独立 npm install + 重建 dist（tdbc-driver-better-sqlite3 + core + tokenizer-driver-node；tokenizer 首次 build 后 dist 空需重跑；desktop 测试 109 全绿需先建 sksp 三平台包 dist + desktop build 产物）。关键环境事实：**core 测试是 tsx --test（cd packages/core && npm test，勿用 npx jest）**。

assistant:
开发 DAG 十个 wave 全部闭合，dev-ready 达成（15 commit 在 web-search-tool 分支）：wave0-2 search 核心（Step1-4+core 测试锁，三 commit，41 新单测）；wave3-5 overflow-sink+curl 50KB+read 简化（Step5-7，两 commit+收尾）；wave6-8 双端 UI 并行（Step8/9 各三 commit，desktop 109 绿/mobile 回归集空/cr-func-ui func-ready，桌面收尾 commit 修 clearKey 互斥/掉选禁用态/失败回读+SegmentedControl 支持 disabled）；wave9 CHANGELOG Unreleased 两条（AI 联网搜索新增 + 工具输出超长落盘变更）。最终：core 1876/1876 全绿 + build OK，desktop typecheck 绿，mobile 官方 typecheck 基线干净。spec_deviations 全部文档化（落盘降级、末行无 nextOffset 边界、顺位回落、Accept-Encoding 省去、searxng answers 不透传）；三个 cr-func 均 func-ready。遗留 manual_user：T-D1/T-M1 双端配置页走查（含落盘文件文件树可见）；待用户示意后并入 dev。

assistant:
code-review-loop 两轮：scope×2 并行（core/ui）产出 10 条 must-fix（P1×2：desktop 清除/保存互斥半成品、引擎清单跨端 DRY 副本；P2×8：bocha 业务码错误未脱敏、UTF-8 切块代理对边界、desktop 校验时机/mobile 失败不回读/禁用样式缺失、超时文案/落盘降级/真实 VFS 集成三条测试缺口）+ review-full 复核（B-K 全维干净，唯一 open deviation：CLI 未装配行为 spec 写「未配置提示」实为「可读错误」→用户拍板方案 a 按 status quo 收窄，spec 已修订）；fix-spec 落盘 docs/Iterations/web-search-tool/cr-fix-spec.md（fix-spec-ready，commit dc9ac9f1）。切 code-dev-loop 执行修复：DAG = fix-core（B-1/B-2/C-1 core 部分/G-1..G-3）→verify→fix-desktop+fix-mobile 并行→verify→cr-func 对照 fix-spec 验收。

assistant:
修复 DAG 全部闭合：fix-core 3 commit（bocha 业务码脱敏、sliceUtf8BytePrefix 代理对块边界右移、ENGINE_IDS/KEY_ENGINE_IDS 导出、G-1..G-3 三条测试补齐）+ allowlist 快照补两个导出（1881/1881 全绿）；双端并行 fix（desktop 22a65d87：双向互斥/校验前置含 userinfo/禁用样式/删副本——renderer 走 shared/logic/search-engines.ts 薄再导出绕 X1 eslint 门禁循 root.ts 先例；mobile c3a98ec8：catch 回读+删副本改重导出，B-3 补 mock 测试 2 用例，踩坑：mobile jest 的 core-shim 映射需同步补新导出）。cr-func-fix 复核 10/10 闭合 func-ready，无新 must-fix。修复轮验证：core 1881 全绿、双端 typecheck/测试锁绿、dist 内容验证含新导出（tsc 增量 mtime 不变属正常）。累计 22 commit 待并入 dev；遗留：T-D1/T-M1 双端走查（manual_user）、desktop save() 自守卫 nit、存量 truncateToByteBudget 同款代理对模式挂起待拍板。注意：worker 自拼测试命令缺 --experimental-test-module-mocks 会假报 17 个存量失败，必须用官方 npm test 复核。

user: 真机测试前先拉主分支（main 更新很多），然后启动 metro 推到真机；版本不对时拍板「卸载或提版本号」。
assistant:
合并 main（51 提交：regex 全量移除 schema v11、body_params schema v12、移动端图表、工作区推送、v1.5.13/14 发版）→仅 CHANGELOG 冲突（Unreleased 段重放于 1.5.14 之上）其余 15 个重叠文件全 auto-merge；合后 npm install + #31 全套 dist 重建 + webview-dist，core 1903/1903 全绿、双端 typecheck/测试锁绿。真机部署路径要点：① adb 在 ~/Android/Sdk/platform-tools；② Gradle 要 JAVA_HOME=.sdkman 的 17.0.13-tem（系统默认 11）；③ 真机已装集成版 versionCode=1099（1.5.99-integration）而本地默认 versionCode=1 会被拒降级——build.gradle 留了 VERSION_CODE/VERSION_NAME 环境变量口子，export VERSION_CODE=1100 VERSION_NAME=1.5.14-websearch 即免改文件注入；④ 先起 metro 再 gradle 构建会竞态崩溃（metro watch 到 node_modules 里 gesture-handler android build 目录被构建过程删除，ENOENT 未捕获）——构建完再起 metro 稳，真机访问宿主 metro 需 adb reverse tcp:8081。现 metro 后台跑着（日志 /tmp/metro-web-search.log），真机 EBG-AN00 装好 v1.5.14-websearch，等用户双端走查。

user: 「AI 搜索」改名「搜索配置」，UI 改两级（列表→各引擎详情表单，参考服务商配置）；取消默认引擎概念，列表更多菜单上移/下移调序，顺序即优先级即串行链（A：未配置跳过 + B：失败串行重试下一个）。
assistant:
澄清明捕获四个口径：双端同改、配置页移除默认引擎控件、全错误类型都降级（全败聚合错误每引擎一行摘要）、显式 input.engine 钉死不静默换引擎、链总预算 120s（防最坏 60+60+30+30=180s 挂死）、成功输出附尝试轨迹。defaultEngine 未发布无存量迁移。PRD 已修订：R1.1 新增（优先级/串行链）、R2 重写（改名+两级结构+上移/下移菜单）、验收标准加配置界面/串行链两节。参考模式：mobile ProvidersScreen+BottomSheetMenu+ProviderDetailScreen、desktop providers→providerDetail 三级导航。待用户确认 PRD 后改 spec 再开发。

assistant:
修订轮开发完成（5 wave）：core（engineOrder 取代 defaultEngine、resolveEngineChain 截取链、串行降级任何错误类型、聚合错误脱敏、120s 总预算门控在尝试前、attempts 轨迹、显式钉死、T-S3 四用例含 mock timers 预算）；双端并行两级 UI（列表页 engineOrder 序+上移/下移菜单首尾禁用——desktop ContextMenu 扩展 disabled、mobile BottomSheetMenu 先例；详情页单引擎表单无默认引擎控件；desktop navState.editingEngineId / mobile params.engineId 两级路由；改名「搜索配置」全落含 core 未配置指引 f8a27bd3）。验证：core 1909 全绿、双端 typecheck/测试绿、真机 reload 已推新 bundle。cr-func 两轮均 func-ready：①截取链回落语义与 PRD 措辞对齐（显式指向未配置引擎只回落其后，不全局回链首）；②桌面详情页失败不回读在两级原子提交下无实际危害（部分生效场景不存在）；③留空保存反馈双端口径不一致（desktop 报错 vs mobile toast）留用户走查拍板。累计修订轮 8 commit（b43d9f99..18afac54）。

user: UI 反馈：空白处长文案难看，改「?」按钮弹窗说明；调整列表样式与配色。
assistant:
UI polish 轮（双端并行 + vision 审图闭环）：长文案全删（列表 footer/详情页底说明/页首 desc），收进标题栏「?」按钮→弹窗（mobile 经 setStackOverride.menuIcon+HelpIcon+ModalShell，desktop 页头 icon-btn+SearchHelpModal，双端三段文案逐字一致存 HELP_SECTIONS）；ENGINE_HINTS 副标题精简短语（按量计费·中文检索/国际、自托管·免费）。vision 审图亮/暗双轮验收通过（排版逐像素一致、对比度达标），两条打磨项已修：ApiKeyStatusTag 未连接文字提亮主文字色、ModalShell 浮层底换 surfaceElevated（暗色与卡片同层级）。commit：6f40bc71（mobile）/d2e503df（desktop）/00b4e00e（打磨）。真机 reload 后已验证到帮助弹窗可用。mobile adb 操作经验：uiautomator dump 拿坐标点导航，⌄ HelpIcon 这类 svg 按钮无无障碍标签要靠 clickable bounds 猜位。

user: bug：问号时有时无（进详情页返回后消失）；问搜索 API 是否都得配、有没有免费的。
assistant:
问号 bug 根因：列表页 header override 用 useEffect 只设一次，详情页返回时其 cleanup 清空 override 后列表页不重设——改 useFocusEffect 聚焦重设（85af428e，另补漏 import dcec35a4；真机验证返回后「?」仍在）。免费口径答复：searxng 自托管全免费无 key（docker 部署聚合百度/必应等）；tavily/brave 注册送免费额度（约 1000/2000 次每月）不付费；bocha 国内按量付费；零配置免费路线（DuckDuckGo 抓 HTML）brainstorm 时因不稳定已砍。教训：edit 调用整批失败时后续重试要核对所有 edits 是否都落了。

user: DuckDuckGo 内置吧，作为兜底。（前轮：调研 GitHub Termux 自部署 SearXNG 方案→用户追问能否抄 SearXNG 代码自实现简易版→人家算清维护税（抓 HTML 无官方 API、引擎改版追修是长期税）→推荐 DDG 甜点位）
assistant:
第三轮 DDG 兜底落地（func-ready，cr-func 无 must-fix）：core 引擎适配器（GET html.duckduckgo.com/html/、正则解析 .result 块 class token 精确匹配、uddg 重定向解码、实体解码、广告跳过、0 结果抛 invalid 供串行链感知改版、恒 configured、resolveEngineChain 无凭据入链分支——spec 未明说的必要补充）、ENGINE_IDS 五引擎默认序 DDG 队尾、存量 order 归一补尾；双端 UI（DDG 行「内置·免费兜底」副标题 + 主题色内置徽标（mobile BuiltinTag/desktop BuiltinEngineTag）、详情页只读说明、帮助弹窗补句双端一致）；T-A6 八用例 + T-S1 语义更新（无 key 无 baseUrl→链=[duckduckgo] 请求真实发出，未配置提示变防御路径）。vision 验收通过。错字风波：「兜底」在仓库存量代码（CLI 等）大量存在，worker 跟着写错进 UI 文案、CHANGELOG 那处是主代理自己打错的——修了本轮 8 文件，存量错字（纯注释为主）未夹带另记。commit：0f6ff9d8/b77678fd/5c405f89/ae869375/d479f7e0/a7da0894/e3852438。真机已验证 DDG 行上屏。

user: 没什么问题，现在进行 CR（code review loop）。
assistant:
第二轮 CR（base dc9ac9f1→head e3852438，排除 merge main 别家文件）：scope×2 并行产出 10 条（P1：loadEngineConfig 全链零消费者死接口；P2×9：desktop 列表错误类未定义/clearKey 无 catch/空 key 保存双端分叉且 mobile 虚假成功被测试锁死/「四引擎」注释漂移/帮助弹窗标题不一致/本迭代源码测试「兑底」16 处/dispatch 注释漂移 + VFS 集成测试回炉指控）；review-full 核验反转：**core2/G-1 失实撤销**（T-G3 实存于 147dc458，scope 评审 grep 漏了，git 历史证明）+ 新增 full/K-1（catalog 描述漏 DDG 且「需在设置中配置」与开箱即用矛盾——用户可见面）+ PRD L114 验收与 R1.2 矛盾修为一致。fix-spec round2 定稿（5ca2255c，状态 fix-spec-ready，待执行 10 条）。教训：scope 评审的 grep 指控要经 full 轮 git 历史复核才能进 fix-spec；上轮声称闭合的条目要抽核实存。

user: 修复吧。
assistant:
round2 修复执行完毕（两个并行 worker：fix2-core 5d3d2295/e8625b9a、fix2-ui b464a923/1925b04a + 收尾 4f180262）：10 条全闭合——loadEngineConfig 五处删+spec 同步+grep 清零、兑底 16 处+dist 重建、catalog 五引擎口径（测试正则仍匹配）、双端错误渲染统一 SettingsStatus、clearKey 补 catch、mobile 空 key 拦截对齐 desktop（测试断言改真）、四引擎注释 6 处+css 通用化（search-config.ts L115 存量语境豁免未被误改）、帮助标题统一。cr-func-fix2 func-ready（新发现 warning 一条 describe 标题顺手修）。验证：core 1919 全绿、mobile 11 绿、双端 typecheck 绿。fix-spec 两轮均执行完毕。存量遗留另记：skills 模块 3 处 .settings-error 裸类同款问题（不夹带）、包 lock 版本字段漂移（无害）。

user: 没问题，合并到主分支（真 main），然后写 changelog。
assistant:
终态收尾：CHANGELOG Unreleased 校对（串行链补未配置跳过、空行，fdcb24f6）三条定稿（新增搜索/两级页面、变更落盘）；合并被主仓未跟踪的旧版迭代文档挡道（brainstorm 阶段初稿，diff 确认无独有内容后清除）——da87c895 合入 main（--no-ff 保留合并记录），dev 快进同步，主仓 core dist 重建跟上。教训（本轮两次踩）：①「免费兜底 移除」被误读为移除 DDG 功能→派回退 worker 被用户掐掉（工作区半成品全量 checkout 恢复，零损失）；②纠正后人家又顺手多改了帮助弹窗两处→再被点「就是列表那一处」。最终 c788cbdf 只改列表副标题一处（「内置 · 免费兜底」→「内置」）。**模糊指代先问一句再动手，用户指名的范围之外一个字都不碰**。worker 子代理在 worktree 的 docs/apm/memory/ 留有过程记忆（未入库，不随合并回主仓）。

user:
DuckDuckGo 是什么网站吗？为什么可以用来当搜索引擎？

assistant:
通用知识答复（对照仓内 duckduckgo.ts 适配器讲清）：DuckDuckGo（duckduckgo.com）本身就是一个搜索引擎网站，2008 年 Gabriel Weinberg 创立的独立公司（美国宾州），卖点是隐私——不记搜索历史、不做用户画像，广告只看当次搜索词不看人。它能当搜索引擎是因为索引靠聚合：普通网页结果主要来自微软 Bing 的索引（合作），加自家爬虫 DuckDuckBot 与维基百科等即时答案源，不必自爬全网；收入靠不追踪的关键词广告+联盟链接，对用户免费。novel-master 能零 key 兜底是因为适配器直接 GET html.duckduckgo.com/html/（给老浏览器的无 JS 纯 HTML 端点）并正则解析结果列表，社区 duckduckgo-search 库同款思路；代价是非官方接口、页面改版会挂，所以放引擎链尾兜底、0 结果抛 invalid 供串行链感知降级。

user:
SearXNG 又是什么原理，它有 QPS 限制吗？

assistant:
原理答复：SearXNG 是元搜索引擎（聚合器）——自己不爬网不建索引，收到查询后并行转发给 settings.yml 勾选的上游引擎（Google/Bing/DDG/百度/搜狗等），聚合去重后统一返回；JSON 输出默认关闭需在 search.formats 加 json。QPS 口径分两层：软件本身无账号/计费/官方配额（自托管自己用没有 QPS 帽的概念）；真实限流在两头——①上游引擎对你实例服务器 IP 的反爬（个人写作频率远碰不到，高频会触发 CAPTCHA，SearXNG 自动临时挂起该引擎指数退避、其余引擎顶上，outgoing 可配代理）；②实例自身 limiter 插件限的是「访问你实例的人」（自用无关），公共实例普遍限流且 JSON API 常关防白嫖——所以 app 不内置公共实例地址、baseUrl 用户自填。仓内适配器：GET {base}/search?q=...&format=json、无鉴权、30s 超时、不传 language 尊重自托管者的中文聚合偏好。

user:
（2026-11-11）我想重构搜索配置页面。新想法：搜索引擎确实没有标准协议，但想复杂了——完全可以基于「curl 协议」（HTTP 请求本身）做可视化配置，用户像填表单一样配任意搜索 API。举例两文档：DeepSeek search（POST /v1/tools/search，Bearer，body{query,count,need_content}，结果 results[]{title,url,snippet,summary}）与智谱 web_search（POST /v4/web_search，Bearer，body{search_query,search_engine,search_intent,count}，结果 search_result[]{title,link,content,media}）。

assistant:
方案分析（待用户拍板后切 prd）：「curl 协议」=把一次 HTTP 请求拆成可视化字段：method+URL 模板+headers+body JSON 模板+响应字段映射（结果列表点路径+title/url/snippet 字段名）。验证覆盖度：DeepSeek/智谱/bocha/tavily/brave/searxng 六例全可模板表达（brave GET+header 认证、searxng GET 无 key 也行），仅 DDG HTML 解析不可模板化（内置兜底不冲突）。推荐温和版：内置五适配器保留（有精细容错：bocha 业务码脱敏、多字段名兜底、freshness 映射，模板表达不了），新增「自定义引擎」类型走模板，新引擎（DeepSeek/智谱）可做出厂预置模板用户填 key 即用，自定义与内置混排同一条串行降级链。三个关键技术点：①JSON 占位符注入必须结构层面做（parse 模板后 walk 字符串值替换+转义，防 query 带引号打坏 JSON，最大坑）；②engineOrder 从静态 ENGINE_IDS 全排列变动态列表（custom:{uuid} 独立 id 段，normalizeEngineChain/串行链/上移下移 UI/配置 DTO 全要动）；③安全口径不破（模板落 KKV 永远 {{apiKey}} 占位，明文只在请求瞬间 SKSP 现读，错误照旧 redact）。待拍板五点：多自定义实例（默认支持）/curl 命令粘贴导入解析（建议做）/测试搜索按钮（内置引擎时代拍板不做，自定义引擎建议重新拍板做）/占位符集合 {{query}}{{count}}{{apiKey}} 起步（recency/domainFilter 不进模板）/answer 摘要字段映射可选。

user:
search 工具本身也想改：各引擎都有自己的搜索语法，现在只提供了最简单的搜索方式。想把 search 做成 MCP 的感觉——提供更多自定义参数、给提示词，相当于一个专门的搜索 MCP。

assistant:
（理解有偏差的一轮）现状核实：schema 只开放 query/maxResults/engine（search-tool.ts inputSchema 注释+L149 ⚠️「生产恒不带 domainFilter/recencyFilter」），但五适配器过滤映射已全线实现（bocha freshness+客户端域名、tavily time_range+include/exclude_domains 服务端、brave/searxng freshness+site:、DDG 域名客户端+recency 忽略）。当时推荐「单工具做深统一参数面」：L1 开闸 recency/domainFilter、L2 query 内嵌语法 description 教学、L3 引擎特有参数不进 schema；反对拆 N 个 per-engine 工具（N 倍描述上下文、降级链被绕过、选型归用户）。DeepSeek fetch API 不另做（curl+落盘+read 已覆盖）。

user:
纠正理解：「像 MCP」不是统一参数面——是 search 工具允许指定搜索引擎+自己设置参数，其实就是 curl：对应的 URL 和 AK 被隐藏、替换为 engine 标识，参数和 curl 一样自由透传。

assistant:
理解修正后方案定型（与配置页 curl 模板合体为同一体系）：配置页模板=请求静态骨架（URL/认证/body 模板/响应映射），工具调用 params=动态部分（引擎方言自由参数）。工具 schema：query（统一必填，占位符替换靠它）+ engine（可选钉死/缺省串行链）+ maxResults（保留统一，1..20 收敛是 50KB 保险丝体系一部分）+ params（自由 JSON 引擎方言透传）。透传机制：内置适配器构造标准 body 后浅合并 params（同名字段 params 覆盖，DDG 无 body 忽略）；模板引擎先替换占位符再合并 params。降级链语义推荐链式时 params 原样合并进每个引擎、引擎自行忽略未知字段（DeepSeek 文档明说未知字段忽略，最 curl 的做法），备选 params 必须钉死 engine。提示词落点：工具描述=静态通用段+per-engine 参数说明拼接（内置出厂写死；自定义引擎配置页加可选「参数说明」文本框拼进描述）——引入工具描述动态化（catalog 从配置读+配置变更刷新），实施雷区记 PRD。DeepSeek fetch API 不另做（curl+落盘+read 已覆盖）。

user:
拍板：①query+maxResults 留统一、recencyFilter/domainFilter 砍掉全走 params；②没有指定引擎则自动走链；②+.1 新能力：引擎开关——每个引擎的说明会透传给 agent，agent 看到就以为能用，所以必须有开关控制，默认关闭、只有 duckduckgo 默认可用；③per-engine 说明是核心能力。问还有没有问题。

assistant:
拍板定型：参数面 query+maxResults 统一+砍 recency/domain 映射；链式缺省走链+params 原样透传；引擎开关=启用闸（关=不进链+说明不透传+agent 完全不可见，配置与开关独立状态，默认全关仅 DDG 开=开箱即用且不偷偷暴露未批准引擎）；per-engine 说明核心能力（内置出厂+自定义引擎配置页填写拼进工具描述）。回复遗留两问：①存量迁移——搜索功能已发版，存量配了 key 的引擎升级后若默认全关会被打回只有 DDG（配了 key 悄悄失效），建议迁移规则「存量已配置 key 升级时自动开」、默认关只对全新安装生效，待用户确认；②配置页轮五点报默认值待确认：多自定义实例支持/curl 粘贴导入做/测试搜索按钮做/占位符 {{query}}{{count}}{{apiKey}}/answer 可选映射。两问答完即合成一个 PRD（配置页 curl 模板化+search 工具 curl 参数化+引擎开关）切 prd-generate。

user:
存量迁移：就当不存在，不迁移，丢弃（升级后一律从只有 DDG 开始）。配置页五点：先做，做完看效果，反正只是 UI 层。

assistant:
全部拍板收齐后切 prd-generate。探索 3 个 readonly 子代理（core 搜索链路 / 双端配置 UI 与装配 / 文档惯例与 CLI），报告主代理落盘 tmp/explore-reports/prd-search-curl-{core,ui,docs}.md。关键发现：①recencyFilter/domainFilter 是「生产恒不传、测试锁活」完整预留链（search-tool.ts:149-152 注释明写勿当死码删，砍除需同步拆五适配器+types 纯函数+≥8 处测试锁）；②ENGINE_IDS 静态枚举渗透 core schema（inputSchema/outputSchema 双 z.enum）/config（engineOrder 全排列不变量+setEngineOrder 校验）/dispatch switch/双端 UI meta/4 测试文件约 15 处，自定义引擎要求放宽 string+重构 configured 语义为开关；③工具 description 是同步 (ctx)=>string、search 现忽略 ctx，动态说明须走装配期快照注入先例（skills.effective/agents，BuiltinToolSearchContext 现仅 resolveEngineChain 一成员）；④formatter/summary 按形状判断不卡枚举天然兼容自定义 id；⑤测试按钮可抄云同步「先保存再测」先例（desktop SettingsViews.tsx:279+mobile CloudSyncConfigScreen）；mobile 新增 core 导出必须同步 core-shim 否则测试红；⑥旧 PRD 不包含范围明文排除「不做请求模板」（prd.md:49）与「测试连接按钮」（prd.md:46），本次双反转；同主题二次迭代先例 chat-history-search→seq-range 路径式 dependency；iterations.yaml 无 web-search-tool 条目需补登；CHANGELOG 现状无 Unreleased 段（1.5.48 已发）；CLI 零 search 引用延续 known limitation。

澄清轮：内置引擎与模板关系（用户初问「模板化和适配器冲突吗」→解释后拍板**全收编**：bocha/tavily/brave/searxng 适配器退役改出厂模板，全系统只剩模板一种机制，DDG 唯一代码兜底）。

PRD 落盘 docs/Iterations/web-search-curl/prd.md（2026-11-12，dependency: [Iterations/web-search-tool/prd.md]）：R1 模板执行器+六出厂模板（占位符 {{query}}/{{count}}/{{apiKey}} 结构化替换、点路径响应映射、超时统一 30s、串行链/钉死/120s 预算/attempts 四口径原样保留）；R2 配置页模板化（动态列表平级混排+开关控件+模板编辑表单+curl 导入-失败整体拒绝+测试按钮先保存再测+恢复默认+删除清 key）；R3 工具参数面（query/engine string/maxResults/params 自由透传同名覆盖、砍 recency/domain、outputSchema 放宽 string）；R4 引擎开关（全引擎可关含 DDG、默认仅 DDG 开、关=不进链+说明不透传+值域不含、全关=可读提示不崩溃、开关与 key 解耦）；R5 per-engine 说明透传（静态通用段+逐引擎段拼装、装配期快照、限长 500 字符、双端 catalog 同步）；R6 存量处置（不迁移不读取不主动清除、iterations.yaml 补登、CHANGELOG 随发版号）。默认决策：明文 key 启发式检测拒存、出厂模板 core 常量+覆盖副本落 KKV、engineOrder 动态列表容错归一。风险：测试锁大面积重写（8+ 映射锁 20+ 链/配置断言作废）、模板执行器新路径需充分单测。

user:
（用户直接调用 spec-generate skill = PRD 确认，spec 阶段启动。期间穿插 worktree 清理拍板：能删的都删、记忆文件保留、本地分支清理、远程分支也清理——已执行完毕，D:/worktree 只剩 transcript-rn 活工作。）

assistant:
spec 阶段：3 个技术视角探索子代理（core 链路+测试锁逐用例 / 双端 UI+IPC 全链 / 外部 API 文档抓取+模板原料），关键发现：①Tool.description 同步 (ctx)=>string 由 toolsFromRegistry 求值——引擎说明快照必须装配期注入（照 skills.effective 先例，BuiltinToolSearchContext 现仅 resolveEngineChain）；②bocha 收编真行为=候选字段容错（url|link|href、snippet 四候选）+信封业务码校验（code!==200）——模板 schema 必须支持候选字段名列表+可选 envelope，否则收编丢行为；③智谱字段名 search_query（非 query）/search_engine 必填枚举（固化 search_std 可 params 覆盖）/search_domain_filter 是 string；DeepSeek results[] 含 snippet/summary/content 三层+need_content 开关、query 支持 site:/after: 语法、未知字段忽略；④SKSP 端口是 set 非 save；SearchConfigDto 全 string 弱类型天然容纳动态 id；desktop 云同步测试=先保存再测而 mobile=草稿直测（双端不一致）；⑤测试锁 61 存量用例处置表（删12/改24/留25）；mobile core-shim 白名单漏补即 Jest 解析炸。

spec 落盘 docs/Iterations/web-search-curl/spec.md（2026-11-12）：9 Step（模板core→dispatch→config-store→tool-surface→exports-shim→desktop-ui→mobile-ui→tests-rewrite→docs-release），T-E/T-P/T-C/T-S/T-R/T-U 六组约 30 新增用例。三处 PRD 口径微调（spec 已注明理由）：①测试按钮改草稿直测（mobile 云同步同款，双端统一坏配置不落库）；②占位符 3→4 增 {{baseUrl}}（searxng 自填实例必需）；③brave 域名过滤强制 count20/tavily snippet 折叠空白/bocha 客户端过滤兜底三处随收编丢弃（已知让渡）。存储新键 enabledEngines/engineOrderV2/customEngines/presetOverrides/engineBaseUrls（旧键 engineOrder/searxngBaseUrl 读路径删除=存量丢弃落地）；{{count}} 整值字符串替换为 number 保 integer 类型。待用户确认 spec。
