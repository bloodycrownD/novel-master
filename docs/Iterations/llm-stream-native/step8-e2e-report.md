---
date: 2026-09-25
step: 8 (e2e-hard-gates)
type: manual_agent 实验
branch: feat/llm-stream-native（HEAD b50771a6，实验代码零提交）
---

# Step 8 E2E 硬指标验收报告

> **初版语义记录**，终版见 `docs/Iterations/llm-stream-native/spec.md` §2 实施修正记录与 §7。
> 本报告完成于「native 流中读超时 30s 生效」阶段，AC-4 的收敛结构（3 次尝试 × 30.0s 读超时、93s 失败终态）与文案里的 `read timeout after 30000ms` 均属初版语义留档。终版按产品拍板**去掉全部流式空闲限制**（client 级 readTimeout 恒禁用、空闲看门狗退役），唯一自动兜底为单次 callTimeout 600s、最多 3 次尝试，首字黑洞的自动上限 ≈ 30 分钟；产品口径以**手动终止**为快速路径。AC-1/AC-2/AC-5 的丝滑度、块级渲染与连接复用结论不受影响。

Spec 依据：`docs/Iterations/llm-stream-native/spec.md` Step 8 + 测试策略 T-N8；PRD AC-1~AC-5 逐项对号。T-N9 真机验收留用户。

## 实验环境

| 项 | 值 |
|---|---|
| 仓库/worktree | `D:\nm6`（分支 feat/llm-stream-native，HEAD b50771a6——**含超时文案修复**） |
| 诊断 APK | 按 Step 7 配方重建：MainApplication.kt 临时 `useDevSupport = false`（构建后已 `git checkout` 还原）→ dev bundle → `build:webview`/`build:webview:native` → `assembleDebug`（BUILD SUCCESSFUL，含 llm-sse-native 模块）→ `adb install -r` |
| 模拟器 | emulator-5554（AVD Medium_Phone_API_36.1，1080x2400；中途崩溃一次后无头重启，见异常 1） |
| mock 服务器 | 主仓 `scripts/mock-openai-server.mjs`；AC-2 用语料替换为 markdown 版本的临时副本（标题/列表/代码块/引用/表格/空行），其余轮次用原版 |
| 网络 | `adb reverse tcp:8787`；provider OpenCode Zen（c0ffeeee-0005）baseUrl → mock；实验会话「新会话2」（ce138bb5） |
| 时钟 | 沿用 Step 7 实测：模拟器时间 = 宿主时间 − 25s（本文日志引用时以各自源时间为准，标注来源） |
| 发送方式 | DB 草稿注入（`composer_draft_json`）+ 无键盘态发送键 dump 实测 bounds `[922,2194][1027,2299]` → tap center(975,2247)；键盘态输入路线在 app 冷启动后两次失败（异常 2），弃用 |

## AC 矩阵

### AC-1 mock-fast 12000 全程丝滑 —— **PASS**

- **服务端**（mock8.log）：req 到达 15:59:59.8 → SSE 完成 16:00:46.2（宿主时间），completion_tokens=12000。
- **UI 终读**：会话头部「上次生成 · 46.5s · 正文 12,000 字 · 260 字/秒」（后续轮次稳定复现 46.5s/49.1s）。
- **截图序列**（ac1-r1-t0…t17，每 4s 一张，tap 后起拍）转写曲线：
  - t2「正在生成…」刚起（正文 0 屏）→ t3 约 2-3 段 → t5 约 4-5 屏 → t6 长文满屏 → t8 持续增长 → t9 约 7-8 屏 → t10 约 9-10 屏 → t12 完成态（计数行落定）→ t14 稳定。
  - 每 4s 采样帧正文量单调递增，**无「0 字憋全文」段、无 9s+ 纹丝不动（两个采样帧之间文字零变化即 8s+，未出现）、无尾部一次性倾泻**（完成前 t9→t10→t12 增量平滑）。
- 拐点：计数行在 t11-t12 间（第 44-48s）落定为完成态，与服务端完成时刻（宿主 16:00:46 ≈ 序列 t47s）吻合。

### AC-2 10 万字长文 —— **PASS**（模拟器面；真机留 T-N9）

- **参数**：mock 临时副本 `--total-tokens 100000 --tokens-per-chunk 8`（中文一字一令牌 → 正文字符数=100000）；SSE 12500 chunk × ~15.4ms/tick，全程 **192.1s**（服务端 completion_tokens=100000）。
- **UI 终读**（dump 结构化，非视觉）：「上次生成 · 194s · 正文 100,000 字 · 515 字/秒」；消息完整收尾、无渲染错乱（完成态转写正文满屏 markdown 元素完好）。
- **流中渲染**：截图序列 ac2-t0…t19（每 15s）每帧正文持续增长、无冻结段、无整屏闪烁重渲。
- **块级渲染（本迭代主场景）**：markdown 语料流中**逐块出现**——t2 帧已可见标题（加粗）、无序列表、`function wait(word)` 代码块（等宽渲染）、引用块、表格逐个成形，后续帧元素逐段累积；无「先纯文本尾部一次性变富文本」的整屏跳变。超限按块判定下 442 字/块均远低于 12k，全程富文本。
- **内存**：流前 TOTAL PSS 610MB → 流后 668MB（+58MB/10 万字正文，含 webview 渲染；无 OOM/GC 风暴迹象——UI 期间持续响应即旁证）。
- **速率**：521 字/s 吞吐下全程丝滑（约为 AC-1 速率 2 倍）。

### AC-3 非流式死亡收敛 —— **未专项实测（登记）**

本轮实验链路未覆盖 listModels/chatNonStream 服务端死亡场景的模拟器实测；该项由 Step 4 的 T-N4 自动测试覆盖（fetch shim 超时收敛 + Empty body 防御），本轮 mock 日志可见一次 `GET /v1/models` 正常往返。留登记，不阻塞。

### AC-4 mock-dead 收敛 + 新超时文案 —— **PASS（初版语义）**（停止按钮子项除外，见专项节）

- **收敛结构**（ac4stop 轮，tap 16:16:12.5 模拟器，**初版 30s 读超时读数**）：3 次尝试 × 30.0s 读超时，logcat 三次 `stream timeout { phase: 'first-chunk', source: 'native timeout: read timeout after 30000ms' }`（16:16:44.6/16:17:14.9/16:17:45.4，间隔精确 +30.3s）→ 最终 `LlmStreamTimeoutError`，**tap → 失败终态 93s**（UI：「上次生成 · 93s · 正文 0 字」），composer 恢复可再发（后续 ac4stop2/3 均发送成功）。重试上限 3、有界收敛、无永久黑洞。**终版语义**：流式空闲界已退役，同场景不再有 30s 断连，每轮尝试由单次 callTimeout 600s 承接，自动上限 ≈ 3×600s≈30 分钟（手动终止为快速路径）——收敛有界性与「不永久黑洞」结论不变，窗口读数以终版为准。
- **服务端留痕**：每次挂死连接都在挂死起点 +30s 整被客户端关闭（`HANG 结束：挂死连接被客户端关闭` ×3：16:17:11.168/16:17:41.485/16:18:11.997，均为起点 +30.000s）。
- **新超时文案（b50771a6 修复实测）**：
  - logcat（权威全文）：`'LLM stream timed out after 600000ms waiting for the first chunk (native timeout: read timeout after 30000ms)'`——detail 从裸 `(native callTimeout)` 变为真实触发来源 **`native timeout: read timeout after 30000ms`**，实测通过。
  - UI 侧：失败消息可见前缀与 logcat 一致（dump 单行省略截断在 "(native " 处，全文以 logcat 为准）。
  - 残留：前缀 `after 600000ms` 仍是 whole-call 常量，实际 90s 收敛——文案数字失真的另一半（Step 7 登记项的存余），行为正确、仅前缀数字误导，维持登记。
- **transport 证据**：ac4stop3 轮 logcat `'→' { method: 'POST', url: …, transport: 'native' }`——挂死实验全部走 native 分支。
- **XHR 回落路径 close 保留**：本轮未复测（Step 7 b1 已实证同环境同操作序列下的对照，不重复消耗）。

### AC-5 复用回归 + e2e 三幕 —— **PASS**

- **连接复用**（服务端日志硬证据）：req#3（16:07:27→16:08:13 完成）与 req#4（16:08:40→16:09:27 完成）两轮完整 12000 字流**全部落在 conn#3** 上，期间无 conn#3 关闭行、无新连接建立——native 管子连接池复用恢复。两轮间隔 24s（<60s 服务端 keep-alive 窗口，见异常 5 的第一轮教训）。
- **e2e 三幕复跑**（模拟器）：正常流（ac1-first 12,000 字 / ac2long 100,000 字）→ 黑洞收敛（ac4stop/ac4stop2 挂死 93s 失败终态）→ 重发成功（ac4stop3 起播，且失败轮后 composer 均可再发）——三幕通过。
- **口径说明**：core 全量与双端定向测试由 Step 1-6 各步跑绿，本步不重复；desktop/CLI 零变化由 port 注入设计保证（未注册即回落）。

## 停止按钮专项（Step 7 遗留疑点复验）—— **无效，真 bug 实锤**

> 本节复验在初版 30s 读超时语义下进行（当时读超时仍生效，故有「90s 有界收敛兜底」可被炸掉一说）；该 P0 已由 193821db 修复（bridge 组装弃 spread 改逐方法解构），终版收敛兜底改由 callTimeout 承接。

**判定：停止链路故障（非 Step 7 疑点的「坐标漂移」解释）。且后果比 Step 7 登记的更严重：点终止后 run 状态机悬死，连 90s 有界收敛兜底也被炸掉。**

### 终止入口的确认（为什么之前点不中）

`ChatComposer.tsx:632-634`：发送键在 running 时**原位变形**——`accessibilityLabel={running ? '终止' : '发送'}`、图标换 TerminateIcon，无「停止」文字。消息流内出现「停止」字样（Step 7/AC-1 转写所见）仅伴随流式增量到达（「正在生成…」条目旁）；**挂死首字未达时该入口不出现**——两轮挂死态截图转写均无「停止」字样。Step 7 四击的记忆坐标（消息流位置三次 + 发送键一次）里，命中的那次也只到了发送键 onPress。

### 证据链（ac4stop3 轮，模拟器时间）

1. dump 证实 tap 命中：发送键 bounds `[922,2194][1027,2299]`（无键盘态，构建前后多次 dump 一致）→ tap center(975,2247)。
2. logcat `16:26:18.097 [nm-timing] t0 send`——onPress 确实进入 `send` 回调（running 分支）。
3. `16:26:18.125 E ReactNativeJS: [TypeError: undefined is not a function]`（t0 后 28ms；Hermes 未处理 rejection 格式，无堆栈）。对照：同 APK 同会话非 running 态发送（16:26:00.076）无此错误——强关联 running 分支的 `runtime.sessionStreamUnitManager.stopRun(sessionId)`（`ChatComposer.tsx:492-496`）调用链。
4. 服务端：conn#8 挂死起点 16:26:28.748（宿主），**tap 时刻（宿主 16:26:43）无断连**，`HANG 结束：挂死连接被客户端关闭` 落在 +30s 整点（16:26:58.747）——读超时路径，abort 未到达连接。
5. **悬死后遗症**：第一次读超时（16:26:32）后**无第二次重试**（mock 无 conn#9）、无最终失败终态；UI 持续「生成中 · 91s」4 分钟+（shot-ac4-final/final2）；二次 tap 终止键 onPress 均不触发（无新 t0 send）；仅 force-stop 可复位。
6. **对照组**：同 APK 同 mock 未点终止的 ac4stop/ac4stop2 两轮均正常 3×30s 收敛 + 失败终态 + composer 可再发——排除环境归因。

### 定位线索与建议

`stopRun`（`session-stream-unit-manager.service.ts:1109-1115`）与 `createAgentAbortRegistry`（core）源码均干净，TypeError 具体抛点未定位（Hermes 无堆栈，疑在 send 回调 → stopRun 链上的某处方法缺失）。建议**另立卡高优修复**：该故障把「用户主动停止」与「读超时兜底」两条收敛路径同时打断，是本轮发现的唯一 P0 级问题。修复时可先在 dev 构建里给 send 回调包 try/catch 打堆栈定位。Step 7 存疑登记 1 据此翻案并结案：不是坐标问题。

## 合批事件率观察口径（T-N8 收口）

- **现有打点不携带每事件日志**（设计如此）：`logSse` 只打请求行（method/url/transport）、首 chunk 字节数、timeout 事件——native 合批事件率（~10 事件/s 量级）无法从现有 logcat 直接数出。
- **本轮口径（间接证明合批有效）**：服务端 3000 chunk 以 ~15.4ms/tick（≈65 事件/s 的到达频率）喷流 → 若无合批（XHR 时代 per-chunk 过桥），该事件率正是 P1 病灶的触发条件；实测 AC-1/AC-2 期间 UI 全程丝滑（截图序列每 4s/15s 正文单调增长、无冻结帧）→ 合批对事件风暴的压制在渲染面生效。首字证据沿 Step 7：`native first chunk { bytes: 1687 }`（首批即合批产物）。
- 若需精确事件率数值，需临时在 wrapper 或 Kotlin 侧加计数打点（超本轮范围，登记）。

## 异常与翻车记录

1. **模拟器进程中途崩溃**（约宿主 16:04）：无头 AVD 进程消失（tasklist 无 emulator，5555 端口 SYN_SENT 残影），崩溃前第二轮 tap 未发出请求（无服务端请求）。重启后继续，后续稳定。
2. **键盘态输入路线在 app 冷启动后不可靠**：`input tap` 聚焦 + `input text` 两次全部未进 EditText（IME 未就绪疑点，dump 证实占位符仍在、文本 null），热态一次成功。稳定路线 = DB 草稿注入 + force-stop 重启水合。
3. **uiautomator dump 工具矛盾闭环**：生成态（转圈动画+计时刷新）dump 报 `could not get idle state`；`animator_duration_scale 0` 可解 dump，但触发 Reanimated reduced-motion 警告 → dev 构建 LogBox 横幅 `[26,2083][1054,2208]` 挡住发送键（bounds 重叠，tap 被截）→ 又挡实验。最终恢复动画、放弃生成态 dump，终止键定位改走「源码确认 + 终态 dump bounds + t0 send 打点」闭环。
4. **视觉模型坐标不可靠**：同一挂死截图两次问询给出 (803,2085) 与 (541,2110)（后者为 composer 位置）；逐字转写漏读图标形态按钮。本轮 (803,2085) 一击无效验证了该路径不可用——截图视觉定位只用于内容转写，不用于坐标。
5. **服务端 keep-alive 60s 空闲超时吃掉第一轮复用窗口**：AC-1 完成后截图转写耗时 >60s，conn#2 被服务端空闲关闭，第二轮必然新建连接。复用证据改由紧凑轮（间隔 24s）拿到。
6. **推回 DB 覆盖了 ac2long 消息**：AC-2 后推库用的是崩溃时拉的旧副本，设备库中 10 万字消息被抹（AC-2 证据链已固化为服务端日志+截图序列+dump 终读，无实质影响）。教训：推库前先拉最新设备库。
7. **600000ms 前缀残留**：见 AC-4 节——detail 已真实化（b50771a6 生效），前缀数字仍是 whole-call 常量，维持登记。
8. **cmd findstr 对 UTF-8 中文匹配失效**：`findstr "停止" *.tsx` 空结果，`git grep` 正常——后续源码中文检索一律 git grep。
9. **AC-3 未专项实测**：见 AC 矩阵节，T-N4 自动测试覆盖，留登记。

## 总判定

| AC | 判定 | 一句话证据 |
|---|---|---|
| AC-1 12000 字丝滑 | **PASS** | 46.5s/12,000 字/260 字/s，截图序列每 4s 正文单调增长，无憋全文/无冻结/无尾部倾泻 |
| AC-2 10 万字长文 | **PASS** | 192s/100,000 字/521 字/s，markdown 元素流中逐块出现，内存 +58MB 平稳，无渲染错乱 |
| AC-3 非流式收敛 | 登记未实测 | T-N4 自动测试覆盖；本轮不阻塞 |
| AC-4 挂死收敛+新文案 | **PASS（初版语义）** | 3×30s 整点断连（服务端留痕）→ 93s 失败终态；文案 detail 实测为 `native timeout: read timeout after 30000ms`（终版：无 30s 空闲界，自动上限 ≈3×600s≈30 分钟，见文首留档注） |
| AC-5 复用+三幕 | **PASS** | conn#3 连续承载两轮完整流（无断连无新建）；三幕（正常流/黑洞收敛/重发成功）复跑通过 |

**Step 8 模拟器侧硬指标验收通过。新增 P0 级发现一项：终止键（running 态发送键）触发 TypeError 且 run 悬死，建议另立卡修复。** T-N9 真机高速模型长流体验验收留用户。
