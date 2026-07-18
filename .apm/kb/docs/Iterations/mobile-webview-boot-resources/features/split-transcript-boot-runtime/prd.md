---
date: 2026-07-17
dependency: Iterations/mobile-webview-boot-resources/prd.md
---

# split-transcript-boot-runtime Feature PRD

## 背景与变更动机

父级迭代已将 chat-transcript boot 从 TS template 迁为真源 `.js`，但「其余运行时」仍堆在单文件 `boot/runtime.js`（约 1500 行），与父级 PRD「按 scroll / render / menu / stream / host-bridge 拆分、禁止继续堆巨石」未完全对齐，审查与局部修改成本偏高。

## 范围说明（相对原需求）

- **包含**：将 `runtime.js` 按职责切为多个 `boot/*.js`；更新 Node assemble concat 顺序与注释；重新生成并提交 `transcript-html.generated.ts`；保留 `source={{ html }}` 与既有桥协议。
- **不包含**：改 WebView 为 `uri` / asset 加载；重做菜单/流式产品交互；拆解 `*.generated.ts` 交付形态。

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `apps/mobile/src/web/chat-transcript/boot/*` | 删除 `runtime.js`；新增职责切片文件 |
| `apps/mobile/scripts/assemble-webview-html.mjs` | `concatTranscriptBoot` 文件列表与顺序注释 |
| `transcript-html.generated.ts` | 组装产物内容变更（契约字符串保持） |
| RN WebView / 桥 API | 无对外接口变更 |

## 验收标准

- [ ] 可编辑 boot 单文件不再保留 `runtime.js` 巨石；各切片职责清晰且均明显短于原 1500 行。
- [ ] assemble 顶部注释与 `parts` 顺序一致且可重复生成。
- [ ] 既有 boot/HTML 契约测（T-BR 相关）全绿。
- [ ] 加载方式仍为 `source={{ html, baseUrl }}`。

## 测试用例

| ID | 说明 |
|----|------|
| T-AG-01 | `npm run assemble:webview-html -w @novel-master/mobile` 成功 |
| T-AG-02 | `chat-transcript-boot-script` / `rich-styles` / `set-floor` / `rich-document-boot-script` Jest 全绿 |
| T-AG-03 | 产物仍含 `bootTranscript`、长按守卫、stream 相关契约关键字（由既有 T-BR 覆盖） |
