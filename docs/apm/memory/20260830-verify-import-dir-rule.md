# import-dir-rule-default-on 迭代 verify-import 复跑验证

- 日期：2026-08-30；worktree `.woktree/import-dir-rule`，分支 `feat/import-dir-rule-default-on`，HEAD 88f088c。
- 任务：以非实现者身份独立复跑验证（只跑命令与检查，不改代码）：core 全量测试、四个定点测试文件、mobile tsc 类型检查、提交与改动范围核对（对照 `docs/Iterations/import-dir-rule-default-on/spec.md`）。

## 结果

- 环境：worktree 缺依赖，root `npm ci`（2266 包）+ `npm run build` 全 workspace 构建通过。
- core 全量 `npm test`：1786 条全过 / 0 败（22.2s，不含 performance.test.ts，包 script 口径）。
- 四文件定点（任务原命令 `npx tsx --test ...`）：78 条 74 过 / 4 败；改用包 script 同款参数（`--experimental-test-module-mocks --tsconfig tsconfig.test.json`）复跑 78 条全过。结论：4 败为命令口径差异（缺上述两参数），非代码回归。失败项均非本迭代新增用例（T-IC1/T-IC2/T-IC5 token cache 清理、fs cp -r）。
- mobile `tsc --noEmit -p tsconfig.build.json`：通过（exit 0）。注意：任务命令中 `--ignoreDeprecations 6.0` 在 mobile 本地 TS 5.9.3 下报 TS5103 无效值（该值仅 TS 6.x 认，root 才是 6.0.3）；不带参数无 deprecation 错误，验证不受影响。
- 提交核对：6 commit 与 spec Step 1-5 + memory 一一对应；diff 9 文件全部落在允许清单（core vfs 服务/logic、四个测试文件、vfs-tools、VfsFileManager.tsx、memory 文件），无 spec 外溢出。
