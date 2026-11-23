# mobile SSE UTF-8 乱码根因与修复 spec

- date: 2026-11-22
- abstract: 真机 LLM 流式乱码根因实锤（RN XHR 原生层 malformed UTF-8 无声损坏 + native transport 从未接管），修复 spec 已落盘待确认。

## 轮次

### 2026-11-22 调查与实锤

- 需求来源：用户口述（DB 151 处 2×FFFD 坏点、write/edit 体感最多、角色卡导入也乱、omz 从不乱码）。
- 根因链闭环：mock 判别实验 mode A（合法碎字节流）/D（历史坏文本回放）全防御 → mode G（JSON 字符串内注孤立 continuation `BA A2` 30 处）真机三轮**逐位稳定复现**：落库 `1628/1787 字符、FFFD=0、丢 22 段`；Node/WHATWG 同输入 `1847 字符（原文+60 FFFD）、零丢失`。损坏点=RN XHR 原生层 responseText 解码（吞 FFFD 标记+丢内容），JS 层哨兵零触发。omz 不乱码=Node TextDecoder WHATWG 容错（有声 FFFD 标记零丢失）。
- 「native 从未接管」头号嫌疑：`MainApplication.kt` 显式 add 了 Sksp/Tokenizer 唯独漏 `LlmSsePackage`；但主仓 Nov14 生成 PackageList 已含该包——双重注册风险，须设备取证后再定补法（探索子代理三路并行报告）。
- Kotlin 解码现状：okio `readUtf8` 隐式 REPLACE 语义，非显式 WHATWG；EOF 残尾静默丢弃（偏差实锤）。
- 已装 FFFD 哨兵：`packages/core/src/infra/llm-protocol/logic/dispatch-sse-chunk.ts`（scope `llm.fffd-sentinel`，keep 注释）。
- 三次翻车教训（都记录在案）：①「逻辑演示」误称复现（虚构非法输入）；② mock 判据全文 includes 被会话历史污染（"modeE" 在历史里恒真，E/F/G 三轮全跑 E——判据必须只看最后一条 user 消息）；③ 贪心单字符 diff 误报缺失（必须用 difflib）。
- spec 落盘：`docs/iterations/mobile-sse-utf8-decode-fix/spec.md`（五阶段：可见化→取证→接管→Kotlin WHATWG 解码器→验收资产收编；T-U1..U7）——**待用户确认**。

### 2026-11-22 深夜：根因定死 + 接管修复 + 真机实证

- 「native 从未接管」根因**定死（dex + git 双实证）**：真机 APK（11-12 构建）Kotlin 方法面=sseConnect/sseAbort/request 三方法（classes10.dex 无 `requestAbort` 字符串）；`requestAbort` 是 11-17 `17cd4d55b`（八期取消链路）才入仓的；同期 JS `isAvailable()` 探测升为四方法 → 探测一个流式 transport 根本不用的方法（流式取消走 `sseAbort`）拒绝了整个接管。**构建版本错位 × 探测自缚**，非「注册面缺失」（dex 有完整注册面、四方法注解齐全、bundle 单实例——三嫌疑全证伪）。
- 修复：`isAvailable()`/`createBridge` 降为流式必需 `sseConnect/sseAbort`；`LlmSseNativeBridge` 收窄为 `Pick` 型；interop 测试加防回归用例（requestAbort 缺失仍注册）。包测试 + mobile 定向 12/12 绿。
- 真机实证链：`注册结果: 成功(registered)`（logcat ×2）→ 切「测试/glm-5.3」模型发 `modeGnativecheck` → 文件日志 `transport: "native"` + `native first chunk {bytes:35}`（**真机史上首次接管**）。
- mode G 终验（native 接管后 vs 修复前 XHR）：落库 1856/FFFD=138（有声标记+净内容 1718） vs 1628/FFFD=0（无声+净内容 1628）；Node WHATWG 参照 1847/60。**「无声损坏」已死**；剩余 REPLACE 粒度差（138 vs 60）是 spec Phase C（Utf8StreamingDecoder）的量化验收对象。
- 排查坑四连：① logcat 中文串被转义（grep 必须用 ASCII 前缀如 `[nm-llm]`）；② MSYS 把 `/sdcard/...` 转成 Windows 路径导致 uiautomator dump 全空（必须 `MSYS_NO_PATHCONV=1`）；③ 会话模型已删除时消息「发出即失败」且不产生任何 sse-transport 日志（先查 DB 的 `[生成失败] Model not saved`）；④ 锁屏下 force-stop 重启的 app JS 不跑（需用户解锁）。

### 2026-11-23 凌晨：Phase C/E 收官——WHATWG 解码器真机逐字符对齐 oracle

- `Utf8StreamingDecoder.kt`（commit `edf2ec963`）：WHATWG UTF-8 decoder 状态机（maximal subpart 每段恰 1 FFFD、越界字节前置回流重判、EOF 残尾 1 FFFD、carry 内聚），退役 `completeUtf8PrefixLength`+`readUtf8`。JVM 13 例全绿（两次红均为测试自身注入点数算错，decoder 无错）。
- **真机终验逐字符一致**：mode G 注入流落库 1847/FFFD=60 == Node WHATWG oracle（1.0000）；干净流 1787=原文逐字零损失。三代对照：XHR 1628/FFFD0（无声丢段）→ Java REPLACE 1856/138（假标记）→ WHATWG 1847/60（精确）。spec Phase A/B/C/E 全完成，Phase D 剩 oracle/replay 收编进仓。
- 新坑记录：① `adb install` streaming 在荣耀卡死（十几分钟无响应）→ 通道重启后 `adb push`（2.9s/191MB）+ `pm install -r -d` 稳定；② MSYS 对 `/data/...` 同样转换（push 目标被推进 git 安装目录）——**adb 设备侧路径一律 `MSYS_NO_PATHCONV=1`，此时本地路径须写 Windows 形式 `D:/...`**；③ `adb kill-server` 清空 reverse 映射（9753 probe 连不上时先查 reverse）；④ `adb input text` 在该荣耀上随机丢字且打不出大写（`modeG`→`modeatw`、`modeg`→`mg`）——关键注入用逐键 `input keyevent`（KEYCODE m=41/o=43/d=32/e=33/g=35），probe 判据改大小写不敏感；⑤ python heredoc 双层转义：工具层把 `\\uFFFD` 降级成 `\uFFFD`，python 单引号串又把它转义回 FFFD 字符本身——需要写字面反斜杠时用 `chr(92)+'uFFFD'` 拼接。

### 2026-11-23 发版前考据：更正上文「从未接管」的范围（用户质疑后逐版本读码）

- **上文「native transport 从未接管」「真机史上首次接管」只对开发态真机成立，范围写过宽了。** 实查 v1.5.34（乱码波 1 期间）/ v1.5.47（乱码波 2 期间）/ v1.5.50（最新发布）：三者的 Kotlin `@ReactMethod` 面均为 `sseConnect/sseAbort/request`、JS 探测均为同三方法、`setup-llm-fetch.ts` 均调用 `registerNativeSseTransportWith`——**已发布版本的 native 链路三处匹配，代码层面没有断点**（仍无 v1.5.50 真机 transport 日志作实证，那之前没这条日志）。
- 四方法探测（`17cd4d55b`，11-17）只进了 p25…p34c 开发 tag 与 main，**无任何 v* 发布 tag**。它只在「JS 比 APK 新」的组合（Metro 热更 × 旧 debug APK）下让探测失败；正式包 JS 内嵌、APK 同版本构建（Kotlin 含 `requestAbort`），不受影响。「v1.5.51 不带探测修复会比 v1.5.50 更糟」是错的。
- **对历史乱码的实际意义**：历史 154 处坏点 92% 为「孤立两字节 → 2×FFFD」形态，发生在 native 已接管的旧解码器路径上；WHATWG 解码器对同一形态**同样产 2 个 FFFD**（oracle 60=30×2）。本次两项修复（探测兼容、解码器 WHATWG 化）改善的是 malformed 的其他形态（旧解码器多标/错标的那部分，138→60），**不改变历史主流乱码形态的输出**。真实流里坏字节的来源至今未定（已排除：Kotlin 旧 carry 切分逻辑、VFS/压缩/hash 链；未排除：服务商/网关侧、请求方式差异）。
- 教训：**「X 版本上是 Y」必须逐版本读码或拿该版本的运行证据，不能从一个 tag 的三行 grep 外推成「已发布版本上正常」**；同样不能从开发态真机的现象外推成「从未」。

### 2026-11-23 深夜：历史乱码根因定死（v1.5.50 worktree 真机 e2e）——上面多段结论作废

**根因（纯客户端，与服务商/通道无关）**：`LlmSseModule.kt` 的 `completeUtf8PrefixLength` 用掩码 `0xF8` 判序列长度，`when` 只列了 `0xF0/0xE0/0xC0`，**lead 在 0xE8..0xEF 的 3 字节字符（U+8000..U+FFFF：高区汉字与全角标点）落入 `else -> 2L`**。一次 read 恰好停在该字符第 2 字节之后时，尾部被误判为「完整」并交给 `readUtf8` → 前 2 字节成 1 个 U+FFFD，下一段开头的第 3 字节孤立再成 1 个：**恰好 2 个替换符、丢 1 个字**。自 native SSE 模块初版（09-25）即存在；所有已发布版本均受影响。真实流的 read 边界随网络分包稀疏出现 → 坏点密度「每千字约 1 处」。

**证据链**（提交 `2aaa99005` 回归测试逐字复刻旧逻辑）：
- 真机 v1.5.50 原版（worktree `D:/worktree/v1550`，分支 `exp/v1550-utf8-e2e`）对**完全合法**的回放流两次落库均为 1856 字符 / FFFD=138（69 段全 2 连）；`transport=native`、`available=true`；Kotlin 旁路 WHATWG 探针报输入非法 **0**、服务端替换符 **0**。
- 字节级现场 138 条 `SPLIT` = 69 对，每对均为「read 尾部停在 E8/EF lead 的第 2 字节，`safe==carryBefore`」+「下一 read 开头第 3 字节孤立」：`E8 87|AA`（自）、`EF BC|8C`（，）、`E8 AF|B4`（说）、`E8 A7|84`（规）。
- 历史库 253 处坏点 **100% 为 2 连**；严格「前缀+原字+后缀」三段匹配还原 94 处，**92 处原字落在 U+8000..U+FFFF**（完好文本基本区汉字基率仅 20.6%；无关联时概率 2e-60）。2 例低区例外可由复读等其他来源解释。
- JVM：`E9 83` 尾部被判完整（低区 `E5 8F` 对照正确保留）；8000 个随机切点的合法长流旧逻辑坏 932 字全 2 连，`Utf8StreamingDecoder` 全部逐字无损。
- **同机同流对照**：v1.5.50 旧版 1856/138 → 修复版 1787/FFFD=0，逐字等于原文。

**作废的旧结论**（均源于同一个误读——把「1856/138」那条当成了 mode G 注入流，实际 probe 日志无 mode 行、是默认回放即干净流）：
- 「FFFD 138 vs 60 是 Java REPLACE 粒度粗」——错，138 是旧逻辑在合法流上自己造的坏点。
- 「本次修复不改变历史主流乱码形态的输出」「真实流坏字节来源未定」「建议先不发版」——全部作废。**WHATWG 解码器替换（`edf2ec963`）恰好移除了这段缺陷逻辑，历史乱码已修**；原计划 Phase C 的动机描述需按此更正。
- 「上游网关切断多字节字符是普遍现象」——无证据支持，撤回；mode A/B/C/D/E/F/G 全是我主动注入，从未证明真实流含坏字节。
- 「write/edit 是放大器」「omz 不乱码是因为解码器容错」——omz 不乱码是因为它没有这段 Kotlin 逻辑；write/edit 放大的说法仍成立（坏字写进文件永久化）。

**方法教训**：
- 实验读数必须连同**实验条件日志**一起核对（probe 有没有打 mode 行）——我只看落库数字就归因，连错三轮。
- 读旧代码时「逻辑看着对」不够：这个分支漏项我昨天人工推演过两遍都说没问题。可靠做法是**逐字复刻 + 可执行断言**（`LegacyDecoderRegressionTest`）和**历史数据的可证伪预测**（码点分区 vs 基率）。
- 在已发布版本上建 worktree 做 e2e 是用户给的方向，是对的：开发分支上早已被替换的旧逻辑只能这样拿到运行证据。worktree 依赖可从相邻 worktree 复制（根 + 六个嵌套 `*/node_modules`）再手建 workspace junction；根目录是 npm（`package-lock.json`），没有 yarn.lock，`yarn install` 会失败。
- 真机降级跑旧版本前整库备份（`D:/tmp/pre-v1550-exp/`，integrity ok）；本例 v1.5.50..main 无功能性 schema 变更（DDL 搬迁逐字符同形）。
