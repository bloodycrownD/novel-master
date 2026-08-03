# CLI 默认 Project / Session（use + config）PRD

## 背景与变更动机

`chat-project-vfs` 迭代后，CLI 大量子命令需重复传入 `--project`、`--session`（如 `project vfs`、`session vfs`、`message`、`records`、`snapshot`），本地脚本与交互调试成本高。

本变更在 **`.novel-master/config.json`** 中持久化「当前 project / session」，并提供 **`nm project use`**、**`nm session use`** 切换上下文；在已配置默认值且未显式传 flag 时，相关命令**省略** `--project` / `--session`。

## 范围变更说明（相对原需求）

### 包含

| 项 | 说明 |
|----|------|
| **配置文件** | 与**当前解析到的 DB 文件同目录**下的 `config.json`（默认 `./.novel-master/config.json`；`NOVEL_MASTER_DB` 或 `--db` 指向其他路径时，config 为 `<db-dir>/config.json`） |
| **`nm project use`** | 设置当前 project；可选校验 project 在 DB 中存在 |
| **`nm session use`** | 设置当前 session；从 DB 读取其 `project_id` 并**同时**写入 config 的 project + session |
| **默认值解析** | 需要 `--project` / `--session` 的命令：未传 flag 时使用 config；**CLI flag 优先于 config** |
| **create 自动 use** | `nm project create` 成功后自动设为当前 project；`nm session create` 成功后自动设为当前 session（并更新 project 为所属 project） |
| **适用命令** | 所有原先需要 project/session 的 scoped 命令：`project vfs …`、`session …`（含 vfs / records / snapshot）、`message …` |

### 不包含

- `@novel-master/core` 业务逻辑变更（config 为 **CLI 本地** 能力）
- 多 profile / 多 workspace 切换（仅单文件 current）
- `nm vfs` 全局命令行为变更（仍不需要 project/session）
- `apps/mobile` 读取该 config

### 配置文件格式（定稿）

路径：`<dirname(resolvedDbPath)>/config.json`

```json
{
  "currentProjectId": "uuid-or-empty",
  "currentSessionId": "uuid-or-empty"
}
```

- 字段可省略或为空字符串表示「未设置」。
- 写入时采用原子写（写临时文件再 rename）或等价策略，避免半写损坏（实现细节见 spec）。

## 影响模块与接口

| 模块 | 变更 |
|------|------|
| **`apps/cli/src/config/`**（新增） | 读/写 `config.json`；`resolveConfigPath(dbPath)`；`loadCliContext` / `saveCliContext` |
| **`apps/cli/src/runtime.ts`** | 在 `createNovelMasterRuntime` 后或并行加载 config；暴露 `getCurrentProjectId()` / `getCurrentSessionId()` 解析（flag > config > 缺失报错） |
| **`apps/cli/src/project/commands.ts`** | 新增 `use`；`create` 成功后 `saveCliContext` |
| **`apps/cli/src/session/commands.ts`** | 新增 `use`；`create` 成功后 `saveCliContext`；scoped 命令改用统一 resolver |
| **`apps/cli/src/message/commands.ts`** | `--session` 可选（默认 config） |
| **`apps/cli/src/main.ts`** | 路由 `project use` / `session use` |
| **测试** | `apps/cli/test/` 增加 config + use + 省略 flag 的 e2e |

**解析优先级（锁定）**

1. 命令行 `--project` / `--session`
2. `config.json` 中 `currentProjectId` / `currentSessionId`
3. 仍缺失 → 明确报错（Usage 提示 `nm project use` / 传 flag）

**Session 与 Project 关系**

- `session use` 只需 `--session <id>`（或 positional）；实现从 DB 查 `project_id` 并写入 config 两项。
- 仅设 project、未设 session 时：`project vfs` 可用；`message` / `session vfs` 等仍需 session（报错提示 `nm session use`）。

**删除与一致性**

- `project delete` / `session delete` 若删除的是 config 中的 current id，实现须**清除** config 中对应字段（或整项置空），避免指向已删实体。

## 验收标准

- [ ] **Given** 无 config，**When** `nm message list`（无 `--session`），**Then** 可判定错误并提示设置 session 或传 flag。
- [ ] **When** `nm project create --name P` 得 `P1`，**Then** config 中 `currentProjectId=P1`（同 DB 目录下）。
- [ ] **When** `nm session create --project P1` 得 `S1`，**Then** config 中 `currentProjectId=P1` 且 `currentSessionId=S1`。
- [ ] **Given** config 已设 P1/S1，**When** `nm message append --role user --content hi`（无 session flag），**Then** 成功且消息归属 S1。
- [ ] **Given** config 已设 P1，**When** `nm project vfs list /template`（无 `--project`），**Then** 列出 P1 的 project 域路径。
- [ ] **Given** config 已设 P1/S1，**When** `nm session vfs read /foo.md --project OTHER`（显式 flag），**Then** 使用 OTHER（及对应 session 规则），**不**使用 config 的 project。
- [ ] **When** `nm project use --project P2`（或等价 positional），**Then** config 更新为 P2；原 session 若不属于 P2，应清除 `currentSessionId` 或报错（实现选一种并在 spec 锁定，推荐：**清除 session**）。
- [ ] **When** DB 为 `--db ./tmp/x.db`，**Then** config 读写 `./tmp/config.json`，而非 `./.novel-master/config.json`。
- [ ] **When** `nm project delete` 删除 current project，**Then** config 中 project（及下属 session）字段被清除。

## 测试用例

### E2E（`apps/cli/test`，临时目录 + `--db`）

1. **create 自动 use**：`project create` → 读 `<tmpdir>/config.json` 含 projectId → `session create` → config 含 sessionId。
2. **省略 flag message**：config 有 session → `message append` 无 `--session` → `message list` 可见。
3. **flag 覆盖 config**：config 为 S1，`message list --session S2` → 仅 S2 消息。
4. **project vfs 默认 project**：config 有 P1 → `project vfs write /template/t.md --text x` 无 `--project` → `project vfs read … --project P1` 成功。
5. **use 切换 project 清除 session**：config P1+S1 → `project use P2` → config 无 session 或 session 为空。
6. **config 路径随 --db**：`--db sub/db.sqlite` → config 在 `sub/config.json`。
7. **delete 清理 config**：delete current session → config `currentSessionId` 为空。

### 手动 smoke

```bash
npm run link:cli
rm -f .novel-master/novel.db .novel-master/config.json   # 或 PowerShell 等价

nm project create --name Demo
nm session create --project <上一步id>   # 或省略 --project 若已 auto use
nm message append --role user --content hello
nm message list
nm project vfs list /template
```

## 后续

- 技术方案与实现步骤：同路径 **`spec.md`**（`/design-proposal`）。
- 原迭代 PRD `chat-project-vfs/prd.md` **不修改**；本 feature 为 CLI 体验增强。
