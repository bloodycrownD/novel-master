---
date: 2026-07-17
dependency:
  - Iterations/mobile-webview-chat-transcript/prd.md
  - Iterations/mobile-vfs-markdown-webview/prd.md
---

# Mobile WebView Boot 资源化与源码拆分 PRD

> **平台**：Mobile（Android + iOS）  
> **性质**：工程可维护性；用户可见行为不变  
> **定案摘要（本迭代）**：把 boot/HTML/CSS 从 TS template 迁为独立真源；去掉巨型 `*.generated.ts`；构建期产出真实 HTML，供过渡期 `source={{ html }}` 使用；boot 按职责拆分。  
> **后续**：交付与加载的终局（打包工具 + `uri`/本地资源、告别手写 assemble 与巨型入库 HTML）见子迭代 [`mobile-webview-boot-bundler`](../mobile-webview-boot-bundler/prd.md)。

## 背景

聊天 Transcript 与 VFS Markdown 预览使用 RN WebView。早期整页嵌在 TS template 中，难维护且曾因转义错误导致 boot 失败。本迭代完成「编辑面资源化」与「去掉 generated TS」，落地形态为：真源 `shell/` + `boot/*.js` → Node 手写 assemble → 提交 `*.assembled.html` → Metro 读成字符串 → `source={{ html }}`。

该过渡形态仍依赖手写 concat 与巨型组装产物入库，**不视为终局**；终局由子迭代用标准前端打包与本地资源加载接管。

## 目标（含成功指标）

1. **可维护编辑面**：boot / 壳 / 样式为独立源文件。  
2. **去掉巨型 generated TS**：不以 TS template 内嵌整页 HTML 为主交付。  
3. **行为不变**：展示、流式、菜单、桥、主题、滚动无回归。  
4. **双端同管线**：transcript 与 rich-document 共用约定。  
5. **为终局让路**：不把「手写 assemble + 仅 `source.html`」写成不可变更的终局约束。

**成功指标**

- 生产路径不再依赖「TS 内嵌整页 HTML」或「手写 IIFE 写在 TS template 里」。  
- 契约单测绿；真机聊天 + Markdown 预览可用。  
- 明确声明后续迭代可替换组装实现与加载 API。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | 改渲染/菜单/流式时编辑独立源文件，而非巨型 TS 字符串。 |
| 终端用户 | 无感知。 |

## 范围

### 包含范围

1. 真源迁出与 boot 职责拆分。  
2. 去掉巨型 `*.generated.ts`；过渡期真实 HTML 交付（含 `*.assembled.html` + 字符串加载）。  
3. 常量单源与双源清理；契约测适配。  

### 不包含范围

1. **用打包工具全面替代手写 assemble**（归子迭代 `mobile-webview-boot-bundler`）。  
2. **WebView 主路径改为 `uri` / 原生 asset**（归子迭代）。  
3. 重做桥协议或产品交互；Desktop；删除 WebView 主路径。

## 核心需求（3–7 条）

1. 独立源文件为编辑面。  
2. 禁止巨型 TS 字符串作为 HTML 主产物。  
3. 过渡期 WebView 可稳定加载（字符串 HTML 可接受）。  
4. 双 WebView 同管线。  
5. boot 禁止巨石回潮。  
6. 契约可回归 + 无用户可见回归。

## 验收标准

- [x] 主逻辑位于独立源文件（相对迁出前）。  
- [x] 不存在作为主交付的巨型 `*.generated.ts` 整页内嵌。  
- [ ] 会话 / 富文档 WebView 行为可用（持续回归）。  
- [ ] 相关单测全绿（持续回归）。  
- [x] 父文档不再把「仅 Node assemble + 仅 source.html」表述为不可替代终局。

## 约束与依赖

- 硬依赖：[`mobile-webview-chat-transcript`](../mobile-webview-chat-transcript/prd.md)、[`mobile-vfs-markdown-webview`](../mobile-vfs-markdown-webview/prd.md)。  
- 终局交付与加载：[`mobile-webview-boot-bundler`](../mobile-webview-boot-bundler/prd.md)。

## 风险与待确认项

- 过渡期 `*.assembled.html` 仍大、仍入库——由子迭代消除。  
- 父 SPEC 中「路径 A / Node assemble 唯一」表述须随子迭代落地而修订或标注 superseded。
