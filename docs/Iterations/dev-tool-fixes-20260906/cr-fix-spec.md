# CR Fix Spec: dev 分支三件套（agent 校验 / VFS 版本校验下线 / 工具返回值统一）

## 元信息
- repo: /home/bloodycrown/Dev/novel-master（主 worktree，分支 dev）
- base_sha: 504ea39（main）
- head_sha: c7ae693（dev）
- prd_path: 未提供（背景意图见 CHANGELOG Unreleased 与 docs/apm/memory/2026090{5,6}-*.md；业务背景即本 spec 标题所述三件套：agent 写入门禁 + prompts 缺省、VFS 版本校验全链下线、工具返回值统一渲染 ok）
- spec_path: 未提供
- review_round: 2
- dag_version: 2
- 状态：draft

## 编排状态
```yaml
dag_version: 2
review_round: 2
wave_plan: [[review-scope-core, review-scope-apps], [spec-fix-round1]]
node_status:
  review-scope-core: done
  review-scope-apps: done
  spec-fix-round1: done
  review-full: done
must_fix:
  - apps/G-1
  - apps/G-2
  - core/A-1
  - apps/C-1
  - core/C-1
  - apps/A-1
  - core/C-2
  - core/G-1
fix_spec_path: docs/Iterations/dev-tool-fixes-20260906/cr-fix-spec.md
spec_fix_plan: []
status: 待用户确认
```

## Must-fix（按 P0 → P1 → P2）

> 首轮评审（review-scope-core / review-scope-apps 两只读节点产出，主代理已抽查核实）共 8 条，逐条如下。维度标记沿用评审节点原体系（G / A / C）。

### MF-1 · apps/G-1 [P0] [G] 技能弹窗契约测试断言已删逻辑，必红
- 文件：apps/mobile/__tests__/new-skill-modal-contract.test.ts:34-50（头注释 1-16）
- 问题：MF-8 用例断言源码契约 `expect(src).toContain('{expectedVersion: read.version}')`，而源码中该乐观锁逻辑已随版本校验下线删除，测试必然失败。
- 改法：删除或重写 MF-8——重写方向为断言重写分支存在 `writeSkillFile(` 且不再出现 `readSkillFile(` / `expectedVersion`；头注释同步去掉 MF-8 的乐观锁描述，保留 D-1。注意：此处的「MF-8」是测试文件内部的历史 CR 用例标签（new-skill-modal-contract.test.ts:35 的 it 描述），与本 spec 的 MF-8（core/G-1）编号撞名，勿读串。
- 验收/测试：`NODE_ENV=test npx jest new-skill-modal-contract` 全绿。
- 来源：review-scope-apps/R1

### MF-2 · apps/G-2 [P0] [G] 两个 CLI e2e 仍操作已删偏好键，必红
- 文件：apps/cli/test/session-rollback-e2e.test.ts:56-65；apps/cli/test/chat-smoke-e2e.test.ts:74-92
- 问题：两处仍在 `preferences set/get session-fs.versionCheck`，该 key 已从 KNOWN_KEYS 删除，两个 e2e 必然失败。
- 改法：删除两处该偏好操作段；chat-smoke 的 preferences 验证可换成 `chat.llmStream` 的 get，保住 happy-path 覆盖。
- 验收/测试：两个 e2e 全绿。
- 来源：review-scope-apps/R1

### MF-3 · core/A-1 [P1] [A] withDefaultPromptLayouts 静默洗白非对象形状 prompts
- 文件：packages/core/src/service/agent/impl/agent-registry.service.ts:33-53
- 问题：`withDefaultPromptLayouts` 对非对象形状的 prompts（字符串 / 数字 / 数组）静默洗白成畸形对象后落盘空布局，与自身注释「非对象形状不在此兜底」矛盾——本应交给 schema 校验报 INVALID_SCHEMA 的脏输入被吞掉。
- 改法：函数入口对 `typeof prompts !== "object" || Array.isArray(prompts)` 时原样返回 def，交 `validateAgentDefinition` 报 INVALID_SCHEMA；补「prompts 为字符串 / 数组 / 数字」三个拒绝用例。
- 验收/测试：core agent 测试新增用例全绿。
- 来源：review-scope-core/R1

### MF-4 · apps/C-1 [P1] [C] FileEditorScreen version state 只写不读，双端 parity 分叉
- 文件：apps/mobile/src/screens/stack/FileEditorScreen.tsx:65,146,191,201
- 问题：`version` state 只写不读，是死状态；desktop PreviewPane 已删同位 state，mobile 残留造成双端 parity 分叉。
- 改法：删 `version` state 与三处 `setVersion`。
- 验收/测试：该文件 grep 无 version state 残留；mobile jest 全绿（`NODE_ENV=test npx jest`）。
- 来源：review-scope-apps/R1

### MF-5 · core/C-1 [P2] [C] vfsConflict 残留半截：枚举、字段、formatter 分支、用例未清
- 文件：packages/core/src/errors/vfs-errors.ts:26,38-60；packages/core/src/domain/vfs/logic/format-vfs-error-for-llm.ts:85-91；packages/core/src/domain/vfs/logic/format-vfs-error-for-user.ts:46；packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:366,409；packages/core/test/tool/format-tool-output.test.ts:332
- 问题：vfsConflict 只删了工厂函数，残留一串：CONFLICT 枚举值、expectedVersion/actualVersion 字段、两个 formatter 的 CONFLICT 分支、T-ERR-02 用例；revision repo 两处 NOT_FOUND 还塞 expectedVersion 字段（与 details 重复）。
- 改法：全部删除（枚举值、字段、formatter 分支、用例）；revision repo 两处 NOT_FOUND 改用 details。
- 验收/测试：全仓 grep `CONFLICT|expectedVersion` 于 src/domain/vfs 与 src/errors/vfs-errors 零命中。
- 来源：review-scope-core/R1

### MF-6 · apps/A-1 [P2] [A] CHANGELOG 措辞窄于实际行为
- 文件：CHANGELOG.md Unreleased 变更段
- 问题：「命令行会话写文件的旗标移除」措辞窄于实际——`nm vfs write` 的旗标同被移除。
- 改法：措辞扩为「命令行写文件（含会话内写文件）」。
- 验收/测试：条目与 CLI 实际行为一致（人工核对）。
- 来源：review-scope-apps/R1

### MF-7 · core/C-2 [P2] [C] 三处过时注释仍描述已下线的版本校验
- 文件：packages/core/src/domain/tool/builtin/vfs-tools.ts:237-238；packages/core/test/skills/skills.service.test.ts:429-431；packages/core/test/vfs/write-same-content-shortcircuit.test.ts（T-SC3）
- 问题：三处注释分别写着「编辑器透明锁走各自 UI 保存链路」「带 expectedVersion 才校验…见下一条用例」「带过期 expectedVersion（旧调用方兼容）」，均与 last-write-wins 新语义不符。
- 改法：统一改写为 last-write-wins 的事实描述；同文件 T-SC1/T-SC2（约 66、82 行）还给 `vfs.write` 传着 `{expectedVersion: 1}` 幽灵第四参（签名已收窄三参，tsx 运行时静默忽略）——顺手删掉两处实参（末轮 review-full 补充，并入本条）。
- 验收/测试：注释与新语义一致，且该测试文件 grep 无 expectedVersion 残留（人工核对）。
- 来源：review-scope-core/R1

### MF-8 · core/G-1 [P2] [G] 测试缺口：非对象 prompts 形状 + agent 工具 create 端到端
- 文件：packages/core/test/service/agent（新增用例文件或并入现有文件）
- 问题：(a) 无非对象 prompts 形状的用例（随 MF-3 落地）；(b) agent 工具 create 缺 `definition.name` 的端到端用例——真实 agent-tool → registry 链路，而非 fake registry 拼合。
- 改法：补两条用例。
- 验收/测试：新增用例全绿。
- 来源：review-scope-core/R1

## Spec deviations

- **open** · apps/cli/src/vfs/commands/write.ts `readStdin` 新增空输入防护（空管道报 `No content provided` 而非写空文件）——超出「移除版本校验」意图的善意新增，堵住了空管道静默清空已有文件的数据丢失路径。待用户拍板「按现状收窄」或回退；若按现状收窄，CHANGELOG 酌情补一句。

## Open questions / 待拍板

（均不阻塞 must-fix 执行）

1. 退役旗标 `--version` / `--no-version-check` 目前被静默忽略，是否改为显式报「旗标已退役」——待拍板。
2. CHANGELOG「文件写入版本校验整体移除」条目现归「修复」段，是否应挪「变更」段——待拍板。
3. 存量 KKV 死键 `session-fs.versionCheck` 是否做一次性清理——待拍板。
4. desktop 编辑器 last-write-wins 之后，是否需要 UI 层外部变更脏检查补偿——产品决策。

## 已豁免（用户确认不修）

（无）

## 合并后 QA（manual_user）

1. CLI 手动验证：`echo -n "" | nm vfs write <目标>` 应报 `No content provided`，不落盘清空已有文件（依赖 deviations 中空输入防护的拍板结果）。
2. CLI 手动验证：带退役旗标（`--version` / `--no-version-check`）的写操作行为与拍板结论一致（静默忽略或显式报错）。
3. desktop / mobile 编辑器保存链路走 last-write-wins 正常，无 version 阻塞弹窗。
4. 回归跑齐三端测试：core 测试、`NODE_ENV=development` 桌面测试、`NODE_ENV=test` mobile jest 全绿（对齐 MF-1/MF-2/MF-4 验收）。

## K 节建议（下游执行时闭合）

1. apps/cli/src/session/commands.ts:24-25 的 JSDoc 尾行孤悬 `*/` 顺手并一行。
2. 执行完按惯例重建 core 与 desktop dist（mobile 经 metro 消费 core dist）。

## Fix-Spec Closure

| 项 | 状态 |
| fix-spec-ready | yes（待用户确认开工；spec_deviations 1 条 open 待拍板） |
| fix_spec_path | docs/Iterations/dev-tool-fixes-20260906/cr-fix-spec.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 2 / 2 / 4 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open: readStdin 空输入防护（待用户拍板收窄/回退） |
| C-orch | ✅（双端 parity 分叉 1 处已入 MF-4；dist 残留归 K-2 重建） |
| C 类合并后 QA | 4 项（见「合并后 QA」章节） |

末轮勘误已由主代理直接落入 spec（trivial 直接执行）：MF-5/MF-7 路径勘误、MF-7 补幽灵实参删除、MF-1 编号撞名注明。
