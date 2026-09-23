---
date: 2026-09-23 23:50
title: mobile 端性能问题批次（5 项）：回忆登记 → 探索定根因 + content 压缩 spec 落盘
keywords: 性能优化, content_json 压缩, message-content-compression, 回滚卡顿, 后台任务冻结, 子代理卡住, 指标条, 输出, t/s, 高速 LLM 卡死, run 无超时, SSE 定时器, Choreographer, usage 事件
abstract: mobile 端 5 个性能问题：①content_json 压缩——已有立项，spec 已落盘（后台谓词驱动压缩任务绕开跨 boot 迁移框架缺口 + 行内双列双形态 + codec 收口 repository + search 去 LIKE 改内存筛），待用户确认；②大文本回滚卡顿——根因候选：回滚链 content_json 全量 parse ≥3 遍 + 快照恒单包无让步 + webview 全量重建（A+B 主嫌）；③后台子代理卡住（开关开/关都卡）——根因候选：RN Android JS timers 由 Choreographer 驱动、后台停摆，SSE 整流 setInterval(32ms) 是唯一投递通道、TDBC 16ms 让步 setTimeout 同停，FGS 保进程不保 vsync；④指标条——拍板 usage 优先 + tokenizer 兜底 + 实时速率；探索实证 anthropic/gemini 流中累计 usage 已在 parser state 只差 emit、openai 仅流尾、真 tokenizer 异步重只能 heuristic 增量+终值校正；⑤高速 LLM 卡死——四类超时全缺失为主干（同会话被 startRun 门禁锁死澄清），per-model 钉死最可能是服务端并发槽（客户端无 per-model 状态），待实验区分。
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
三轮收敛、五份全 Go（R1 三路并行审查：①Go+10条 / ②Go+8条 / ③No-Go / ④⑤No-Go → 5 个 doc-fix 并行；R2 两路复审：22 条闭合+1 P1 新遗漏（③）+若干 P2 → 1 个收尾 doc-fix；R3 轻量终检零问题全 Go）。抓到的真 P0 四个：③PRD「重试退避同机制覆盖」与 spec「登记不改」直接矛盾（修为「盘点并处置」，重试退避登记已知限制——总纲拍板记录标注待用户随 execute-ready 一并确认）；⑤超时错误会被 adapter 的 abort 吞错链当用户停止吞成 partial + isRetryableError 对未知错误默认可重试（idle 也会被重试）+ 接入点文件写错（model-retry-policy 是 KKV 存取，判定在 model-request.service）——修法 rejectOnce(超时错误) 抢占 settle + isRetryableError 显式分支 + 接入点改正；④openai 流尾终值校正无落点（FINISHED payload 不带 usage）——修法 runner 每 step done 后补发 run 级累计 usage 事件复用 EVENT_AGENT_STREAM_USAGE 管线；主代理补跨文档 P0：①④同期 bump SCHEMA_BOOT_VERSION 撞号——两边统一「不写死号、主干现值 +1、先合 +1 后合顺延」。R2 重要实证：③ driver 注册工厂有 index.ts/native.ts 双平行入口、mobile 走 native.ts（漏写必编译失败，已补+拍板共享注册函数转发）；②plan 拉取下界钉死 clicked.seq（审查逐消费点核实）；①KKV 标记两段式 nm-message-content/compactionDone、AC-1 按端拆分（desktop≥3:1/mobile≥2.5:1）、首启 60s 有界同步披露为口径修正。命名统一：④全链 completionTokens（outputTokens 不存在）。execute-ready 达成待用户确认；确认后可进 code-dev-loop。纪律事件：R1 的 A 路 doc-fix 子代理越权追加写本记忆文件（追加式无破坏、内容准确已核验保留）；后续派遣 prompt 均显式禁止写 memory。mobile-perf-2026-09 目录整树未跟踪，提交时留意纳入。
