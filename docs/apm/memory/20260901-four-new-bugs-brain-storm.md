---
date: 2026-09-01 23:50
title: 新四问题探索：长文本输入变删除、统计模型下拉与维度、工具卡 markdown 预览不渲染、速率单位改短
keywords: ChatComposer, TextInput, 数据统计, 模型下拉, provider 维度, markdown 预览, token/s
abstract: 用户报告四个新问题（均 mobile）：1) 输入框文本过长时出现"输入文字却删除文字"；2) 数据统计模型下拉无法滚动且建议改 provider×model 维度；3) 从工具卡片进 markdown 预览不渲染，切文本 tab 再回来才正常（疑入口未刷新）；4) 统计汇总平均速率单位 token/s 改为 t/s。按 brain-storm 派三路 readonly 探索。
---

user:
报告四个新 bug：1) 文本过长时输入框会出现"输入文字却是删除文字"；2) 数据统计的模型切换下拉框无法滚动、很多模型无法选择，建议统计维度改成 provider×model；3) markdown 渲染有问题——从工具卡片（如编辑）进 markdown 预览时不渲染，切到文本 tab 再切回来才正常，其他入口正常，怀疑入口没刷新；4) 统计汇总的平均速率单位 token/s 改成 t/s。要求使用 brain storm skill。

assistant:
按 ~/.agents/skills/brain-storm 流程派三路并行 readonly scout 探索（问题 2 与 4 同屏合并为一路），等待报告后汇总。

assistant(汇总):
三路 scout 报告结论：
1) 输入变删除：ComposerAtPathInput 是 children 驱动全量受控 TextInput（无 value prop），库每次渲染 createElement 新 children → 每键全文重推原生 EditText（仓库铁证：已回退提交 99f5299 注释明言"重推 children 只会重建 spannable"，因真机 T-C2/3/4 回归被 e8aac80 回退）；每键同步 5 趟 O(n) 全文处理（tryAtomicMentionDelete 的 parseValue 先于长度守卫、库 diffChars 全文差分、mentionValueToPlain、useMentions useMemo 再 parse、setText+persistDraft），长文本 JS 滞后 → 重推旧全文覆盖原生新输入。children 路径不走 RN mostRecentEventCount 守卫（TextInput.js 仅 value 字符串才走 setTextAndSelection）。次嫌疑：IME 组合期长度骤减触发 tryAtomicMentionDelete 误删整个 mention（仅含 tag 时）。修复方向：复活 99f5299 children 引用复用（先查 T-C2/3/4 失败形态）+ 守卫提前 + 纯文本快速路径。
2) 统计下拉：StatsFilterBar.tsx:98-152 弹层选项裸 .map 平铺、无 ScrollView/FlatList，pickerSheet maxHeight:420 直接裁剪——根因确定，包滚动容器即修。provider×model 维度：chat_message.provider 列已有但存协议名（anthropic/openai/gemini，agent-runner.ts:588 落库口径注释明确）；真服务商在 llm_saved_model.provider_id→llm_provider.display_name，可与 model_name=vendor_model_id JOIN。改维度波及 core SQL（getModelBreakdown GROUP BY+其他桶归并）+ UsageStatsModelRow 类型 + SummaryTab/StatsFilterBar/screen state + 测试；需用户拍板口径（协议 vs 服务商配置）。存量 provider NULL 占比需 COALESCE 兜底。
3) 工具卡 markdown 预览首进不渲染：txt tab 直接 return <Text> 卸载 RichDocumentWebView → 切回=全新挂载（"切 tab 就好"机制确认）；最强嫌疑=push 转场期间同步挂 WebView（FileEditorScreen.tsx:97-111 注释明说会卡转场但只给 physical 只读分支加 80ms 延迟，session 分支即工具卡入口裸挂）；html 空走 plain 模式显示原文（RN 侧首帧缺失基本排除，但 previewEngine==='rn'+session scope 的 mdAnnotateActive 组合会强制挂 WebView 且 html=undefined → plain，次生缺陷）。修复方向：session 分支同套延迟 或 仿 chat-transcript 的 setDocument ack+重挂。待用户分流症状：原文可滚动复制（plain）vs 空白（渲染合成）。
4) 速率单位：唯一拼接点 format.ts formatTokensPerSecond（现值 tok/s 非用户所说 token/s），两调用点 SummaryTab third 卡片+DetailTab；同步 4 处测试断言（token-usage-format.test.ts:98,102、token-usage-stats-screen.test.tsx:899,938）。单点改 t/s。
待用户确认：① provider 语义=协议名还是服务商配置（决定 JOIN 与否）；② bug1 纯文本无 tag 是否复现；③ bug3 首进症状是原文还是空白、工作区入口是否同样复现。

user:
确认：1) bug1 纯文本可复现，与 tag 无关；2) bug3 首进症状是空白（未渲染），不是显示原文。provider 口径问题未答。

assistant:
两条现场确认收敛根因：bug1 排除 mention 误删（④），主犯=children 全量重推+长文本 JS 滞后（①+②）；bug3 排除 plain 模式（B），坐实转场窗口 WebView 初始化失效（C）。开修：新分支按 2A/4/3/1 顺序。

user:
provider 维度拍板：统计落库记 providerId + modelId（vendor_model_id），不是 provider name。历史数据匹配不上可接受，服务商删除重建丢匹配也合理，完全不需要 join。

assistant:
口径确定：chat_message 增 provider_id 列（写入时快照，agent-runner 落 savedModel.providerId）；聚合 GROUP BY provider_id + model_name；显示名查询时经配置解析（listProviders），解析不到归"其他/已删除"桶；筛选值改 (providerId, modelName) 复合。注：现有 provider 列存协议名不动（BILLED_INPUT_SUM_SQL 依赖 anthropic 判断）。

user:
（修复完成后确认提交）要求放到 feature 分支。

assistant:
四问题全部修复并分六个提交落在 fix/2026-09-stats-composer-markdown（自 main 拉出）：①8ff21dc 下拉包 ScrollView（根因=裸 .map 无滚动容器被 maxHeight 420 裁剪）；②47c0399 速率单位 tok/s→t/s（format.ts 单点+断言）；③964c098 FileEditor 全 scope 统一 80ms 延迟挂重预览（编辑器页恒以预览模式打开、session 入口首进 markdown 空白=转场窗口 WebView 初始化失效；切 tab 重挂即好与"txt 分支 return Text 卸载 WebView"机制吻合；测试 renderLoadedScreen flush 120ms）；④fcb00ac 输入变删除缓解：tryAtomicMentionDelete 先做 {@}/{$} includes 短路再 parseValue——纯文本按键不再全文解析（根治需透明输入+高亮层 overlay 重写，spec #25 已证 children 复用/库 patch 两条路真机 tag 消失不可行，另立迭代）；⑤b9562dd provider×model 维度：chat_message 增 provider_id 列（DDL+幂等对齐）、agent-runner 快照落库、GROUP BY provider_id+model_name、filter.providerId 三态全链路（summary/daily/hourly/requests）、mobile 下拉复合选项+分服务商×模型列表+未知服务商兜底、G-1b 用例；⑥f55e16d 记忆。验证：core 1792 全绿、mobile 触及套件 77 全绿、tsc 双端持平基线、prettier/eslint 干净（1 warning 存量）。注意：format.ts 曾因 git checkout 误丢工作区副本，自丢弃提交对象恢复。

user:
真机数据统计报 no such column: provider_id——补列没生效；问取的是什么 id、是否改表。

assistant:
取的是 llm_saved_model.provider_id → llm_provider.id（服务商配置主键 UUID，非协议名）；表加了 chat_message.provider_id（幂等 ADD COLUMN）。报错根因：改 SCHEMA_COLUMN_ALIGNMENTS 时未 bump SCHEMA_BOOT_VERSION（novel-master-bootstrap.ts 合同版本），存量库走快路径跳过 ALIGN——v9 注释记载 first_token_ms 曾同款翻车。已 bump 9→10（附 v10 注释）、重建 dist、core 1792 全绿、提交 8d94xxx 同分支。规矩已写入长期记忆。

user:
确认旧结构：之前 chat_message 没有 provider 配置 id 列吗？model_name 就是纯 vendorId？

assistant:
是。旧 chat_message 只有两列相关：provider 列存的是协议名（anthropic/openai/gemini，agent-runner 注释明言"与 saved model 的服务商解耦"，BILLED_INPUT_SUM_SQL 还靠 provider='anthropic' 判计费口径）；model_name 存纯 vendorModelId（savedModelForAppend.vendorModelId）。同名模型挂在多个服务商时旧结构完全无法区分——这正是统计改 provider×model 维度的动机，新 provider_id 列补的就是这块。

user:
输入框那个没根治的，加个日志吧，有日志可以定位。

assistant:
新增临时探针（未提交，随工作树生效）：apps/mobile/src/debug/composer-input-debug.ts（__DEV__ 门控、djb2 指纹比对不落内容、文件头带判读表）+ ComposerAtPathInput 五处埋点：native-change（原生上报 len/delta/hash）、children-push（重推指纹与最近原生上报比对，stale:true=陈旧重推实锤）、atomic-delete、programmatic-write、hydrate-apply。判读：delta<0 非删除时出现=原生侧在缩（IME）；stale push 后跟 delta<0=陈旧 children 覆盖（主嫌实锤）；native-change 成簇=JS 滞后。验证 prettier/eslint/tsc/12 测试全过。

user:
贴来第一轮输入探针日志：hydrate 663 → 首键 native 664 → push 661（stale）→ native 662（delta-2）→ push 659（stale）。

assistant:
实锤：删除发生在 JS 管线内部——每轮 native 上报 N、mention 库重建值恒为 N-3，重推把短值落实回原生，每键净 -2（与 delta:-2 吻合）。不是旧帧竞态。3 字符差额身份未定（怀疑 \r\n 口径或标记边界），已加差异窥探探针（stale 时打出首差异位置±6字符窗口、\r\n 转义可见），下一轮日志可定字符级根因。#2 stale 为挂载初始态，良性。

user:
第二轮窥探日志：at=656，aWin「任务让它真改工」vs bWin「任务让它真改一好个工」——原生多出的 3 字是「一好个」。

assistant:
字符级铁证：多出的 3 字在光标处、内容是 IME 组合期临时候选文本——mention 库差分→重建在组合未上屏时就把组合区搅碎（原生 660 → 重建 657），重推回原生杀死正在输入的组合文本=输入变删除。属 Android 受控输入×中文输入法经典冲突，长文本重建重、窗口大故更明显。修复（已写未提交，随工作树生效）：emitMentionValue 自愈对账——handleChangeText 在原子删之后、入库处理之前把原生上报存 nativeTruthRef（markup 形态，消费一次即清）；库重建结果与原生不等时以原生文本为准（直接作新 mentionValue，tag 由 useMentions 重解析），原子删/程序化写入路径不经对账。新增 self-heal 探针事件验证：修复生效后 children-push 应全部 stale:false。29 个 composer 测试全绿。验证通过后：提交修复+拔探针。

user:
修好了（真机验证通过）。

assistant:
结案：拔除全部输入探针（composer-input-debug.ts 删除、组件内五处埋点与 self-heal 日志移除），自愈对账修复保留并提交（fix 分支）。组件 grep 探针零残留，tsc 非 __tests__ 持平基线 8、eslint 0、composer 相关 28 测试全绿。案件归档：输入变删除=IME 组合期 mention 库差分重建吃字符+children 全量重推落实，修复=原生上报对账自愈。

user:
对 fix/2026-09-stats-composer-markdown 发起 code-review-loop（diff 模式）。

assistant:
按 skill 流程：base=631ac73(main) head=b8840b0，24 文件 +614/-154；fix-spec 路径定 docs/Iterations/stats-composer-fixes-2026-09/cr-fix-spec.md；派 readonly 评审子代理（B–K 维 + A 对照记忆文件所载需求）。

user:
对 fix/2026-09-stats-composer-markdown 发起 code-review-loop。

assistant:
diff 模式单轮：reviewer（readonly）评审 631ac73..b8840b0，结论"需产出 fix-spec"（P0=0/P1=2/P2=2，无 open spec_deviations）：CR-1[P1] desktop DTO 丢 providerId→同名模型多行、React key 重复（改法=DTO 按 modelName 聚合复原桌面旧行为+ipc 测试）；CR-2[P1] mobile 筛选项与汇总行 parity 破坏——(provider_id NULL×已配置模型) 与 (P×未配置模型) 两类存量行无选项可命中（改法=方案A：「其他模型」改 provider 维度传 {model:undefined, providerId:null}、每服务商加「·其他模型」项、对象形态 model 可 undefined、format.ts 注释校正+core/mobile 测试+parity 断言）；CR-3[P2] FileEditor 矛盾注释合并；CR-4[P2] 自愈对账加两条集成用例（chat-composer.integration 未 mock 库，可真实驱动）。spec-fix 子代理落盘 docs/Iterations/stats-composer-fixes-2026-09/cr-fix-spec.md（99 行，结构合规，行号/路径经核实修正：矛盾注释实际 L83-87）。open questions 待拍板：①desktop 是否上复合维度（CR-1 只最小复原）；②reloadModels 失败静默空态；③串行 listByProvider 偏慢。待用户确认后开工执行 fix-spec。

user:
发起 code-dev-loop 执行 cr-fix-spec（四条 must-fix）。

assistant:
DAG：wave-0 三路并行 worker（CR-1 desktop DTO 聚合、CR-2 mobile 筛选 parity 方案A、CR-4 自愈集成测试）+ CR-3 trivial 主代理直执（矛盾注释合并）；wave-1 verify 主代理直执；wave-2 cr-func readonly。子代理只改码不提交（避免同工作区 index 抢锁），主代理统一提交四逻辑块（09138cd/9dbc3d8/6810269/df6bc75）。CR-2 类型收敛为三形态联合（顶层 null 移除）、选项携带 value、providerModelFilterOptionKey 比对；残留边界：模型仅被另一服务商配置时仍无入口（NOT IN 是全局 distinct），方案 A 口径内可接受，另开迭代再议。CR-4 变异验证：破坏对账条件双用例挂、只破坏清空仅②挂；关键坑：testID find 命中的是 ComposerAtPathInput 组件自身 props（外层 onChangeText=直接调 commitComposerText 绕过 mention 层），必须 findAllByType(TextInput) 拿内部原生输入驱动。CR-1 desktop 测试非 jest，是 node scripts/run-tests.mjs（tsx+node:test），11/11。

assistant(收口):
cr-func（readonly reviewer）四条矩阵全闭合、func-ready: yes，spec_deviations 四项均为合理扩展/收窄（CR-1 null 桶归并、CR-2 三形态互斥联合比 spec 更严、CR-4 构造手段偏差但同一对账分支、CR-3 不写死 80ms）。verify 收尾：desktop tsc 0 错（main 侧）、触及文件 prettier 归一（desktop 两文件原不合规式）后 desktop 11/11、mobile 60/60 复跑绿。dev-ready 达成：四实现提交+格式提交，无 open must-fix、无 open spec_deviations。遗留（K 节，发版前）：CHANGELOG Unreleased 段补记（两分支合计）；open questions 仍待拍板：desktop 复合维度、reloadModels 错误态、方案 A 残留边界（模型仅被另一服务商配置时无入口）。

user:
生成 changelog。

assistant:
按 novel-master-changelog skill 撰写 Unreleased 段（此前无该段，1.5.8 为最近版本）：新增 1 条（服务商×模型统计，移动端——desktop DTO 聚合保持模型粒度故不标双端）；修复 5 条（输入法丢字、生成中残留+内部加固并句、markdown 首进空白、下拉滚动、t/s 单位）；dev-loop 同批引入又修复的（desktop 重复行、筛选 parity）与 schema bump、注释、测试均按原则不写。提交于 fix/2026-09-stats-composer-markdown，两分支合并后同进下个版本。

user:
git prune 然后执行发布流程。

assistant:
prune 清理（gc.log 删除、garbage 归零）后按 novel-master-publish skill 发版 v1.5.9：两 feature 分支 no-ff 合入 main（零冲突）→ CHANGELOG Unreleased 定版 1.5.9 - 2026-09-02 → 双端 package.json + android build.gradle 默认 versionName bump（build.gradle 有历史乱码注释非 UTF-8，需二进制方式改）→ 门禁测试：core 1794/1794、desktop 触及套件 27/27（全量 run-tests.mjs 不带参数会挂慢路径，跑超过 10 分钟被用户叫停，教训：desktop 全量测试须限定文件或查明脚本行为）、mobile 触及五套件 82/82 → 提交 4b11e60、打 tag v1.5.9、push tag 触发 Release、push main。CI 三平台产物（Android APK/Windows NSIS/macOS DMG）由 release.yml 构建发布。

user:
有点尴尬，又修出新bug了。1. 输入框tag效果一打字就消失变普通文本；2. 流式请求时其他消息全部丢失，只剩当前assistant消息不断流thinking，退出重进或流结束后恢复。怀疑是前面修复导致的。

assistant:
两个都是 v1.5.9 修复引入的回归，均已定位并修复（提交 c74ce03、363e399，本地 main 待真机验证）：
1. tag 消失：自愈对账拿「库重建值（markup 形态）」与「原生上报（展示 plain，markup 从不进原生 buffer，children 拼接即 getPlainString 投影）」直接比较，带 tag 恒不等 → resolved=truth 把 markup 换成 plain → 一打字 tag 必死。修复：对账改在 plain 空间比较（mentionValueToPlain(库值)===truth 则库无损直接采用；不等才以 truth 经 promotePlainMentions 重建 markup）。关键认知：node 验证 children part.text 是 plain 形态、markup 只存在 data.original；T-CR4① 旧断言「单一 plain 段」正是 bug 表现，已改断言 tag 幸存。
2. 流式消息丢失：可见性重挂修复的 dirty 路径重挂后，ready 链走 sendSessionSnapshot('preserve') 的 defer 路径（uiRunning+streamActive pending 到流结束）——空基线 WebView 只剩恢复注入的当前 partial。修复：dirty 重挂置 forceSnapshotOnReadyRef，ready 后首个快照带 force 直发（复用 D4 通道）。T-REPAINT 用例经变异验证。
教训：两处都被"复现用例+变异验证"抓住，回归用例必须随修复落库。遗留：desktop 全量 run-tests.mjs 挂死调查中断（分块定位到第 2 块时被叫停），待续。
