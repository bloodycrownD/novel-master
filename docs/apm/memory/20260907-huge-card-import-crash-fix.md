---
date: 2026-09-07 01:20
title: 巨型角色卡导入崩溃修复（导入失败可开、导入成功缓修）
keywords: [角色卡, 导入, 崩溃, OOM, huge-card-import-crash, character-card-import, mobile]
abstract: 用户报：终端用户导入巨型角色卡后应用直接崩溃且重启必崩。修复方向拍板为「导入失败但应用可打开，不杀死进程；导入成功路径缓修」。敏捷项挂 Iterations/character-card-import 下，分支 fix/huge-card-import-crash。
---

user: 感觉不如直接修复应用崩溃 bug，发布让它安装。bug 是用户导入一个巨大的角色卡，导致应用直接崩溃，重新进入也打不开。我觉得最快的方式就是导入失败但是可以打开，不让线程死亡，如何让导入成功可以慢慢解决。

assistant: 确认按 agile-dev 走 bug 流程：敏捷名称 huge-card-import-crash，父级迭代 Iterations/character-card-import；分支 fix/huge-card-import-crash 基于 dev 建 .worktree/huge-card-import-crash。双 scout 探索结论：①杀进程的是原生 OOM 非 JS 异常——导入链 try/catch 齐备（UI toast），但巨大卡片在 JS 堆多份全尺寸拷贝（document-io readFile base64 1.33×N → atob 峰值 3.3× → extract-png-chara decodeLatin1 逐字符拼接 → 整棵 JSON.parse → op-sqlite 绑定），角色卡导入无任何体积/条目上限（ZIP 对照有 VFS_ZIP_MAX_UNCOMPRESSED_BYTES=32MB / MAX_ENTRY_COUNT=5000，角色卡仅路径长≤512；错误码无 TOO_LARGE）；②重启必崩循环：ensureImportDirRules 给导入目录补 ruleEnabled=true 默认规则 + 导入后 clearSessionPromptCaches 清缓存 → 重启 loadMobileScope 自动选回 session → useChatTabScope.refreshChatMeta useEffect 无条件跑 → rule_snapshot/file_cache 必 miss → assembleWorkplaceDisplay 逐文件 vfs.read 全文（header 模式也是先整读再截）+ renderFileBlock/serialize/tokenizer 拼巨型串 → OOM；resilient fallback 自己也全量。修复方案：A 导入闸门（mobile pickAndReadBytes 先 fs.stat 预检 + core importFromBytes bytes.length 上限 + md 树总量/单文件/条目上限 + 新错误码 TOO_LARGE，阈值草案输入 48MB/树总量 32MB/单文件 8MB/5000 条）；B 读取侧降级（workplace 组装按元数据 size 预判，超限文件不读全文、占位符、不进 file_cache）——B 是解救已打不开应用用户的关键。消息 tail40 分页/工作区树元数据列表/checkpoint 指针化均健康勿动。

## 实现要点（worker 交付，主代理抽查通过）

- core：错误码加 TOO_LARGE；character-card-limits.ts（输入 48MB/总量 32MB 对齐 ZIP/单文件 8MB/条目 5000 + utf8ByteLength，TextEncoder 优先、Hermes 按 UTF-16 码元手数、代理对与 lone surrogate 与 TextEncoder 一致）；importFromBytes 解析前 bytes.length 拒收；validate-md-tree-limits.ts 三闸在 Phase A 后事务前零写库；常量经 public/vfs.ts 导出（allowlist 快照已更新）。
- mobile：pickAndReadBytes 加 maxBytes+buildTooLargeError（遵守 document-io「错误由业务域注入」层约定）；角色卡侧传 CHARACTER_CARD_MAX_INPUT_BYTES，stat 失败放行由 core 兜底。
- 读取侧：VfsEntryRepository.findContentSizeByPath（内联行 length(content) 字符数 + content store 行查 vfs_content_blob.byte_len 压缩字节）→ VfsService.findContentSize；loadOrFillFileCache miss 后先探测，blob 行对比 2MB（8MB/4 折算保守闸门），超限返回占位不读全文不写 file_cache，探测失败/null 回退原路径；filename 档位不探测。prepareUserMessagesForPrompt 同走 loadOrFillFileCache 天然受保护。

## 关键发现/踩坑（worker 记录）

- 新写路径 vfs_entry.content 恒为 NULL（正文全在 content store、行上只有 content_hash），length(content) 对存量毒数据取不到值；byte_len 是 zlib 压缩字节（RN 分支是 base64 长度），是明文下界，闸门按 4× 压缩比折算、宁可误占位。
- blobFs() 返回的就是 fs 对象本身（blobFs().stat 才对），写 blobFs().fs.stat 会 TypeError 且被 catch 吞成静默放行。
- worktree 起步 dist 缺失比记忆 #31 记的更多：tdbc-driver-better-sqlite3 / op-sqlite / cloud-sync-driver-s3 / sksp-android / tokenizer-driver-rn / build:webview 都要补建，mobile jest 首跑 13 套件挂全是环境问题。
- core 测试是 node:test+tsx 不是 jest；tsx --test 要传 glob 不能传目录。

## 提交与验证

- 86522528 fix(core) 导入闸门；342e7bbd fix(mobile) stat 预检；d89efde1 fix(core) 读取侧降级。
- 验证：core 全量 1841 绿；mobile 全量 186 套件 1095 用例绿；core build+typecheck、mobile 官方 typecheck 绿。主代理复跑：新增 7 套件 56 例 + document-io 17 例 + core build 全绿。

## 收尾

- 留痕：docs/Iterations/character-card-import/bugs/huge-card-import-crash/{prd.md,spec.md}（453f1b85）。
- dev 已 fast-forward 到 453f1b85（三提交 86522528/342e7bbd/d89efde1 + 留痕）；main 未动。
- 待用户拍板：是否发版与版本号（最新 tag v1.5.12，默认递增 v1.5.13）；发版时需按 #28 补 CHANGELOG（崩溃与拒收行为均为用户实际见过）。

## 救援包轮（用户拍板：激进方案——应用降级为数据库导出工具）

user: 更激进些：除数据库导出外全部页面/线程禁用，一进应用就是导出页；版本号 999 确保覆盖；导出数据后整个应用可删除——等于做一个数据库导出应用。

assistant: 确认理解并实现「救援模式」：崩溃链在 RootNavigator 挂载的 ChatTab，救援页不挂载导航树即永不触发；exportDatabaseBackup 走 checkpoint+文件级拷贝+清服务商表，不解正文，毒数据免疫。实现（8c032db4，dev）：rescue-mode.ts 开关（主干恒 false，惰性沉淀）+ RescueExportScreen + App 根部闸门；typecheck 绿。本地翻 true 打 v999 救援包（1.5.13-rescue），签名与 Release v1.5.12 完全一致（均 debug.keystore，fac6…3b9c）——之前还验证了 CI 从未配 ANDROID_KEYSTORE_BASE64、release.yml 的 versionCode=GITHUB_RUN_NUMBER（v1.5.12=94）。模拟器 nm-e2e 冒烟：覆盖安装后启动即救援页（uiautomator 验证文本）、进程无崩溃。产物：仓库根 NovelMaster-1.5.13-rescue-{universal,arm64}.apk。用户流程：装→导出 .nmbackup→卸载→装正式版→导入→重配服务商 key（备份不含密钥表）；v999 意味着该设备装不上后续更新，只能卸载重装（正是救援语义）。注意：.nmbackup 导入回正式版后毒数据也会回来，但正式版带读取侧降级+导入闸门，能打开能清理。正式发版 v1.5.13 待用户拍板。

## 真机验证（同日 +22m）

user: 安装到当前手机试试？我先验证下 / 没问题。

assistant: 荣耀真机（DSLDU20407006179）原为本地开发版（versionCode=1，versionName 1.5.12），adb install -r 装 rescue-arm64 首次被手机侧安装确认弹窗拒绝（INSTALL_FAILED_ABORTED），用户手动放行后 Success；进程启动、am start 带前台后用户目视确认救援页正常（「没问题」）。真机收尾：该机现为 v999 救援包，回正常开发版须卸载（数据丢）或先在救援页导出再卸载重装导入；受害用户交付物为仓库根 NovelMaster-1.5.13-rescue-{universal,arm64}.apk。

## 元凶卡片复现轮（+22m 后）

user: 发来 WuWa_Solaris-3_MVU_Edition_2026-08-22_0048.png（用户指认的元凶角色卡），要求复现。

assistant: 剖析（真实代码链）：文件仅 11.49MB、chara 元数据 2.47MB、md 树 556 文件/总量 2.51MB/最大单文件 33KB——四道闸门全部放行，**修复拦不住这张卡**，"巨大卡片撑爆内存"假设不成立。模拟器（nm-e2e、x86_64）复现：v1.5.12 亲自走 UI 导入（种子项目/会话行 + DocumentsUI 选择器；模拟器点击有「dump 后首击被吞」怪癖，swipe 式点按更可靠）——导入成功（角色描述+开场15+世界书540，库 221KB→3.4MB）、进程不崩、重启也不崩。崩溃未复现。待查变量：受害者版本（quick-sqlite 时代 ≤v1.4.27 有 heap 损伤老毛病，v1.4.28 起换 op-sqlite）与机型内存（导入链峰值 ~35-60MB，低端机 LMK 可杀）；受害者"重启必崩"在 v1.5.12+op-sqlite 上找不到机制。模拟器保留中毒现场（种子 repro-proj/repro-session + 已导入卡）待装修复版对照。若最终确认是该卡+低端机内存问题，现修复对它无效，需补「输入峰值防护」（如 stat 预检阈值下调或流式解析）。

## 真机复现成功 + 机制破案（同日晚）

user: 真机导入卡顿、无整机崩溃，但进项目卡死、重启无效；项目外新建正常。是不是模拟器性能太好？

assistant: 真机（荣耀 DSLDU20407006179）现场抓取：卡死时 mqt_v_js（Hermes JS 线程）103% 持续满载（累计 1:27→1:54 CPU），HeapTaskDaemon 33% 高压 GC，RES 464M，整机 7.4/7.6G + swap 2.5G 濒临极限；约 2 分钟后重活跑完、界面解冻（工作区 556 文件完整渲染）。force-stop 重启第二次启动 JS 线程累计仅 0.5s——file_cache/rule_snapshot 已持久化，热缓存进项目飞快。机制链：导入后 clearSessionPromptCaches → 首次进项目触发 556 文件全量组装（assembleWorkplaceDisplay 逐文件 vfs.read+JSON 序列化写缓存+renderFileBlock）在 JS 线程同步忙 ~2 分钟 → 用户以为卡死强制退出（缓存没写完）→ 重启再进又是冷缓存全量重跑 → 「重启无效」；低端机内存压力下 LMK 直接杀 = 受害者的「崩溃」。模拟器 x86 快 + 空载，几秒跑完所以看起来没事。受害者若版本旧（≤v1.4.27 quick-sqlite）另有 heap 损伤叠加。关键结论：本次修复对该卡无效——四闸门不触发（单文件最大 33KB）、读取侧降级不触发（远小于 8MB），需要第二轮修复：①组装链分块 yield（每 N 文件让出 JS 线程防冻结感）②文件数/总量超阈值时 token label 降级（元数据估算或占位，不跑全量组装）③缓存增量落盘（中途强退不丢进度）。真机当前状态：v1.5.12+已导入卡+热缓存；重测冷启动需重导或清缓存（无 root 不能直接删 session_kkv）。

## 第二根因破案与最终修复（同日深夜）

user: 真机卡死后「跑完了540文件，但解析后的加载仍卡顿？」→ 插桩定位。

assistant: 诊断链：v1000/v1001 探针包（mobile reload 三 promise + core doMaterialize/loadContextMetadata 逐段 console.log，注意 metro 缓存吞 dist 变更须清缓存+--rerun-tasks）→ 铁证：session reload 的 vfs.list/getDirRule 秒回，buildListRows 永不返回；细化探针后 loadContextMetadata +145ms files=556 完成而 evaluateRuleView 永不返回。根因：workplace-rule-engine 旧实现 computeDisplay 对每文件全量扫 fileSet+重排兄弟+findIndex，540 文件=540 次 O(N logN) collator 排序=O(N²·logN)；叠加无结果缓存（每次进视图/token 计算 cache miss 都重跑）→ 真机分钟级占死 JS 线程=「加载中…」永久；用户强制退出→file_cache/rule_snapshot 没写完→重启冷启动重跑=「重启无效」。用户拍板：属设计失误，本应存 Map，修复与原行为完全一致。修复 d040dc3f（buildDirSortPlans 每目录排序两次+名次 Map）+ 大目录回归测试；desktop harness 287.9→17.8ms，真机 reload 永不返回→0.4s（evaluateRuleView +299ms）。留痕 spec 已追记。剩余已知优化空间（未做，YAGNI）：auto 名次可由全量排序一趟派生省一半；collator 排序键预计算（Schwartzian）省 5-20×；walkDir 的 directChildDirs 仍是 O(D²) 目录数隐性平方；loadContextMetadata 每次三条查询（手机 ~130ms）可缓存。发版 v1.5.13 待用户拍板。

## 排序缓存设计讨论（+30m）

user: Windows 的排序确定不是懒加载吗？我们完全可以把顺序 map 持久化吧？只在文件变化和规则变化时更新，只读没必要每次算顺序。

assistant: 确认用户理解正确：Explorer 是虚拟化列表（懒渲染行）+ 视图内缓存排序结果、文件/规则变化才失效重排，之前「打开时排一次」是简化说法。方案分层：L1 进程内 memo（loadContextMetadata ~0.15s + dir 排序计划按工作区代数计数器缓存，VFS 写/规则变更走服务层统一 bump——风险低收益高，重复进入 O(1)）；L2 每文件持久化 collation 排序键（冷启动比较器从微秒降纳秒，但动 schema 须 bump SCHEMA_BOOT_VERSION）；L3 用户提的持久化顺序 map（失效面最宽：文件增删改名/mtime/规则排序字段/纳入模式全要 bump 目录序，L1+L2 后收益太小）。指出代码里 token 链已有同类模式（rule_snapshot 持久化 + 规则变更差集刷新），缺的正是 evaluate/list 侧的缓存。建议 L1 可做、L2/L3 缓做，等用户拍板。

user: 进程内 memo 就是 Java 的 ThreadLocal 吧？让 map 生命周期变长、应用启用期间不重复加载？代码逻辑变动不大？

assistant: 概念纠正：不是 ThreadLocal（那是按线程隔离，JS 单线程用不上；对应物是挂在长生命周期服务实例上的普通字段，类似 Spring 单例 bean 的成员）。生命周期=runtime/service 实例存活期（应用一次运行），rebootstrap 会重建服务即天然失效。代码量确实小，但失效设计有暗雷：角色卡/ZIP 导入直接走仓储层写库、不经过 vfs.service——挂在 service 写路径上的代数计数器会漏 bump，导入后 memo 吐旧列表（恰是毒卡场景）。所以推荐 ETag 式指纹校验替代写钩子：每次 evaluate 前跑一条轻量聚合（count(*)+max(mtime_ms)+max(head_version)，规则表同构一条），指纹不变直接用缓存——任何路径的写都会改指纹，天然免疫漏网；代价只是一条几 ms 的 SQL。冷启动首次仍全量算（那是 L2 排序键的活）。

user: 目录规则好像不在这个 SQL 里啊。

assistant: 确认真缺口：workplace_dir_rule 列只有 scope_key/logical_path/rule_enabled/sort_field/sort_order/head_count/tail_count/fill_policy，workplace_file_rule 只有 inclusion_mode——都没有 mtime/版本列，聚合指纹对「规则改值」（如开关联动、排序字段变化）天生失明，count 也看不到 UPDATE。解法：规则表行数天然极小（每目录/每文件一行人工配置，毒卡场景仅 2 行），不做指纹——每次 evaluate 全量重读规则（毫秒级小查询）并把序列化签名并进 memo key；最终 key=(scopeKey, filesFingerprint, rulesSignature)。给规则表加 updated_at 也可行但须 bump SCHEMA_BOOT_VERSION，为几十行数据动 schema 不值。

user: 这套指纹方案对持久化 map 不也生效吗？有什么区别？

assistant: 确认：指纹校验解决的是「失效正确性」，与缓存载体无关——持久化 map 同样安全，用户理解正确。区别只剩收益/成本账：L3 相比 L1 的全部增量收益=每次冷启动的第一进省 ~0.3s（仅 500+ 文件用户有感）；增量成本=持久化载体（kkv 语义不合/专表须 bump SCHEMA_BOOT_VERSION）、写回逻辑、跨版本格式漂移（app 升级改排序逻辑后旧 map 指纹仍对但内容按旧逻辑算——须再加缓存格式版本号参与失效；内存缓存重启自愈无此问题，持久缓存 bug 会粘住）。结论：先做 L1，键设计原样复用；L3 的指纹机制不变、只加载体与格式版本，真需要时再上。

## L1 缓存规格启动（+45m）

user: 先做 L1 吧，生成 spec。

assistant: 按 spec-generate skill 走：需求来源=用户口述（L1 进程内 memo：workplace 评估链缓存，键=scopeKey+filesFingerprint+rulesSignature，指纹校验失效）。派 3 个只读探索子代理：A 评估链与 service 生命周期（materializeLiveView/loadContextMetadata 构成、实例持有方、rebootstrap 重建）；B 指纹正确性审计（枚举全部写路径验证 count/max(mtime)/max(head_version) 必变，找反例）；C 既有缓存模式（kkv file_cache/rule_snapshot 键与失效、测试基建、mobile 调用面收益点）。spec 将落 docs/Iterations/workplace-eval-memo/spec.md。

## L1 探索结论（3 scout 并行）

关键发现：①rename 盲区——renamePathInScope/renamePrefixInScope 只 UPDATE path 列，count/max(mtime)/max(head_version) 三元组全不变，纯 rename 下缓存必假命中；②回滚盲区——resetHeadToVersion 写回历史 (version, mtime)，被回拨行非 max 持有者时三元组不变；③树拷贝保留源 mtime 且 head_version 恒 1，session 重拉/fork 在特定分布下三元组可重合；④规则表无版本列，同数改写（翻转 rule_enabled）count 抓不住——规则签名必须全量重读序列化；⑤工厂每次 new 实例、消费面大量一次性实例（@ 弹窗/picker/desktop IPC），实例级 memo 命中率低，须挂 conn 级 WeakMap（测试多库同进程、rebootstrap 换 conn 天然隔离）；⑥mkdir 空目录必须可见——指纹不能过滤 entry_kind；⑦既有先例 sessionApiPromptTokenCache（模块级 Map+写后失效）与 agent-runner 注释（实例去重被工厂击穿的教训）。结论：三元组指纹否决，改用 path 敏感有序聚合签名（group_concat(path:version:mtime, char(31)) 排序子查询）；失效纯读时校验、零写路径钩子。

## L1 spec 落盘（待用户确认）

spec 路径：docs/Iterations/workplace-eval-memo/spec.md（随 fix 分支 worktree，待确认后提交并入 dev）。要点：三元组指纹否决→path 敏感有序聚合签名（group_concat(path:version:mtime, char(31)) 排序子查询，不滤 entry_kind）；规则表全量重读序列化做签名；缓存挂 conn 级 WeakMap（跨实例共享+测试多库隔离+rebootstrap 自愈）；读时校验零写钩子；liveViewInFlight 升级为跨实例 inFlight；9 个测试用例 T-WMC1~9；6 个实现 Step（含真机 spotcheck 为非阻塞 manual_user）。

## L1 spec 已确认（用户：开发吧）→ 进入实现

assistant: spec 提交并入 dev 后派 worker 子代理按 Step1-5 实现（签名查询→缓存模块→服务接线→T-WMC1~9→dist+回归），主代理抽查+复跑关键测试后提交。

## L1 实现完成（worker 27be71c4，已并入 dev）

worker 单提交 9 文件：computeEntrySignature（签名 SQL 与规格逐字一致：排序子查询+char(31)+不滤 entry_kind+count 前缀防 NULL/歧义）；workplace-view-cache.ts（WeakMap<conn,Map<scopeKey,entry>>，entry 含 sigs/ctx/view/filetreeDisplay/inFlight，publish 带计算前采样 sigs，identity guard 清 inFlight）；workplace.service.ts 三入口统一 evaluateCachedView（命中短路→跨实例 inFlight→publish），移除实例级 liveViewInFlight，WorkplaceServiceDeps 加必填 conn（规格未写明 key 来源，最小侵入）。偏差三处均合理：conn 必填、deprecated materialize 计数 2→1（inFlight 合并语义）、缓存函数名落地。回归：core 1853/0、mobile typecheck+jest 186套/1095例、desktop typecheck、eslint 零告警。主代理抽查签名 SQL/接线/竞态注释并亲自复跑 21 例全绿。T-WMC1~9 全落地（rename/规则同数改写/回滚/跨实例/连接隔离/mkdir 全覆盖）。

## L1 真机验证收尾 + 新需求（DB 位置）

user: map 生效了吗？怎么还是实时加载感 → 日志验证（[L1] 探针，用户操作我拉日志）→ 生效：冷 MISS compute 948ms/sig 214ms，其后全部 HIT 评估 0ms；剩余 100-200ms/次 = vfs.list 目录行传输（世界书 540 行 ~200ms）+ 签名校验 + UI 渲染，且为 debug 包数值。用户追问「进入工作区指什么时候/为何一进全量算」→ 解释：评估单位是整个 scope（点开工作区面板/@ 弹窗/token 链三入口共用），设计上全量快照因 token 链与宏树本就需要全树、规则跨目录一致、全量成本已被缓存摊平；目录导航评估为零。用户拍板：就这样，撤日志收尾（已撤、dist 重建）。新需求：mobile DB 默认位置改到用户可见目录（如 Android/data 应用 data 目录）——待澄清 Android 11+ 文件管理器限制/API key 泄露面/卸载即清三点后定方案。

## CR diff 模式首轮 + 用户质询工作块价值/版本号（+3h）

cr 结论：需产出 fix-spec——P0=P1=0、P2=2（CR-1 占位块 mtimeMs=0 渲染成 1970 假时间戳随提示词送模型；CR-2 救援屏硬编码色板绕 useTheme 令牌），SD-1 救援模式无文档留痕待拍板；K 节：CHANGELOG 无 Unreleased 段、package-lock 漂移勿入库。

user: 导入闸门+读取降级是干嘛的？确定不是没用的修复？真正有用的不是平方修复？救援模式不是一次性产物？版本号怎么升到 1000 多了？

assistant: 诚实定位：平方修复（d040dc3f）是唯一真正修掉本次事故的修复；闸门/降级是基于最初错误假设（真·巨型卡 OOM）做的防御性加固，对本次事故无贡献，但防的是真实存在的相邻失败类（对齐 ZIP 导入既有 32MB/5000 上限、超大单文件占位保开机），已测试、成本低，建议保留。救援模式默认关零影响，可留可 revert（8c032db4 独立单提交）。版本号澄清：仓库/CI 干净（versionCode=GITHUB_RUN_NUMBER≈95、versionName 1.5.12 未动）；1000+ 全是本地测试构建（999 救援/1000-1002 诊断/1003 修复验证/1006 debug），只装在用户手机与模拟器；后果=用户手机装不上 CI 更新，须卸载重装一次。

## 救援模式撤出主干 + CR fix-spec 落盘

user: 救援模式这种东西怎么能混合到主分支？单独 worktree 保留源码，需要时再打包。

assistant: 拍板执行：revert 8c032db4（365959cb）并入 dev；源码保留在分支 rescue-mode-source（=8c032db4），打包流程已存长期记忆（worktree 拉取→翻开关→v999 构建）。CR fix-spec 落盘 cr-fix-spec.md 并入 dev：CR-1（P2 占位 mtime=0 渲染 1970 假时间戳）唯一 must-fix 待执行；CR-2 随 revert 消失；SD-1 fixed；K 节含 CHANGELOG Unreleased 补段。fix-spec-ready，待用户确认执行 CR-1。

## CR-1 执行 + CHANGELOG（收尾轮）

assistant: CR-1 修复 645b18b5（VfsContentSize 两变体带 mtimeMs、探测 SQL 投影 mtime_ms、占位分支真实 mtime；测试 33 例针对性 + 全量 1853 绿 + dist 重建）并入 dev。CHANGELOG Unreleased 段新增两条修复（大型角色卡卡死+超大卡导入保护），按 skill 校对清单过：L1/引擎重构为实现细节并入卡死条目不单列；1970 时间戳（未发布即修）与救援模式（未发布即 revert）不进 changelog。注意：主工作区当时被并行会话切到 feat/feature-optimizations-2026-09，CHANGELOG 须在 fix worktree（dev 内容）上改。
