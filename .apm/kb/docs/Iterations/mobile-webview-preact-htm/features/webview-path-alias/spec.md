---
date: 2026-07-18
agile_trace: true
---

# webview-path-alias 实现规格（SPEC）

## 根因 / 方案摘要

WebView boot 无路径别名，跨 `shared` 需多层 `../`。方案：在 **tsc 与 esbuild 双侧** 增加 `@web/* → src/web/*`，与 Metro `@/*` 隔离；样例改写验证双端一致。

## 变更点清单

| 区域 | 变更 |
|------|------|
| tsconfig | `baseUrl: "."`；`paths["@web/*"] = ["src/web/*"]` |
| esbuild | `alias: { '@web': webRoot }`（`bundleAppJs` + `loadRichContentStyles`） |
| 样例 | 6 文件 shared import → `@web/shared/...` |
| README | `@web` 仅 WebView boot |

## 详细改动说明

### 别名契约

| 别名 | 映射 | 用途 |
|------|------|------|
| `@web/*` | `apps/mobile/src/web/*` | 仅 WebView 真源（esbuild boot + webview-boot tsc） |
| `@/*` | （不变）Metro / RN | **禁止**在 `src/web` boot 源码使用 |

### 样例文件

1. `runtime/stream/stream-markdown.ts`
2. `runtime/util/html-escape.ts`
3. `runtime/scroll/scroll.ts`
4. `runtime/menu/menu.ts`
5. `ui/render/ThinkingSection.tsx`
6. `rich-document/webview/ui/DocumentApp.tsx`

未改（可后续）：`stream.ts`、`AssistantBubble.tsx`、`StreamTail.tsx`。

### 提交

- `3bc0d091` — 配置
- `5f8fb166` — 样例
- `e77a2c18` — README

## 测试策略

### 测试用例

| ID | 命令 / 检查 | 结果（实现时） |
|----|-------------|----------------|
| T-WPA-01 | `npm run build:webview` | 通过 |
| T-WPA-02 | `npx tsc --noEmit -p tsconfig.webview-boot.json` | 通过 |
| T-WPA-03 | `npm test -- --testPathPattern=boot-script` | 通过（20 tests） |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| tsc / esbuild alias 不同步 | 两处同 PR 改；构建+tsc 双绿 |
| IDE 仍提示可用 `@/` | README 约定；webview-boot 无 `@/` paths |
| 漏配 `loadRichContentStyles` | 两处 esbuild 共用 `webAlias` |

**回滚**：revert 上述三提交。
