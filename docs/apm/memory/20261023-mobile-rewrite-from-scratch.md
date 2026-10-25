# 2026-10-23 移动端从零重写选型（RN / Flutter / 纯 Kotlin）

## 类型与定位
- 类型：**brainstorm 续轮**（用户澄清：不是迁移，是从零重写；上一轮见 `20261023-mobile-stack-exploration.md`）
- 本轮新增证据：`.reference/rikkahub` 模块级规模实测（纯 Kotlin/Compose 同类产品，作为「从零写纯 Kotlin」的对照实验）

## 用户问题
- user: 「不不，其实我没想着迁移这个问题，我就是说重写，从零开始写。哪个更好些？rn 碰到的很多坑，其他大概率也会碰吗？」

## 结论摘要

### 1. 从零写的选型结论
- **纯 Kotlin / Compose 最优，Flutter 最差，RN 出局**。
- RN 出局的理由不是技术差，而是「从零写 + 放弃桌面」把 RN 的两个价值（复用 React 生态、与 Electron 共享 TS）同时清零，只留下 JS 单线程与桥的负债。
- Flutter 的问题是**多一门语言**而非少一门：底层能力（DJL 分词、Android Keystore、op-sqlite、OkHttp SSE、mermaid WebView）全部要 platform channel 绕回 Kotlin，等于 Dart UI + Kotlin 能力，与现状 TS UI + Kotlin 能力没有质变，还丢掉 React 生态与仓库内 Kotlin 参考实现。
- 纯 Kotlin 是唯一「收敛到一门语言」的方案，且三族机制性缺陷（键盘/IME 四链路、JS 单线程与桥、Yoga 测量与渲染两套账）从架构上消失。

### 2. RN 的坑分三类，换栈后果不同
- **A 类 机制性（换栈永久消失，约占能归因的 40%）**：键盘避让四链路拼装（Android 15+ edge-to-edge 后 adjustResize 失效）、JS 单线程同步重活堵交互、RN 新架构模块方法懒实体化（spread 丢方法 → "undefined is not a function"）、Hermes 无 WebAssembly、JS timer 由 Choreographer 驱动导致后台停摆、Fabric 自定义组件 Yoga 测量与渲染两套参数（差一行/裁一半/叠印）、react-native-webview `menuItems` 在 HyperOS 失效。
- **B 类 问题域固有（谁写都要碰，约 35%）**：长列表 + 动态行高 + 贴底跟尾 / prepend 锚定 / 展开下推；中文 IME 组合态；WebView 双进程生命周期；富文本渲染；多会话状态隔离；mermaid。
- **C 类 产品复杂度（与栈无关，约 25%）**：胶囊边界与附件真源、压缩锚定、导入预算、VFS 内容寻址、回滚。

### 3. rikkahub 实测（从零写纯 Kotlin 的对照基准）
- 全仓 Kotlin 748 文件 / **146,830 行**（单模块统计；无 src/test）。
- `Markdown.kt` 1,319 行 + `MarkdownNew.kt` 1,491 行（**两套实现并存**，说明自有渲染器本身在持续演进）；`MarkdownWeb.kt` 30 行、`Mermaid.kt` 304 行（仍为 WebView 岛）、`HighlightCodeBlock.kt` 537 行。
- 自研 highlight 引擎独立模块（移植 highlight.js），30+ 语言各一文件。
- `ChatInput.kt` 876 + `ChatInputState.kt` 149；`ChatList.kt` 850；`ChatMessage.kt` 629；`ChatGenerationForegroundService.kt` / `ChatService.kt` 独立前台服务。
- 推论：novel-master 功能面宽于 rikkahub（VFS + 压缩 + 回滚 + 技能 + 子会话 + 工作区规则），从零写纯 Kotlin 的体量估计 **15–20 万行**。

### 4. 从零写的真实风险不在 UI
- UI 重写是可见成本；**不可见成本是 core 70,774 行业务规则 + 93,383 行测试所固化的 30 多个版本的踩坑结晶**（压缩锚定口径、已引用省略、VFS 内容寻址与引用计数、附件 hydration、token 归因、回合快照）。
- 从零写这批规则 = 把过去一年半的踩坑重走一遍，且这部分与 UI 栈完全无关。

## 建议
- 若确定为「放弃桌面 + 从零重写」：选纯 Kotlin/Compose，直接读 `.reference/rikkahub` 的 `Markdown/MarkdownNew/ChatList/ChatInput/Mermaid` 作为实现参照；词表资产（17 文件 / 63.45 MB HF JSON）与 DJL 依赖可原样沿用；mermaid 做成独立 WebView 岛。
- 无论选哪个栈，`core` 的业务规则应作为「设计规格 + 验收基准」保留，而不是当成可丢弃的旧代码。

## 未闭合
- Kotlin 从零写时业务层形态（直接翻 Kotlin vs 内嵌 JS 跑 core）未定；本轮倾向「翻 Kotlin」，因内嵌 JS 会让架构变成 Compose + Kotlin 原生 + JS 引擎 + JS↔Kotlin 桥四层，比现在更复杂。
- Compose 的 `AnnotatedString` 不支持内联块级元素（表格/代码块/mermaid 需独立 Composable），rikkahub 的 MarkdownNew 即为此而写；具体拆法未验证。

## 追加轮（2026-10-24）：用户明确「不考虑工期与成本，喜欢写代码的创造感」
- user: 「ok，你的建议如果要重写就用原生？你不用考虑工期或者成本啥的，我就喜欢写代码这种创造的感觉（不奇怪吧。。。？）」
- 用户决定的前提变了：成本不再计入。回答的重点因此从「值不值」转为「即使不要钱，原生是不是最优」。

### 结论：是，但「原生」的真实图景不是零 WebView
- 纯 Kotlin/Compose 拿到的是三族机制性缺陷消失 + 一门语言 + 完整 JVM 生态（zlib、加密、字节处理、协程、SQLite、内存可控、无 JS 引擎启动开销）。
- 但 WebView 不会消失，只会从「一个大的」变成「几个小的岛」：**mermaid（必然）+ KaTeX 数学公式（rikkahub 在 MarkdownNew 里也得处理）+ 可能的代码编辑器**。每个岛都要自己的 bridge。
- 准确的架构图：Compose 主界面 + 3~4 个 WebView 岛 + 全部业务逻辑 Kotlin。

### 难度是转移，不是消失（不涉及成本的技术事实）
- 原生更强：键盘/IME、无桥、无 Yoga 双账、列表原生虚拟化、zlib（java.util.zip 免费拿到 7.6× 收益）、分词（DJL 原样可用）、并发（协程）、启动速度。
- 原生更弱：①markdown 渲染——Compose `AnnotatedString` 不支持内联块级元素，表格/代码块/mermaid 必须拆成独立 Composable，得写「markdown → Compose 组件树」转换器（rikkahub 写了两遍 1,319 + 1,491 行）；②代码高亮——highlight.js 190 语言 vs Kotlin 移植 30 语言；③数学公式——KaTeX 仍在 WebView；④富文本 parity 无参照物，需自定义设计语言。

### 创造感的分野（重要）
- **写 UI = 创造**（有设计空间，值得重写）。
- **写业务规则 = 考古**（压缩锚定口径、ref_count 与 GC、附件三层真源、token 归因，这些没有设计自由度，只有唯一正确答案）。
- 因纯 Kotlin 架构里保 core 会变成四层（Compose + Kotlin 原生 + JS 引擎 + 桥），推荐姿态：**core 作为「参考实现 + 测试基准」，Kotlin 侧重建时用其 93,383 行测试逐条对账**。考古有地图，不是从零挖。

### 实施切分建议（顺序有理由）
1. transport + DB（tdbc + op-sqlite，19 个 schema 的**最终 DDL 直接搬**，不需要背 30 个迁移——这是从零写的优势）
2. 协议层（`infra/llm-protocol` 4,934 行是纯字符串状态机，翻译最快、风险最低）
3. VFS 版本层（最重，但 `docs/apm/RULE.md` 的术语条目就是需求清单）
4. UI（创造感最强，也最不怕返工，所以放最后）
- 原则：**先做没有设计自由度的部分（翻译），后做有设计自由度的部分（创造）**。反过来会在业务规则反复调整时反复改 UI。
- 迁移期的隐性资产：`RULE.md` 里的术语（压缩锚定、已引用省略、按内容寻址、批注）是 30 多个版本的经验压缩，应逐条当需求条目实现。

## 追加轮（2026-10-24）：NativeScript 作为第四选项的评估

### 用户问题
- user: 「对了，另外一个技术选型忘说了。NativeScript，这个会不会有更多优势呢？」

### 事实（web 检索 + 官方 blog，2025-02 NativeScript 8.9）
- **Android runtime 已用 Node-API 重写**，实现引擎无关：支持 V8 / Hermes / QuickJS / JSC；官方称零 breaking change、drop-in。官方原话「We don't recommend shipping apps to production with the new runtimes just yet. This is an early preview」。
- **官方已明确在与 React Native / Expo 集成**；`@nativescript/react-native` 9.1.0 已发布（"React Native TurboModule for NativeScript Native API access"），即**在现有 RN 项目里装一个 TurboModule 就能用 TS 直接调任意 Android/iOS API**。
- 机制：NativeScript 把全部原生 API 直接暴露给 JS（运行时绑定，非序列化桥），不把 TS 编译成 Java/ObjC。
- 引擎基准（OnePlus 9 / Android 14 / 1M 次调用，老 runtime = V8 10.3）：
  - V8 N-API：16 项里 11 项提升；但 instance Field 访问慢 65–133%
  - **Hermes：方法调用慢 529%**（因 Hermes 尚未用其 HostObject 扩展，回退 JS Proxy）
  - QuickJS：多数项优于老 runtime
  - JSC：灾难级（2000%+ 慢）
  - 绝对值：慢 529% 的项从 322ms → 2029ms / 1M 次 = **约 2μs/次**
- App 体积（Hello World，arm64-v8a）：V8 11.3MB / V8 N-API 11.7MB / Hermes 5.6MB / QuickJS 5.3MB / JSC 7.2MB；proguard + QuickJS 可到 3.7MB。
- 内存（运行 5 分钟）：V8 N-API 139MB / Hermes 144MB / QuickJS 115MB / JSC 153MB。

### 判断：两种用法，价值完全不同
- **A. 整个换成 NativeScript：不推荐**。①新 runtime 仍是 early preview，官方明说别上生产（本项目已在发版）；②UI 抽象层薄——`@nativescript/core` 只是原生 View 轻封装，复杂界面（胶囊输入框、转录列表、批注菜单）要手写原生 View，声明式能力远弱于 Compose；③生态比 RN 小一个量级，单人开发踩坑无人陪；④RN 0.85 已是新架构（JSI），"无桥"这一卖点被削掉大半。
- **B. 在现有 RN 里装 `@nativescript/react-native`，作为「原生 API 直通手术刀」：这是真正有价值的用法**。可精准解决三族问题里最难的三项：①zlib → 直接 `java.util.zip.Inflater`（白拿 7.6×，不需要 Rust）；②输入框 → 直接 `android.widget.EditText`（绕开 Fabric/Yoga 测量）；③WebView → 直接 `android.webkit.WebView`（拿全生命周期）。性能特征：字段/数组访问慢 65–133%、Hermes 下方法调用约 2μs/次——**低频重活（解压 3MB 省 237ms）完全无感，高频小调用才有感**。

### 与「重写用纯 Kotlin」的关系
- NativeScript 的独特价值是「TS 写 UI + core 七万行 TS 直接复用」，恰恰是「不重写」路线的最优解。
- 但用户已确定「从零重写用原生」，那么这条独特价值就不成立；重写路线仍应选 Kotlin/Compose（UI 工程能力、生态、稳定性全面占优）。
- 可留作退路：若将来放弃重写、想在 RN 里补原生能力，`@nativescript/react-native` 是当前唯一「不写 TurboModule 就能直调任意原生 API」的方案（成熟度需实测，9.1.0 刚发布）。

### 追加追问：「能优化当前 nm 吗？能优化 msg 列表吗？」

**关键区分：`@nativescript/react-native` 提供的是「调原生方法」，不是「做原生组件」。**
- 它能做的：在 TS 里 `new java.util.zip.Inflater()`、`Files.readAllBytes()`、调系统服务。适用「方法级」痛点。
- 它做不到的：把 `androidx.recyclerview.widget.RecyclerView` 变成一个 RN 组件。那需要 Kotlin 写 Fabric `ViewManager`/`ComponentView` + `requireNativeComponent`，与 NativeScript 无关。

**因此对消息列表无效。** 列表要的是原生组件而非原生方法。
- 确定能帮的三处（均为方法级）：①zlib 直接 `java.util.zip.Inflater`（7.6×，且 WebView 内摸不到）；②文件/加密/字节处理类直通；③若自己写 WebView 组件，可直调 `android.webkit.WebView` 拿完整生命周期——但「自己写 WebView 组件」本身要 Kotlin ViewManager，NativeScript 只帮调 API。
- 输入框已原生化，收益重叠。

**更关键：换控件只换得掉「虚拟化」一项，而那恰恰是已证明不重要的一项。** 三个方案各自缺什么：
| 方案 | 富文本 | 虚拟化 | 贴底/锚定/下推语义 |
|---|---|---|---|
| WebView 全量 DOM（现状） | ✅ 现成（markdown-it + hljs + CSS） | 内部 row-windowing（EWMA 槽高估算） | 自写 |
| RN 原生列表 | ❌ 要自建渲染器 | ✅ | 自写 |
| 原生 RecyclerView | ❌ 要自建渲染器 + mermaid 岛 | ✅ | 自写 |
- `transcript-native-2026-10` 的实证：拆掉虚拟化后，RN 列表与 WebView 全量 DOM 的差别只剩初始化成本。即虚拟化不是瓶颈。
- 列表项若是 WebView → N 个 Chromium 实例（每个 30–80MB）内存爆炸；若是原生富文本 → 要自建 markdown→Spannable 渲染器（rikkahub `MarkdownNew` 1,491 行的量级）。**「列表用什么控件」不是问题，「列表项里放什么」才是。**
- 真正的优化方向（待验证）：①把「EWMA 估算槽高」换成「精确测量缓存 + 失效策略」（WebView 内 DOM 布局是精确的，问题在虚拟化把元素移出 DOM 后量不到，需缓存）；②按行分档渲染——轻量行（段落/列表/标题）全量 DOM 渲染（便宜），重量行（代码块/mermaid/工具卡）懒加载占位 + 渲染后缓存精确高度，降低对虚拟化的依赖。
