---
date: 2026-11-22
---

# mobile SSE UTF-8 解码修复（SPEC）

## 需求来源

非标准 PRD：用户口述 + 真机调查实锤（2026-11-22 会话，`docs/apm/memory/20261122-sse-utf8-mojibake.md`）。

**证据链**（全部可复现）：

1. 历史 DB 151 处独立坏点，每处恰 2×U+FFFD（3 字节中文被切两段独立解码）；`user_vfs_pending/queue` 另有错位重组字形态（「劝亚返娜饲槁」）。
2. 真机 4/4 次 LLM 流式调用 `transport=xhr`（app 文件日志）——精心实现的 native SSE 模块**从未接管**。
3. **mode G 判别实验**（mock 注入 30 处孤立 continuation 字节到 JSON 字符串内，真机三轮稳定复现）：
   - RN 真机落库：`text=1628 / 原文1787、FFFD=0、丢 22 段`——**无声损坏**（吞掉 FFFD 标记 + 丢内容）；
   - Node/WHATWG 同输入：`text=1847（原文+60 FFFD）、FFFD=60、零丢失`——**有声有损**。
   - 损坏点在 RN XHR 原生层 responseText 解码（`ProgressiveStringDecoder`），JS 层（FFFD 哨兵）零触发。
4. omz（Node WHATWG TextDecoder）同上游从不乱码；nm 因解码器语义差异放大损坏。上游网关（智谱直连/Zen 中转均有）逐块转发切断多字节字符是普遍输入，不可消除——**客户端必须容错**。

## 设计目标

1. mobile LLM 流式对 malformed UTF-8 达到 **WHATWG 语义**：每处 malformed 产 U+FFFD 标记、周围内容零丢失、EOF 截断序列补 FFFD。
2. native SSE transport 在真机**实际接管**（`transport=native` 可观测）。
3. 乱码从「无声损坏」变「有声可观测」：FFFD 哨兵（已装，`dispatch-sse-chunk.ts`）在损坏发生时落文件日志。
4. 验收资产入仓（probe fixture 化、WHATWG oracle 收编），可无限重复回归。

## 总体方案

五阶段串行（取证分叉在 Phase 1 内闭合）：

- **Phase A 可见化+取证**（**已完成，2026-11-22**）：注册失败可见化落地（`native.ts` registerWith 失败 warn + `setup-llm-fetch.ts` 注册结果 warn）；一次性设备取证**已定死根因**——不是「注册面缺失」而是**构建版本错位 × 探测自缚**：真机 APK（11-12 构建）Kotlin 方法面 = sseConnect/sseAbort/request 三方法（dex 实证无 `requestAbort`，该方法 11-17 `17cd4d55b` 才入仓），而 11-17 后 JS `isAvailable()` 探测升为四方法 → `requestAbort` 探测失败 → 流式永不接管。且 `requestAbort` 是非流式 shim 的取消方法，流式 transport 根本不用（流式取消走 `sseAbort`）。
- **Phase B 接管修复**（**已完成，2026-11-22**）：`isAvailable()`/`createBridge` 探测与解构降为流式必需的 `sseConnect/sseAbort`；`LlmSseNativeBridge` 类型收窄为 `Pick<…, "sseConnect"|"sseAbort"> & {events}`；`apps/mobile/__tests__/llm-sse-native-bridge-interop.test.ts` 增防回归用例（requestAbort 缺失仍注册）。**真机实证**：`注册结果: 成功(registered)`、`transport: "native"`、`native first chunk`（真机史上首次接管）。重打 APK（含 11-17 Kotlin）仍在后续版本对齐时自然发生，不阻塞。
- **Phase C WHATWG 解码器**（**已完成，2026-11-23，commit `edf2ec963`**）：`Utf8StreamingDecoder.kt` 落地（WHATWG UTF-8 decoder 状态机：maximal subpart 每段恰 1 FFFD、越界字节前置回流重判、EOF 残尾 1 FFFD、carry 内聚进 decoder），替换 `pumpStream` 的 `completeUtf8PrefixLength`+`readUtf8` 组合（两者退役）。JVM 单测 13 例全绿（WHATWG 官方形态 + 任意切分不变性 + mode G 粒度动态断言）；JVM 基建按 tokenizer-driver-rn 先例（`testImplementation junit:4.13.2`）。
- **Phase D 验收资产收编**（部分完成）：probe 判据已大小写不敏感（真机小写 `modeg` 触发，绕开 adb input 打不出大写的限制）；`replay-text.txt` / `whatwg-utf8-oracle.mjs` 仍在 `D:/tmp`，待迁入 `e2e/fixtures/` 与 `e2e/scripts/` 并参数化端口。
- **Phase E 真机验收**（**已完成，2026-11-23**）：重打 debug APK（`adb push`+`pm install` 通道；`adb install` streaming 在荣耀卡死）→ 注册成功、`transport=native` → mode G 注入流落库 **1847 字符 / FFFD=60，与 Node WHATWG oracle 逐字符一致（相似度 1.0000）**；干净回放流 1787=原文逐字零损失。三代对照：XHR 1628/FFFD0（无声丢段）→ Java REPLACE 1856/138（假标记）→ WHATWG 1847/60（精确）。

## 最终项目结构

```
packages/llm-sse-native/
  android/src/main/java/com/novelmaster/llmsse/
    LlmSseModule.kt            # pumpStream 接线新解码器（Phase C）
    Utf8StreamingDecoder.kt    # 新增：纯函数 WHATWG 流式解码器
  android/src/test/java/com/novelmaster/llmsse/
    Utf8StreamingDecoderTest.kt # 新增：JVM 单测（期望值由 Node oracle 离线生成）
  android/build.gradle          # 补 junit/testOptions（照抄 tokenizer-driver-rn）
apps/mobile/
  android/app/src/main/java/com/novelmaster/MainApplication.kt  # 依取证补注册（Phase B）
  e2e/fixtures/utf8-replay-text.txt        # 新增：回放文本入仓（原 D:/tmp）
  e2e/scripts/whatwg-utf8-oracle.mjs       # 新增：Node WHATWG 基线（原 D:/tmp 临时件）
  e2e/scripts/mock-openai-utf8-probe.mjs   # 改：REPLAY_PATH 指仓内 fixture、端口参数化、提示文案补 E/F/G
  src/runtime/setup-llm-fetch.ts           # 改：注册失败文件日志可见化
packages/llm-sse-native/src/native.ts      # 改：isAvailable false 区分原因上报
packages/core/test/infra/llm-protocol/llm-sse-transport-port.test.ts  # 补：FFFD chunk 透传契约测试
```

## 变更点清单

| # | 文件 | 变更 | 依据 |
|---|---|---|---|
| 1 | `apps/mobile/src/runtime/setup-llm-fetch.ts` | registerWith 返回 false / shim 回落时走文件日志（LogFactory）而非仅 console.warn | 探索B#3 取证缺口 |
| 2 | `packages/llm-sse-native/src/native.ts` | isAvailable false 时上报原因（模块缺位 vs 方法面不全） | 探索B 候选 C 判别 |
| 3 | `MainApplication.kt` | **取证后**补注册（显式 add 或修 autolink 输入），避免与生成 PackageList 双重注册 | 探索A/B P0 嫌疑 |
| 4 | `Utf8StreamingDecoder.kt`（新） | WHATWG 流式解码：逐字节状态机；malformed→1 FFFD 前进 1 字节；overlong/surrogate/超界按 WHATWG 替换；EOF 残尾→FFFD；不完整序列跨 read 保留 | mode G 实锤 + 探索A#5 EOF 偏差 |
| 5 | `LlmSseModule.kt` pumpStream | 用 Utf8StreamingDecoder 替换 `carry+completeUtf8PrefixLength+readUtf8(safe)`；**不得打乱 abort/finishStream 的锁与顺序注释**（L217-219/512-529/542-565） | 探索A#3.8 |
| 6 | `android/build.gradle` | 补 `testOptions.unitTests.includeAndroidResources = true` + `testImplementation junit:4.13.2`（照抄 tokenizer-driver-rn） | 探索C#4.1 |
| 7 | `Utf8StreamingDecoderTest.kt`（新） | JVM 单测：expected 序列由 whatwg-utf8-oracle 离线生成 fixture（含 mode G 注入流、EOF 截断、4 字节 emoji、孤立 continuation、overlong） | 探索C 建议 |
| 8 | `e2e/fixtures/utf8-replay-text.txt`（新）+ probe 改造 | 回放文本入仓；REPLAY_PATH 改仓内路径；`--port` 参数化（与 mock-anthropic-provider 解冲突）；提示文案补 E/F/G | 探索C#5 |
| 9 | `e2e/scripts/whatwg-utf8-oracle.mjs`（新） | Node `Buffer.toString('utf8')` 作 WHATWG 基线，输入任意 fixture 流，输出 decoded 文本 + FFFD 计数；`--gen-expected` 产 Kotlin 测试 fixture | 探索C#4.3 |
| 10 | `packages/core/test/.../llm-sse-transport-port.test.ts` | 补契约测试：native wrapper 投递含 FFFD 的 chunk → onChunk 原样透传零丢失 | 探索C#4.4 |
| 11 | `.github/workflows/{release,android-nightly,ci}.yml` | 修 `-w @novel-master/tdbc-driver-rn` 为实际存在的包名（顺手修，Android 构建链健康） | 探索B#4 |

**不动**：core `llm-sse-transport.ts` 三路分发逻辑零改动（native 分支已正确）；XHR 分支保留为 fallback（不删——native 缺位时的保命路径）；`dispatch-sse-chunk.ts` FFFD 哨兵保留（修复验收后转为常驻观测）。

## 详细实现步骤

- Step 1 — phase-diagnose — blocking: yes — qa: auto：注册失败可见化（变更 #1/#2），`log.warn` 进 `files/logs/nm-*.log`；llm-sse-native wrapper 测试补「isAvailable false 原因上报」断言。
- Step 2 — phase-diagnose — blocking: yes — qa: manual_user：一次性设备取证：真机装 dev 包跑一次 LLM 请求，收 logcat（`nm-llm` 告警 / `LlmSseNative` tag）+ `adb shell pm dump` / APK classes.jar 检查 LlmSseModule 是否在包内 + 文件日志确认注册结果。**产出根因判定**：注册面缺失（候选 A）vs 方法探测失败（候选 C）。
- Step 3 — phase-takeover — blocking: yes — qa: auto：依 Step 2 判定修注册：候选 A→补 AndroidManifest.xml 或显式 add（若 PackageList 已含则只修 autolink 输入，防双重注册）；候选 C→修 bridgeless 探测（如 `global.__turboModuleProxy` 路径）。重建 APK 真机验证 `transport=native`。
- Step 4 — phase-decoder — blocking: yes — qa: auto：写 `Utf8StreamingDecoder.kt` 纯函数（无 RN/okio 依赖，输入 ByteArray 输出 String + 残尾字节），WHATWG UTF-8 解码规范实现。
- Step 5 — phase-decoder — blocking: yes — qa: auto：`android/build.gradle` 补测试基建；写 `Utf8StreamingDecoderTest.kt`；期望值 fixture 由 oracle 生成（T-U2）。
- Step 6 — phase-decoder — blocking: yes — qa: auto：`pumpStream` 接线新解码器（保留 100ms|64K 合批、锁顺序、abort 闸门语义）；llm-sse-native 现有 `transport.test.ts`/`error-mapping.test.ts` 全绿。
- Step 7 — phase-acceptance — blocking: no — qa: auto：验收资产收编（变更 #8/#9）：fixture 入仓、oracle 脚本、probe 端口参数化与文案修正。
- Step 8 — phase-acceptance — blocking: yes — qa: auto：core port 契约测试（变更 #10）+ 全量回归（core 960 / desktop / mobile jest，core 改动后重建 dist）。
- Step 9 — phase-acceptance — blocking: yes — qa: manual_user：真机终验：mode G 注入 → native 接管 → 落库文本与 oracle 输出逐字符一致（FFFD 计数相同、零丢段）；同时跑 mode A/D 回归（合法流零损）。
- Step 10 — phase-acceptance — blocking: no — qa: manual_user：CI workflow 包名修复（变更 #11）；FFFD 哨兵转常驻观测的登记说明。

## 测试策略

### 测试用例

- T-U1 — blocking: yes — Step 1/3：注册可见化——模拟 NativeModules 缺位，断言文件日志出现注册失败与原因码。
- T-U2 — blocking: yes — Step 4/5：Kotlin 解码器 JVM 单测——用例组：① 合法中文流跨 read 任意切分零损；② 孤立 continuation（mode G 形态）→ 每 2 字节 2 FFFD 且余文零损；③ 4 字节 emoji 跨 read 截断；④ overlong（C0 80）/surrogate（ED A0 80）/超界（F4 90+）按 WHATWG 替换；⑤ EOF 残尾补 FFFD；⑥ 全部期望值 == oracle 输出。
- T-U3 — blocking: yes — Step 6：pumpStream 接线后 llm-sse-native wrapper 测试全绿（1000 chunk 1:1、超时、abort 语义不变）。
- T-U4 — blocking: yes — Step 8：core port 契约——native 分支 onChunk 收到含 FFFD 文本原样透传。
- T-U5 — blocking: yes — Step 9：真机 mode G 终验（与 oracle 逐字符 diff 脚本化判据，非肉眼）。
- T-U6 — blocking: no — Step 9：真机 mode A/D 回归（合法流零损）。
- T-U7 — blocking: no — Step 7：probe/oracle 脚本自检（`--check` 模式）。

## 风险与回滚方案

| 风险 | 缓解 |
|---|---|
| 双重注册（显式 add × PackageList 已含） | Step 2 取证先行；若 PackageList 已含则走 Manifest/autolink 修复而非 add |
| 真机构建分叉再现（本地包 vs CI 包注册面不同） | Step 1 可见化常驻；Step 9 终验含 `transport=native` 断言 |
| bridgeless interop 下新探测路径失效 | Step 3 候选 C 分支含 TurboModuleProxy 兼容写法；XHR fallback 保底 |
| Kotlin 解码器与 okio 语义差异引发新回归 | 纯函数 + JVM 全量字节级断言（T-U2 六组）；pumpStream 只换解码、不动合批/锁 |
| mobile jest 读 core dist 假绿 | Step 8 重建 dist 后跑（#279 纪律） |
| 回滚 | 变更集中：解码器为新增文件（revert 即回 okio 语义）、注册为一行、其余为测试/脚本——XHR fallback 始终在场，最坏情况回到现状（有损但可用） |
