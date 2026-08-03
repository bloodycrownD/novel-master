# Core 测试 SQLite Fixture 共享 PRD

## 背景

`@novel-master/core` 集成测试约 **129 个文件 / 570 用例**，全量 `npm test -w @novel-master/core` 在开发机上需 **约 3–5 分钟**。调研结论：

- 测试使用 `:memory:` SQLite；用例结束 `conn.close()` 即销毁整库，**不存在**「清脏数据慢」问题。
- 主要耗时来自 **每个用例重复** `openNovelMasterTestConnection()` → `bootstrapNovelMaster()`（全套 DDL、migration 检查、provider seed），以及少数重型用例（如 `performance.test.ts` 写入 1000 文件）。
- Node `--test` **文件级并行**已启用；根因是 **bootstrap 次数过多**（约两百次量级），而非清理或完全无并行。
- 另：`package.json` 中 `test` 脚本写死 `test/**/*.test.ts`，`npm test -- <单文件>` **不会**替换 glob，开发者易误以为在跑子集实则全量。

本迭代优化 **Core 测试基础设施**，缩短日常开发与 CI 反馈时间，**不改动生产代码行为**。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 减少 bootstrap 次数 | 同一 `describe` / 测试文件内共享连接，默认每文件 bootstrap **1 次** |
| 保持用例隔离 | 共享库内用例互不污染；需「空库」的用例仍用独立 conn |
| 快测入口 | 提供 `test:fast` / 域子集 script，子集运行 **<30s**（message-checkpoint 等） |
| 全量提速 | 全量 core 测试耗时较基线下降 **≥40%**（以 CI / 本地同一环境对比） |
| 零生产影响 | 仅 `packages/core/test` 与 `package.json` scripts |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Core 开发者 | 改 rollback/vfs 后只跑相关目录，秒级反馈 |
| CI | `npm test -w @novel-master/core` 在合理时间内完成 |
| Agent / 子代理 | 迭代中可跑子集，不必每次等 5 分钟全量 |

## 范围

### 包含范围

1. **共享 Fixture 模式**
   - 扩展 `test/helpers/novel-master.ts`（或同级 `fixture.ts`）：`before` 开 conn + bootstrap，`after` close。
   - 文档约定：集成测默认 `describe` 级共享；`it` 内禁止再 `openNovelMasterTestConnection()`（除非显式标注 `// isolated-db`）。
2. **用例间隔离（共享 conn 时）**
   - 轻量方案：每 `it` 使用独立 `project`/`session` 前缀，或
   - 中等方案：`afterEach` 删业务表数据（保留 schema / seed），或
   - SPEC 定案其一，PRD 要求「同 describe 内用例可任意顺序通过」。
3. **独立库例外清单**
   - `bootstrap/**`、`phase3-migrations`、`compaction-conditions-v3-migration` 等 **测迁移本身** 的文件保持每用例独立 `open`。
   - `performance.test.ts` 拆为 `test:perf`，**默认全量不跑**。
4. **npm scripts**
   - `test:fast`：无 glob 占位，接受路径参数。
   - `test:msg` / `test:vfs` 等常用子集别名。
5. **分批迁移**
   - M1：`message-checkpoint/**` + `test:fast` scripts（已验证痛点）。
   - M2：`vfs/**`、`chat/**`、`session-fs/**`。
   - M3：其余集成测文件。

### 不包含范围

- 修改 `bootstrapNovelMaster` 生产逻辑或 schema
- Mobile Jest / Desktop 测试结构变更
- 全仓库 `npm test` workspaces 并行化（可后续迭代）
- 用磁盘 SQLite 替代 `:memory:`（除非 SPEC 证明有收益）
- 改造纯单元测（无 DB）文件

## 核心需求（6 条）

1. **共享优先**：集成测默认每文件（或每顶层 `describe`）bootstrap 一次；不得为省事在全仓共用一个全局 conn（避免文件并行竞态）。
2. **隔离可验证**：迁移后的测试文件可单独运行且顺序无关（同文件内）。
3. **独立库白名单**：测 migration / 破坏性状态的用例使用独立 conn，不影响共享 fixture。
4. **快测脚本**：`npm run test:fast -w @novel-master/core -- test/message-checkpoint/*.test.ts` 只跑指定路径，**不**追加全量 glob。
5. **性能用例门禁**：`performance.test.ts` 仅由 `test:perf` 或 CI nightly 触发，默认 `test` 不包含。
6. **可度量**：在 PR 描述或迭代文档记录迁移前后全量耗时（同一机器一次对比即可）。

## 验收标准

- **A1 共享 fixture**  
  Given `rollback.test.ts` 已迁移  
  When 统计 `bootstrapNovelMaster` 调用次数  
  Then 每文件 ≤ 1 次（或每顶层 describe 1 次），且 R1–R10 全通过

- **A2 快测子集**  
  Given `npm run test:msg -w @novel-master/core`  
  When 执行  
  Then 仅 `test/message-checkpoint/` 下文件运行，耗时 **<30s**（同环境基线）

- **A3 全量提速**  
  Given 迁移 M1+M2 完成  
  When 跑 `npm test -w @novel-master/core`  
  Then 总耗时较迭代前下降 **≥40%**

- **A4 迁移测不受影响**  
  Given `bootstrap/phase3-migrations.test.ts`  
  When 全量测试  
  Then 仍使用独立 conn，行为与迁移前一致

- **A5 无生产代码变更**  
  Given `git diff main..HEAD -- packages/core/src`  
  Then 无变更（仅 `test/` 与 `package.json` scripts）

## 风险与备注

| 风险 | 缓解 |
|------|------|
| 共享 conn 导致用例泄漏状态 | 每 it 独立 projectId；或 afterEach 清表；单文件先跑通再推广 |
| 文件内并行（未来） | 保持「一文件一 conn」；不对同一 conn 启用 test concurrency |
| 迁移工作量大 | 分 M1/M2/M3；helper API 统一减少逐文件样板 |

## 迭代命名

`core-test-fixture-sharing` — Core 测试 SQLite fixture 共享与快测入口
