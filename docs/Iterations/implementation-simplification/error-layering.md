# 错误四层分工

> 接线图 D 固化文档（M4 Step 23）  
> 关联 SPEC：[spec.md](./spec.md)

## 分层概览

| 层 | 函数 | 语言 | 消费者 |
|----|------|------|--------|
| LLM `tool_result.content` | `formatVfsErrorForLlm` / `formatToolErrorForLlm` | 英文 + `[CODE]` | Agent runner 落库 |
| 工具卡 `summary` | `buildToolResultBlock` 内 summary | 英文截断 | MessageList / WebView |
| 用户 Toast / Alert | `formatVfsErrorForUser` | 中文 | Mobile `formatError`；Desktop PreviewPane 等 |
| IPC `{ code, message }` | `formatIpcError`（唯一） | 英文 code | Desktop handlers → renderer |

## 调用链

```text
VFS / Tool 失败
  ├─ Agent 工具路径 → formatVfsErrorForLlm / formatToolErrorForLlm → 落库 transcript
  ├─ 工具卡渲染     → buildToolResultBlock summary（英文截断）
  ├─ App 用户可见   → formatVfsErrorForUser（中文）← Mobile formatError 委托
  └─ Desktop IPC    → formatIpcError（code + message）← 全部 handler 统一
```

## 约定

- **禁止** handler 内本地 `formatError`；VfsError / ToolError unwrap 由 `formatIpcError` 单点处理。
- **禁止** 将 LLM 层英文文案直接展示给用户；用户层须走 `formatVfsErrorForUser` 或等价中文映射。
- IPC `code` 供 renderer 分支；`message` 为英文/技术句，Toast 展示前须经用户层格式化（若适用）。

## 单测

| 场景 | 测试文件 |
|------|----------|
| CONFLICT / REPLACE_NOT_FOUND / ToolError unwrap（用户层） | `packages/core/test/vfs/format-vfs-error-for-user.test.ts` |
| SessionFs / VfsError code 映射（IPC 层） | `apps/desktop/test/format-ipc-error.test.ts` |
