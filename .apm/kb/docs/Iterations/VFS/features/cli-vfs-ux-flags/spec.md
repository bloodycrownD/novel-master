# cli-vfs-ux-flags 技术规格（SPEC）

## 设计目标

- 为 `novel-master vfs write` / `replace` 补充 **flag 式参数**，改善脚本与 PowerShell 体验。
- **零 core 变更**；保持原位置参数 / stdin / `--file` 行为。
- 与主 VFS SPEC CLI 表一致。

## 现状（实现已完成）

| 文件 | 职责 |
|------|------|
| `apps/cli/src/vfs/commands/write.ts` | `--text` / `--file` / stdin 内容来源 |
| `apps/cli/src/vfs/commands/replace.ts` | 位置参数或 `--old` + `--new` |
| `apps/cli/src/vfs/parse-args.ts` | 通用 `--flag` / `--flag value` |
| `apps/cli/test/vfs-e2e.test.ts` | T1–T8 覆盖 |

主 SPEC（`.apm/kb/docs/Iterations/VFS/spec.md`）CLI 表已更新第 278–279 行。

---

## 总体方案

### write 内容来源（优先级）

```text
if --file and --text → Error
else if --file → readFile(utf8)
else if --text → flag value as content
else → readStdin()
```

version 逻辑 **不变**：更新已存在 path 时需 `--version` 或 `--no-version-check`。

### replace 参数解析

```text
old = flags.old ?? positional[1]
new = flags.new ?? positional[2]
require path, old, new
if (only one of flags.old / flags.new) → Error
service.replace(path, old, new, { replaceAll: flags.all })
```

---

## CLI 用法（定稿）

```text
novel-master vfs write <path> [--text <content>] [--file <path>] [--version <n>] [--no-version-check]

novel-master vfs replace <path> <old> <new> [--all]
novel-master vfs replace <path> --old <old> --new <new> [--all]
```

### 示例

```powershell
novel-master vfs write /chapters/1.md --text "# Chapter 1"
novel-master vfs write /chapters/1.md --file ./draft.md
novel-master vfs replace /chapters/1.md --old "draft" --new "final"
novel-master vfs replace /chapters/1.md "draft" "final" --all
```

---

## 变更点清单

| 路径 | 变更 |
|------|------|
| `apps/cli/src/vfs/commands/write.ts` | `--text`、互斥校验 |
| `apps/cli/src/vfs/commands/replace.ts` | `--old` / `--new` |
| `apps/cli/test/vfs-e2e.test.ts` | 新增 2 条 e2e |
| `.apm/kb/docs/Iterations/VFS/spec.md` | CLI 表 |
| `packages/core` | 无 |

---

## 详细实现步骤（已完成）

1. `write.ts`：扩展 Usage 字符串；`--text` 分支；`--file`+`--text` 抛错。
2. `replace.ts`：flag 与 positional 合并；半 flag 校验。
3. E2E：`write with --text`、`replace with --old and --new flags`。
4. 更新主 VFS SPEC CLI 表。

---

## 测试策略

- **E2E**：`npm run test -w @novel-master/cli`（`vfs-e2e.test.ts`）。
- **手工**：PowerShell 下 `--text` 含空格字符串；`replace --old` 含特殊字符。

### 测试用例映射

| ID | 测试位置 |
|----|----------|
| T1–T4 | `write with --text` + 既有 write 用例 |
| T5–T7 | `replace with --old and --new flags` + 既有 replace 用例 |
| T8 | 全套件 green |

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| `--text` 与 positional 混淆 | Usage 文档明确；仅 `--text` 为 flag |
| 破坏旧脚本 | 位置参数 / stdin / `--file` 未改 |

**回滚**：还原 `write.ts` / `replace.ts` 与 e2e 新增用例；SPEC 表一行 revert。

---

## 与 vfs-test-sync 的边界

`vfs-test-sync watch` 启动 stderr 输出行 **不属于** 本 feature；若需 KB 文档，在 `features/vfs-test-sync-script/` 下另开「watch-start-line」类变更即可。
