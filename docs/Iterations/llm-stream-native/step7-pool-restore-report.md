---
date: 2026-09-25
step: 7 (pool-restore)
type: manual_agent 实验
branch: feat/lllm-stream-native（HEAD 8817d8fa，实验代码零提交）
---

# Step 7 双路径回归实验报告：`Connection: close` 条件化撤除

> **初版语义记录**，终版见 `docs/Iterations/llm-stream-native/spec.md` §2 实施修正记录与 §7。
> 本报告完成于「native 流中读超时 30s 生效」阶段，当时的收敛窗口读数为 3 次尝试 × 30s ≈ 90s。终版按产品拍板**去掉全部流式空闲限制**（client 级 readTimeout 恒禁用、空闲看门狗退役），唯一自动兜底为单次 callTimeout 600s、最多 3 次尝试，首字黑洞的自动上限 ≈ 30 分钟；产品口径以**手动终止**为快速路径。故本文 a2/a3/b2 的「30s 内收敛」判读属初版语义留档，**不作为终版现状结论**；撤 close 的条件化形态（native 分支不设、回落 XHR 保留）在终版依然成立。

Spec 依据：`docs/Iterations/llm-stream-native/spec.md` §7——撤 close 是**条件化**的：本次请求走 registered native transport 时不设（native 黑洞由整调用 callTimeout 600s 单层兜底）；运行时判定 native 未注册/加载失败回落 XHR 时仍设（首字黑洞由 close + `xhr.timeout` 兜底）。本实验在模拟器上做双路径回归，判定「撤 close + native 默认启用」是否安全。

## 实验环境与配置

| 项 | 值 |
|---|---|
| 仓库/worktree | `D:\nm6`（git worktree，分支 feat/llm-stream-native，HEAD 8817d8fa） |
| 模拟器 | AVD `Medium_Phone_API_36.1` 无头启动，分辨率 1080x2400，boot 后 `sys.boot_completed=1` |
| 时钟校正 | **实测模拟器时钟比宿主慢 25s**（宿主 15:34:8862 vs 模拟器 15:34:8837，取整看为宿主快 ~25s；运维配方所记「模拟器快约 30s」与本次实测方向相反，本文所有对时以**模拟器时间 = 宿主时间 − 25s** 校正） |
| mock 服务器 | `node scripts/mock-openai-server.mjs --total-tokens 12000 --log-file mock.log`（主仓脚本；监听 127.0.0.1:8787，keepalive=true，mock-fast 2ms/chunk × 3000 chunk；连接级日志含自增 conn#、req#、keep-alive 复用判定=同一 conn# 出现第二个 req#） |
| 网络 | `adb reverse tcp:8787 tcp:8787`；provider baseUrl `http://127.0.0.1:8787/v1` |
| DB 注入 | UPDATE 内置 OpenCode Zen（id `c0ffeeee-0001-4000-8000-000000000005`）base_url → mock（走 defaultApiKey="public"，日志 `auth="Bearer public"` 实证，不依赖 keystore 密文）；INSERT llm_saved_model 一行（标准 UUID `b570f659-…`，vendor mock-fast，settings_json 沿用 schemaVersion2 形状）；实验会话用现有「新会话2」（`ce138bb5-…`），agent_config_json.modelId 指向新模型行 |
| 发送方式 | composer 草稿 DB 注入（`{"text":"…","attachments":[]}`，形状抄现有非空行）或 `input tap` 聚焦后 `input text`；无键盘态发送键实测 bounds `[922,2194][1027,2299]`（配方坐标 (990,2245) 命中其内）；键盘开态发送键漂移至约 (974,1447) |
| 分支证据 | dev bundle 下 `__DEV__` 自动开启 `logSse`，logcat ReactNativeJS 每请求打印 `[novel-master/llm-sse] → {method, url, transport: 'native'|'xhr'}`——分支判定的硬证据，与服务端连接日志互为印证 |

两个 APK 变体：

- **APK-A（native 注册路径）**：正常构建。MainApplication.kt 临时加 `useDevSupport = false`（RN 0.85 参数名）+ assets bundle + webview 产物链（`npm run build:webview` && `npm run build:webview:native`，在 apps/mobile 下）+ `gradlew.bat assembleDebug`。
- **APK-B（回落 XHR 路径）**：`apps/mobile/src/runtime/setup-llm-fetch.ts` 临时注释 `registerNativeSseTransportWith(registerSseTransport);` 一行（native 不注册 → postSse 逐请求判定回落 XHR → close 头生效），其余构建步骤同 A。构建后源文件均 `git checkout --` 还原。

## 实验矩阵

### a1 健康复用恢复（APK-A，native 路径）——**PASS**

**配置**：APK-A，mock-fast（12000 tokens，3000 chunk × 2ms），keepalive 服务器，连续两次发送（a1-first / a1second），间隔约一次完整生成。

**logcat（分支判定）**：两次请求均打印

```
[novel-master/llm-sse] → { method: 'POST',
  url: 'http://127.0.0.1:8787/v1/chat/completions',
  transport: 'native' }
[novel-master/llm-sse] native first chunk { bytes: 1687 }
```

**mock 服务端日志（关键行摘录，宿主时间）**：

```
[15:25:46.201Z] conn#1 建立 remote=127.0.0.1:56110
[15:25:46.211Z] conn#1 req#1 POST /v1/chat/completions model=mock-fast stream=true bytes=91815 messages=6 prompt_tokens≈24223 auth="Bearer public" include_usage=true
[15:25:46.214Z] conn#1 req#1 POST /v1/chat/completions -> SSE 共 3000 chunk，间隔 2ms
[15:26:32.338Z] conn#1 req#1 POST /v1/chat/completions <- SSE 完成，completion_tokens=12000
[15:27:25.014Z] conn#1 req#2 POST /v1/chat/completions model=mock-fast stream=true bytes=127886 messages=8 prompt_tokens≈36231 auth="Bearer public" include_usage=true
[15:27:25.015Z] conn#1 req#2 POST /v1/chat/completions -> SSE 共 3000 chunk，间隔 2ms
[15:28:11.565Z] conn#1 req#2 POST /v1/chat/completions <- SSE 完成，completion_tokens=12000
```

**判读**：两次完整请求全部落在 **conn#1** 上（req#1、req#2 同连接 id），期间 mock **无任何「conn#1 关闭」行、无 conn#2 建立行**——native 管子（自有 OkHttpClient + 独立 ConnectionPool）流结束后连接回池并被下一请求复用。对照面见 b1：close 头下同样的两次请求会表现为「每次请求一建一关」。

**UI**：两次生成均完成（会话头部「上次生成 · 48.8s · 正文 12,000 字 · 246 字/秒」；截图 shot-a1-r2-draft / shot-a1-r1-done 序列）。注：12000 tokens 全程约 46–49s，是 Windows 宿主下 Node `setInterval(2ms)` 实际精度的结果（3000 tick × ~15ms），与 app 侧消费速率无关。

### a2 死连接收敛（APK-A，native 路径）——**PASS**

**配置**：a1 req#2 完成后**杀掉 mock 服务器进程**（adb reverse 保留），再发一次（a2dead）。

**logcat（模拟器时间）**：

```
15:28:45.239 [nm-timing] t0 send
15:28:46.757 '→' POST …（transport: 'native'，第 1 次尝试）
15:28:49.005 '→' POST …（第 2 次尝试，间隔 ~2.2s）
15:28:51.422 '→' POST …（第 3 次尝试）
15:28:53.519 NativeSseTransportError: unexpected end of stream on http://127.0.0.1:8787/…
```

OkHttp 对「复用池内已死连接」失败（unexpected end of stream）自动重试新建，新连接同样失败（adb reverse 对已死端口回 EOF），三次后放弃，上抛可重试错误。

**UI**：`[生成失败] unexpected end of stream on http://127.0.0.1:8787/...`（对话流内失败消息）+ 会话头部「上次生成 · **8.2s** · 正文 0 字」；composer 恢复可用（发送键节点 `[922,2194][1027,2299]` 存在可点，可再发）。

**判读**：发送到失败态 **8.2s**，远在当时的 30s 读超时窗口内（初版读数）；错误可重试、无永久黑洞。b2 会对照 XHR 路径同场景的表现。终版该场景的收敛上限同源为 callTimeout（详见文首留档注）。

### a3 挂起态观察（APK-A，native 路径）——**核心 PASS；停止按钮子项存疑登记**

**场景说明**：a2 的「杀服务器」形态 8.2s 即收敛，挂起窗口太短；a3 主体改用 **mock-dead**（服务器活着、收到请求挂死不响应、保持连接）——这正是初版「读超时 30s」的设计目标场景（首字黑洞），与 a2 合起来覆盖「连接死」与「连接活但无响应」两种黑洞形态。（终版无此 30s 界，见文首留档注。）

**logcat（模拟器时间，a3stop 一轮完整链）**：

```
15:31:40.037 '→' POST transport: 'native'（req#1）
15:32:10.074 stream timeout { phase: 'first-chunk' }        ← +30.0s 整
15:32:10.289 '→' POST（自动重试 req#2，first-chunk 可重试语义生效）
15:32:40.317 stream timeout { phase: 'first-chunk' }        ← +30.0s 整
15:32:40.811 '→' POST（req#3）
15:33:10.829 stream timeout { phase: 'first-chunk' }        ← +30.0s 整
15:33:10.948 LlmStreamTimeoutError: 'LLM stream timed out after 600000ms waiting for the first chunk (native callTimeout)' → 最终失败
```

**mock 服务端（宿主时间）印证**（读超时断连在服务端留痕）：

```
[15:32:35.002Z] conn#2 req#2 … HANG model=mock-dead … 保持连接不响应
[15:33:05.002Z] conn#2 关闭
[15:33:05.002Z] conn#2 req#2 … HANG 结束：挂死连接被客户端关闭   ← 恰为挂死起点 +30s
[15:33:05.527Z] conn#3 req#3 … HANG …（重试的新连接）
[15:33:35.524Z] conn#3 关闭 / HANG 结束                          ← 又是 +30s
```

**UI 时序（截图序列）**：生成中状态明确显示「正在生成…」+「停止」按钮（shot-a3-cur.png 转写要点：「正在生成…」「停止」「上次生成 · 50.4s · 正文 0 字」）；计时持续增长序列 6s → 12s → 33.2s → 50.4s（shot-a3w1-6s / shot-a3w1-12s / shot-a3b-hanging / shot-a3-cur）——事件驱动计时在走。

**收敛结构（初版读数）**：每轮 run = 3 次尝试 × 30s 读超时 = **90s 有界收敛**（重试上限 3，非无限重试；a3stop3 一轮 logcat 三次 POST + 三次 timeout 后最终 LlmStreamTimeoutError，与 a3stop 一致），无永久黑洞。**终版语义**：流式已无任何空闲界（readTimeout 恒禁用、空闲看门狗退役），同场景每轮尝试不再有 30s 断连，收敛改由单次 callTimeout 600s 承接——3 次尝试的自动上限 ≈ 30 分钟，产品口径为「死流由用户手动终止、自动兜底约 30 分钟」。

**存疑登记 1（停止按钮）**：挂起窗口内共四次点击尝试（坐标 (494,2180)、(540,2030)、(540,2050) 于消息流「停止」按钮视觉位置，(974,2246) 于 composer 发送键位置），**均未中止挂死连接**——mock 侧每次都在挂死起点 +30s 整关闭（读超时路径），点击时刻无一对应连接关闭事件。两次点击确实落在挂起窗口内（tap 时刻 15:35:17 vs conn#5 挂死 15:04:56–15:05:26 等，详见异常记录节）。无法区分「模拟器坐标未命中 RN/webview 内按钮热区」与「停止链路未覆盖 native 挂起场景」两种解释，**登记为待排查**：初版读超时 30s×3 兜底使该问题不产生黑洞（安全冗余内），但建议后续以 e2e/真机复验停止链路（Step 8 已复验并实锤为真 bug，见该报告「停止按钮专项」；终版已修复）。

**存疑登记 2（错误文案）**：最终失败消息 `LLM stream timed out after 600000ms waiting for the first chunk (native callTimeout)`——600000ms 是 whole-call 常量语义，实际触发是 3×30s 读超时（90s）；文案数字与真实等待不符（行为正确、文案误导），登记。

### b1 请求仍带 close（APK-B，回落 XHR 路径）——**PASS**

**配置**：APK-B（setup-llm-fetch.ts 临时注释 `registerNativeSseTransportWith(registerSseTransport);`，构建后已还原），mock-fast keepalive 服务器，连续两次发送（b1first / b1second）。

**logcat（分支判定）**：进程更换（APK-B 重装重启），两次请求均打印

```
[novel-master/llm-sse] → { method: 'POST', … transport: 'xhr' }
[novel-master/llm-sse] xhr first chunk { bytes: 224 }
```

native 未注册 → postSse 逐请求判定回落 XHR → XHR 分支内 `!usedRegisteredTransport` 条件成立 → `Connection: close` 设置（spec §7 条件化语义的回落半边）。

**mock 服务端日志（关键行摘录，宿主时间）**：

```
[15:42:58.458Z] conn#10 建立 remote=127.0.0.1:55286
[15:43:00.414Z] conn#10 req#10 POST /v1/chat/completions model=mock-fast stream=true bytes=164599 … auth="Bearer public" …
[15:43:46.522Z] conn#10 req#10 POST /v1/chat/completions <- SSE 完成，completion_tokens=12000
[15:43:46.526Z] conn#10 关闭                                    ← 完成后 4ms 即关
[15:44:13.188Z] conn#11 建立 remote=127.0.0.1:55387             ← 第二次请求：全新连接
[15:44:15.391Z] conn#11 req#11 POST /v1/chat/completions model=mock-fast stream=true bytes=200670 …
[15:45:01.884Z] conn#11 req#11 POST /v1/chat/completions <- SSE 完成，completion_tokens=12000
[15:45:01.889Z] conn#11 关闭                                    ← 完成后 5ms 即关
```

**判读**：两个请求各自新建连接（conn#10、conn#11），每个响应完成后毫秒级出现「关闭」行——OkHttp 尊重请求侧 `Connection: close`（CallServerInterceptor → noNewExchangesOnConnection），连接用完即废不回池。与 a1 的「conn#1 承载 req#1+req#2、全程无关闭行」形成**同环境同操作序列下的行为对照**：复用差异即 close 头生效的直接证据，同时反证 a1 的复用是撤 close 的结果而非服务器/环境偶然。

### b2 死连接兜底（APK-B，回落 XHR 路径）——**PASS**

**配置**：b1 req#2 完成后杀掉 mock 服务器进程（adb reverse 保留），再发一次（b2dead）。

**logcat（模拟器时间）**：

```
15:45:11.689 [nm-timing] t0 send
15:45:13.144 '→' POST transport: 'xhr'（第 1 次尝试）
15:45:15.877 '→' POST transport: 'xhr'（第 2 次尝试）
15:45:18.891 '→' POST transport: 'xhr'（第 3 次尝试）
15:45:21.338 [agent-run] failed { ProviderError: XHR network error }（xhr.onerror 路径）
```

**UI**：`[生成失败] XHR network error` + 会话头部「上次生成 · **9.6s** · 正文 0 字」；composer 恢复可再发（历史失败消息 a2/a3/b2 三条并存可见，composer 均可用）。

**判读**：t0 到失败态 **9.6s**（3 次 XHR 尝试、每次 ~2.7s），**完全未触及 `xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS`（600s）整调用兜底**——close 语义保证每次重试都强制新建连接，连接建立失败（EOF/refused）立即浮出，不存在「高速流后死连接复用静默挂起等 10 分钟」的黑洞回归。错误 ProviderError(HTTP_ERROR) 可重试，无黑洞。

## 总判定

**双路径全过，Step 7 通过——撤除 `Connection: close` 按「条件化」形态定案**：

| 实验 | 路径 | 判定 | 一句话证据 |
|---|---|---|---|
| a1 健康复用恢复 | APK-A native | **PASS** | conn#1 依次承载 req#1+req#2（12000 tokens 完整流 ×2），期间无连接关闭/新建——native 管子连接池复用恢复 |
| a2 死连接收敛 | APK-A native | **PASS** | 杀服务器后发送，OkHttp 三次尝试（~2.2s 间隔）后 8.2s 出 UI 失败态，可重试，无黑洞（≪30s 读超时窗口，初版读数） |
| a3 挂起态观察 | APK-A native | **核心 PASS（初版语义）** | mock-dead 挂死下「正在生成…」计时 6→12→33.2→50.4s 持续增长；每轮 3 次 × 30.0s 读超时整点断连（mock 侧 +30s 关闭留痕）后收敛 LlmStreamTimeoutError，总 90s 有界、重试上限 3（终版无 30s 空闲界，自动上限 ≈ 3×600s≈30 分钟，见文首留档注）；**停止按钮子项存疑登记**（四次窗口内点击未中止连接，见登记 1） |
| b1 请求仍带 close | APK-B XHR | **PASS** | transport:'xhr' 下 conn#10/conn#11 每请求新建、响应完成后 4–5ms 即关——用完即废不保活，与 a1 复用行为对照鲜明 |
| b2 死连接兜底 | APK-B XHR | **PASS** | 杀服务器后 3 次 XHR 尝试 9.6s 收敛 ProviderError 可重试，未触及 600s xhr.timeout——close 保证重试新连接、黑洞不回归 |

- native 分支不设 close 的安全性成立：健康路径池化复用恢复（a1），死连接与挂死黑洞均由「整调用预算 × 重试上限 3」有界收敛（a2/a3），无永久黑洞。初版该预算表现为 30s 读超时（实测 90s 收敛）；终版读超时退役、自动兜底为单次 callTimeout 600s（3 次尝试 ≈ 30 分钟），结论方向不变、窗口读数以终版语义为准。
- 回落 XHR 保留 close 的必要性维持：close 保证死连接场景快速失败（b2 9.6s，不等 600s），且只在回落时付出「不复用」的代价（b1）。
- **无需触发「整体保留 close」的回退分支**（该分支的改法备而不用：llm-sse-transport.ts XHR 分支去掉 `!usedRegisteredTransport` 条件恢复无条件设置——仅在任一实验失败时才需要，本次未触发，不改代码）。

## 异常与翻车记录

1. **会话列表不显示 DB 新插入的会话**：直接 INSERT chat_session（step7-A）后 app 列表不显示（行在库中、无列表项）；原因未深究（列表可能从 vfs 快照/内存 registry 水合）。绕行：改用现有活跃会话「新会话2」（ce138bb5）——UPDATE 其 agent_config_json.modelId 指向注入模型 + 注入 composer 草稿，实验照常。
2. **首次点击进错会话**：视觉模型给的列表坐标 (450,675) 实际落在「新会话1」上，其最后一条消息是未回复 user 文本 → lastMessageIsPlainUserText 守卫静默吞掉发送（t0 send 打点后无任何后续，logcat 仅 1 行）——配方预警的坑实踩一次。改用 uiautomator dump 的列表项 bounds（列表页 dump 可靠）精确定位后恢复。
3. **停止按钮四次窗口内点击未中止挂死连接**（a3 存疑登记 1）：坐标经裁剪图二次校准仍无效，连接均在挂死起点 +30s 整由读超时关闭。无法区分「坐标未命中 RN/webview 按钮热区」与「停止链路未覆盖 native 挂起场景」，登记待 e2e/真机复验。安全影响有限（读超时兜底内），但若为真 bug 建议单独立卡。
4. **最终失败文案数字失真**（a3 存疑登记 2）：`LLM stream timed out after 600000ms … (native callTimeout)` 中 600000ms 为 whole-call 常量，实际是 3×30s 读超时（90s）收敛；行为正确、文案误导，登记（不属本步改码范围）。
5. **时钟方向与配方相反**：实测模拟器比宿主**慢** 25s（配方记「快约 30s」）；本报告全部按「模拟器时间 = 宿主时间 − 25s」校正对时。
6. **Windows 定时器精度**：mock-fast 标称 2ms/chunk，宿主实测 3000 chunk 全程约 46s（~15ms/tick）；对连接复用/超时判定无影响，只影响吞吐速率读数。
7. **mock-fast 全速流期间 logcat 无合批事件率打点**：native 合批事件率（~10 事件/s 量级）属 T-N8/AC-1 验收项，本步未采集（超范围）。
8. **杂项**：`adb shell cat` 拉库在 Windows 下换行符污染（SQLITE_CORRUPT），换 `adb exec-out` 解决；`timeout /t` 在本 shell 不可输入重定向，换 PowerShell Start-Sleep；仓库根无 build:webview 脚本（在 apps/mobile 下）；uiautomator dump 对 RN 动态节点（发送键状态、停止按钮、正在生成）多陈旧/缺失，主证据链按纪律以服务端日志 + 截图序列为准。

