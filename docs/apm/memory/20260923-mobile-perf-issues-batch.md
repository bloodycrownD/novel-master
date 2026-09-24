---
date: 2026-09-25 00:45
title: mobile 性能批次全记录：5 spec→dev-ready（未 merge）+ ⑤回炉闭环（e2e 三幕）+ Phase 2 llm-stream-native 立项并 execute-ready（待确认）+ 压缩前状态快照
keywords: 性能优化, content_json 压缩, 回滚卡顿, 后台停摆, SSE 定时器, Choreographer, 指标条, t/s, LLM 流卡死, XHR onprogress, 增量投递停摆, 真机实验, mock-openai-server, 内嵌 bundle, worktree 并行, dev-ready, 视觉幻觉, 坐标漂移, Connection close, callTimeout, 死连接复用, 黑洞, llm-stream-native, 原生 SSE 管子, 块级渲染, execute-ready
abstract: 五命题全 dev-ready 未 merge（①635c714c ②19e4e841 ③61a14db9 ④64c0a0479 ⑤5826d19e 已回炉 e2e 三幕验证为合并候选）。Phase 2 迭代 llm-stream-native 已立项（原生 SSE 管子+累积数组化+转录块级渲染+非流式收编）经 spec-check-loop 两轮收敛至 execute-ready，**待用户确认后从 Step 1 评估门开工**。文档分支 iteration-docs-20260924 最新 ccc3cffb。合并红线与实验资产全记录在案，环境已收尾（真机还原、模拟器带修复版 APK 在线）。
---

user:
有几个性能优化的地方：1. content json 压缩；2. 大文本 message 回滚出现页面卡顿、界面不刷新；3. 后台任务执行无效——并发任务与消息通知已实现，但派遣子智能体后任务卡住，恢复到前台才继续；4. 会话页指标条「正文与思考」简化为「输出」，单位改 t，速率改 t/s；5. 高速 LLM（约 200t/s）出现 api 卡死——应用没死但该模型一直不输出、干等请求，换模型或重启应用后又能正常。以上均为 mobile 端测出。

assistant:
（apm-usage 回忆，逐项对照既有记忆与代码现状）：

① content_json 压缩——已有完整既往记忆且已立项：storage-cache-dedup-and-cleanup 迭代收尾时用户追问「500→100MB 还能更小吗」，实算账本 content_json 明文 73.1MB 占 chat_message 表 94%，随即立项 docs/Iterations/message-content-compression/（PRD 骨架已落盘：zlib 压缩对齐 vfs_content_blob 编码模式、目标 105MB→50MB 量级、存量迁移必须真搬运不可清空重填、跨 boot 重入是最大技术风险）。此项不新开主题，推进该迭代即可。

② 大文本回滚卡顿——无同主题既往记忆，新问题。既有相关背景：回滚是物理删尾（DELETE WHERE seq > ?），UI 链路 useChatTabMessages；init-busy-yield 已把快照分片（50 条/片）+ RowList 窗口化，但回滚触发的是 force 全量快照重建路径，大会话下重建重序列化是否被分片机制覆盖待查。

③ 后台子代理卡住——新问题。强关联既往背景：resident-keepalive-notification 迭代拍板「常驻通知开关默认关」，开关关着就没有前台服务，EMUI/国产 ROM 会冻结后台进程的 JS 线程，症状恰是「回前台才继续」。待向用户确认测试时常驻通知开关是否开启：若开着仍卡，才是代码层问题（定时器/网络限流）。

④ 指标条简化——现状（代码实证）：文案在 core 共用 format（packages/core/src/domain/format/format-stream-metrics-line.ts），现为「生成中 · 12.3s · 正文 1,234 字 · 思考 567 字 · 89 字/秒」；计数源是 useAgentStreamMetrics 的 delta.length（字符数），流式期间没有逐 delta 的 token 数。改「输出 N t · M t/s」存在口径决策：字符数换标 t 不诚实；真 token 需 tokenizer 逐 delta（贵）或协议 usage 块（非全 provider 支持且多在流尾）；折中可用字符/token 比率估算。token-usage 统计页已有 t/s 格式化先例（apps/mobile/src/screens/stack/token-usage/format.ts）。另该 format 是 Mobile/Desktop 共用切片，改动双端同变。

⑤ 高速 LLM 卡死——与已登记遗留 bug 症状吻合：reload-busy-period-probe 排查期登记过「run 无超时挂死——LLM 无响应无兜底」（probe 消息 0 字计时增长挂十几分钟不结束不报错）。「一直不输出等请求」与之同形，高速模型更易触发 provider 侧停流，而客户端无超时兜底就一直等；「换模型恢复」暗示按模型维度的连接/客户端状态可能被钉死（换实例绕开），根因待查（无超时兜底 + 高速流相关性两层）。相关迭代背景：mobile-sse-stream-resilience、mobile-stream-display-pacing、TDBC 16ms 量子。

后续：①走既有迭代出 spec；②③⑤建议 brain-storm 探索定根因；④需用户拍板 token 口径（真实 usage / 估算 / 字符改标）。

user:
3 的常驻通知开关开/关都试过、都卡。4 拍板：一般用 usage；且现在速率是全程平均速率不是实时速率，也要改；usage 有就用 usage，没有的话我们不是有 tokenizer 计数器吗，应该也能拿来算速率。指令：继续探索（②③⑤），1 生成 spec。

assistant:
（七只只读探索子代理并行：①spec 三只 + ②③⑤④四只，全同步等待汇总）

【① spec 落盘】docs/Iterations/message-content-compression/spec.md。关键拍板：不注册 schema migration 搬数据（跨 boot 框架确认完全缺失、两度被评审拒绝、空占位禁令封死先登记后搬），改后台谓词驱动压缩任务（content_json != '' 谓词、≤100 行/批短事务、幂等可重入、完成置 KKV 标记+挂 VACUUM，先例 runDeferredFileCacheGc+vfs-content-blob-zlib-v1）；schema 走行内双列 content_encoding/content_blob + 双形态读（明文行永远合法=迁移可中断可回滚的根基）+ BOOT_VERSION 15→16；codec 收口 repository（三端零感知），updateContent 的 stringify 从 service 下沉；searchMessages 去 LIKE 改全量内存筛（LIKE 是唯一被压缩破坏的读路径，service 本就内存精筛）；RN 沿用 zlib-b64（+33% 膨胀，mobile 压缩比预期 2.5~3:1）；解压失败 fail-fast 不自愈（用户数据本体）。AC-3 口径收窄待随 spec 确认（API 断言零修改 + SQL/fixture 基建豁免清单）。Step 1-7（7 为 manual_user 真机实库验收）、T-C1~C12。

【② 回滚卡顿根因候选】A（最高）：回滚链同一时间窗 content_json 全量 parse ≥3 遍——plan 阶段 listBySession 全量、完成后 listBySessionTail 41 条、refreshChatTokenLabel 又全量（回滚刚 invalidate token cache 必全量重算），叠加快照 JSON.stringify，均无让步；B（高）：回滚走 shrink/tailWindowReplaced 全量快照分支，SNAPSHOT_CHUNK_SIZE=50 > 页 40 → 恒单包、片间量子让步机制完全不生效，web 侧 applySnapshot 全量重建 + TrustedHtml innerHTML 重解析；C（中）：回滚事务内 sweepSessionRevisions 含 deleteGlobalOrphans 全局全表 DELETE（与全库规模相关）；D 竞态类基本排除（有兜底）。验证：bootTimingLog 打点分段 + 大消息小会话 vs 小消息大会话实验矩阵。

【③ 后台卡住根因候选（开关开也卡已排除 ROM 冻结为主因）】头号：RN Android 的 JS timers（setTimeout/setInterval）由 native Timing module 挂 Choreographer frame callback 驱动，onHostPause 摘 callback、后台无 vsync → 所有到期 timer 不执行；SSE chunk 投递整流 createSseChunkEmitter 的 setInterval(32ms) 是 XHR 路径唯一投递通道（onprogress 只 append 进 buffer），后台时网络数据照常到 JS 但不投递 → onChunk 永不调 → await modelRequests.request 挂死 → 回前台 vsync 恢复积压 chunk 一次倾泻立刻继续。次候选：TDBC 事务内 16ms 量子让步的 setTimeout(0) 同停（run 开头 backfill 事务、VFS 写事务触发）。FGS 保进程不被杀不保 vsync——「开关开着也卡」完美吻合。子代理特异点=task 工具 await runChildAgent 走同一 SSE 链，长流式必卡（短请求 onload 同步 flush 兜底可推进）。验证第一步：chrome://inspect 退后台跑 setTimeout 实测钉死前提；NM_DEBUG_LLM_FETCH 看「网络活着投递死了」。

【⑤ 高速流卡死根因候选】主干：四类超时（connect/response/read/idle）全缺失——RN XHR 不设 xhr.timeout，四个回调一个不来 Promise 永不 settle，agent-runner await 挂死，retry 只对 throw 生效；挂死时 finally 不执行 abortRegistry 恒真 → 同会话被 startRun 门禁锁死（换模型再发必然是新会话或先点过停止——现象表述澄清）。「换模型恢复」：客户端代码无任何 per-model 状态（排除性实证），最可能是服务端/中转 per-key 或 per-model 并发槽被挂死连接占用（候选 2）或 RN OkHttp 连接池死连接同 host 复用（候选 3）；治本方向=传输层 stream idle timeout（N 秒无 chunk 判失败+retry），可同时缓解 1/2/3。用户猜测的「缓存问题」未发现代码路径（token cache 同步 Map 无阻塞耦合）。逐 delta 链路竞态已排除。验证：挂死现场开飞行模式实验、PC 同 key 同模型对照实验、NM_DEBUG_LLM_FETCH。

【④ 指标条现状】usage 可得性矩阵：anthropic（message_delta 流中多次带累计 output_tokens，parser 已存原文只差 emit）/ gemini（每块 usageMetadata 累计，同样只差 emit）/ openai（协议限制仅最后一块，流中不可得；三方网关还可能忽略 include_usage 全程无 usage）。tokenizer 真相：core 同步 API 只有 heuristic（len/3.35，英文口径中文低估约半）；真 tokenizer 是异步 prompt 级 API（RN 走原生 Kotlin bridge），逐 delta 不可行——兜底方案=heuristic 增量累计 + usage/done 终值校正。实时速率建议时间窗口制（2~3s 滑窗或时间自变量 EWMA，慢速流按事件更新会冻结）。双端数据流不对称：mobile 已迁 unit 投影（含 run_state 持久化）、desktop 还是 hook 直连 IPC，共用件只有 core buildStreamMetricsLine——需加 EVENT_AGENT_STREAM_USAGE 事件（连带 public-events-allowlist 快照/desktop FORWARDED_EVENTS/generate-desktop-events 三处登记）。待立项（prd）。

user:
（spec 疑问）1 是动态迁移？那什么时候迁移完成？我有个习惯是每次发布都会清理 10 个 tag 前的 migration 保证代码洁净——1 能这么处理吗？比如 10 个 tag 以后。

assistant:
澄清：①不注册任何 schema migration（schema 走 DDL+align+BOOT_VERSION 固化通道，本就是清理三件套的终态），10-tag 清理流程无可摘除条目、不产生新负债；完成语义=谓词空→KKV 标记→VACUUM 一次→此后启动查标记零成本，空闲启动几分钟量级、agent 常活跃跨多次启动、存储页状态行可见 N 递减。压缩任务与明文读路径的退役不按 tag 数、按「最低支持基线抬过压缩上线版本」的安全条件（明文读是跨版本跳装升级的入口状态必需品，受支持最老库进来全是明文行）；届时须把任务退化为启动时谓词收尾同步搬运（跳装场景残余量上限仍是全库明文）；推荐口径=两者长期保留不退役（幂等+完成后零成本+读只多一次判定）。已补进 spec「迁移完成语义与长期维护」一节。

user:
（否决推荐口径）不不不，迁移流程代码本身就是负担，我们需要明确的移除阶段。C 端和服务端不同——服务端可以自由控制迁移，C 端不行，必须确保有办法下线这部分代码。

assistant:
用户否决「长期保留不退役」，spec 改为**三段式确定性下线生命周期**（每段完成不依赖用户行为，最终迁移代码归零只留永久 codec）：
- V0（上线）：后台谓词任务 + 升级首启同步收尾预算 60s（小库当场完成，残余转后台）；
- V1（约 10 tag 后，与 migration 清理同轮）：基线抬到 V0（老库 fail-fast 不再产生新明文入口）+ 启动强制同步收尾门（谓词非空同步搬完才放行，无预算上限，覆盖「装过 V0 未搬完就跳装 V1」的库）+ 删后台任务/明文读路径/双形态分支与 T-C3/T-C12 退役测试；与史前 migration 清理同流程登记；
- V1'（下下轮清理，基线抬过 V1）：删启动收尾门——≥V1 的库已被 V1 强制门保证全压缩，跳装入口随基线消失。迁移代码全归零。
教训入档：C 端数据迁移方案必须自带确定性下线路径（强制门+基线抬升），不得以「成本低可长期保留」回应代码移除诉求。

user:
ok，剩下四个命题生成 spec 了吗？可以进入 spec 阶段。

assistant:
②③④⑤ spec 全部落盘（探索报告已齐，主代理直接撰写）：新迭代桶 docs/Iterations/mobile-perf-2026-09/（总纲 PRD + 四 feature 各 prd.md+spec.md，iterations.yaml 已登记）：
- rollback-large-jank（②）：四独立改动——回滚链分段打点（__DEV__）/大列表解析分片让步+plan 拉取收窄（唯一语义边界点，T-R1 等价性兜底，保守推进）/快照分片加字节预算（256KB/片，40×大消息也能切多片）/deleteGlobalOrphans 从回滚事务 deferred 化/token 刷新错峰。7 Step + T-R1~R6。
- background-run-continuity（③）：SSE 整流事件驱动化（append 时过 32ms 闸门即 flush，由 onprogress 原生事件驱动，interval 保留兜底——后台 interval 停摆不再致命）+ TDBC 量子让步 isBackground 注入（mobile 注入 AppState.currentState，后台跳过休眠；驱动包不 import RN，探测注入保包边界）+ run 链 timer 盘点（重试退避后台推迟登记为已知限制）。前提实证（chrome inspect 后台 setTimeout）设为合并门禁：Step 1 manual 结论为否定则整案撤回。5 Step + T-B1~B6。
- stream-metrics-tokens（④）：LlmStreamEvent 增 usage 变体（anthropic 在 message_delta 处、gemini 每块 parse+emit，数据已在 parser state；openai 不加流中事件）+ EVENT_AGENT_STREAM_USAGE 三处登记 + runner 侧 run 级累计换算 + mobile unit token metrics（heuristic len/3.35 增量兜底、usage 覆盖校正、run_state 持久化水合）+ desktop hook 同款 + buildStreamMetricsLine 改「输出 N t · M t/s」+ slidingTokenRate 滑窗纯函数（2.5s 窗口，时间制防慢速流冻结；usage 校正点重 seed 防尖刺）+ 旧 hook 死代码收口。7 Step + T-M1~M11。
- llm-stream-timeout（⑤）：stream-watchdog 双 deadline 原语（首字 120s/空闲 90s 导出常量）接入 XHR 与 fetch 双路径（onTimeout→abort→既有 onabort 链 reject）；分级语义——首字前超时判 retryable 复用既有 retry、流中断不重试走既有 [生成失败] 占位链；超时收敛自然修复 abortRegistry 挂死泄漏与会话门禁锁死；onTimeout 打点（lastActivityAt/processedLength）区分 provider 停流 vs 客户端不消费。后台 watchdog 停摆登记已知限制（与③同根因）。7 Step + T-T1~T8。
全部待用户确认；建议走 spec-check-loop 审查（五份 spec 含 ① 的）。

user:
（① 追问）消息正文压缩存储有什么办法确认是否迁移完成吗？方便 10 个 tag 后用户确认是否更新应用。

assistant:
spec 补「迁移完成的三层确认手段」：①app 内三态状态行（未开始/进行中 N/已完成）+ 副文案——未完成态提示「完成前升级新版本会在首次启动时等待优化收尾（一次性）」给终端用户升级指引；②DB 直查（开发者/高级用户）：`SELECT COUNT(*) FROM chat_message WHERE content_json != ''` 归零即完成 + KKV 标记（约定 key nm.message-content-compaction.done）复核，运行库 adb run-as 拉取或 .nmbackup 备份文件均可查、无需打开 app；③V1 兜底：启动先查标记已完成直接放行零感知，未完成才进强制收尾门带进度文案「正在完成存储优化（剩余 N 条）」——确认是体验优化（省升级后首启等待）不是安全前提。Step 7 验收补 SQL 确认步骤。

user:
（① 第 1 轮审查）spec/prd 走第 1 轮审查出 must-fix（P0 撞号 + P1×2 + P2×7），派子代理修文档（只改 PRD/SPEC 不动代码）。

assistant:
message-content-compression 第 1 轮 must-fix 全闭合（只改 docs/Iterations/message-content-compression/{prd,spec}.md，代码零改动，证据全部 rg 定点实核）。**以下旧拍板口径已被本轮修正，后续会话以 spec 现文为准**：
- BOOT_VERSION 不再写死 15→16——与 mobile-perf-2026-09/stream-metrics-tokens（其 spec 自记「若为加列走三件套纪律」，同轮可能 bump）撞号；全文改「SCHEMA_BOOT_VERSION +1（写作基线 15；实施以主干现值为准递增，撞号顺延）」，纪律是 bump 本身不是具体号。
- KKV 完成标记弃单串 `nm.message-content-compaction.done`，改两段式 `kkv.set('nm-message-content', 'compactionDone', ...)`（仓库约定 module nm- 短横线先例 nm-search/nm-compaction-conditions、key camelCase；表 kkv_entry 列 module/key/value）；DB 直查复核 SQL 同步补。
- 三态改两态：进行中（剩余 N，含从未开始 N=全部——库里只有完成标记一种进度，数据上分不出「未开始」）/已完成。
- desktop 状态行落点无 DataManagementView 文件，实为 apps/desktop/renderer/features/settings/SettingsViews.tsx:576「数据清理」区块。
- 守卫表述改「app 层组合守卫（按端取用：desktop runtime/agent-activity.ts + services/db-maintenance-busy.ts + cloud-sync.service.ts；mobile runtime/agent-activity.ts + StorageConfigScreen dbBusy），core 侧靠 tdbc 连接级互斥」——守卫不在 core db-maintenance 模块内。
- 「不阻塞启动」口径修正：应为「不无限期阻塞启动」，V0 升级首启 ≤60s 有界同步收尾预算属设计内一次性代价；PRD 核心需求 2 与 spec 设计目标/Step 7 同步改写。
- AC-1 按端拆分：desktop/CLI ≥3:1、mobile ≥2.5:1（zlib-b64 base64 +33% 膨胀口径）；PRD AC-1 与目标段同步。
- AC-3 收窄落流程：豁免清单作验收附件；零豁免兑现则按原口径验收。
- V1 基线判据登记：V0 不注册 migration，「基线=V0」须 legacy 形态探测（chat_message 缺 content_encoding 列，对齐 detectLegacyShape）或借 V0~V1 间其它迭代 migration id；V1' 判据=完成标记/谓词空。
- DDL 精确文本入变更点清单：content_encoding TEXT NULL CHECK (IN ('zlib','zlib-b64'))（CHECK 对 NULL 放行，legacy 行合法）、content_blob BLOB NULL。
- core 不新增 exports 子路径：./compaction 已被上下文裁剪域占用（package.json exports + desktop ipc/handlers/compaction.ts 消费），压缩任务并入主入口 index.ts 的 infra/db-maintenance 导出区；codec 系 core 内部设施不导出。constraints 补「mobile 新增子路径消费须同步 apps/mobile/jest.config.js moduleNameMapper」。
CHANGELOG 未动（本轮无代码/行为变更）。

user:
[$spec-check-loop] 对五个 spec 进行 loop 审查。

assistant:
三轮收敛、五份全 Go（R1 三路并行审查：①Go+10条 / ②Go+8条 / ③No-Go / ④⑤No-Go → 5 个 doc-fix 并行；R2 两路复审：22 条闭合+1 P1 新遗漏（③）+若干 P2 → 1 个收尾 doc-fix；R3 轻量终检零问题全 Go）。抓到的真 P0 四个：③PRD「重试退避同机制覆盖」与 spec「登记不改」直接矛盾（修为「盘点并处置」，重试退避登记已知限制——总纲拍板记录标注待用户随 execute-ready 一并确认）；⑤超时错误会被 adapter 的 abort 吞错链当用户停止吞成 partial + isRetryableError 对未知错误默认可重试（idle 也会被重试）+ 接入点文件写错（model-retry-policy 是 KKV 存取，判定在 model-request.service）——修法 rejectOnce(超时错误) 抢占 settle + isRetryableError 显式分支 + 接入点改正；④openai 流尾终值校正无落点（FINISHED payload 不带 usage）——修法 runner 每 step done 后补发 run 级累计 usage 事件复用 EVENT_AGENT_STREAM_USAGE 管线；主代理补跨文档 P0：①④同期 bump SCHEMA_BOOT_VERSION 撞号——两边统一「不写死号、主干现值 +1、先合 +1 后合顺延」。R2 重要实证：③ driver 注册工厂有 index.ts/native.ts 双平行入口、mobile 走 native.ts（漏写必编译失败，已补+拍板共享注册函数转发）；②plan 拉取下界钉死 clicked.seq（审查逐消费点核实）；①KKV 标记两段式 nm-message-content/compactionDone、AC-1 按端拆分（desktop≥3:1/mobile≥2.5:1）、首启 60s 有界同步披露为口径修正。命名统一：④全链 completionTokens（outputTokens 不存在）。execute-ready 达成待用户确认；确认后可进 code-dev-loop。

user:
确认 execute-ready（含③重试退避已知限制拍板），[$code-dev-loop] 开工；建议新建多个 worktree 并发——这几个优化相关性不强。

assistant:
code-dev-loop 启动（2026-09-24）。worktree 并行方案拍板：五迭代文件交集盘点——①②同碰 sqlite-message.repository（不同区域小冲突）、①④同 bump BOOT_VERSION（顺延纪律）、③⑤都碰 sse-chunk-emitter（⑤纯增量 bufferedLength），其余零交集，五个独立 worktree 成立。注意：本机 worktree 目录是 .worktree（RULE 的 .woktree 是旧 Linux 机器写法）。基线：自 main 建临时分支 iteration-docs-20260924 提交迭代文档（23818754，13 文件——此前 mobile-perf-2026-09 整树未跟踪）；五 worktree .worktree/f-{message-content-compression,rollback-large-jank,background-run-continuity,stream-metrics-tokens,llm-stream-timeout} 各建 feat/* 分支自基线；另有他 session 的 desk-e2e-test worktree 不碰。五路后台 npm install + npm run build 装配中；完成后 wave-0 五 impl 并行 → wave-1 五 verify → wave-2 五 cr-func。Windows 首次装配耗时未知，等待通知。

assistant:
（wave-0 全部完成，2026-09-24）五 worktree impl 收敛：①压缩 6 提交（cc79fbbe schema 三件套/398fcb2b codec 收口+updateContent 下沉/063454ac search 去 LIKE/52298415 压缩任务+三端接线+双端状态行/9ebf39ca T-C11+快照/635c714c docs），AC-3 豁免清单零豁免兑现；②回滚 6 提交（918657f8 打点/fa2589a9 收窄+分片让步/0291ed83 字节预算/478261af 孤儿 deferred/47c2e1b9 token 错峰+onSnapshotComplete 链/21f9b7a3 jest helpers ignore 修 worktree 怪癖），续作时抓到在途真 bug：static 成员经 this 引用致 NaN 空列表；③后台 2 提交（3ab00926 emitter 闸门事件驱动/804fde76 isBackground 注入——共享注册函数 registerOpSqliteDriverWith 双入口转发）；④指标条 7 提交（af8f4cdc+a9937e44 协议层与事件面/343b396a run_state 三件套 v16/2889ba55 unit token 化/64f02b04 desktop hook/e3c727ed 文案+滑窗+死代码收口/f42cc213 夹具适配），t/s 格式按 T-M8 例文裁决（整数不带 .0）；⑤超时 4 提交（d285f1c5 watchdog 原语/3644a106 双路径接入/1a60162c 分级重试/db62703f changelog），dispose 终态防御补强。已知环境基线（各 worktree 共识，主 worktree 同 commit 复现双证）：core T-C2/T-C6 时区 2 红、mobile mermaid T-MF3 产物断言 1 红、desktop renderer workspace-push-menu 既有 tsc 错。中途遇用量限额中断，②④⑤ 断点续作（先核对在途改动再续写）。进入 wave-1 五 verify 并行。

assistant:
（wave-1/2 + dev-ready，2026-09-24）五 verify 独立复跑全 PASS（各失败用例均基线双证：core T-C2/T-C6 时区、mobile mermaid T-MF3 CRLF、helpers 空套件；发现并修复：④ renderer tsc 351→352 唯一新增 TS2740→6c0a0479 修回基线；②孤儿清扫测试头注释微任务→宏任务措辞→19e4e841；③补 CHANGELOG Unreleased→61a14db9）。五 cr-func 全 func-ready 零 must-fix，deviations 全部裁定 closed/accept。终态五分支（基线 23818754）：feat/message-content-compression→635c714c（6 提交）/feat/rollback-large-jank→19e4e841（7）/feat/background-run-continuity→61a14db9（3）/feat/stream-metrics-tokens→6c0a0479（8）/feat/llm-stream-timeout→db62703f（4）。cr-func 登记（合入前/发版前）：③ Step 1 chrome inspect 后台 timer 停摆实证=合并硬门禁（否定则撤回实现）；③ mobile 1 红归因补强（非阻塞）；④ desktop AgentStreamMetricsBar 采样器跨 run 未 reset（≤2.5s 旧样本→短暂 0 t/s，非阻塞 polish，mobile 侧有 runKey 重置先例）；④ 合入时 spec 补三句语义（采样器共用封装/t/s 整数不带 .0/usage 后 heuristic 不回写）；② Step 7 真机打点对比录屏。合并注意：①④都 bump BOOT_VERSION 15→16——先合并者取 16、后者 re-bump 17（断言均引用常量，改常量值即可）；①②同碰 sqlite-message.repository（不同区域小冲突）。环境登记：desktop npm test 在 Windows cmd 假绿（run-tests.mjs 单引号 glob，须 bash 等价命令）；worktree 路径使 jest testPathIgnorePatterns 失配（②已裸片段化修复，其余 worktree 未修属基线形态）。dev-ready 达成，未 merge（协作红线待用户指令）。

user:
（⑤ 严厉纠偏）流式超时兜底治标不治本。症状口径修正：**任何一个高速模型，在高速输出完成之后，想要再次请求时进入长时间等待**；重启应用或更换模型都能正常请求。不像网络问题（同一时刻换模型就通），像我们自己的代码问题。且用户实际节奏：正常高速模型 3s 内返回、超 10 几秒就手动重试，90s/120s 阈值毫无意义；first-chunk 120s 还会误杀慢启动/缓冲型（「非流」）正常模型——⑤ 不能按现状合并，回炉。

assistant:
承认两处成立：症状口径错（挂起在「下一次请求」而非流中）→ 病根方向改为「上一次高速流的残留状态」；阈值设计错（应以用户十几秒手动重试节奏为基准，first-chunk 固定 120s+自动重试对缓冲型模型有害）。新候选（均吻合「重启恢复/换模型恢复/UI 不卡死=await 型挂起」）：a) RN OkHttp 连接池——高速流结束后连接回池、状态被污染，下一次同 host 请求复用死连接挂起，换模型=换 host 绕开、重启=清池；b) Android 原生 tokenizer 桥——run 开始时 token 计数经 NativeModules.countPrompt 异步 Promise（GLM/claude/qwen2/deepseek 走原生、GPT 系走 JS），桥被高速流的重量使用搞挂→下一次计数永等，换模型=换 tokenizer 族；c) TDBC AsyncMutex 饥饿——高速流的大 partial 写（>1MB 降 1s 全量覆盖写）堆积，下一次 run 开头 backfill 事务排队。鉴别问题（待用户答）：①挂起时指标条是「生成中·0字·计时增长」还是连「生成中」都没出现（请求已发出挂 vs 受理前挂——c 的指纹）；②换模型恢复是同一会话换 pin 模型还是新会话；③挂起的是同会话下一次请求还是新会话也挂。行动计划：按新口径重派探索（受理→发请求→首字全路径 + 跨 run 残留状态 + 连接复用实证），⑤ 暂缓合并，根因明确后阈值与语义一起重做。

user:
（同轮补充指令）搭建虚拟 openai 接口返回固定内容，方便测试找 bug + 模拟器 e2e。

assistant:
（⑤ 根因复现闭环，2026-09-24 下午）**判别实验全部完成，根因实锤为「RN XHR 增量投递停摆」——用户症状的真实形态**：
【实验环境】scripts/mock-openai-server.mjs（7ef4967a 已提交，零依赖：mock-fast 2ms/chunk 高速喷长文/mock-slow 80ms 慢速/mock-dead 收 N 次起挂死；--no-keepalive/--hang-after/--log-file 连接级日志）+ 无头 AVD Medium_Phone_API_36.1 + 内嵌 bundle 诊断 APK（useDevSupport=false + react-native bundle --dev true 进 assets，__DEV__ 打点全保——**metro 反向通道在 Windows 上不稳定，应用被随机静默 reload（12:43/12:44/12:45 三次实锤、无任何 JS 异常日志），此配方再次根治**；注意 RN 0.85 参数名是 useDevSupport 非 useDeveloperSupport）。adb reverse tcp:8787 与 10.0.2.2 直连双通道均验证。
【六轮实验结论】不论 reverse（经 adbd）还是 10.0.2.2 直连（不经 adbd）、不论 2ms 高速还是 80ms 慢速流，客户端 UI 全程「生成中 · Ns · 正文 0 字」，服务端在正常喷流、JS 线程活着（指标条计时在走）——**XHR onprogress 只在首 chunk（~224 字节）触发一次，之后所有增量数据不再到达 JS 层，直到 onload 才由最终 flush 一次性交付全文**（logcat 证据：xhr first chunk 后 46s 零日志 → xhr complete → 快照一次性重建）。停止按钮在 0 字挂起态仍有效（服务端实锤收到连接中止）。服务端流时长由客户端消费速率反压决定（12000 token ≈ 46-49s ≈ 250 字/秒）。
【与用户 bug 的对应】真机上渐进流式若同样停摆：连接健康时表现为「长时间 0 字等待后全文一次性出现」（高速模型长流=等待窗口大）；**连接中途死亡/中转停流时 onload 永不触发 → 永久「生成中·0字·计时增长」= 用户报告的 api 卡死**；重启=杀 socket、换模型=换 host，均恢复。模拟器时钟比宿主快 30s（分析 logcat 与服务端日志时必须校正）。
【⑤ 回炉方向】原 watchdog 方案降级为安全网；主修复转向传输层增量投递：排查 RN 0.85.3 XMLHttpRequest/RCTNetworking 的 didReceiveNetworkData 停摆机制（responseType/incremental events 条件、事件合流），修复或绕行（如轮询 responseText 尾部/换 fetch 流/原生 SSE 模块），使流中增量真正到达 JS；watchdog 阈值以用户「十几秒手动重试」节奏重定。待真机验证：真机 release 上流式是否同样 0 字（用户历史反馈见过流式渲染，真机行为可能不同——但 46s 一次性交付与用户「长时间等待后出全文」的描述吻合）。
【附带发现】① 项目名输入框 input text 触发的「JS 上下文静默 reload」实为 metro 通道问题，内嵌 bundle 后消失——非产品 bug，销案；② uiautomator 的 RN 文本节点常陈旧（composer 占位符误显示为有文本、添加按钮状态不更新），**视觉截图+逐字转写为唯一可靠 UI 证据源**（且 vision 对不存在的列表项会幻觉，必须与 dump/DB 交叉验证）；③ DB 直改注入测试数据可行路径：run-as 拉库→better-sqlite3 改→推回（llm_saved_model.id 必须是标准 UUID，assert-saved-model-uuid.ts 格式校验拒短 id）；④ e2e 资产就绪：mock 服务器+内嵌 bundle+adb 驱动 UI 全链路已跑通，可复用为正式 e2e。

user:
（更正）「正文流式渲染一半→thinking 继续」是 v1.5.18 时期已被修复的 bug，现在没有了——不能作为「真机流式正常」的反证。指令：更新记忆，准备压缩上下文。

assistant:
（压缩前状态快照，2026-09-24 14:05）反证撤销 → 增量投递停摆假设对真机成立概率上升，**下一步唯一裁决实验：真机接 mock-fast 看流式是逐字还是 0 字憋全文**（adb reverse tcp:8787 + 服务商 http://127.0.0.1:8787/v1 + 拉模型选 mock-fast，node scripts/mock-openai-server.mjs --total-tokens 12000）。
【全案状态】主 worktree（D:\Dev\Js\novel-master）分支 iteration-docs-20260924（基线 23818754=main+迭代文档，另含 mock-openai-server 提交 7ef4967a）；五 worktree 分支均 dev-ready 未 merge：feat/message-content-compression→635c714c、feat/rollback-large-jank→19e4e841、feat/background-run-continuity→61a14db9、feat/stream-metrics-tokens→6c0a0479、feat/llm-stream-timeout→db62703f（**⑤已扣下回炉，勿按现状合并**）。合并注意：①④同 bump BOOT_VERSION 15→16 须顺延（先合+1后合再+1，断言引用常量）、①②同碰 sqlite-message.repository 小冲突、③合并硬门禁=chrome inspect 后台 timer 停摆实证未做、各 feature manual_user 真机验收未做、④ desktop 指标条采样器跨 run 未 reset 为非阻塞 polish。
【⑤回炉要点】主修复=传输层增量投递（RN 0.85.3 XMLHttpRequest/RCTNetworking 的 didReceiveNetworkData 首包后停摆机制待深挖；模拟器六轮实锤：双通道/双速率全 0 字、onload 一次性全文、服务端流长由客户端消费反压决定 ~250字/秒、挂起态停止按钮有效）；watchdog 降级安全网，阈值按用户「十几秒手动重试」节奏、须解决缓冲型模型 first-chunk 误杀。
【环境备忘】诊断 APK 1301（内嵌 --dev bundle）在 apps/mobile/android/app/build/outputs/apk/debug/；MainApplication.kt 临时改动已 git checkout 还原（干净）；assets/index.android.bundle 为未跟踪构建产物；metro/模拟器/mock 服务器均已停；模拟器时钟+30s 偏差、uiautomator RN 文本陈旧、vision 会幻觉列表项——UI 证据必须截图逐字转写+交叉验证；DB 注入：run-as 拉库→better-sqlite3→推回，llm_saved_model.id 必须 UUID 格式。真机 DSLDU20407006179 在线可用。

user:
鉴别问题答复：①挂起时**有计时**（不然怎么知道运行了十几秒）——即 run 已受理启动、卡在首字前；②**同一会话换 pin 模型后其他模型可正常请求**——会话级状态干净，堵点跟随模型接入路径；③新会话是否也挂未尝试。另指令：搭建虚拟 openai 接口返回固定内容，方便测试找 bug + 模拟器 e2e。

assistant:
指纹收敛：受理后挂起 → 候选 3（受理前 DB mutex 排队）基本出局（待确认 RUN_STARTED 与 backfill 先后）；存活候选 a) OkHttp 连接池死连接复用（换模型=换 host）与 b) 原生 tokenizer 桥挂起（换模型可能换 tokenizer 族：GLM/claude/qwen2/deepseek 走原生 Kotlin bridge、GPT 系走 JS）。mock OpenAI 服务器是关键判别器：挂起时服务端收到下一次请求与否直接区分「没发出去」（请求前 await 卡死，指向 b）vs「发出去了客户端不收」（连接层，指向 a）；且服务端日志可见连接复用行为。行动：重派定向探索（受理→首字串行 await 链逐环 + token 计数是否在请求路径上可独立挂起 + XHR 连接复用）；搭零依赖 mock-openai-server（SSE 流/非流、速率与挂起可配、请求与连接级日志）；后续用 AVD 模拟器 adb reverse 复现。纪律事件：R1 的 A 路 doc-fix 子代理越权追加写本记忆文件（追加式无破坏、内容准确已核验保留）；后续派遣 prompt 均显式禁止写 memory。mobile-perf-2026-09 目录整树未跟踪，提交时留意纳入。

user:
（压缩后恢复）真机测试吧——真机接 mock-fast 裁决：流式是渐进还是 0 字憋全文。

assistant:
（⑤ 真机裁决实验，2026-09-24 晚，Honor EBG-AN00 / DSLDU20407006179）**裁决结果：真机流式 =「前段渐进 → 中途停摆 → 尾部倾泻」，XHR 增量投递停摆在真机成立（比模拟器轻一档）**。
【实验配置】诊断 APK 1.5.23-diag(1301) 原地升级真机（原装 1.5.21 debug，同签名数据保留；DB 为用户真实 109MB 库，pristine 备份在 C:\Users\BloodyCrown\AppData\Local\Temp\rt_db\pristine.db）；provider 配置走 **DB 注入**（真机表单页有布局 bug 见下）：UPDATE llm_provider 把内置 OpenCode Zen（c0ffeeee-0005，openai 协议、defaultApiKey="public" 免 SKSP）baseUrl 指向 http://127.0.0.1:8787/v1 + INSERT llm_saved_model mock-fast（UUID id 必须，settings_json 沿用 schemaVersion2 形状）；run-as cat 拉库→better-sqlite3 改→/data/local/tmp 中转 cp 推回；mock 服务器 --total-tokens 12000；adb reverse tcp:8787（真机 USB reverse 通，设备浏览器直开 127.0.0.1:8787/v1/models 验证过）。
【核心数据】发送后服务端 POST /v1/chat/completions（messages=4、prompt≈1396 token 带真实工作区前缀、auth=Bearer public）→ SSE 3000 chunk 标称 2ms，**实际 46.85s 送完（客户端 socket 匀速 ~250字/s 反压，与模拟器同节奏）**；UI 计数曲线：6.4s→200字 / 19.1s→630 / 36.8s→1880 / **40.5s→1880 / 45.7s→1880（9 秒纹丝不动）** / 49.0s→1900 / 完成→12000（usage 终值校正，正文计数 heuristic 中文低估 + 校正跳变属 ④ 设计行为）。消息区文字全程可见增长（r2_3 起正文已渲染）。
【结论链】①真机增量投递**存在**且前 37s 健康（模拟器首包即停）；②36.8s 后停摆、剩余 ~10000 字靠 onload 尾部倾泻——与模拟器同病灶轻重两档；③socket 在匀速读但增量事件中途断流 → 停摆点在 RCTNetworking「已读数据→JS 增量事件」环节，不是 OkHttp 读 socket；④**连接中途死亡场景下 onload 永不触发 → 真机也会永久「生成中·0字·计时增长」= 用户 bug 高概率在真机成立**；⑤⑤ 回炉主修复方向不变（传输层增量投递），且新增证据：停摆与流速率/时长相关（模拟器 2ms 即停、真机 37s 后停——疑与累计数据量或某个 buffer 阈值有关，待深挖 RCTNetworking didReceiveNetworkData）。
【过程翻车与教训（重要）】a) **视觉模型 prompt 诱导幻觉**：我在转写 prompt 里给了指标条格式示例，vision 照格式编造「生成中·3.0s·正文 0 字」——四张不同截图返回一字不差的假指标条，一度误导出「应用整体冻结、JS 死锁」的大误判（还做了线程态/hprof 取证）；实际是发送键没点中、消息根本没发出去。**中性 prompt（只说「逐字转写」不带任何格式/预期）复检后才推翻**。RULE.md 纪律的加重版：prompt 里连示例格式都不能给。b) **发送键坐标随键盘开合漂移**（键盘开 1330 / 键盘关按钮行沉出屏），第一次 tap 落空；必须先开键盘抬升布局再 dump 定坐标。c) **Honor 百度输入法 ESC(keyevent 111) 后半死态**（mInputShown=false 但 mIsInputViewShown=true，adjustResize 把应用压扁）→ 切 LatinIME 绕过，LatinIME 首启有设置向导（下一步/数据恢复取消）。d) 真机诊断 APK **无 ReactNativeJS logcat 输出**（模拟器有）——真机取证只能靠截图序列+服务端日志+DB。e) uiautomator 真机 dump 比 RN 文本可靠（本次全程可用），composer 多行文本命中 EditText 会吃掉 swipe 手势（表单滚不动的原因）。
【附带发现的真机 bug（待登记）】表单页（ScreenFormLayout + StickyFormFooter，如服务商添加表单）在真机上 footer 被裁剪不可见——「创建」按钮 uiautomator 零边界、屏幕下半空白；与 IME 半死态时间上相关但重启+IME 切换后仍复现过一次，根因未定（疑 useReanimatedKeyboardAnimation 幽灵键盘高度或 ScrollView 手势被输入框吃掉），需专项排查。
【未做/下一步】mock-dead 真机复刻「连接死亡→永久 0 字挂起 + 停止按钮有效性」；RCTNetworking didReceiveNetworkData 停摆机制深挖（为何真机 37s 才停）；⑤ spec 按新形态回炉重写。

user:
重写 spec 并进行修复吧——⑤ 回炉正式开工。

assistant:
（⑤ 回炉闭环，2026-09-24 深夜）**spec/prd 重写 + 修复实现 + e2e 三幕全过，提交 5826d19e（feat/llm-stream-timeout，未 merge）**。
【三路研究结论（RN 0.85.3 npm 包自带 ReactAndroid/ReactCommon 源码，本地直读）】A 路——增量停摆机制：native `readWithProgress`（NetworkingModule.kt:812-854）每 8KB 读立即发增量事件、发射链路无阻塞点；**停摆最可能=每事件 JS 成本超线性（XMLHttpRequest.js:383 `this._response += chunk` Hermes 无 rope 累计 O(n²)+GC 风暴；网络事件与定时器共用 RuntimeScheduler 队列，积压→渲染/计时冻结→流尾突发排空=尾部倾泻）**；responseText getter 只读 JS 累积值、native 无部分响应查询接口→**轮询绕行定论不可行**；根治=原生 SSE 模块（登记 Phase 2 不实施）。C 路——超时与连接池：**四超时全 0**（OkHttpClientProvider.kt L49-54）+池 5条/5min；**池内健康检查防不住静默半开**（h1.1 空闲<10s 连探测都不做；>10s 的 1ms 探测对无 FIN 连接误判健康）→复用后写本机缓冲即成功、读永久阻塞；**xhr.timeout 在 0.85.3 已实现且映射 OkHttp callTimeout**（NetworkingModule.kt L412-418 克隆 builder 开销极低）——JS 侧唯一 h1/h2 全周期控制面；Connection: close 被 RN 头无过滤放行、OkHttp CallServerInterceptor 尊重请求侧 close 用完即废，**h2 下被剥离（无效但无害）**。B 路——我方传输链全图（XHR onprogress→deliverNewText 切片→32ms emitter 节流；fetch reader 直投；abort 链 isRequestAborted 三判据）。
【模拟器补充实验】r1/r2 健康流：req 复用同一 conn（健康复用无恙——病灶在死连接不在复用本身）；r3 杀服务器→黑洞：受理后「生成中·3.4s·0字」**计时冻结**（指标 elapsed 是事件驱动渲染，无事件即冻结）+ **点停止触发自动重试再进黑洞**（isRetryableError 对 ProviderError("Request aborted") 走 status==null→true 分支）+ 服务器复活也不自愈。**修正认知：mock 服务器 46-49s 流长不是客户端反压，是 Windows 定时器分辨率（2ms setTimeout 实际 ~15.6ms × 3000 chunk）**。
【回炉方案（spec/docs 在 worktree docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/）】三层防御+一处语义修正：①XHR 流式请求强制 `Connection: close`（applyXhrHeaders 之后，覆盖用户同名头）——消灭死连接复用入口；②`xhr.timeout=SSE_WHOLE_CALL_TIMEOUT_MS(600_000)` 映射 callTimeout 整调用兜底（fetch 路径 whole-call 定时器同构），触发按 processedLength>0 分级（0字节=first-chunk 可重试天然走新连接；有输出=idle 不重试走失败链）；③watchdog 回炉为仅 idle（30s，活动前无任何定时器——缓冲型模型零误杀，首字臂删除）；④isRetryableError 补 abort 形态 ProviderError 不可重试（口径对齐 isRequestAborted 第三判据）。恒量导出更新（FIRST_CHUNK_TIMEOUT_MS 删除、SSE_WHOLE_CALL_TIMEOUT_MS/LLM_STREAM_TIMEOUT_ERROR_NAME 新增；type 导出运行时不可见不进 allowlist 快照——踩过一次）。
【测试与构建】定向 27/27 绿（T-D1~D7：Connection:close 头序断言/xhr.timeout 赋值/ontimeout 双分级/fetch whole-call/abort 不重试/idle 语义/零误杀）；core 全量 2163 测试仅 T-C2/T-C6 时区基线 2 红；mobile tsc 的 agent-editor 测试红为基线噪音。**worktree 深路径撞 CMake 250 字符对象路径上限**——`mklink /J D:\nm5 <worktree>` 短路径 junction + 清 .cxx 后构建成功（构建产物残留 assets bundle/res 目录为未跟踪态，勿提交）。
【e2e 三幕（模拟器诊断构建=worktree 修复版内嵌 bundle）】(a) mock-fast 正常流：conn#1 完成即关（15:02:42.451 完成→.455 关闭，**Connection:close 生效不进池**；对照旧构建连接挂几分钟等复用）；(b) mock-dead 黑洞：conn#2 新建（不复用！）→服务端 HANG→UI「生成中·14.0s」**计时在走**→点停止→服务端实测「挂死连接被客户端关闭」+ 零僵尸重试（req#2 后无 req#3）+ UI 终态「上次生成·15.9s」+ 发送键复活；(c) 重发 f4：conn#3 全新连接→SSE 完整完成→conn#3 关闭。**用户 bug 三条恢复路径全部实测：停止→干净收尾可再发；再发→新连接成功；无僵尸重试。**
【过程新坑】①**lastMessageIsPlainUserText 守卫**：最后一条是未回复的纯文本用户消息时 composer 禁用（inputDisabled）+ 发送静默返回（t0 打完日志就 return）——一度误判为「新构建 dispatch 断链回归」，实为设计行为；e2e 用 DB 造新会话绕开。②模拟器 `input text` 间歇失效（焦点建立失败，IME mIsInputViewShown 半死态在模拟器上也出现）——**composer 草稿 DB 注入**（chat_session.composer_draft_json = {"text":"f1","attachments":[]}）是可靠替代，配「无键盘态发送键 (990,2245)」。③DB 造会话 INSERT 要带 agent_config_json（agentId+modelId 从现有行抄）。
【环境终态】feat/llm-stream-timeout@5826d19e（12 文件 +509/-335，含 spec/prd/CHANGELOG）；模拟器在线装着修复版诊断 APK（MainApplication.kt 已还原、worktree git 干净除未跟踪构建产物）；mock 服务器已停；D:\nm5 junction 已删；真机已还原（前一轮）。合并注意不变：①④ BOOT_VERSION 顺延、①② repository 冲突、③ 硬门禁 chrome inspect 实证；⑤ 现在可进入合并候选（真机 manual 验收仍待做）。

user:
两个追问：①连接池复用是常见优化，Connection: close 直接关掉考虑过性能影响吗？②高速 LLM 输出过程中会出现卡顿、低速没有——和增量停摆（P1）有关系吗？

assistant:
①性能账算过、影响很小且范围收敛：Connection: close 只作用于 mobile 的 SSE 流式请求（postSseViaXhr）——app 其它 HTTP（模型列表/版本检查等）与 desktop/CLI 的连接池行为完全不动。而 SSE 聊天请求的形态是「低频、长时、单条重」：每次多付一次 TCP+TLS 握手（TLS1.3 约 1 RTT，移动网几十到两百毫秒量级），对照秒级到几十秒级的生成时长占比 <5%，且是首字节前的固定延迟、不影响吞吐。不保池的根本原因：RN 的 JS 面只有 xhr.timeout（整调用 callTimeout）一个旋钮，读超时设不了——「保池 + 死连接检测」需要 native 侧 setCustomClientBuilder/自建 OkHttp 客户端，属 Phase 2 原生 SSE 模块的活；届时可恢复池化并配健康检测。②高度相关，几乎可断定同病灶家族：高速模型=单位时间增量事件多，而 RN 管线每事件成本随累计长度超线性（XHR `_response +=` O(n²)+GC、webview 转录全量重渲染、流中 partial 持久化写），事件与定时器共用 RuntimeScheduler 队列——速率×成本超过处理容量就积压=输出中卡顿，极端时完全停摆、流尾队列排空=尾部倾泻。模拟器（慢 CPU）首包即停、真机（快 CPU）37s 后才停，正是「容量决定饱和点」；低速模型事件率低、在容量内无感，与用户观察精确吻合。已把「输出中卡顿」并入 P1 表现谱系记档。

user:
原生 SSE 和原生 HTTP 是一个东西吗？意思是弃用 RN 的 http 库？

assistant:
概念澄清：SSE 不是与 HTTP 并列的协议——SSE 请求就是一次普通 HTTP 请求（POST + Accept: text/event-stream），「流」就是这条响应体被服务端分块持续写下去而已。所以「原生 SSE 模块」换的不是协议，是**发这条 HTTP 请求的人**：现在走 JS XHR → RN NetworkingModule（RN 预配的 OkHttpClient，超时全 0、每 chunk 一事件、JS 侧 O(n²) 累积）；Phase 2 改为我们自己的 Kotlin 原生模块（新 workspace 包，先例 sksp-android/tokenizer-driver-rn/tdbc-driver-op-sqlite 三件套）持有**自己的 OkHttpClient 实例**——底层库与 RN 用的是同一款 OkHttp，但配置归我们（读超时/池策略/ping），native 线程读流+合批（~100ms 或 N KB 一批）再以受控节奏发 JS 事件。范围仅 LLM 流式请求，其余 fetch/XHR 照旧走 RN 的；wire 格式不变服务端无感知。修复机理：事件率可控 + 绕开 RN XHR 管线超线性累积 + 拿到读超时旋钮（可安全恢复连接池）。

user:
变动不小啊——原本用的是 core 提供的 API 客户端吧？现在是脱离了？

assistant:
没有脱离：core 仍是唯一的 API 客户端，原生模块只是传输层最底部「搬字节的管子」。core 的 llm-sse-transport 本来就有平台分叉（shouldUseXhrForSse：RN 走 XHR / desktop 走 fetch），Phase 2 只是把这个分叉换成可注入的第三个实现——按项目既有模式（tdbc-driver-op-sqlite/sksp：core 定 port、平台包实现、app 装配注册）。原生模块的契约面极小：connect(url, headers, body, timeout 配置) → onChunk(合批文本)/onDone(status)/onError(code)，**不含任何协议逻辑**——鉴权、wire 格式、SSE 帧解析、重试、超时分级、watchdog 全部留在 core 单源，desktop/CLI 零变化、无 Kotlin 侧协议重复（防漂移的关键：端口只搬字节不认协议）。变动量承认不小：新 workspace 包 + Kotlin + autolink + release.yml 构建清单（RULE 有漏登记前科）+ 双端回归，所以独立立项为 Phase 2。

user:
core 的传输层有必要单独成包吗（比如 sse-rn 这种）？fetch 和 xhr 现在也没拆包呀。

assistant:
不拆传输层本体，拆包判据是「原生代码必须住在哪」而非「传输逻辑住在哪」：fetch/XHR 路径留在 core 的理由——零原生代码零额外依赖（fetch 是 Node 全局、XHR 是 RN 运行时注入的全局，core 条件分叉即可用），拆出去只多一个包的构建与版本负担。Kotlin 代码没法进 core（core 是纯 TS 包、desktop/CLI 直接消费），所以新包只为原生模块而生：Kotlin 模块 + 薄 JS 包装（~百行：NativeEventEmitter 订阅、requestId 匹配、合批 chunk→port 回调）+ register 函数；core 侧只加一个可注入 port 与注册点（先例：configureLlmFetch 的 fetchFn 注入、registerOpSqliteDriver 的驱动注册），postSse 变三分支择优（registered native > XHR > fetch），mobile 启动装配、desktop 无感。**不把 postSse 搬进 sse-rn 包**：依赖方向会反转（core→RN 味的包）或平白多一层间接；watchdog/整调用超时分级这轮刚修好的语义会碎片化到两处；desktop 不该背这个依赖。测试面沿用 setShouldUseXhrForSseOverrideForTests 同款 override 模式扩一个 native 强制位。

user:
确认下范围：只有 SSE 吗？还是说还有其他部分也连带用 Kotlin 实现？

assistant:
Kotlin 范围只有一个——SSE 字节管子（一个模块一个包）。之前提到的「读超时/连接池/ping」不是别的组件，是这根管子自己那个 OkHttpClient 实例的配置项；P1 完整修复里的「转录渲染增量化」是 JS/WebView 侧的活，与 Kotlin 无关。三个既有原生包（sksp/tokenizer/tdbc-op-sqlite）不动不合并不扩张。**主动提一个边界决策点**：非流式请求（chatNonStream/listModels 走 RN 默认栈）同样是零超时、也可能黑洞（PRD 已登记为既有行为不在本期目标）——同一个 OkHttp 实例加一个极小的 postJson 面即可顺带收编，建议 Phase 2 spec 里作为决策项记录（成本很低，默认倾向收编，由用户拍板）；但除此之外不扩：port 保持字节级、非流请求没有事件率病灶、Kotlin 面越大协议泄漏与维护风险越高。

user:
拍板：非流式也收编处理。另问：原生模块和 JS 的桥接本身就是性能消耗点，SSE 高频率更甚——确定改原生能解决当前问题吗？

assistant:
【用户已拍板：Phase 2 范围含非流式 postJson 收编。】桥接问题的关键反转：**今天的问题恰恰是"每个 native chunk 过一次桥"**（readWithProgress 每读发一事件，高速流每秒几十上百次，每次都进与定时器同队列的 RuntimeScheduler——这正是卡顿/停摆的机制本体）；原生模块不是新增桥接，而是把过桥次数压到 ~10 次/秒（100ms 合批）。桥的固定开销（调度/唤醒/回调派发/参数编组）随**次数**线性，字节总量不变（内容总得过河）——合批砍的是次数 5-20×，且 native 读取在自己线程不再被 JS 节奏反压。诚实分层回答"能否解决"：a) 实锤消灭的两个最大成本源——XHR `_response +=` 的 O(n²) 累积（responseText 单字符串契约所致；我们的 port 无此契约，批次直喂 SSE 解析器无需拼整串）+ 事件风暴；b) 机制证据充分（队列饱和模型解释模拟器立即停/真机 37s 停/计时冻结/尾部倾泻全部现象），但**原生管子是必要条件非充分条件**——JS 侧还有两个超线性残留：消息正文逐 delta 累积（超长输出平方级）与转录 WebView 整段重渲染，故 Phase 2 完整方案=原生管子+渲染增量化+累积策略（数组 push/join）捆绑；c) 验收写死硬指标（mock-fast 12000 token 全程无冻结；10 万字长文不掉帧），可证伪不打包票。

user:
两个 JS 卡点（逐 delta 累积、WebView 整段重渲染）有优化办法吗？RN 高速 SSE 困境非我们独有——去查社区怎么处理的，有没有现成库或方案。

assistant:
（社区调研，2026-09-24 深夜）**结论：方向被社区反向验证，两个卡点各有业界标准解法，且无论买库还是自建，JS 侧两处改造都必须做。**
【库地形（native 管子候选）】①**@mattermost/react-native-network-client**（1.11.3，9 天前刚发版；新架构 TurboModule 支持；Android OkHttp 5.3.2 / iOS Alamofire）——Mattermost 产品级聊天应用的同款动机（官方说法：内置 fetch 处理不好流式与取消才自建）；确认能力：per-server 超时策略、退避重试、上传/下载进度事件；**SSE/chunked 响应订阅未在文档确认，Phase 2 spec 需仓库级核验**——头号买入候选。②react-native-sse-bridge-client（v2.2.0，2026-09 发布，自称直连 URLSession/OkHttp+暖池）——npm/libraries.io 可见但 GitHub 细节查不到（维护深度/合批/新架构未知），待核验的次候选。③**expo/fetch**——WinterCG 兼容 fetch、native 支持流式响应体，**bare RN 装 expo 模块即可用**；最大卖点：API 是 fetch，能直接塞进现有 postSseViaFetch 的 fetchFn 注入位（传输层零改动）；短板：大概率没有读超时/callTimeout 旋钮、chunk 粒度 native 决定不可控——解决"没有流"但不解决"零超时与合批"。④react-native-sse（binaryminds）纯 JS 走 fetch/XHR——与我们同管线同病灶，且有 Android 事件不触发 issue #68，排除。结论：Phase 2 spec 写"买 vs 建评估矩阵"——mattermost 客户端优先核验，自建（okhttp-sse 官方库打底，三包先例）为兜底。
【卡点一的社区修正】现代 JS 引擎（V8/JSC）有 rope/ConsString，`+=` 摊还 O(1)，"array.join 防 O(n²)"是老 folklore；**Hermes 的 rope 实现未公开文档化**，无专属基准——结论不是"必须 join"而是：设计成"按批追加、极少物化整串"（落库/快照时才 join），任何引擎行为下都稳；RN XHR 的 `_response +=` 累积则被原生管子直接消灭。
【卡点二的业界标准解】Google Chrome 官方指南（2025-01）结论：**append() 是渲染 LLM 流的最佳实践**——streaming-markdown 库按 append-only 增量渲染而非整段重解析；GitHub issue（streaming 圈通用讨论）确认聊天应用的通行做法=**块级 append-only 渲染**：已完成的块只渲一次、只对尾部"活跃块"节流重渲——与我们 chat-transcript webview 的 innerHTML 整段替换病灶 1:1 对应，streaming-markdown 是 web JS 可直接进 webview。GetStream/SitePoint 的通用建议（30-60ms 批量 flush、refs+interval、memo）佐证我们 32ms emitter 的设计是对的。
【对 Phase 2 的落点】管子选型（买 mattermost/建 okhttp-sse）× JS 两改（累积按批追加+块级 append 渲染）= spec 骨架；验收硬指标不变。

user:
生成 spec 吧（Phase 2 立项）。

assistant:
（Phase 2 spec 落盘，2026-09-25，b67085d4 @ iteration-docs-20260924）`docs/Iterations/llm-stream-native/{prd,spec}.md` + iterations.yaml 登记。
【摸底修正两个假设（探索代理报告）】①三家 SSE parser **已是数组 push + 终态 join**（openai:36-45 / anthropic:229-251 / gemini:143-151）——O(n²) 累积不在 parser；真热点=registry（create-agent-stream-registry.ts:46-59 per-delta 拼接）/ unit partialTextValue（:908，64ms 节拍）/ webview 显示态（stream.ts:313）。②纯文本路径的 webview 渲染**本来就是增量 append**（appendEscapedDelta :73-76 insertAdjacentHTML）——病灶精确定位在 richText 链：**RN 每帧对全量文本跑 markdown-it**（ChatTranscriptWebView.tsx:484-491/:531-538 RAF flush）+ **webview 整段 innerHTML 替换**（stream.ts:243/:266 applyTrustedHtml）；webview 已有轻量 markdown 350ms 升级层（stream-markdown.ts）。JS 侧三级合并（32/64ms）**够不到** RN XHR 的事件风暴层（合并在事件过桥之后）——原生管子 native 合批的必要性由此坐实。
【spec 要点】分层：Kotlin 管子（自有 OkHttp+读超时 30s/callTimeout 600s+独立池+100ms|64KB 合批+postJson；**不用 okhttp-sse**——port 只搬字节纪律）→ core port 注册三分支（registered native > XHR > fetch，⑤ 回炉的超时分级语义在三分支之上统一）→ fetch shim 收编非流式（configureLlmFetch 注入，零 adapter 改动）→ 累积数组化（物化收敛）→ 块级渲染（streamBlockCommit 协议：RN 只渲活跃尾块、块完成 markdown-it 渲一次、webview append 提交块；活跃块维持现有增量文本+350ms 升级；streaming-markdown 降为备选）。Step 1=评估门（mattermost PoC：SSE POST/chunk/abort 三硬核验 + 全局 OkHttp5 强制冲突核验，倾向自建）；Step 7=撤 Connection: close（条件=读超时就位+复用/死连接回归实验）。8 Steps + T-N1~N9（含 10 万字符线性耗时护栏测试）。
【新事实】mobile 非 Android-only——iOS 工程完整存在（xcodeproj/Podfile）但发布面仅 Android（release.yml 无 iOS job）；管子按 Kotlin-only 设计、iOS 将来发布则 port 回落 XHR。webview 构建=esbuild IIFE es2018 直出（引库须过无 lookbehind 约束）。NativeModules interop（tokenizer 同款）在 bridgeless 已可用，无需 codegen。

user:
[$spec-check-loop] loop check 一遍 llm-stream-native 的 spec。

assistant:
（spec-check-loop 两轮收敛，2026-09-25，提交 2e280242 @ iteration-docs-20260924）**R1 No-Go：3 P1 + 5 P2**——P1-1 native postJson 缺 method 装不下 GET（listModels 三家全 GET，照抄实施会把 GET 错发 POST）；P1-2 撤 Connection: close 缺运行时回落判定（native 未注册回落 XHR 时黑洞以 10 分钟形态回归——idle watchdog 首活动前不武装，唯一兜底 xhr.timeout=600s）；P1-3 T-N1「native 合批」测试不可落地（合批在 Kotlin 读循环，fake timer 是 JS 概念）；P2 含超限交互（RICH_CONTENT_MAX_CHARS=12k 全量判定下 AC-2 十万字场景全程纯文本，块级改造卖点落空——升级必修）、tokenizer 测试先例失实、port 形状/watchdog 上移边界、fetch shim 流式边界、装配点 dev logging 组合。doc-fix 单节点全闭合（含校准：tokenizer android 模块实有 Kotlin junit 测试只是未挂 CI——R1 审查也有小失实；设计定为「流中按块超限判定、终态/历史维持全量降级」「close 条件化撤除（XHR 且未注册时保留）」「T-N1 改 wrapper 级、合批精度归 manual」「request(method,...) 带 GET」「shim body 置 null 命中既有防御」「__DEV__ 下 createLoggingFetch(shim) 最外层」）。R2 复审：8 项全闭合、零 P0/P1、锚点逐条属实 → **Go（execute-ready）**。剩两条 P2（行号基准未标注合入漂移、streamCommit payload 漏 scrollIntent 字段）由主代理 trivial 豁免直改（已记档）。**待用户确认 execute-ready 后方可开工**（Step 1=评估门）。

user:
更新记忆，准备压缩上下文了。 [$apm-usage]

assistant:
（压缩前状态快照，2026-09-25 00:45）
【恢复锚点（三选一开工）】① 用户确认 llm-stream-native execute-ready → 从 Step 1 评估门开工（mattermost PoC：模拟器+mock 核验 SSE POST/chunk 事件/abort + 全局 OkHttp5 强制冲突，决策记录落 docs/Iterations/llm-stream-native/decision.md，不过即自建）；② 用户给 ①②③④⑤ 合并指令；③ ⑤ 的真机 manual 验收（黑洞停止/重发场景真机复走）。
【分支与提交全景】文档分支 iteration-docs-20260924：23818754（迭代文档基线）→ 7ef4967a（mock 服务器）→ b67085d4（llm-stream-native 立项 prd+spec）→ 2e280242（spec-check-loop 两轮修订）→ ccc3cffb（记忆补记）。五功能分支（基线 23818754）：feat/message-content-compression@635c714c / feat/rollback-large-jank@19e4e841 / feat/background-run-continuity@61a14db9 / feat/stream-metrics-tokens@64c0a0479 / feat/llm-stream-timeout@5826d19e（回炉版：Connection:close+SSE_WHOLE_CALL_TIMEOUT_MS(600s)+仅idle看门狗30s+abort不重试；定向测试 27/27 绿、e2e 三幕过、core 全量仅时区基线 T-C2/T-C6 两红）。全部未 merge（协作红线等指令）。
【合并红线备忘】①④ 同 bump SCHEMA_BOOT_VERSION 15→16 须顺延（先合 +1 后合再 +1，断言引用常量）；①② 同碰 sqlite-message.repository 小冲突；③ 硬门禁=chrome inspect 后台 timer 停摆实证未做；各 feature manual_user 真机验收未做；④ desktop 指标条采样器跨 run 未 reset 为非阻塞 polish。
【Phase 2 已定契约（spec 内有全文）】request(method,...) 带 GET；close 条件化撤除（XHR 且运行时判定 native 未注册时保留）；超限按块判定（流中块级/终态与历史全量降级双口径）；T-N1 wrapper 级测试；fetch shim=Response body 置 null 命中既有防御、__DEV__ 下 createLoggingFetch(shim) 最外层；不用 okhttp-sse（port 只搬字节）；Kotlin-only（iOS 工程存在但发布面仅 Android）；desktop/CLI 零变化。
【环境终态】真机 DSLDU20407006179：DB 已还原 pristine（备份 %TEMP%\rt_db\pristine.db）、IME 已还原百度、诊断 APK 1.5.23-diag(1301) 仍装着（同签名顶替了 1.5.21，退回需旧 APK）；表单页 footer 裁剪 bug（ScreenFormLayout+StickyFormFooter，创建按钮零边界）已登记待专项。模拟器 Medium_Phone_API_36.1 在线：装着 ⑤ 回炉版诊断 APK（worktree 构建），repro/新会话1/新会话2 测试数据在库，adb reverse 已设。mock 服务器已停；D:\nm5 junction 已删；⑤ worktree 有未跟踪构建产物（assets bundle + res 目录，提交时勿纳入）；worktree 深路径构建须 junction 短路径（CMake 250 字符限制）。运维配方：composer 草稿 DB 注入（chat_session.composer_draft_json={"text","attachments"}）+ 无键盘态发送键 (990,2245)；lastMessageIsPlainUserText 会禁用 composer（t0 后静默 return 属设计）；真机 logcat 无 ReactNativeJS 输出（模拟器有）；视觉转写禁带格式示例（会诱导幻觉）。
【会话工具沉淀】诊断构建配方（useDevSupport=false + bundle --dev true 进 assets + gradle；RN0.85 参数名注意）；mock-openai-server 用法全参数；uiautomator dump 解析脚本 %TEMP%\dump-parse.ps1（GBK 乱码可解码）。
