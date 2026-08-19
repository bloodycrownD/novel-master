# global-fs-manager CR 修复执行（impl-cr-core）

- 日期：2026-08-19
- 分支：feat/skills-integration（主仓），节点 impl-cr-core
- 事实来源：docs/Iterations/global-fs-manager/cr-fix-spec.md

## 任务范围（只动 packages/core/**）

1. meta/C-orch-1 [P0]：meta 域逻辑路径双前缀。global-meta 物理前缀改空串、project-meta 改 `/projects/{pid}`；read 分流逻辑路径保持 `/meta/...`；list 链路输入侧传物理形态目录作 base（`/meta` + rest / `/projects/{pid}/meta` + rest），`listScopeFirstLevel` 输出 `base + '/' + name`。警告两种断裂：`/meta` 自指循环、`/projects/{pid}/projects` 废路径。
2. core/B-1 [P2]：compareEntries 排序键统一 `label ?? basename`，补混排断言。
3. core/C-1 [P2]：删 `dirPart` 恒等三元；改 initialize-session-workspace.ts 注释错字「全部内容部带入」→「都带入」。
4. core/G-1 [P2]：补两测试——子 agent 会话 BFS 展开后 list('/projects/{pid}/sessions') 见子会话目录行；跨项目 sid → NOT_FOUND。
5. core/G-2 [P2]：五个挂载点根 read 均断言 NOT_FOUND（实测非 NOT_FOUND 则随 P0 归一）。
6. desktop/B-2 core 半边 [P2]：PhysicalVfsService 加 `listTree(physicalPath)` 批量接口——一次 listEntriesUnderPrefix 后递归切全部层级行，虚拟目录（projects/sessions 枚举）也合成；port 类型同步；补单测。

## 测试改造（P0 验收）

- T-PB1/T-PB2 造数改经 SkillsService 创建技能，禁止 `globalMetaVfs().write('/skills/...')` 直写。
- 断言 `list('/meta')` 直接见 `skills/`；`read('/meta/skills/{name}/SKILL.md')` 返回内容。
- vfs-path-mapper.test.ts meta 物理前缀断言同步改（空串 / `/projects/{pid}`）。

## 约束

- 提交按逻辑块：P0 一个 commit、B-2 批量接口一个、其余整洁+测试一个；只 add 自己的文件。
- 只动 packages/core/**，desktop/mobile/cli 由后续并行 wave 处理。
- 验证：packages/core `npm run build` + 全量 `npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test "test/**/*.test.ts" --test-ignore "test/**/performance.test.ts"`。

## 结果（2026-08-19 执行完毕）

全部 6 项完成，三个 commit 均在 feat/skills-integration：

- `381a715` fix(core): meta 域逻辑路径双前缀（CR P0 meta/C-orch-1）
  - vfs-path-mapper：global-meta 前缀空串、project-meta 前缀 /projects/{pid}；
    toLogicalPath(project-meta) 需校验剥项目段后以 /meta 开头（与同项目 template 子域区分，
    测试过程中发现的必要补充）
  - physical-vfs：read 分流保留 /meta 段；list 分流传物理目录；listScopeFirstLevel
    以物理目录为 base；read 撞目录行 IS_DIRECTORY 归一 NOT_FOUND（G-2 前置，
    因 ensureParentDirectories 会显式建 /meta 目录行，实测必撞）
  - 测试：SkillsService 造数 + /meta 断言 + mapper 新语义断言
- `2c94190` feat(core): listTree 批量接口（desktop/B-2 core 半边）
  - 每 scope 一次前缀查询递归切全部层级；虚拟目录（projects/sessions 枚举、
    挂载点根）均合成；含「与逐层 list 的 BFS 展开对拍」性质测试
- `6fbb4ce` fix(core): 排序键末段 + 整洁 + 测试（B-1/C-1/G-1/G-2）
  - compareEntries 改 label ?? basename；混排断言用 `0-${suffix}` 项目名构造
    （旧键 "/projects/{uuid}" 恒小于 "0-"，新键恒大于 → 新旧顺序必反，确定性回归）
  - G-1 两例（createSubSession 造子/孙会话 BFS 展开；跨项目 sid NOT_FOUND）、
    G-2 六处挂载点根 NOT_FOUND；dirPart 三元已随 P0 消化；错字已改

验证：`npm run build` 通过；全量测试 2036 pass / 0 fail
（performance.test.ts 按约定 ignore）。

注意点（后续 wave 参考）：B-1 改 basename 排序后，listTree 聚合行的目录间
顺序按 basename 而非全路径（同层 list 行为不变，前缀相同）；desktop BFS
改用 listTree 后可去掉逐层 list 调用。
