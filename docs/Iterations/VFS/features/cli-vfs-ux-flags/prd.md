# cli-vfs-ux-flags PRD

## 背景与变更动机

VFS 主迭代 SPEC 原先约定 `write` 仅 **`--file` 或 stdin**、`replace` 仅 **位置参数 `<old> <new>`**。实际使用与命令备忘中出现了 `--text`、`--old` / `--new` 等写法，与实现不一致，造成困惑。

| 动机 | 说明 |
|------|------|
| 备忘与实现不一致 | 用户期望 `write --text`、`replace --old/--new`，代码未支持 |
| PowerShell / 脚本 UX | 位置参数在含空格、引号时易错；显式 flag 更清晰 |
| 文档对齐 | 主 SPEC 命令表需与实现一致 |

**说明**：`vfs-test-sync watch` 启动输出行属 **vfs-test-sync-script** 变更，**不在本 feature** 范围内（已实现，可另开 feature 文档）。

## 范围变更说明（相对原需求）

### 新增

- **`novel-master vfs write`**：新增 **`--text <content>`**，与 `--file`、stdin **三选一**；禁止同时使用 `--file` 与 `--text`。
- **`novel-master vfs replace`**：新增 **`--old <string>`**、**`--new <string>`**；可与原位置参数形式 **二选一**（使用 flag 时必须 **同时** 提供 `--old` 与 `--new`）。

### 不变

- **core `VfsService`** 接口与语义不变（仍 `write` / `replace`）。
- 原有用法保留：`--file`、stdin、`replace <path> <old> <new> [--all]`。
- `write` 更新路径时的 **`--version` / `--no-version-check`** 规则不变。
- `replace` 仍内部 read + OCC 写回，用户 **无需** 传 version。

### 不包含

- 不新增子命令；不修改 `glob` / `grep` / `list` / `delete` CLI。
- 不修改 `@novel-master/core` 公开 API。
- 不实现 `--text` 从文件、`replace` 正则等扩展。

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `apps/cli/src/vfs/commands/write.ts` | 解析 `--text`；内容来源优先级：`--file` > `--text` > stdin |
| `apps/cli/src/vfs/commands/replace.ts` | 解析 `--old` / `--new`；与位置参数互备 |
| `apps/cli/src/vfs/parse-args.ts` | **无改**（已有通用 `--key value` 解析） |
| `apps/cli/test/vfs-e2e.test.ts` | 新增 `--text`、`--old`/`--new` 用例 |
| `.apm/kb/docs/Iterations/VFS/spec.md` | CLI 命令表一行更新（已同步） |
| `packages/core` | **无** |

## 验收标准

### write --text

- **Given** 路径不存在  
  **When** `vfs write /a.txt --text hello`  
  **Then** exit 0；`read /a.txt` 内容为 `hello`。

- **Given** 同上  
  **When** 同时使用 `--file` 与 `--text`  
  **Then** exit 非 0；错误信息指明不可并用。

- **Given** 路径已存在  
  **When** `write --text` 且无 `--version` / `--no-version-check`  
  **Then** 失败（与原 write 规则一致）。

### replace --old / --new

- **Given** `/r.txt` 内容为 `hello world`  
  **When** `vfs replace /r.txt --old world --new there`  
  **Then** exit 0；内容为 `hello there`；stdout 含 version 与 replacements。

- **Given** 同上  
  **When** `vfs replace /r.txt --old world`（缺 `--new`）  
  **Then** exit 非 0；提示需同时提供 `--old` 与 `--new`。

- **Given** 同上  
  **When** `vfs replace /r.txt world there`（位置参数）  
  **Then** 行为与变更前一致（向后兼容）。

### 文档

- 主 VFS SPEC CLI 表反映 `--text` 与 `--old`/`--new` 形式。

## 测试用例

| ID | 场景 | 命令 | 期望 |
|----|------|------|------|
| T1 | write --text 创建 | `write /t.txt --text body` | read 为 body |
| T2 | write --file 仍可用 | `write /t.txt --file ./f` | 与变更前一致 |
| T3 | write stdin 仍可用 | pipe → `write /t.txt` | 与变更前一致 |
| T4 | write 互斥 | `--file` + `--text` | 失败 |
| T5 | replace flags | `replace /r --old a --new b` | 内容替换 |
| T6 | replace 位置参数 | `replace /r a b --all` | 与变更前一致 |
| T7 | replace 半 flag | 仅 `--old` | 失败 |
| T8 | E2E 套件 | `npm run test -w @novel-master/cli` | 全部通过 |

## 后续

- 技术方案见 [spec.md](./spec.md)
