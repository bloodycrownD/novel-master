---
date: 2026-09-28
agile_trace: true
---

# skill-tool-path-serialization 实现规格（SPEC）

## 根因 / 方案摘要

ToolRunner.runParallel 的 pathTail 同路径串行化只对 `classifyMutatingToolCall` 认识的工具名生效（write/edit/fs），skill 工具不在名单——同 step 多笔 skill write/edit 真并发，`revision-aware-vfs.service.ts` 的 replace 是「事务外 read → computeReplaceResult → write」非原子，后写基于旧快照整份覆盖先写（「只有最后一条生效」）。

方案（用户拍板最小改动 + 排队键带 domain）：skill 工具纳入分类器，与 edit 工具获得同一套排队保证与同一盲区；跨 agent 场景按用户拍板不支持（pathTail 本就跨不了 runner 实例，本来也不合理）。

## 变更点清单

1. 新增 `packages/core/src/domain/skills/logic/skill-paths.ts`：`SKILLS_ROOT`、`SKILL_ENTRY_FILE`、`resolveSkillRelPathCore`（纯函数、不抛错，返回 ok/rel 或失败原因）——路径合成从 service 层抽出为 domain 单源，供 service 与分类器共用
2. `skills.service.ts`：常量与相对路径解析迁至 skill-paths，`resolveSkillRelPath` 变为 SkillError 包装（三种失败原因的报错文案逐字保留）
3. `fs-command-classify.ts`：`classifyMutatingToolCall` 新增 skill 分支（`classifySkillToolCall`）——write/edit 判突变，排队键 `skill:{domain}:{技能文件逻辑路径}`；write 的 domain 缺省 project（与 skill-tool 的 write 分支同口径）；load/read/list 只读；域/名字缺失或路径非法保守返回 `paths: null`（该调用会被 schema/服务层拒绝）
4. 测试：`fs-command-classify.test.ts` +2 用例；`skill-tool.test.ts` +「skill 工具同路径串行化」describe（fake 服务模拟 vfs.replace 的执行时读-改-写语义，首笔延迟 30ms 制造竞态）

## 详细改动说明

- 排队键带 `skill:{domain}:` 前缀有两重目的：与 vfs 工具的普通路径键天然隔离（技能存 meta 域，物理上不会与工作区文件同路径）；global 与 project 同名技能是不同 scope 的两个文件，互不排队（排在一起只会白损失并行度）
- pathTail 以原始键比对且跨 runner 实例不共享：跨 agent（子会话共享父工作区）并发写同一文件仍不保护、vfs 工具同文件不同写法（如 `a.md` 与 `/a.md`）互不串行——与 edit 工具既有盲区一致，拍板接受
- 连带消费方核查（不改行为）：`anyToolUseMutatesWorkspace`（vfsMutated 刷新链）用独立名单 `isMutatingFileToolName`，不受影响；`user-vfs-turn` 的 `collectMutatingPathsFromCalls` 只见用户编辑器保存操作（write/edit/fs），不会收到 skill 键

## 测试策略

### 测试用例

- `fs-command-classify.test.ts`「skill write/edit 返回带 domain 的合成键」：write 缺省域 project；edit 显式 global；嵌套相对路径 `./notes/a.md` 归一化进键
- `fs-command-classify.test.ts`「skill load/read/list 只读；非法输入保守突变不排队」：三个只读 action；edit 缺 domain、path 含 `..` → `mutating: true, paths: null`
- `skill-tool.test.ts`「同 step 多笔 skill edit 同名同域依次叠加，不丢更新」：首笔延迟下断言两处替换共存于最终内容（未串行化时该用例必红——lost update 复现）
- `skill-tool.test.ts`「global 与 project 同名技能不互相排队」：断言首笔延迟期间第二笔已进入执行（若键未带 domain 该用例必红）
- 回归：classifier 既有 5 用例、skills.service 17 条（含 `..` 拒绝与 escape 文案）、tool-runner-parallel 4 条、user-vfs-turn 7 条

验证记录（2026-09-28）：定向命令 `npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test …` 69/69 绿；`npm run build -w packages/core` 零错。

## 风险与回滚方案

行为变化仅一处：同 step 内同一技能文件的多笔 skill 写从并发变串行——正确性增强，代价是该场景损失并行度；不同技能文件、不同域、只读操作不受影响。回滚 = 还原分类器 skill 分支与两处测试（单文件级，skill-paths.ts 可保留——service 层包装不受影响）。
