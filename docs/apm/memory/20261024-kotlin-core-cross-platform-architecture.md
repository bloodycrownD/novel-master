# 2026-10-24 Kotlin core 的多端复用架构（是否必须放弃桌面端）

## 类型与定位
- 类型：**brainstorm 第五轮**（用户澄清：从零重写一个 **Kotlin core**；问是否不一定需要放弃桌面端；观察到 Electron 可以「基于 CLI 开发」）
- 用户三个判断的评估：①不必放弃桌面端 —— 成立；②Electron 可基于 CLI 开发 —— 成立且有成熟范式；③Kotlin core 可单独抽离复用 —— 成立，但有三条不同路线

## 一、如果 core 是 Kotlin，桌面端有三条路

| 路线 | 形态 | core 复用 | 代价 |
|---|---|---|---|
| **1. 全 Kotlin（CMP）** | core KMP + Compose Desktop（JVM） | 100%，无桥 | 桌面 UI 全重写；桌面 WebView 能力要重建（mermaid/富文本预览需 JCEF/KCEF）；jpackage 打包与 JRE 体积 |
| **2. Kotlin core + Electron 壳（sidecar）** | core/CLI Kotlin/JVM，Electron UI（TS/React）经 IPC 调 core | core 100% | 双 UI 语言（TS + Compose）；进程管理与 JRE 打包；stdio 协议设计 |
| **3. Kotlin core + Kotlin CLI 作为 API 边界 + 任意前端** | core KMP → CLI 暴露 stdio JSON-RPC；Electron/Web/Tauri 都接同一 CLI | core 100% | 同上，但架构最解耦（UI 可替换） |

**推荐路线 3**：它正是用户「Electron 基于 CLI 开发」的直觉，且是成熟范式（LSP、MCP、语言服务器都是这个形态）。

## 二、推荐架构（写实版）

```
core/                       Kotlin Multiplatform module（纯业务，无 UI）
  ├── domain/               VFS 版本层 / chat / tool / prompt / checkpoint / workplace
  ├── infra/                SQLite / LLM 协议 / 分词 / 内容寻址存储
  └── runtime/              RuntimeFacade（统一入口，suspend + Flow）
       ├─ androidMain:      同进程直接 new RuntimeFacade()
       ├─ jvmMain:          CLI main() → stdio JSON-RPC → RuntimeFacade
       └─ （可选）jsMain
宿主：
  android-app   Compose UI  ──直接调用──> core
  desktop-cli   Kotlin/JVM CLI ──stdio──> 任意前端（Electron / Compose Desktop / Web）
```

关键不对称（可接受且各有优势）：
- **移动端同进程**：无序列化开销，简单；但工具执行会占 UI 进程，必须全程协程化。
- **桌面端跨进程**：天然隔离（工具/压缩再重也不影响 UI）、崩溃不连坐；代价是多一层 stdio 序列化与流式转发（但 CLI 本来就要做流式输出，不是新增问题）。

## 三、这个方案解决了一个此前的矛盾
- 前几轮曾判断「把可写世界挪出客户端」会破坏本地 agent 定位（用户已否决）。
- 但 **「core 作为本地库/本地进程」与「core 在云端」是两回事**：路线 3 让 core 仍是本地进程（离线、隐私、文件在本地都成立），只是把「业务运行时」与「UI」拆成两层。
- 因此可以同时拿到「前后端分离」的解耦收益（UI 可替换、崩溃隔离、可测试）与「本地 agent」的产品定位。

## 四、KMP 的真实坑（必须提前知道）
1. **分词器**：DJL 是 JVM-only（HuggingFace tokenizers + SentencePiece JNI），**不能进 commonMain**。必须 expect/actual：androidMain/jvmMain 用 DJL，其他目标需另实现或用纯 Kotlin 分词语义（会牺牲精度）。
2. **加密**：Android Keystore 与 JVM 侧（Windows DPAPI / macOS Keychain / Linux libsecret）需 expect/actual，无法统一。
3. **SQLite**：KMP 侧成熟选项是 SQLDelight（支持 Android/JVM/Native）或 Room KMP；现有 tdbc 那样的驱动抽象在新项目里可以省掉，直接用 SQLDelight 的 `.sq` 定义 + 生成类型安全 API。
4. **HTTP/SSE**：Ktor Client（androidMain 用 OkHttp engine，jvmMain 用 CIO/OkHttp）；SSE 解析仍建议手写在 commonMain（三家协议状态机是纯逻辑）。
5. **文件系统**：本项目 VFS 存在 DB 里，**不需要真实 FS 抽象**，这一条反而是 KMP 的最大减负项。
6. **UI 共享**：若走 Compose Multiplatform，Android + Desktop 可共享一部分 UI；但 mermaid/富文本在 Desktop 仍需 JCEF，且 Compose Desktop 的原生菜单、文件对话框、字体渲染需单独处理。

## 五、结论
- **不需要放弃桌面端**。core 是 Kotlin 时，桌面端反而比现状更干净：core 一份真源，CLI 作为稳定 API 边界，UI 随便换。
- 若将来想彻底摆脱 Electron → 走 Compose Desktop（core 不用改）；若想保留 React 生态 → Electron 壳 + CLI sidecar（core 也不用改）。**这个决定可以推迟，因为 core 与 UI 之间已有 CLI 契约。**
- 唯一要现在决定的是：CLI 的协议形态（建议 stdio JSON-RPC + 流式事件，对齐 LSP 风格）。

## 六、追加轮（2026-10-24）：用户拍板保留 Electron
- user: 「我知道 kt 可以写桌面端，但是 electron 的兼容性是其他框架比不了的」
- **决策确认：桌面端保留 Electron，不做 Compose Desktop。** 路线 3（Kotlin core + Kotlin CLI + Electron UI）即为最终形态，与「core 是 Kotlin」不冲突——Electron 只承担 UI，core 在 CLI 进程里。

### Electron 在该项目里不可替代的具体来源（拆解「兼容性」）
1. **Chromium 渲染能力**：mermaid（11.16.1）、KaTeX、markdown、highlight.js、富文本预览全部依赖真实 Chromium；换任何非 Chromium 桌面框架都要重建（Compose Desktop 需 JCEF/KCEF）。
2. **与移动端渲染层同源**：移动端 WebView 是 Chromium，桌面 Electron 是 Chromium → mermaid/气泡/高亮这一层在两端跑同一引擎，是 RN + WebView 时代留下的真实资产。
   - **但要注意差异**：桌面捆绑 Electron 自带的 Chromium（版本跟随 Electron），移动端用 Android System WebView（版本跟随系统，老设备可能 Chromium 58+）——这正是 `apps/mobile/scripts/build-webview.mjs:44-45` 设 Chromium 58 兼容基线的原因。渲染行为不能假设完全一致。
3. **Node 生态与工具链**：构建、脚本、文件系统、原生模块（better-sqlite3 等）在桌面侧仍然可用。
4. **跨平台一致性**：一套代码在 Windows/macOS/Linux 行为一致；Compose Desktop 在字体渲染、原生菜单、IME 上仍有差距。

### Electron ↔ Kotlin core 的传输选择
- **stdio JSON-RPC**：无端口冲突、天然一对一、安全（不暴露本地端口）、实现简单。适合单窗口主场景。
- **本地 HTTP / WebSocket（bind 127.0.0.1 + token）**：可 curl 调试、多窗口共享同一 core、未来 Web 前端直接复用。有端口占用与本地鉴权成本。
- **建议**：协议定义成**传输无关的 JSON-RPC**（方法 + 通知 + 流式事件），先实现 stdio，需要时加 HTTP adapter——不预赌传输层。
