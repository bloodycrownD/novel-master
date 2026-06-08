# macOS 桌面版启动修复 PRD

## 背景

部分开发环境（如通义灵码 IDE 集成的终端）会在子进程中注入 `ELECTRON_RUN_AS_NODE=1`，导致 Electron 以纯 Node 模式启动，无法加载 `electron` API，桌面应用在 `dev:electron` / `start` 时直接失败。

与此同时，桌面版此前将自定义标题栏（`titleBarOverlay`）仅面向 Windows 实现；macOS 需要采用系统原生的 `hiddenInset` 样式与交通灯布局，否则窗口 chrome 与交互不符合 macOS 用户预期。

本迭代在修复跨平台启动可靠性的同时，补齐 macOS 标题栏与资源路径问题。因当前开发与验收环境为 Windows，**本迭代以 Windows 回归验证为主**，macOS 实机验收留待后续或协作者确认。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 启动可靠 | 即使父 shell 设置了 `ELECTRON_RUN_AS_NODE=1`，桌面版仍能以正常 Electron 模式启动 |
| macOS chrome 就绪 | macOS 使用 `hiddenInset` 与交通灯避让，启用与 Windows 一致的自定义标题栏交互能力 |
| Windows 无回归 | 改动后 Windows 上 dev / start 流程与窗口表现与改前一致 |

成功指标（可量化）：

- 在模拟 `ELECTRON_RUN_AS_NODE=1` 的终端环境下，`npm run dev:electron` 与 `npm run start`（desktop 包）均可成功拉起窗口，无 `electron` API 缺失类报错。
- Windows 上窗口标题栏 overlay、拖拽区域、应用图标显示正常。
- 本迭代验收用例在 Windows 上 **100% 通过**；macOS 用例记为「待实机确认」，不阻塞本迭代完成。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 桌面端开发者 | 在 IDE 内置终端或已污染环境的 shell 中执行 `dev:electron`，期望应用正常启动 |
| macOS 终端用户 | 打开桌面版后看到符合 macOS 规范的窗口装饰（交通灯位置、标题区留白） |
| Windows 终端用户 | 升级后日常开发与打包启动路径不受影响 |

## 范围

### 包含范围

- **启动环境隔离**：在 Electron 启动链路中清除或规避 `ELECTRON_RUN_AS_NODE`，确保子进程以 GUI 模式运行；覆盖 `dev:electron` 与 `start` 入口。
- **平台化窗口配置**：主进程 `BrowserWindow` 按 `darwin` / `win32` / 其他平台分别配置标题栏样式。
- **渲染层平台感知**：preload 向渲染进程暴露平台信息；macOS 启用自定义标题栏能力；DOM 根节点标记 `data-platform` 以驱动样式。
- **macOS 交通灯避让**：leading 区域增加左侧 padding，避免内容与系统交通灯重叠。
- **应用图标路径修正**：渲染层引用 monorepo 内正确的 icon 资源路径。
- **开发服务器资源访问**：Vite dev server 允许访问 monorepo 根目录下的共享静态资源（如图标）。

### 不包含范围

- 通义灵码或其他 IDE 侧环境变量注入行为的修复或上报。
- Linux 桌面版专属标题栏 polish（沿用默认配置即可）。
- **本迭代内的 macOS 实机启动与 UI 验收**（无 macOS 环境时不执行，不视为未完成）。
- Electron 打包、签名、notarization 流程变更。
- 除 icon 路径外的新增 UI 功能或业务逻辑改动。

## 核心需求（6 条）

1. **抗污染启动**：桌面应用在 `ELECTRON_RUN_AS_NODE=1` 已设置的终端中启动时，必须清除或覆盖该变量后再 spawn Electron，且不影响同 shell 内其他 Node 进程。
2. **双入口一致**：`dev:electron`（含 native rebuild 与 main/preload 构建）与 `start` 均走统一的跨平台启动器，行为一致。
3. **macOS 原生窗口装饰**：`darwin` 平台使用 `hiddenInset` 与合理的 `trafficLightPosition`，不使用 Windows 专用的 `titleBarOverlay`。
4. **macOS 自定义标题栏**：preload 在 macOS 上同样声明 `customTitleBar: true`，渲染层通过 `data-platform=darwin` 应用交通灯避让样式。
5. **Windows 行为保持**：`win32` 仍使用 `hidden` + `titleBarOverlay`；窗口可拖拽、图标可见、无布局错位。
6. **资源可解析**：开发模式下 Vite 可加载 monorepo 根目录侧的 icon 资源，不出现 404 或构建失败。

## 验收标准

- **A1 污染环境下 dev 启动（Windows）**  
  Given 当前 shell 已 `set ELECTRON_RUN_AS_NODE=1`（PowerShell / cmd 等价操作）  
  When 在 `apps/desktop` 执行 `npm run dev:electron`  
  Then 应用在合理时间内打开主窗口，控制台无「require('electron') 非 API」或进程立即退出类错误。

- **A2 污染环境下 start（Windows）**  
  Given 同上环境变量已设置  
  When 在 `apps/desktop` 执行 `npm run start`（需已 build main/preload）  
  Then 应用正常启动，行为与 A1 一致。

- **A3 Windows 标题栏与图标**  
  Given 未设置 `ELECTRON_RUN_AS_NODE` 的正常 Windows 环境  
  When 启动桌面应用  
  Then 标题栏 overlay 显示正常、窗口可拖拽、侧栏/顶栏应用图标正确显示。

- **A4 rebuild 脚本不受污染**  
  Given `ELECTRON_RUN_AS_NODE=1`  
  When `node scripts/rebuild-native.mjs` 作为 `dev:electron` 前置步骤执行  
  Then native rebuild 完成且无因 Electron 模式错误导致的失败。

- **A5 平台配置代码审查（macOS，文档验收）**  
  Given 代码已合并  
  When 审查 `BrowserWindow` / preload / CSS / `AppChrome` 改动  
  Then `darwin` 分支含 `hiddenInset` 与交通灯配置；`win32` 分支未被误改；`data-platform` 在挂载时写入 `document.documentElement`。

- **A6 macOS 实机（本迭代不执行）**  
  Given macOS 设备可用  
  When 执行 A1/A2 并目视检查交通灯与标题区  
  Then 窗口装饰符合 macOS 规范 — **标记为后续验收项，不纳入本迭代 Windows 环境的完成判定**。
