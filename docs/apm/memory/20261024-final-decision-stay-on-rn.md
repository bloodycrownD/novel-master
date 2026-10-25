# 2026-10-24 最终决策：留在 RN，转向代码优化

## 类型与定位
- 类型：**决策归档**（用户拍板：不重写、不换栈，留在 RN 做优化）
- user: 「算了，感觉成本还是太高了，rn 也不是不能用，不如优化优化代码」
- 本文件是全轮技术选型讨论的落点；前四份记忆（stack-exploration / rewrite-from-scratch / sandbox-and-multisession / kotlin-core-cross-platform-architecture / msglist-open-source-references）作为论证存档

## 一、这个决定成立的三条实质理由（不是妥协）
1. **RN 的三族问题已经摸清且有存量经验**：116 条 mobile-only 缺陷已按根因归类（键盘/IME 11、桥与 JS 线程 9、原生输入框测量 7、普通状态渲染 28、WebView 18、业务 8）。换栈只是把「已知的坑」换成「未知的坑」，而 `transcript-native-2026-10` 证明了新坑的密度不会更低（6 天 4 轮未收敛）。
2. **保住单一真源**：core 70,774 行 TS + 93,383 行测试仍是唯一业务真源。重写 Kotlin（15–20 万行）不带来任何产品增量，只带来重建风险。
3. **保住两端同源渲染**：移动 WebView 与桌面 Electron 同为 Chromium，mermaid/富文本/高亮这一层不需要重建。

## 二、优化之前的首要动作：先建基线（当前几乎无实测数据）
- 仓库内只有库体积数据（523MB→105MB、76MB、8.8MB blob 等），**没有运行时性能基线**。
- 1.5.28–1.5.44 三次架构迁移（输入框 WebView 化 → 会话列表 SPA 化 → 回滚 → 输入框原生化 → RN 列表实验）共同特征是：动因多为「感觉慢/感觉卡」，缺少可对比数字。这是必须补的第一课。
- 建议采集的 5 个指标：
  1. 冷启动 → 首屏可见耗时
  2. 进入会话 → 首条消息可见耗时（区分 cold / warm / 已有快照）
  3. 长会话（3000+ 行）滚动帧率与卡顿次数（`gfxinfo` / `FrameMetrics`）
  4. 多会话并发 run 的 RSS 峰值与总内存（目前完全无数据）
  5. WebView 进程内存与 `onRenderProcessGone` 触发频次（低端机重点）

## 三、优化清单（按投入产出比）

### 第一档：确定收益、不动架构
1. **消息列表：把 EWMA 槽高估算换成「精确测量缓存 + 分档渲染」**
   - 依据：开源 IM 实现无一使用估算（Zulip 全量 DOM + 分页；Element Web 精确测量；Telegram/Signal 高度缓存）。novel-master 的 `row-windowing.ts`（60 行窗口 + 20 行缓冲 + EWMA）是这批里唯一用估算的 → 很可能是「贴底抖 / 锚定跳 / 展开下推错」的共同根因。
   - 做法：测量过的行按 id 缓存精确高度 + 明确失效条件；轻量行（段落/标题/列表）全量 DOM，重量行（代码块/mermaid/工具卡）懒加载占位 + 渲染后缓存高度。
   - 参考：`zulip/zulip-mobile` 的 `generateInboundEventEditSequence.js`（增量编辑序列）、`html/messageListElementHtml.js`。
2. **拆 mermaid 出主 bundle**
   - 依据：chat-transcript app.js 3.81MB 中 mermaid 家族占 2.72%（2.80MB / 71.9%）；rich-document 3.42MB 中占 80.1%。
   - 预期：主包降至约 1MB，直接改善冷启动与切会话重建——正是当初 SPA 化的动因。
   - 待验证：`file://` 下分包加载方式（`<script src>` 本地 chunk），不能用 fetch。
3. **收口三条无界内存**
   - 活跃 run 单元不占槽不淘汰（只有 settled 有 LRU 8）
   - 跨会话并发 run 无全局上限（多会话并行是正式产品能力）
   - 切会话不释放（只摘句柄）
   - 这三条是中低端机 OOM 的直接来源。

### 第二档：小改动、补漏
4. **补 `allowedPaths` 与三处路径校验**（几十行）：现在三端硬写 `undefined` 恒放行，且不解 `..`、漏 `glob.cwd`/`grep.pathPrefix`、`filePath` 无工具声明。比引入任何沙箱便宜两个数量级。
5. **WebView 生命周期治理收口**：`onRenderProcessGone` 恢复、ready 8s 超时后的降级路径、白闪三防线统一。
6. **zlib 原生加速**：`java.util.zip.Inflater` 替代 fflate（273ms → 35.7ms，7.6×）。实现方式二选一：自写 30 行 TurboModule（可控），或引入 `@nativescript/react-native`（需实测成熟度）。

### 第三档：结构性，需单独立项
7. 键盘/IME 11 条：根因是 Android 15+ 强制 edge-to-edge 后 `adjustResize` 失效，四条链路按版本拼装。
8. 原生输入框 7 条：`react-native-enriched-markdown` 33 文件 / 2,582 行 patch 的长期维护税，需评估替换或上游化。

## 四、负面清单（明确不再做）
- **不再做大规模架构迁移**（三次迁移每次产出 10–20 条衍生缺陷）。
- **不再引入新的列表库**（FlashList v2 / v1 inverted / LegendList v3 已证否，坐标系翻转三次）。
- **不引入 NativeScript 全家桶**（新 runtime 官方标注 early preview；UI 层薄）。
- **不上 proot 沙箱**（agent 无执行面，引入只增加 N × 80–100MB 存储与版本管理重建成本）。
- **不把可写世界挪出客户端**（与本地 agent 定位冲突，用户已否决）。

## 五、纪律建议
任何架构级改动立项前，必须先给出「当前实现的具体数字 + 目标数字 + 测量方法」三件套。缺这三样就不立项——这是从三次迁移里唯一能提取出的可执行教训。

## 六、追加轮（2026-10-24）：多线程能力的准确口径（用户质疑，前说法需修正）

### 用户质疑
- user: 「你前面说 rn 没法处理多线程问题，rn 引擎确实没办法处理，但是经过桥也没办法吗？我理解起线程是 api 提供的，多线程能力应该是有办法桥接或者有现成包的吧？」

**用户是对的，此前「JS 单线程」的说法过于简化，需修正为：JS 逻辑单线程，但原生侧一直能多线程，且已有现成方案让 JS 代码跨线程执行。**

### RN 的三层多线程能力
1. **原生线程（一直存在）**：TurboModule/NativeModule 的 async 方法在原生线程池执行，回调回 JS 线程。**注意坑**：Callstack 的 native threading model 文档指出——`NativeModules` 线程**跨模块共享**，CPU 密集或长任务必须开 module-owned queue / coroutine scope，否则会堵住其它模块的异步调用。
2. **JS 多线程（现成包，2025–2026 状态）**：
   - `react-native-worklets`（Software Mansion，Reanimated 4 拆出的独立包，官方文档 docs.swmansion.com/react-native-worklets）——「multithreading engine」，可跑多线程多 runtime 的纯 JS。
   - `react-native-worklets-core`（margelo）——把任意 JS 函数转成 worklet 跑在后台线程。
   - `react-native-multithreading`（Marc Rousavy）——多个 Hermes 实例并行 JS（需核实维护状态）。
   - `react-native-threads` —— 独立 JS context。
3. **分片让出**：长任务切小片 + `setImmediate` / `InteractionManager`，现有做法。

### 关键区分（此前混淆的点）
- **「起线程」≠「TS 代码并发」**。原生线程里跑的是 Kotlin/Java，不是 TS。要想让 TS 业务逻辑并发，只能走第 2 层（多 runtime / worklet），或者把该段逻辑改写成 Kotlin 放第 1 层。
- 回看 1.5.23 那批缺陷，根因各不相同，不能一概归为「没有多线程」：
  - 「分词排队堵住停止按钮」→ **TS 侧串行排队占 JS 线程**，worklets 或多 runtime 可解；或把调度挪进 Kotlin。
  - 「后台 JS timer 停摆」→ 根因是 JS timer 由 Choreographer 驱动，**不是线程问题**，worklets 不解决，需原生 timer / 前台服务。
  - 「模块方法懒实体化导致 undefined is not a function」→ 新架构模块加载语义问题，与线程无关。

### 待验证
- 现有代码里到底哪些路径是「同步阻塞 JS 线程」（`row-windowing` 之外），需逐个定位后再决定用第 1 层还是第 2 层。
- `react-native-worklets` 与现有 Reanimated 版本、Hermes、新架构的兼容性需实测。
