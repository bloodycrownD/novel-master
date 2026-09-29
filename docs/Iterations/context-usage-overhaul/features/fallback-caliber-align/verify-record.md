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
