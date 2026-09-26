---
date: 2026-09-25
dependency: [mobile-perf-2026-09]
---

# LLM 流式原生传输与渲染丝滑化 PRD（Phase 2）

## 背景

`mobile-perf-2026-09/llm-stream-timeout`（回炉版，5826d19e）修掉了「高速流之后下一次请求黑洞」（P2：死连接复用 + 四超时全 0），并留下过渡态：mobile SSE 请求带 `Connection: close`（放弃池化换取入口安全）。本迭代处理**登记在案的 P1 与收尾项**，全部有实证与社区调研支撑（2026-09-24 深夜调研，见 spec 引用）：

1. **P1 增量停摆**：流式渲染「渐进 → 中途停摆 → 尾部一次性倾泻」。根因 = RN XHR 管线每事件成本超线性（`_response +=` 累积 + 事件风暴 + 转录整段重渲染），事件与定时器共用 RuntimeScheduler 队列，积压后 UI 冻结。用户观察「**高速 LLM 输出过程中卡顿、低速没有**」即同一病灶在饱和点之下的表现（已并入 P1 表现谱系）。
2. **JS 侧两个超线性残留**（原生管子之外的必要配套）：消息正文逐 delta 累积（十万字级长文为平方级拷贝，Hermes 的 rope 实现无公开文档，不能赌引擎）；转录 WebView 的整段重渲染（社区标准解 = 块级 append-only 渲染，Google Chrome 官方指南背书）。
3. **非流式零超时黑洞**（用户已拍板收编）：chatNonStream / listModels 走 RN 默认栈，同为零超时，可能永久挂起（PRD ⑤ 已登记为既有行为）。
4. **过渡态回收**：P2 修复中的 `Connection: close` 在原生管子（自带读超时）就位后应撤除，恢复连接池复用；撤除是**条件化**的——原生管子未注册或加载失败回落 XHR 时 close 头保留（首字黑洞兜底不裸奔）。

## 目标

高速长流全程丝滑（无冻结帧、计时与正文连续增长）；十万字级长文输出不掉帧、内存平稳；mobile 网络请求（流式与非流式）全部具备确定性超时收敛；连接池复用恢复且死连接黑洞不回归；desktop/CLI 零行为变化。

## 核心需求

1. **原生传输管子**（Android，Kotlin）：自有 OkHttp 实例（**client 级读超时恒禁用**/call 超时/池策略可配；流式不设任何固定空闲界，见实现修正），native 线程读流 + **合批投递**（约 100ms 或 N KB 一批，先到者触发），POST + 自定义 headers + body，可 abort；**不含任何 LLM 协议逻辑**（port 只搬字节）；
2. **非流式 request 面**（用户拍板收编；原草案名 postJson，因 listModels 为 GET 无 body 而扩 method 改名）：同一管子上极小的请求-响应方法，支持 GET（listModels）/POST（chatNonStream），带 call 超时，收编 chatNonStream / listModels 等非流式请求的 mobile 侧通路；
3. **买 vs 建评估门**（Step 1）：`@mattermost/react-native-network-client`（活跃、新架构、但要求全局强制 OkHttp 5.3.2/Kotlin 版本对齐，且 SSE/流式响应 API 未在文档确认）为头号候选，按核验清单走 PoC，不满足即走自建（`okhttp-sse` 官方库打底）；
4. **core port 注入**：llm-sse-transport 增加可注入原生管子分支（registered native > XHR > fetch 择优），desktop/CLI 无感，测试可注入假 port；
5. **正文累积改造**：流式链路按批追加（数组），仅在落库/快照等物化点 join 成整串——任何引擎的字符串实现下都稳；
6. **转录 WebView 块级 append 渲染**：已完成块只渲一次、仅尾部活跃块节流重渲（候选 `streaming-markdown`，3kB gzip append-only；需过 webview 老浏览器约束核验），流式期间不再整段 innerHTML 替换；rich 超限判定（现全量 12k）改为**按块**——单块超限仅该块降级纯文本，长文流式期间块级 rich 对主场景生效（**实现修正**：终态/历史路径实际未接入 12k 全量降级——webview 终态行仍 rich，见 `spec.md` §6 实现形态修正）；
7. **过渡态回收**：条件化撤 `Connection: close`——原生管子分支不设（恢复池化 + 整调用 callTimeout 兜底；流式无固定空闲界，死流以手动终止为快速路径），运行时判定管子未注册回落 XHR 时保留；死连接黑洞场景双路径（native 注册/回落 XHR）回归实验通过；
8. **硬指标验收**（可证伪）：mock-fast 12000 token 全程无冻结帧（指标条连续走动 + 正文连续增长）；10 万字长文流中不掉帧、内存曲线平稳；mock-dead 场景在整调用兜底窗口内收敛（单次 600s × 最多 3 次尝试，极端 ≈30 分钟；快速路径为手动终止）；native 分支撤 close 后 r1/r2 复用回归 + 死连接实验不黑洞（回落路径 close 保留另行断言）。

## 验收标准

- AC-1：模拟器 + 真机 mock-fast 全程丝滑（无 3 秒以上正文无增长、无秒表冻结）；
- AC-2：10 万字长文（mock 大 total-tokens）流式输出期间 UI 可交互、帧率平稳、无 OOM/GC 风暴迹象；流式期间已完成块保持 rich 渲染（超限按块判定，单块超限仅该块降级纯文本，不再全程纯文本）；
- AC-3：非流式请求（listModels/chatNonStream）在服务端死亡场景下有限时间收敛，会话可再发；
- AC-4：原生管子分支撤除 Connection: close 后：健康连接复用恢复（服务端日志可见同连接多请求）；死连接实验（杀服务器再发）在**整调用兜底窗口**内收敛为可重试错误，无永久黑洞——自动上限 = 单次 callTimeout 600s × 重试次数（最多 3 次尝试）≈ 30 分钟，产品口径以手动终止为快速路径（原稿「读超时窗口」已随流式空闲界退役失效，见实现修正）；未注册回落 XHR 的路径请求头仍带 close（黑洞兜底不回归）；
- AC-5：core 全量 + 双端定向测试全绿；desktop/CLI 行为与网络栈零变化；e2e 三幕（正常流/黑洞收敛/重发成功）复跑通过。

## 已知限制（登记）

- 仅 Android（mobile 为 Android-only；iOS 无交付目标）。Mattermost 候选若采用，其 iOS 侧依赖无害但不可用。
- webview 渲染改造与 RN 侧 32ms emitter 节流共存：emitter 保持（社区亦佐证 30-60ms 批量 flush 为通行做法），管子合批在其之下再压一层事件率。
- desktop 的非流式请求不在本期收编（Node undici 自带 headers/body 默认超时，有界）；如需对齐另行立项。
- ~~原生管子落地前，`Connection: close` 过渡态继续生效（P2 修复的既有行为）。~~（已随本迭代落地：native 分支不设 close、连接池复用恢复；仅回落 XHR 路径保留该头。）
- **走实现修正的终版语义**（2026-09-26，详见 `spec.md` §2 实施修正记录与 §7）：流式不设任何固定空闲界（Kotlin client 级 readTimeout 恒禁用、空闲看门狗退役），唯一自动兜底是整调用 callTimeout 600s（最多 3 次尝试 ≈ 30 分钟）；死流由用户手动终止。原稿中「读超时 30s 兜底 / 90s 收敛」的表述与实验读数均属初版语义，Step 7/8 报告已加留档注。
