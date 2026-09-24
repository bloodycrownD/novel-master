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
4. **过渡态回收**：P2 修复中的 `Connection: close` 在原生管子（自带读超时）就位后应撤除，恢复连接池复用。

## 目标

高速长流全程丝滑（无冻结帧、计时与正文连续增长）；十万字级长文输出不掉帧、内存平稳；mobile 网络请求（流式与非流式）全部具备确定性超时收敛；连接池复用恢复且死连接黑洞不回归；desktop/CLI 零行为变化。

## 核心需求

1. **原生传输管子**（Android，Kotlin）：自有 OkHttp 实例（读超时/call 超时/池策略/ping 可配），native 线程读流 + **合批投递**（约 100ms 或 N KB 一批，先到者触发），POST + 自定义 headers + body，可 abort；**不含任何 LLM 协议逻辑**（port 只搬字节）；
2. **非流式 postJson 面**（用户拍板收编）：同一管子上极小的请求-响应方法，带 call 超时，收编 chatNonStream / listModels 等非流式请求的 mobile 侧通路；
3. **买 vs 建评估门**（Step 1）：`@mattermost/react-native-network-client`（活跃、新架构、但要求全局强制 OkHttp 5.3.2/Kotlin 版本对齐，且 SSE/流式响应 API 未在文档确认）为头号候选，按核验清单走 PoC，不满足即走自建（`okhttp-sse` 官方库打底）；
4. **core port 注入**：llm-sse-transport 增加可注入原生管子分支（registered native > XHR > fetch 择优），desktop/CLI 无感，测试可注入假 port；
5. **正文累积改造**：流式链路按批追加（数组），仅在落库/快照等物化点 join 成整串——任何引擎的字符串实现下都稳；
6. **转录 WebView 块级 append 渲染**：已完成块只渲一次、仅尾部活跃块节流重渲（候选 `streaming-markdown`，3kB gzip append-only；需过 webview 老浏览器约束核验），流式期间不再整段 innerHTML 替换；
7. **过渡态回收**：撤 `Connection: close`，恢复池化 + 读超时；死连接黑洞场景回归实验通过；
8. **硬指标验收**（可证伪）：mock-fast 12000 token 全程无冻结帧（指标条连续走动 + 正文连续增长）；10 万字长文流中不掉帧、内存曲线平稳；mock-dead 场景在读超时阈值内收敛；撤 close 后 r1/r2 复用回归 + 死连接实验不黑洞。

## 验收标准

- AC-1：模拟器 + 真机 mock-fast 全程丝滑（无 3 秒以上正文无增长、无秒表冻结）；
- AC-2：10 万字长文（mock 大 total-tokens）流式输出期间 UI 可交互、帧率平稳、无 OOM/GC 风暴迹象；
- AC-3：非流式请求（listModels/chatNonStream）在服务端死亡场景下有限时间收敛，会话可再发；
- AC-4：撤除 Connection: close 后：健康连接复用恢复（服务端日志可见同连接多请求）；死连接实验（杀服务器再发）在读超时窗口内收敛为可重试错误，无永久黑洞；
- AC-5：core 全量 + 双端定向测试全绿；desktop/CLI 行为与网络栈零变化；e2e 三幕（正常流/黑洞收敛/重发成功）复跑通过。

## 已知限制（登记）

- 仅 Android（mobile 为 Android-only；iOS 无交付目标）。Mattermost 候选若采用，其 iOS 侧依赖无害但不可用。
- webview 渲染改造与 RN 侧 32ms emitter 节流共存：emitter 保持（社区亦佐证 30-60ms 批量 flush 为通行做法），管子合批在其之下再压一层事件率。
- desktop 的非流式请求不在本期收编（Node undici 自带 headers/body 默认超时，有界）；如需对齐另行立项。
- 原生管子落地前，`Connection: close` 过渡态继续生效（P2 修复的既有行为）。
