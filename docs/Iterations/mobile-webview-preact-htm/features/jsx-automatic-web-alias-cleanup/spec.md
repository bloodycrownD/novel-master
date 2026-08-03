---
date: 2026-07-18
agile_trace: true
---

# jsx-automatic-web-alias-cleanup 实现规格（SPEC）

## 根因 / 方案摘要

Classic JSX 强制显式 `h`，体验差；`@web` 样例未覆盖全部 shared 引用。改为 esbuild/tsc **automatic** + 扫尾 `@web/shared`。

**Supersede**：父 SPEC「JSX 编译 = classic + jsxFactory h」→ **automatic + jsxImportSource: preact**；显式 `h` 仅保留给 `main` 手写装配。

## 变更点清单

| 区域 | 变更 |
|------|------|
| esbuild | `jsx: 'automatic'`，`jsxImportSource: 'preact'` |
| tsconfig | `jsx: 'react-jsx'`，`jsxImportSource: 'preact'` |
| 12× `.tsx` | 删仅 JSX 用的 `import { h }` |
| 3× TrustedHtml | `@web/shared/ui/TrustedHtml` |
| 父 SPEC/PRD | 同步定案 |

## 详细改动说明

### JSX

- 自动注入 `preact/jsx-runtime`（非全局 inject `h`）。
- `main.ts` 仍：`import { h, render } from 'preact'` + `render(h(Comp, props), root)`。
- HTML **classic script** 契约不变。

### @web 扫尾文件

- `ui/stream/StreamTail.tsx`
- `ui/render/AssistantBubble.tsx`
- `runtime/stream/stream.ts`

### 提交

- `2cc5d27d` 配置 automatic  
- `a07e06c2` 删 h import  
- `1e6fdeac` @web 扫尾  
- `e91c8615` 父文档同步  

## 测试策略

### 测试用例

| ID | 结果（实现时） |
|----|----------------|
| T-JAC-01 build:webview | 通过 |
| T-JAC-02 tsc webview-boot | 通过 |
| T-JAC-03 boot-script 20 tests | 通过 |
| T-JAC-04 无相对 shared | 通过 |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| jsx-runtime 进 IIFE 体积略增 | 已接受 Preact；禁 minify 救测 |
| 文档仍写 jsxFactory | 已改父 SPEC/PRD |

**回滚**：revert 上述提交。
