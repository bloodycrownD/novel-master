---
date: 2026-07-17
---

# Mobile WebView 真源与 Host 分区 技术规格（SPEC）

> **PRD**：[`prd.md`](./prd.md)  
> **建议分支**：当前功能分支或 `feat/mobile-webview-src-layout`  
> **代码基线**：`mobile-webview-boot-bundler` 已落地（esbuild + `source.uri` + dist）  
> **需求来源**：PRD + 用户定案「方案 3」+ 只读探索（构建入口、import 消费者、现网混放）

## 设计目标

1. **`apps/mobile/src/web/` = 仅可进 esbuild 的 WebView 真源**（无 `react-native` 依赖）。  
2. **`apps/mobile/src/webview-host/` = RN/Metro/Jest 宿主胶水**（URI + 原包根纯函数）。  
3. 两包 web 侧对称：`{pkg}/webview/**` + `index.html` + `styles/`。  
4. **chat-transcript `webview/` 按职责分子目录**（非独立 npm 包）：`bridge` / `state` / `scroll` / `menu` / `stream` / `render` / `util`；入口仍为 `webview/main.ts`；**禁止** 子目录 `index.ts` barrel，跨模块显式文件路径。`rich-document/webview/` 仅 `main.ts`，**不强制**对称硬拆。  
5. **行为与契约不变**：URI 定案串、产物布局、IIFE/`minify:false`、桥协议、必配 props。  
6. 包根与 boot **同名双份只搬家不合并**。

## 总体方案

### 架构（搬家，不改运行时）

```text
改前（混放）
  src/web/
    webview-asset-uri.ts          ← RN
    {pkg}/uri.ts, scroll.ts, …    ← RN/Jest
    {pkg}/src/**                  ← Web boot
    shared/**

改后（方案 3）
  src/web/                        ← 只给 esbuild
    shared/**
    {pkg}/index.html + styles/
    {pkg}/webview/                ← 原 {pkg}/src/**；CT 再按职责分子目录
      main.ts
      bridge/ | state/ | scroll/ | menu/ | stream/ | render/ | util/

  src/webview-host/               ← 只给 Metro/Jest
    webview-asset-uri.ts
    chat-transcript/{uri,scroll,menu-overlay-guards,stream-tail-html-state}.ts
    rich-document/uri.ts
```

### 唯一定案

| 项 | 定案 |
|----|------|
| Host 根目录 | **`apps/mobile/src/webview-host/`**（不用 `native/webview-host`） |
| Web boot 子目录名 | **`{pkg}/webview/`**（替换 `{pkg}/src/`） |
| CT webview 内部分区 | **必做**（目录模块，非 npm 包）。固定子目录：`bridge/`、`state/`、`scroll/`、`menu/`、`stream/`、`render/`、`util/`；根级仅留 **`main.ts`**（入口组装）。文件映射见「最终项目结构」。 |
| CT webview barrel | **禁止**。各子目录 **不得** 使用 `index.ts` barrel；子目录内文件名按映射表（`bridge/bridge.ts`、`state/state.ts` 等），**禁止** 把 `bridge.ts` 等改名为 `index.ts`。跨模块 import **必须** 显式文件路径（如 `../bridge/bridge`、`../state/state`），**禁止** 目录裸 import（如 `../bridge`）。 |
| RD webview | 仅 `main.ts`（及后续自然增长）；**不**为对称而空建子目录 |
| 包壳 | `{pkg}/index.html`、`{pkg}/styles/` **仍留在 `src/web/{pkg}/`** |
| shared | **仍留在 `src/web/shared/`**；host 可单向 import web shared（如 constants）；**禁止** web boot import host |
| URI | `webview-host/webview-asset-uri.ts` + `webview-host/{pkg}/uri.ts`；对外符号名不变 |
| 双份逻辑 | **只搬家**；不合并 host `scroll` 与 webview `scroll`；不合并 guards 与 menu 内函数 |
| 根 shim | 删除 `src/web/rich-content-styles.ts`；测改指 `shared/rich-content-styles` |
| 产物 / 原生落点 / URI 字符串 | **零变更**（沿用 bundler） |
| 路径别名 | 优先 `@/webview-host/...`、`@/web/...` |
| 禁止 | 将上述子目录拆成独立 npm workspace 包；为拆而拆空目录；CT `webview/` 子目录 `index.ts` barrel / 目录裸 import |

### Context Bundle

```yaml
iteration_name: web-src-layout-cleanup
requirement_path: Iterations/mobile-webview-boot-bundler/features/web-src-layout-cleanup/prd.md
spec_path: Iterations/mobile-webview-boot-bundler/features/web-src-layout-cleanup/spec.md
explore_summary: |
  方案3：host 迁出 web；CT webview 按 bridge/state/scroll/menu/stream/render/util 分子目录；
  禁止子目录 index.ts barrel，跨模块显式文件路径；build 入口仍为 webview/main.ts；
  RN 依赖仅 webview-asset-uri。
impact_files:
  - apps/mobile/src/web/**                    # 收拢 webview/ 子目录、删 RN 文件与 shim
  - apps/mobile/src/webview-host/**            # 新建
  - apps/mobile/scripts/build-webview.mjs
  - apps/mobile/tsconfig.webview-boot.json
  - apps/mobile/src/components/chat/ChatTranscriptWebView.tsx
  - apps/mobile/src/components/vfs/RichDocumentWebView.tsx
  - apps/mobile/__tests__/webview-uri-load.test.tsx
  - apps/mobile/__tests__/chat-transcript-scroll.test.ts
  - apps/mobile/__tests__/menu-overlay-guards.test.ts
  - apps/mobile/__tests__/stream-tail-html-state.test.ts
  - apps/mobile/__tests__/rich-content-styles.test.ts
  - apps/mobile/README.md
constraints:
  - no RN deps under src/web
  - host may import src/web/shared only
  - CT webview subdirs: bridge/state/scroll/menu/stream/render/util + main.ts
  - no index.ts barrel under CT webview subdirs; explicit file path imports only
  - URI strings / dist layout / bridge unchanged
  - no merge of duplicate scroll/guards this iteration
  - no npm packages for webview subdirs
blocking_steps: [1, 2, 3, 4, 5, 6]
```

## 最终项目结构

```text
apps/mobile/src/
  web/                                    # 仅 WebView 真源（esbuild）
    shared/
      constants.ts
      decode-entities.ts
      rich-content-styles.ts
    chat-transcript/
      index.html                          # 短壳：link + classic script
      styles/
        transcript.css
      webview/
        main.ts                           # 入口：组装 / 绑事件（唯一根级业务入口）
        bridge/
          bridge.ts                       # 原 bridge.ts
        state/
          state.ts                        # 原 state.ts
        scroll/
          scroll.ts                       # DOM boot（与 host/scroll 不同）
        menu/
          menu.ts                         # 原 menu.ts
        stream/
          stream.ts                       # 原 stream.ts
          stream-markdown.ts              # 原 stream-markdown.ts
        render/
          snapshot.ts                     # 原 snapshot.ts
          row-render.ts
          rows-click.ts
          tool-render.ts
        util/
          html-escape.ts
          vfs-tool-path.ts
    rich-document/
      index.html
      styles/
        document.css
      webview/
        main.ts                           # 轻量；不强制建 CT 同款子目录

  webview-host/                           # 仅 RN / Metro / Jest
    webview-asset-uri.ts                  # Platform + blob-util；拼 android_asset / WebViewDist
    chat-transcript/
      uri.ts                              # getChatTranscriptUri / PackageDirUri
      scroll.ts                           # 数值 nearBottom 等（原包根）
      menu-overlay-guards.ts
      stream-tail-html-state.ts
    rich-document/
      uri.ts                              # getRichDocumentUri / PackageDirUri

apps/mobile/scripts/build-webview.mjs     # entry → {pkg}/webview/main.ts
apps/mobile/tsconfig.webview-boot.json    # include → **/webview/** + shared；去掉 exclude asset-uri
apps/mobile/webview-dist/                 # 不变
```

> 验收：「web 无 RN + host 集中 + `{pkg}/webview/main.ts` 入口 + CT 七类子目录 + 无 barrel」。子目录内文件名按下方映射表（`bridge/bridge.ts` 等）；**禁止** `index.ts` barrel 与目录裸 import。

> **后续覆盖**：CT `webview/` **七类顶层物理路径**与 **T-WL-07** 已被 [`mobile-webview-preact-htm`](../../../mobile-webview-preact-htm/spec.md) 以 `ui/` + `runtime/{七类}/` 覆盖（supersede）；本 SPEC 职责心智与禁 barrel 仍有效。

### CT `webview/` 文件映射（现网 → 终局）

| 现网（`{pkg}/src/`） | 终局 |
|----------------------|------|
| `main.ts` | `webview/main.ts` |
| `bridge.ts` | `webview/bridge/bridge.ts` |
| `state.ts` | `webview/state/state.ts` |
| `scroll.ts` | `webview/scroll/scroll.ts` |
| `menu.ts` | `webview/menu/menu.ts` |
| `stream.ts`、`stream-markdown.ts` | `webview/stream/` |
| `snapshot.ts`、`row-render.ts`、`rows-click.ts`、`tool-render.ts` | `webview/render/` |
| `html-escape.ts`、`vfs-tool-path.ts` | `webview/util/` |

> **Import 约定（与 barrel 定案一致）**：跨子目录写显式文件（`from '../bridge/bridge'`），勿 `from '../bridge'`；同目录可 `./stream-markdown`。

### 已知限制 / 实现注

- **七类单文件目录偏碎（已接受）**：用户定案七类 **必做**。`bridge/`、`state/`、`scroll/`、`menu/` 现网各仅一文件，终局仍为 `bridge/bridge.ts` 等单文件目录——**接受**，心智收益主要在 `stream/`、`render/`、`util/` 多文件聚合；**不**改回扁平，也 **不** 为「目录好看」把单文件改成 `index.ts`。
- **禁止 barrel**：与「唯一定案」表一致；实现与 CR 拒收 `webview/**/index.ts` 及目录裸 import。

## 变更点清单

| 区域 | 变更 |
|------|------|
| 搬家 host | 6 个 host 文件 → `webview-host/` |
| 收拢 boot | `{pkg}/src` → `{pkg}/webview`；**CT 再按映射表分子目录**（无 barrel）；修正模块间相对 import 为显式文件路径 |
| 删除 | `src/web/rich-content-styles.ts` shim；`src/web` 下不再留 uri/asset-uri/包根纯函数 |
| 构建 | `build-webview.mjs`：`entryRel` = `{pkg}/webview/main.ts`；必要时修正 boot→shared 相对路径 |
| 类型 | `tsconfig.webview-boot.json` include/exclude 对齐 |
| RN | 两 WebView 组件 import → `@/webview-host/.../uri` |
| 测试 | uri / scroll / guards / stream-tail / rich-styles 路径更新 |
| 文档 | README 最短路径；本 feature 树；父 bundler SPEC 可加一句「真源分区见本 feature」 |

## 兼容性与迁移

1. **行为**：加载 URI、ready、桥、产物文件名不变。  
2. **Import**：旧 `@/web/chat-transcript/uri` 等删除，不保留长期 re-export（本期激进；若需过渡可短时 shim，默认不做）。  
3. **顺序**：先建 `webview-host` 并改消费者 → 再 `src`→`webview` + **CT 分子目录**并改构建 → 删 shim → 文档。  
4. **回滚**：git revert 本 feature 提交。

## 详细实现步骤

- Step 1 — phase-host-move — blocking: yes — qa: auto：新建 `src/webview-host/`；迁入 `webview-asset-uri` 与两包 `uri` + chat 包根三纯函数；修正其对 `web/shared` 的相对路径（示例：`../../web/shared/constants` 或 `@/web/shared/constants`）；更新两 WebView 组件与相关 Jest import。  
- Step 2 — phase-webview-rename — blocking: yes — qa: auto：`{pkg}/src` → `{pkg}/webview`（可先扁平）；更新 `build-webview.mjs` entry；更新 `tsconfig.webview-boot.json`；确认 boot→`shared` 相对路径；`npm run build:webview` 绿。  
- Step 3 — phase-webview-subdirs — blocking: yes — qa: auto：按「文件映射」将 CT `webview/` 拆入 `bridge|state|scroll|menu|stream|render|util`（文件名按映射表，**禁止** `index.ts` barrel）；更新内部相对 import 为显式文件路径；根级仅留 `main.ts`；再次 `build:webview` 绿。RD 不强制拆。  
- Step 4 — phase-remove-shim — blocking: yes — qa: auto：删除 `src/web/rich-content-styles.ts`；`rich-content-styles` 测改指 `shared/`；确认 `src/web/**` 无 RN 依赖。  
- Step 5 — phase-docs — blocking: yes — qa: auto：README 真源路径改为 `src/web/{pkg}/webview`（并简述 CT 子目录）+ 说明 host 在 `src/webview-host/`；父 bundler SPEC「最终项目结构」加交叉引用或短 banner。  
- Step 6 — phase-verify — blocking: yes — qa: auto：跑 `build:webview` + 相关 Jest（uri-load、scroll、guards、stream-tail、rich-styles、boot-script）；抽检 CT `webview/` 具备七类子目录 + `main.ts`，且无子目录 `index.ts`。  
- Step 7 — phase-device-qa — blocking: no — qa: manual_user：真机双 WebView smoke（合并后用户执行）。

## 测试策略

- **自动**：构建产物；URI / 纯函数 / CSS / boot 契约测。  
- **手工**：Step 7。

### 测试用例

| ID | Step | blocking | 说明 |
|----|------|----------|------|
| T-WL-01 | 1–4 | yes | `src/web/**` 无 `react-native` / `react-native-blob-util` 直接依赖 |
| T-WL-02 | 2–3 | yes | `build:webview` 产出两套 dist 三文件 |
| T-WL-03 | 1,6 | yes | `webview-uri-load` 绿；组件 URI 来自 host |
| T-WL-04 | 1,6 | yes | scroll / guards / stream-tail 单测改路径后绿 |
| T-WL-05 | 4,6 | yes | rich-styles 测指 shared；根 shim 已删 |
| T-WL-06 | 6 | yes | boot-script 契约测仍绿（读 dist） |
| T-WL-07 | 3,6 | yes | CT `webview/` 含 `main.ts` + `bridge|state|scroll|menu|stream|render|util` 七类子目录；子目录无 `index.ts`；跨目录 import 为显式文件路径 |
| T-WL-08 | 5 | yes | README 路径与终局树一致，且保留「仅 start 不足」 |
| T-WL-09 | 7 | no | 真机 smoke（manual_user） |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| boot→shared 相对路径在改名/分子目录后算错 | Step 2–3 立刻 `build:webview`；抽检 `../../shared` 深度 |
| CT 子目录内相对 import 漏改 / 误用 barrel | Step 3 全量编译；T-WL-07；CR 拒收 `index.ts` 与目录裸 import |
| 漏改 `@/web/.../uri` | Step 6 全搜旧路径；T-WL-03 |
| 误合并双份 scroll/guards | SPEC 禁止；CR 时拒收无关 refactor |
| host→shared 循环依赖 | 只允许 host→web/shared；web 禁止 import host |
| 过度拆 npm 包 / 为单文件改 `index.ts` | SPEC 明确禁止；仅目录模块 + 映射表文件名 |

**回滚**：revert 本 feature 提交。
