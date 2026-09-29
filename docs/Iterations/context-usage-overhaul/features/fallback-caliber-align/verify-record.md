# fa Step 7 Android 真机验收记录（2026-09-29）

设备：荣耀 EBG-AN00（DSLDU20407006179）；构建：worktree cuo 真实路径直编
debug APK（`gradlew assembleDebug`，BUILD SUCCESSFUL 7m07s，191MB）；JS 经
worktree Metro（真实路径起服，`adb reverse tcp:8081`）。证据截图：
`docs/Iterations/context-usage-overhaul/cache/fa-step7/`。

## 验收结论：PASS

| 验收点 | 结果 | 证据 |
|---|---|---|
| Kotlin 契约变更后 app 无崩（删 heuristic 折算 + 失败 reject） | ✅ 启动/列表/聊天/弹窗全程无红屏无崩溃 | 05-tap-with-log.png |
| GLM 家族本地计数（原生 DJL + web/glm.json） | ✅ chip `glm = 0% 346/128K`（旧格式实测时）——如实报家族名；若 Kotlin 失败回落会显示 `gpt ≈`，未见 | dump17/19（见会话记录） |
| GPT 家族真值计数（UI 手动添加 `智普/gpt-4o` 后切换） | ✅ chip `gpt = 0% 416/128K`——countTiktoken 升级的真值（`=` 非 `~`）；与 glm 346 数值不同证明各用各的词表 | dump17 |
| API 真值档标签 | ✅ `远程 = 7.1K tokens`（新会话6，上次 API usage） | 05-tap-with-log.png |
| 模型切换 → API 值失效 → 本地重算链路 | ✅ 切 gpt-4o / 切回 glm-5.3-flash 标签随之切换且数值立即出 | dump17→dump19 |
| tok / tok/s 单位（迭代收尾统一） | ✅ 指标条「输出 183 tok · 36.5 tok/s」 | 05-tap-with-log.png |

**顺手验收（md Step 5 移动端）**：点指标条弹「用量详情」底部 sheet——两段式
数据完整（最近请求：模型 glm-5.3-flash / 输入 7.1K / 输出 183 / 缓存命中率
0%；会话累计：消息数（可见）2 / 工具调用 0 / 累计输入输出 / 上下文占用），
底注两口径标注在；外点关闭正常。证据 06-metric-sheet.png。

## 真机性能实测（用户反馈「重进会话 2~3s 无缓存感」驱动，后续修复见 c9f1e4e9）

测试会话：新会话1（725 条消息、26 条可见、序列化 139KB、glm 家族）。
分段打点实测（打点自身经 Metro 桥每条有 100~400ms 放大，段内差可信）：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 首次进入（冷 L1） | build 2.6s（listBySession 全量 725 条解压 1.6s）+ glm 原生计数 5.8s ≈ **10s** | build 1.2s（list 258ms）+ 原生计数 6.7s ≈ 9.9s（首算不可免） |
| 同进程重进 | build 2.1s + resolve 1.8s ≈ **4s**（L1 已命中，驱动内部仅 ~12ms，余为组装+争用） | build 0.7s + resolve 1.8s* ≈ **2.5s** |
| **app 重启后重进** | L1 清零 → 必再付原生 5.8s | **L1 KKV 种子命中（l1=HIT count=0ms）→ 免重算，≈2.9s（含打点放大）** |

*resolve 段剩余 ~1.8s 主体是 dev 包 console.log 走 Metro 桥的打点自身开销
与转录挂载期的线程争用；生产形态（无 Metro 日志）显著更低。

修复三件（commit c9f1e4e9）：
1. `listBySession` 增 `includeHidden:false`（SQL 层滤 hidden）——双端 chip
   读口接入，list 1.6s → ~100ms；
2. L1 整串缓存 KKV 持久化（token_chunks 域 `promptWholeCache` 键，每会话
   ≤16 条、只收 estimated:false、无变化不写库）——重启后 seed 回 L1，native
   档免整串重算；
3. 标签格式改版（用户拍板）：`glm = 99.3k / 128k (78%)`（真机渲染证据
   10-new-format.png）。

## 追加轮：用户复验「重进仍 ~1s」→ chat-token-label-memo（d8496e4b）

用户复验快了但仍 ~1s。定位：L1 已让计数零成本（l1=HIT），剩余是**重组装**
（拉可见消息 100ms + 规则快照/file_cache 逐条解压 ~400ms + agent 解析
~150ms + 序列化哈希 ~30ms）+ 300ms 防抖。file_cache/rule_snapshot 是
**落盘**缓存（KKV 压缩 blob），无进程内读层——每次组装都从库里读回并解压，
这就是 workplace 的 ~400ms。

修法：`chat-token-label-memo`（core 新模块）——廉价变更指纹
（会话 updatedAt + 新 sessionMessageStamp[可见条数+MAX(seq)] + 会话模型 +
canon 指纹 + API 真值指纹[读 store 热层]）判定「重组装结果必然不变」，
直接返回上次标签，组装/序列化/哈希全跳；命中路径 ≈ 3 个单行查询 +
300ms 防抖。已知盲区（注释拍板）：agent model pin / tokenizer override
设置变更不进 stamp，低频用户操作、下轮消息变更自愈。双端 service 接入
（mobile 存 label 串、desktop 存 stats 对象）。

**遗留优化候选（未做）**：KKV 仓储给 rule_snapshot/file_cache 加进程内
读缓存（写/清即失效）——能把 miss 路径的 workplace 400ms 也压到几十 ms，
且每轮 agent 回合的 workplace 组装同样受益；需谨慎设计事务回滚污染面。

workplace 进程内读缓存之外，重组装 miss 路径的主要剩余成本为 agent 解析
（~150ms，VFS 读 + 解压）与可见消息拉取（~100ms），量级可接受。

## 过程记录（教训入库）

- 出包：subst 虚拟盘方案在 cuo 上**不可用**——Node 侧路径解析把包位置还原成
  `D:` 真实根，与 gradle 的 `W:` 工程根混用，op-sqlite codegen 的 Java
  relativize 报 different roots；cuo 真实路径与主仓等长（21 字符），直接
  真实路径编译全程无 260 问题。已入 RULE。
- 「新建会话按钮失灵」为误判：按钮每次都建了会话（库内 新会话7~11 与 5 次
  tap 时间戳一一对应），会话列表按创建时间**升序**、新会话垫底，注入的
  swipe 未生效导致一直拍到顶部 6 条。无 bug。
- 验收期间发生一起**误删用户会话事故**（详见记忆 20260928-context-usage-
  token-perf.md 当轮记录）：清理测试会话时坐标复用 + 盲点确认框连删，误删
  新会话4/5/6 三条真实会话（37 条消息）；恢复源 = 事发前 force-stop 状态的
  整库副本（quick_check ok），等待用户拍板整库还原。

## 追加轮：统计优先口径——压缩评估/压后刷新不再实时整串计数（4f0a0eeb）

用户拍板（2026-09-29）：「无论是 usage 还是本地，就像 metric 一样，有哪个
就用哪个；已经有上下文统计了才进行压缩」。此前的问题实锤：每 step 的
`result.usage.promptTokens` 在 step 循环里就拿到了，却只在 run **结束**且
completed 才写回；而消息一追加就失效旧值——于是 run 内每 step 的压缩评估、
压后刷新全都跌进本地整串计数（glm 原生大上下文单次 ~5.8s）。四件落地：

1. **每 step usage 回锚**（agent-runner）：请求完成后在本 step 全部消息
   落库之后回锚（两 chokepoint：完成/空回复分支 + tool_results 落库后），
   `anchorSeq` = 提示词末条消息 seq；run 内下一步评估与 chip 刷新直接命中
   api 档零计数。run 末终值写沿用最后锚点；非 completed 收尾失效语义不动
   （T-T5 系列）。
2. **读口 api 命中 = 基线 + 增量估算**：锚点后追加的消息按 heuristic 折算
   加回（`formatChatMessageForCliPreview` 序列化；metric 基线+增量同款，
   RULE「实时 token 指标语义」先例）。增量本体小（一步的 assistant +
   tool_results 或一条新 user 消息），heuristic 低估被基线精确性兜底，下一
   次 usage 即覆盖。
3. **读口本地 miss 强制估算档**：WEB/SP 家族（glm/qwen2/gemma/claude…）
   强制 `tokenizerOverride:"tiktoken"` 走 cl100k 分块估算（JS 侧，L1/L2
   缓存照常），如实标 `estimated:true`（标签 `gpt ≈`）；tiktoken/heuristic
   档不强制。家族真分词器精确计数只留给 CLI 直调驱动。**口径后果**：本地
   `glm =` 档不再实时出现（仅存量 L1 持久化命中时可见），日常显示为
   `远程 =`（api）或 `gpt ≈`（估算）。
4. **触发器保守系数扩到 `estimated:true`**：估算档（含强制 cl100k 档）一律
   乘 0.85 安全系数，与 heuristic 档同待遇。

测试：core 全量 2925/2927（仅既有 usage-stats 时区 2 例）+ typecheck 干净；
mobile 35、desktop 9 定向全绿。顺手修 `createMemorySessionKkv` 缺
`getMany` 的存量红（c6d28a62 遗留，T-WT16 两例当场红、helper 补齐即绿）。
