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
