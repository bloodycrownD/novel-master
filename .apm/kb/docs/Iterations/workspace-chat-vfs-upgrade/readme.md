# workspace-chat-vfs-upgrade

**日期：** 2026-07-21  
**状态：** SPEC 待用户确认  
**父级：** [prd.md](./prd.md) · [spec.md](./spec.md)

---

## 目录约定

```
workspace-chat-vfs-upgrade/
├── readme.md
├── prd.md
├── spec.md
└── features/
    └── <feature>/{prd,spec}.md
```

---

## Feature 索引

| Feature | 摘要 | 文档 |
|---------|------|------|
| [fork-snapshot-and-rules](./features/fork-snapshot-and-rules/) | fork/copy：活树快照 + workplace 规则 | [prd](./features/fork-snapshot-and-rules/prd.md) · [spec](./features/fork-snapshot-and-rules/spec.md) |
| [chat-token-api-overlay](./features/chat-token-api-overlay/) | 展示与压缩同一引擎；优先 API promptTokens | [prd](./features/chat-token-api-overlay/prd.md) · [spec](./features/chat-token-api-overlay/spec.md) |
| [vfs-zip-directory](./features/vfs-zip-directory/) | 目录子树 ZIP + 入口改挂 | [prd](./features/vfs-zip-directory/prd.md) · [spec](./features/vfs-zip-directory/spec.md) |
| [vfs-batch-io](./features/vfs-batch-io/) | 批量 IO；Desktop 拖拽三向；Mobile 菜单 | [prd](./features/vfs-batch-io/prd.md) · [spec](./features/vfs-batch-io/spec.md) |

---

## 已拍板摘要

- ZIP 导入 = **当前/目标目录子树覆盖**，兄弟保留  
- Token = **展示与压缩同一套结果**；有 API 用 API，否则本地；不新增 `api` 选项  
- `session.copy` 与 `fork` **同合同**（规则 + 活树快照）  
- Mobile 不做拖放；Desktop 移动 + 拖入 + 拖出都要  
