# 2026-10-23 移动端换栈探索（RN → Flutter / 纯 Kotlin / Rust 混合编译）

## 类型与定位
- 类型：**brainstorm**（方向探讨，未立项、未改代码、未产出 prd/spec）
- 四个 readonly 子代理并行探索（架构规模 / bug 归因 / 依赖面 / 渲染与 Rust），报告落 `tmp/stack-explore/`（A-architecture / B-bug-attribution / C-deps / D-render-rust），本文件记结论与待拍板项

## 用户问题
- user: 「因为我们项目有很多 bug，我看 changelog。如果我放弃桌面，只做手机，是不是这些问题能好解决」
- user: 「我现在其实是在探索：换 flutter 能解决？换 kotlin 能解决？memarid（mermaid）这个玩意好像还得 js」
- user: 「那既然得用 webview，kt 原生嵌入 webview 会比 rn 更方便吗」
- user: 「flutter 能用 dart 解决分词器、msg 列表、输入框这些问题吗」
- user: 「换成 rust + 其他语言混合编译会更好吗」

## 探索结论摘要（人话）

### 1. 真实现状：三层体量与 bug 分布
- RN 主体 303 文件 / 52.9k 行；WebView 源 70 文件 / 8.3k 行（preact，四个包）；自研 Kotlin 仅 2,212 行（SSE 字节管 / DJL 分词 / Keystore）；core 是纯 TS 642 文件 / 70.8k 行 + 93.4k 行测试，src 零 `node:` 静态 import、67 个 port 接口。
- CHANGELOG 全量 485 bullet：移动端相关 142（mobile-only 116），桌面端相关 51（desktop-only 25）。**移动端 bug 密度约为桌面 3 倍**，集中在 1.5.28–1.5.44 的架构迁移期。
- 移动端独有缺陷按根因：RN 框架/桥/键盘/原生模块 55（其中键盘/IME 11、桥与 JS 线程 9、原生输入框补丁 7、普通状态/渲染 28）、WebView 18、纯业务 8、Kotlin 原生 2、构建链 3。
- **能靠换栈消掉的约 38–45 条（键盘族 + 桥/JS 线程 + 原生输入框测量 + WebView 双进程）**；28 条应用状态/渲染逻辑与 8 条纯业务逻辑换任何栈都还在。

### 2. mermaid 是决定性约束
- 实测（esbuild metafile）：chat-transcript app.js 3.81MB 中 mermaid 家族（mermaid + @mermaid-js/parser + cytoscape 系）约 2.80MB = 71.9%；rich-document 3.42MB 中 80.1%。
- 必须 WebView 的原因：`sanitize-rich-html.ts` 白名单不含 `svg` 且未知标签 escape，SVG 只能由 WebView 内 mermaid 生成后 innerHTML 注入；RN 侧无 HTML 渲染器。
- **反例实证：纯 Kotlin/Compose 的参考仓 `.reference/rikkahub` 同样为 mermaid 开 WebView（assets 内置 3.56MB mermaid.min.js）**。即「换栈」不等于「去 WebView」。

### 3. 四个方案的实质判断
- **Flutter**：最不推荐。核心业务层是 7 万行 TS，Dart 无法复用（要么内嵌 JS 引擎、要么重写）；跨端优势在本项目为零（只发 Android、桌面是 Electron）；mermaid 仍要 WebView；分词器需 platform channel 回 Kotlin DJL。Dart 生态的 markdown/高亮/胶囊输入框质量仓库内无证据（未验证）。
- **纯 Kotlin/Compose**：唯一有实质收益。能消掉键盘/IME（WindowInsets.ime）、桥与 JS 线程（协程替代 JS 单线程）、原生输入框的 Yoga 测量两套账。**但决策点不在 UI，而在 core**：保住 core 就要内嵌 Hermes/QuickJS（同时维护 Kotlin + JS 两套，比现在更复杂）；不保就是 7 万行 + 93k 测试重写。代价约 12 万行级。
- **Kotlin 嵌 WebView vs RN 嵌 WebView**：WebView 资产（index.html/app.js/app.css）零改动可复用，`file:///android_asset` 直载；bridge 从 postMessage 换成 WebMessageListener 更直接；划词菜单用原生 ActionMode 可绕开 react-native-webview 在 HyperOS 的已知失效（RULE 术语「批注」条）。**但宿主侧状态机（v2 信封、快照分片、流式三通道、ready v2 协商、deferred 队列，约 2.7k 行 TS）要重写成 Kotlin**。渲染成本不变。
- **Rust 混合编译**：价值很小且取决于宿主语言。仓库零 Rust、无 CMake/napi 基建，引入需 cargo-ndk + Gradle + 4 ABI `.so`。唯一有量化收益的是 zlib（fflate 解压 3.24MB 273ms vs node:zlib 35.7ms，7.6×），**而这个收益在换 Kotlin 后由 java.util.zip 免费获得**；只有在「继续用 JS/RN」的场景里 Rust 才有意义（按 `zlib-accelerator` port 注入 JNI，保留 JS 回落）。分词器已有 DJL，markdown/mermaid/协议层换 Rust 无收益。

### 4. 历史教训（三条已被验证的死路）
- **RN 化消息列表（2026-10-12→10-19）**：失败根因不是「RN 列表不行」，而是自研行为语义层 × 虚拟化 × 动态行高 × MVCP 补偿语义四轮未收敛；换 FlashList v2 → v1 inverted → LegendList v3 正排，坐标系翻转三次、行为层每次重写；最终拆掉虚拟化后与 WebView 全量 DOM 差别只剩初始化成本。**换 Compose 的 LazyColumn 一样要处理贴底/prepend 锚定/展开下推，不会自动消失。**
- **会话列表 SPA 化（1.5.30→1.5.37 回滚）**：本质是状态隔离模型退化——「文档常驻」把每会话一文档变成一文档服务所有会话，四条串台路径 + workspace stale + 后台回收误报全部由此派生。回滚后「用确定性换性能」。
- **输入框 WebView 化 → 原生化（1.5.28→1.5.41）**：WebView 化是为消灭双引擎同步（不是性能），原生化后消灭了测量/渲染两套账，但胶囊语义仍在修（1.5.43/1.5.44），并把 WebView 的 bug 换成了 patch 库（33 文件 / 2,582 行 patch）的长期维护税。
- 共同规律：**1.5.28–1.5.44 期间移动端做了三次大架构迁移，每次都产出 10–20 条衍生 bug。bug 多与「栈选择」的相关性弱于「架构演进速度 > 收敛速度」。**

## 给用户的建议路径（已写入本轮回答）
1. 不换栈；先把「零 WebView」降级为「WebView 只做渲染岛」。
2. 把 mermaid 从 chat-transcript / rich-document 主 bundle 拆成独立按需加载（预估主包 3.81MB → 约 1MB），直接改善冷启动——正是当初 SPA 化的动因，且不需要换栈。**（拆法未验证：file:// 下需 <script src> 本地 chunk 方案）**
3. WebView 生命周期治理产品化（onRenderProcessGone / ready 超时 / 白闪三防线已有）。
4. 若仍要原生化：顺序是输入框（已完成）→ 外壳 → 列表最后；先做 2 周 spike，三判据＝长会话锚定 / IME+胶囊 / 富文本 parity，任一不过就不换。
5. 若目标是「减少维护面」而非「减少 bug」：可先砍桌面（38k 行、25 条 desktop-only 缺陷），但要接受 core 失去 Node/Electron 宿主之一。

## 待拍板 / 未闭合
- 「2026-10-19 放弃 RN 列表」**仓库内无文档记录**（只有两条实验分支提交停在 10-18 + main 未合并）。建议在 `docs/Iterations/transcript-native-2026-10/` 补终止记录，否则半年后无法复盘。
- 是否保留 core（决定内嵌 JS 引擎 or 重写 7 万行）是本轮唯一真正的分水岭，用户未表态。
- Flutter/Dart 生态（mermaid 替代、markdown/高亮包、胶囊 span 圆角）无仓库内证据，全部标注未验证。
- mermaid 拆包方案的可行性与收益未验证，需 spike。
