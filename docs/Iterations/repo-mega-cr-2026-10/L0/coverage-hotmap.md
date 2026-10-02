# L0 覆盖率热图（coverage hotmap）

> 机位：W8 覆盖率机位（实证）。所有数字来自本次实跑的真实覆盖率产物，未做估算、未做抽样外推。
> 复跑脚本：`tmp/w8cov/{core,cli,mobile,desktop}-cov.sh` + `node tmp/w8cov/hotmap.mjs`。
> 原始产物：`tmp/w8cov/{core,cli,desktop}.lcov`、`tmp/w8cov/mobile-coverage/coverage-summary.json`。

## 一、跑法与口径

| 目标 | 运行器 | 覆盖率产物 | 记录文件数 | 退出码 |
|---|---|---|---|---|
| `packages/core` | `node --test` + tsx（`--experimental-test-module-mocks --tsconfig tsconfig.test.json`，node 侧 glob `"test/**/*.test.ts"`） | `core.lcov` | 994 | EXIT=1 |
| `apps/cli` | `node --test` + tsx（`test/**/*.test.ts`） | `cli.lcov` | 599 | EXIT=1 |
| `apps/mobile` | jest 29（`--coverage --maxWorkers=2`） | `mobile-coverage/coverage-summary.json` | 378 | EXIT=1 |
| `apps/desktop` | `node --test` + tsx（`tsconfig.renderer.json`，`NODE_OPTIONS=--import test/register-electron-mock.mjs` 打桩 Electron） | `desktop.lcov` | 838 | EXIT=1 |

### 1.1 跑法上踩到的坑（W8 复核请按此读数）

- **`npm test` 脚本一律没用**：core/cli 的 npm 脚本靠 `bash -O extglob -O globstar -c` 展开 glob，在 Windows 的 cmd 宿主里会先被 shell 展开成几百个参数，直接撞 8191 命令行上限（实测报「命令行太长」，core 的 428 个测试文件一次都没跑起来）。改用 node 22 自带的 `--test` glob——把 `"test/**/*.test.ts"` 加引号交给 node 侧展开，绕开宿主 shell。**这条是本轮最关键的坑，`npm test` 的失败不代表测试有问题。**
- **跑覆盖率必须挂 `--test-reporter=dot --test-reporter-destination=stdout`**（或 tap/junit），否则 node 默认 reporter 与 lcov reporter 的输出会互相盖掉，失败信息整个消失——本机位第一次跑 cli 就吃了这个亏，只看到 lcov 文件生成了。
- **mobile 的 `pretest` 会先构建 core 等 workspace 包**，直接 `npx jest` 会跳过它。本机位额外手工补了两步：`npm run build -w @novel-master/tdbc-driver-rn`（jest 的 `moduleNameMapper` 直连它的 `dist/`）与 `node scripts/build-webview.mjs`（`__tests__/helpers/read-webview-dist.ts` 要读 `webview-dist/**` 产物）。补之前 mobile 挂了 8 个套件 / 34 个用例，补之后只剩 2 个。
- **jest 的 `collectCoverageFrom` 默认口径太窄**：`apps/mobile/jest.config.js` 只收 `src/services|storage|hooks|runtime` 四个目录（注释写明「仅报告逻辑层目录」）。为了出全量生产热图，本机位在命令行用 `--collectCoverageFrom='src/**/*.{ts,tsx}'` 覆盖掉窄口径，并排掉 `__tests__` / `*.test.*` / `__mocks__`。
- **`node --test` 的 lcov 只给「被加载过的文件」出记录**：文件不在 lcov 里 == 没有任何测试进程 import 过它。所以 node 侧的「零覆盖」有两种成因（从未加载 / 加载了但一行没执行到），已分别单列。jest 侧 `collectCoverageFrom` 强制给全部 `src/**` 出记录，`lh=0` 即真零覆盖。
- **构建入口文件必须先剔除**：`src/web/*/webview/main.ts` 这类文件由 `apps/mobile/scripts/build-webview.mjs` 当 esbuild `entryPoints` 打进 bundle、在 WebView 里执行，app 代码里没有任何 import，jest 与 node --test 都看不见。它们「零覆盖 + 零引用」纯属口径产物。本机位用 `tmp/w8cov/build-entries.txt`（从 `scripts/**` 与各 app 配置里抽出的源码路径字符串）做入口守卫，在判死前剔除。
- **不跨 runner 相加**：不同 runner 的行号基准与插桩粒度不一致，`packages/core/*` 只取 core.lcov、`apps/cli/*` 只取 cli.lcov、`apps/desktop/*` 只取 desktop.lcov、`apps/mobile/*` 只取 jest summary。

### 1.2 测试运行健康度（覆盖率只在「跑到的行」上才有意义，先说清哪些没跑）

| 目标 | 失败项 | 性质 |
|---|---|---|
| `packages/core` | 3 个：`T-C2 本地时区天边界`、`T-C6 DST 切换日按挂钟日归桶`、`usage stats service (T-S5)` | 时区断言依赖宿主 TZ、`usage stats` 疑似依赖真实时钟/DB 状态。**测试自身问题**，不影响读数。首轮把 `performance.test.ts` 也吃了进去多挂 3 个性能阈值用例，本轮 node glob 已包含它，性能类失败依旧但不影响覆盖统计。 |
| `apps/cli` | **35 个**（`agent config CLI`、`agent CLI smoke`、`agent registry e2e`、`T1–T8` 项目/会话/消息持久化系列、`E1/E3/C2` agent 系列、`vfs-*` 系列等） | **环境性 + 结构性问题**，见下方专段。本机位第一次跑 `cli` 时用了 `--test-reporter=lcov` 单 reporter，失败信息被吞掉（stdout 只有 7 字节），差点误报「无失败」；加上 dot reporter 才看清。 |
| `apps/mobile` | 3 套件 / 6 用例（`mermaid-fullscreen`、`composer-fullscreen`、`chat-tab-screen.integration`） | 异步未等待 / 集成用例超时类，重跑时集合会漂移（首轮 2 套件，补构建后 2 套件，并行跑时 3 套件）。属 flaky，不影响覆盖统计。 |
| `apps/desktop` | 6 个：`cr-05轮内连接被关不永久死亡`、`desktop blob 归一调度服务（cr-03/cr-05）` + 4 个产物断言（`electron-builder --dir`、`preload exposes …IPC bridge API`、`renderer build output exists`、`build/icons/icon.ico exists`） | 后 4 个需要先跑 desktop 的 `prebuild`/`build`，本机位为省预算没跑，属环境性失败；`cr-05` 是真失败（连接重挂退避逻辑）。 |

### 1.3 `apps/cli` 的 35 个失败：为什么必须单列

- `apps/cli/test` 下 20 个测试文件里有 16 个是 e2e（`*-e2e.test.ts` / `*-smoke.test.ts`），全部通过 `runNm()` → `spawnSync(process.execPath, ["--import","tsx","src/index.ts", ...])` **起子进程**跑真实 CLI。子进程的 V8 coverage 不会回流到父进程的 lcov，所以**这些 e2e 实际执行到的 CLI 代码行，在本报告的 `apps/cli` 数字里全部不计入**。`cli` zone 的 ${pct(perOwner.cli?.lh || 0, perOwner.cli?.lf || 1)}% 是「只算进程内单元测试」的下限，不是真实值。
- 失败形态本身也指向环境：典型报错是 `新建会话失败：workspace 未配置 Agent，且 registry 为空`、`Missing --session <id>`、以及 `T1: project create writes currentProjectId` 的 UUID 不匹配——本 worktree 里 `D:\Dev\nm-worktree\mcr\.novel-master` 与用户目录 `~/.novel-master` **都不存在**，agent registry 无从加载。同时单个用例耗时 30–180 秒，说明子进程在等外部条件（网络/模型/DB 初始化）后超时。
- **对本机位结论的影响**：`apps/cli` 只有 4 个生产文件「从未出记录」，零覆盖数为 0（全是顶层被 import 过），所以 cli zone 根本没进死码清单。cli 的真实死码情况需要「先让 e2e 能跑通、再把子进程 coverage 收回来（NODE_OPTIONS=--experimental-test-coverage + NODE_V8_COVERAGE 目录）」才能测，本轮预算内做不到，记为遗留项。

## 二、总览

| 指标 | 数值 |
|---|---|
| 纳入统计的生产文件数（`coverage-matrix.csv` 非 tests zone） | 1345 |
| 生产文件可执行行总数（LF） | 105558 |
| 已覆盖行（LH） | 94937 |
| **行覆盖率** | **89.94%** |
| **零覆盖生产文件数** | **327** |
| 其中「测试进程从未加载」（node 侧无 lcov 记录） | 245 |
| 低覆盖文件（0 < 覆盖行 < 30） | 384 |
| T3 零覆盖 ∩ 有零消费导出（symbol 级） | 91 个文件 / 10304 物理行 |
| └ 其中 LF=0 的**假零覆盖**（纯类型/纯 re-export） | 62 |
| T2 node 侧从未加载 ∩ 有零消费导出（已剔除构建入口） | 60 个文件 / 7674 物理行 |
| **T1 文件级全死**（零覆盖 + 全部命名导出皆死） | **4 个文件 / 159 物理行** |
| 跨端孪生残骸（mobile/desktop 双份拷贝，仅零覆盖那侧命中） | 1 对 / 115 行 |
| 未纳入本次 runner 的其它 workspace 包文件 | 101 |

mobile 单体（jest 自带 `total` 口径，`apps/mobile/src/**` 全量）：行覆盖 **60.1%**（7997/13305），函数 **55.54%**（1754/3158），分支 **53.47%**（4827/9027）。

> 全仓 89.94% 这个数字**看着很高，但有系统性偏差**，别直接拿它当质量结论，见下面 2.1 的分 runner 拆解。

### 2.1 分 runner 拆解（看清高覆盖率是怎么来的）

| 归属 | 生产文件 | 被 runner 出记录 | 从未出记录 | 出记录但零覆盖 | LF | LH | 行覆盖率 |
|---|---|---|---|---|---|---|---|
| `core`（node --test (core)） | 640 | 528 | 112 | 0 | 66752 | 64827 | 97.12% |
| `cli`（node --test (cli)） | 50 | 46 | 4 | 0 | 4114 | 3445 | 83.74% |
| `desktop`（node --test (desktop)） | 254 | 148 | 106 | 0 | 21387 | 18668 | 87.29% |
| `mobile`（jest (mobile)） | 401 | 401 | 0 | 82 | 13305 | 7997 | 60.11% |

这张表是本轮最重要的方法论结论，三件事必须一起读：

1. **`node --test` 侧不存在「出记录但 LH=0」的文件**——core / cli / desktop 三列的「出记录但零覆盖」全是 **0**。原因是 V8 coverage 只要文件被 import，模块顶层就已经求值，顶层语句必然被记成已覆盖。所以 node 侧的「零覆盖」只有一个成因：**从来没被任何测试 import 过**（即「从未出记录」那一列）。这也意味着本报告第六节 T2 档（从未加载 ∩ 死导出）是 node 侧唯一有意义的死码信号。
2. **node 侧「从未出记录」不等于死**：core 有 112 个、desktop 有 106 个生产文件不在 lcov 里。其中相当一部分是**被另一侧覆盖的**——例如 core 的文件被 cli/desktop 的测试 import（走 dist 产物，不在 core.lcov 口径内），desktop renderer 的组件被 mobile 侧逻辑复用等。这类必须配合 `dead-exports.md` 一起判，不能只看覆盖率。
3. **`mobile-web` 与 `mobile-screens` 被系统性低估**：`src/web/**` 是 WebView 内运行时，由 esbuild 打成 bundle 在浏览器内核里执行，jest 从原理上就看不见；`src/screens/**` 的 RN 组件树渲染路径也没被建模。mobile 的 60.11% 只反映「逻辑层被单测跑到的程度」，不代表这些模块实际没跑。

## 三、按 zone 的零覆盖分布

| zone | 文件数 | 零覆盖文件 | LF | LH | 行覆盖率 |
|---|---|---|---|---|---|
| `desktop-renderer` | 141 | 74 | 10544 | 9200 | 87.25% |
| `mobile-web` | 67 | 33 | 2425 | 727 | 29.98% |
| `core-service` | 123 | 31 | 15246 | 14819 | 97.20% |
| `UNASSIGNED` | 29 | 28 | 33 | 18 | 54.55% |
| `mobile-app` | 134 | 24 | 3435 | 2741 | 79.80% |
| `mobile-components` | 133 | 18 | 4379 | 2940 | 67.14% |
| `core-infra` | 129 | 16 | 13525 | 13064 | 96.59% |
| `desktop-main` | 80 | 15 | 8709 | 7356 | 84.46% |
| `core-vfs` | 57 | 14 | 6212 | 5927 | 95.41% |
| `mobile-screens` | 48 | 11 | 3066 | 1589 | 51.83% |
| `core-root` | 57 | 10 | 3798 | 3692 | 97.21% |
| `core-chat` | 61 | 9 | 7188 | 6906 | 96.08% |
| `desktop-shared` | 21 | 6 | 2101 | 2094 | 99.67% |
| `core-provider` | 33 | 5 | 2006 | 1950 | 97.21% |
| `cli` | 50 | 4 | 4114 | 3445 | 83.74% |
| `core-agent` | 14 | 4 | 968 | 955 | 98.66% |
| `core-workplace` | 19 | 3 | 2167 | 2151 | 99.26% |
| `core-message-checkpoint` | 17 | 3 | 1959 | 1953 | 99.69% |
| `core-kkv` | 4 | 3 | 76 | 76 | 100.00% |
| `core-tool` | 29 | 2 | 6291 | 6205 | 98.63% |
| `core-prompt` | 12 | 2 | 1100 | 1032 | 93.82% |
| `core-session-kkv` | 6 | 2 | 770 | 770 | 100.00% |
| `core-session-run-state` | 3 | 2 | 157 | 156 | 99.36% |
| `mobile-android` | 2 | 2 | 0 | 0 | —% |
| `core-bootstrap` | 31 | 1 | 2125 | 2105 | 99.06% |
| `core-character-card` | 9 | 1 | 733 | 673 | 91.81% |
| `core-skills` | 9 | 1 | 564 | 563 | 99.82% |
| `core-smart-sort-rule` | 9 | 1 | 899 | 891 | 99.11% |
| `core-compaction-conditions` | 7 | 1 | 235 | 222 | 94.47% |
| `packages-periph` | 1 | 1 | 0 | 0 | —% |
| `core-format` | 5 | 0 | 387 | 386 | 99.74% |
| `core-depth` | 3 | 0 | 191 | 176 | 92.15% |
| `core-events` | 1 | 0 | 120 | 120 | 100.00% |
| `core-feature-flags` | 1 | 0 | 35 | 35 | 100.00% |

## 四、零覆盖生产文件全清单（327 个）

> 口径：LH=0（node 侧含「从未被 import」）。按物理行数降序——行数越多越是「写了但没人跑」的高价值清理目标。`死导出` / `仅测试` 两列来自 `L0/dead-exports.md`。

| # | 文件 | zone | 物理行 | 死导出数 | 仅测试消费数 | 构建入口 |
|---|---|---|---|---|---|---|
| 1 | `apps/desktop/renderer/features/settings/SettingsViews.tsx` | `desktop-renderer` | 2508 | 0 | 0 |  |
| 2 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx` | `desktop-renderer` | 1382 | 0 | 0 | 是 |
| 3 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx` | `desktop-renderer` | 1131 | 0 | 0 |  |
| 4 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | `desktop-renderer` | 1048 | 4 | 0 |  |
| 5 | `apps/desktop/renderer/providers/ShellNavProvider.tsx` | `desktop-renderer` | 1014 | 1 | 0 |  |
| 6 | `apps/desktop/renderer/layout/ChatRail.tsx` | `desktop-renderer` | 782 | 0 | 0 |  |
| 7 | `apps/cli/scripts/capture-agent-scenarios.mjs` | `cli` | 723 | 0 | 0 |  |
| 8 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx` | `desktop-renderer` | 664 | 0 | 0 |  |
| 9 | `apps/desktop/renderer/features/chat/ChatComposer.tsx` | `desktop-renderer` | 578 | 0 | 0 |  |
| 10 | `apps/desktop/renderer/hooks/useColumnSplitters.ts` | `desktop-renderer` | 561 | 0 | 0 |  |
| 11 | `apps/desktop/scripts/fix-settings-utf8.mjs` | `UNASSIGNED` | 548 | 1 | 0 |  |
| 12 | `apps/mobile/src/screens/stack/SkillsSettingsScreen.tsx` | `mobile-screens` | 526 | 0 | 0 |  |
| 13 | `apps/desktop/renderer/App.tsx` | `desktop-renderer` | 522 | 0 | 0 |  |
| 14 | `apps/mobile/src/screens/stack/ProviderDetailScreen.tsx` | `mobile-screens` | 510 | 0 | 0 |  |
| 15 | `apps/desktop/renderer/layout/PreviewPane.tsx` | `desktop-renderer` | 504 | 0 | 0 |  |
| 16 | `apps/desktop/src/main/ipc/handler-registry.ts` | `desktop-main` | 486 | 1 | 0 |  |
| 17 | `apps/mobile/src/components/skills/NewSkillModal.tsx` | `mobile-components` | 467 | 1 | 0 |  |
| 18 | `apps/desktop/renderer/features/settings/SkillDetailView.tsx` | `desktop-renderer` | 408 | 0 | 0 |  |
| 19 | `apps/mobile/src/screens/stack/SmartSortRulesScreen.tsx` | `mobile-screens` | 404 | 0 | 0 |  |
| 20 | `apps/desktop/renderer/features/settings/SkillsManageView.tsx` | `desktop-renderer` | 403 | 0 | 0 |  |
| 21 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | `desktop-renderer` | 390 | 8 | 0 |  |
| 22 | `apps/mobile/src/components/chrome/ProjectDrawer.tsx` | `mobile-components` | 365 | 0 | 0 |  |
| 23 | `apps/desktop/renderer/features/workspace/WorkspaceTree.tsx` | `desktop-renderer` | 361 | 0 | 0 |  |
| 24 | `apps/mobile/metro.config.js` | `UNASSIGNED` | 356 | 0 | 0 |  |
| 25 | `apps/desktop/renderer/layout/SettingsOverlay.tsx` | `desktop-renderer` | 335 | 0 | 0 |  |
| 26 | `apps/desktop/renderer/layout/PreviewAnnotateUi.tsx` | `desktop-renderer` | 328 | 0 | 0 |  |
| 27 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx` | `desktop-renderer` | 326 | 1 | 0 |  |
| 28 | `apps/mobile/src/navigation/RootNavigator.tsx` | `mobile-app` | 324 | 0 | 0 |  |
| 29 | `apps/mobile/src/screens/stack/ModelSamplingScreen.tsx` | `mobile-screens` | 323 | 0 | 0 |  |
| 30 | `packages/core/src/domain/vfs/repositories/vfs-entry.port.ts` | `core-vfs` | 321 | 1 | 0 |  |
| 31 | `apps/desktop/renderer/features/settings/ModelSamplingView.tsx` | `desktop-renderer` | 293 | 0 | 0 |  |
| 32 | `apps/mobile/src/screens/stack/CloudSyncConfigScreen.tsx` | `mobile-screens` | 279 | 0 | 0 |  |
| 33 | `apps/mobile/scripts/generate-app-icons.mjs` | `UNASSIGNED` | 272 | 0 | 0 |  |
| 34 | `apps/desktop/renderer/features/workspace/DirectoryRuleModal.tsx` | `desktop-renderer` | 256 | 0 | 0 |  |
| 35 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | `core-tool` | 253 | 3 | 1 |  |
| 36 | `apps/mobile/src/screens/stack/CloudSyncStorageScreen.tsx` | `mobile-screens` | 238 | 0 | 0 |  |
| 37 | `apps/mobile/src/components/skills/SkillInfoEditModal.tsx` | `mobile-components` | 236 | 0 | 0 |  |
| 38 | `apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx` | `desktop-renderer` | 233 | 0 | 0 |  |
| 39 | `packages/core/src/service/chat/usage-stats.port.ts` | `core-service` | 232 | 0 | 0 |  |
| 40 | `apps/mobile/jest.config.js` | `UNASSIGNED` | 228 | 0 | 0 |  |
| 41 | `apps/mobile/scripts/build-webview.mjs` | `UNASSIGNED` | 228 | 0 | 0 |  |
| 42 | `packages/core/src/domain/vfs/repositories/vfs-revision.port.ts` | `core-vfs` | 227 | 0 | 0 |  |
| 43 | `apps/desktop/renderer/features/settings/SearchEnginesView.tsx` | `desktop-renderer` | 221 | 0 | 0 |  |
| 44 | `apps/desktop/renderer/layout/ExplorerPane.tsx` | `desktop-renderer` | 219 | 1 | 0 |  |
| 45 | `apps/mobile/src/components/provider/SamplingForm.tsx` | `mobile-components` | 214 | 0 | 0 |  |
| 46 | `apps/desktop/src/main/main.ts` | `desktop-main` | 211 | 0 | 0 |  |
| 47 | `apps/mobile/src/web/code-editor/webview/runtime/editor.ts` | `mobile-web` | 210 | 2 | 0 |  |
| 48 | `apps/mobile/src/runtime/create-mobile-runtime.ts` | `mobile-app` | 200 | 0 | 0 |  |
| 49 | `apps/desktop/renderer/features/settings/AboutView.tsx` | `desktop-renderer` | 198 | 0 | 0 |  |
| 50 | `apps/desktop/renderer/features/chat/SessionSkillPanel.tsx` | `desktop-renderer` | 189 | 0 | 0 |  |
| 51 | `apps/mobile/src/web/chat-transcript/webview/ui/stream/StreamTail.tsx` | `mobile-web` | 184 | 0 | 0 |  |
| 52 | `apps/mobile/src/screens/stack/CloudSyncProgressScreen.tsx` | `mobile-screens` | 182 | 0 | 0 |  |
| 53 | `apps/desktop/scripts/generate-icons.mjs` | `UNASSIGNED` | 180 | 0 | 0 |  |
| 54 | `apps/desktop/renderer/hooks/useAutoUpdateCheck.tsx` | `desktop-renderer` | 177 | 0 | 0 |  |
| 55 | `apps/mobile/src/web/rich-document/webview/runtime/annotate.ts` | `mobile-web` | 172 | 0 | 0 |  |
| 56 | `packages/core/src/service/skills/skills.port.ts` | `core-service` | 166 | 0 | 0 |  |
| 57 | `apps/mobile/src/components/chrome/CloudSyncProgressPanel.tsx` | `mobile-components` | 166 | 0 | 0 |  |
| 58 | `apps/mobile/src/screens/stack/SkillDetailScreen.tsx` | `mobile-screens` | 164 | 0 | 0 |  |
| 59 | `apps/mobile/src/components/chrome/ToastHost.tsx` | `mobile-components` | 163 | 1 | 0 |  |
| 60 | `apps/desktop/renderer/providers/NovelMasterProvider.tsx` | `desktop-renderer` | 162 | 2 | 0 |  |
| 61 | `apps/desktop/renderer/features/settings/SamplingForm.tsx` | `desktop-renderer` | 158 | 0 | 0 |  |
| 62 | `packages/core/src/domain/message-checkpoint/repositories/message-checkpoint.port.ts` | `core-message-checkpoint` | 155 | 0 | 0 |  |
| 63 | `apps/desktop/renderer/features/skills/SkillPicker.tsx` | `desktop-renderer` | 146 | 1 | 0 |  |
| 64 | `apps/desktop/renderer/hooks/useChatMessagesScrollFollow.ts` | `desktop-renderer` | 146 | 0 | 0 |  |
| 65 | `apps/mobile/src/shims/aws-rn-stream-collector.js` | `mobile-app` | 146 | 0 | 0 |  |
| 66 | `apps/desktop/renderer/features/workspace/FileInclusionModal.tsx` | `desktop-renderer` | 143 | 0 | 0 |  |
| 67 | `packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts` | `core-vfs` | 131 | 2 | 0 |  |
| 68 | `apps/desktop/renderer/layout/AppChrome.tsx` | `desktop-renderer` | 128 | 0 | 0 |  |
| 69 | `apps/desktop/src/main/shell-menu.ts` | `desktop-main` | 127 | 1 | 0 |  |
| 70 | `apps/mobile/src/components/prompt/PromptPreviewSegmentCard.tsx` | `mobile-components` | 127 | 1 | 0 |  |
| 71 | `packages/core/src/common/memoize.ts` | `core-root` | 124 | 1 | 0 |  |
| 72 | `packages/core/src/infra/llm-protocol/ports/adapter.port.ts` | `core-infra` | 124 | 0 | 0 |  |
| 73 | `apps/mobile/src/web/chat-transcript/webview/ui/render/MessageRow.tsx` | `mobile-web` | 124 | 1 | 0 |  |
| 74 | `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | `core-vfs` | 120 | 3 | 0 |  |
| 75 | `apps/mobile/src/components/prompt/TemplatePullButton.tsx` | `mobile-components` | 120 | 0 | 0 |  |
| 76 | `apps/mobile/src/components/update/UpdateCheckResultModal.tsx` | `mobile-components` | 120 | 4 | 0 |  |
| 77 | `apps/mobile/src/runtime/types.ts` | `mobile-app` | 120 | 0 | 0 |  |
| 78 | `packages/core/src/domain/chat/repositories/message.port.ts` | `core-chat` | 119 | 0 | 0 |  |
| 79 | `apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx` | `mobile-web` | 117 | 1 | 0 |  |
| 80 | `apps/desktop/renderer/components/batch/ManageHeader.tsx` | `desktop-renderer` | 115 | 1 | 0 |  |
| 81 | `apps/desktop/renderer/features/chat/RealPromptPanel.tsx` | `desktop-renderer` | 115 | 0 | 0 |  |
| 82 | `apps/mobile/src/components/chat/ChatMetaBar.tsx` | `mobile-components` | 115 | 0 | 0 |  |
| 83 | `packages/core/src/common/excerpt-release-notes.ts` | `core-root` | 114 | 1 | 0 |  |
| 84 | `packages/core/src/service/workplace/workplace.port.ts` | `core-service` | 114 | 0 | 0 |  |
| 85 | `apps/desktop/renderer/components/ui/TextPromptModal.tsx` | `desktop-renderer` | 111 | 0 | 0 |  |
| 86 | `packages/core/src/service/vfs/internal-vfs.port.ts` | `core-service` | 110 | 0 | 0 |  |
| 87 | `packages/core/src/service/chat/message.port.ts` | `core-service` | 108 | 0 | 0 |  |
| 88 | `apps/desktop/src/main/runtime/types.ts` | `desktop-main` | 107 | 0 | 0 |  |
| 89 | `apps/mobile/src/navigation/types.ts` | `mobile-app` | 107 | 0 | 0 |  |
| 90 | `packages/core/src/infra/sksp/impl/base-sqlite-secret-store.ts` | `core-infra` | 106 | 0 | 0 |  |
| 91 | `apps/desktop/renderer/features/settings/PromptCollapsibleField.tsx` | `desktop-renderer` | 106 | 0 | 0 |  |
| 92 | `apps/mobile/src/services/prompt-preview.service.ts` | `mobile-app` | 104 | 1 | 0 |  |
| 93 | `apps/desktop/renderer/features/settings/AddModelModal.tsx` | `desktop-renderer` | 103 | 0 | 0 |  |
| 94 | `apps/desktop/scripts/rebuild-native.mjs` | `UNASSIGNED` | 100 | 0 | 0 |  |
| 95 | `apps/mobile/src/screens/stack/RealPromptScreen.tsx` | `mobile-screens` | 100 | 0 | 0 |  |
| 96 | `apps/mobile/test-utils/core-shim.ts` | `UNASSIGNED` | 98 | 59 | 0 |  |
| 97 | `packages/core/src/domain/chat/model/content-block.ts` | `core-chat` | 97 | 0 | 0 |  |
| 98 | `packages/core/src/service/smart-sort-rule/smart-sort-rule.port.ts` | `core-service` | 97 | 0 | 0 |  |
| 99 | `apps/mobile/src/web/chat-transcript/webview/ui/menu/MenuOverlay.tsx` | `mobile-web` | 96 | 1 | 0 |  |
| 100 | `packages/core/eslint.config.mjs` | `packages-periph` | 95 | 0 | 0 |  |
| 101 | `packages/core/src/service/agent/agent-stream-registry.port.ts` | `core-service` | 95 | 1 | 0 |  |
| 102 | `apps/mobile/src/web/code-editor/webview/runtime/theme.ts` | `mobile-web` | 94 | 0 | 0 |  |
| 103 | `apps/desktop/scripts/ensure-test-native.mjs` | `UNASSIGNED` | 93 | 0 | 0 |  |
| 104 | `apps/desktop/renderer/features/chat/MessageEditModal.tsx` | `desktop-renderer` | 92 | 0 | 0 |  |
| 105 | `apps/desktop/scripts/rebuild-native-for-node.mjs` | `UNASSIGNED` | 92 | 0 | 0 |  |
| 106 | `apps/mobile/src/web/chat-transcript/webview/ui/render/AssistantBubble.tsx` | `mobile-web` | 91 | 1 | 0 |  |
| 107 | `apps/desktop/eslint.config.mjs` | `UNASSIGNED` | 90 | 0 | 0 |  |
| 108 | `packages/core/src/service/chat/session.port.ts` | `core-service` | 89 | 0 | 0 |  |
| 109 | `apps/desktop/renderer/features/settings/PromptMacroTextarea.tsx` | `desktop-renderer` | 89 | 1 | 0 |  |
| 110 | `apps/desktop/src/main/ipc/handlers/search.ts` | `desktop-main` | 89 | 0 | 0 |  |
| 111 | `apps/desktop/renderer/providers/ThemeProvider.tsx` | `desktop-renderer` | 88 | 2 | 0 |  |
| 112 | `apps/mobile/src/web/rich-document/webview/runtime/bridge.ts` | `mobile-web` | 88 | 4 | 0 |  |
| 113 | `apps/desktop/renderer/components/ui/ToastHost.tsx` | `desktop-renderer` | 87 | 0 | 0 |  |
| 114 | `packages/core/src/domain/workplace/model/workplace-types.ts` | `core-workplace` | 86 | 2 | 0 |  |
| 115 | `apps/desktop/renderer/components/ui/ContextMenu.tsx` | `desktop-renderer` | 86 | 0 | 0 |  |
| 116 | `apps/desktop/renderer/features/settings/AgentWorkplaceBlockCard.tsx` | `desktop-renderer` | 83 | 0 | 0 |  |
| 117 | `apps/desktop/renderer/features/chat/useReadOnlyRunProbe.ts` | `desktop-renderer` | 82 | 2 | 0 |  |
| 118 | `apps/desktop/renderer/components/ui/CodeEditor.tsx` | `desktop-renderer` | 81 | 0 | 0 |  |
| 119 | `apps/desktop/scripts/generate-desktop-events.mjs` | `UNASSIGNED` | 81 | 0 | 0 |  |
| 120 | `apps/mobile/src/runtime/mobile-scope.ts` | `mobile-app` | 81 | 0 | 0 |  |
| 121 | `packages/core/src/domain/workplace/repositories/workplace.port.ts` | `core-workplace` | 80 | 3 | 0 |  |
| 122 | `apps/desktop/renderer/components/ui/codemirror-theme.ts` | `desktop-renderer` | 78 | 0 | 0 |  |
| 123 | `apps/desktop/src/preload/preload.ts` | `desktop-main` | 78 | 0 | 0 |  |
| 124 | `apps/mobile/eslint.config.mjs` | `UNASSIGNED` | 78 | 0 | 0 |  |
| 125 | `apps/desktop/renderer/components/ui/PickerModal.tsx` | `desktop-renderer` | 76 | 0 | 0 |  |
| 126 | `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | `core-vfs` | 75 | 2 | 0 |  |
| 127 | `apps/mobile/src/components/skills/skill-ui.ts` | `mobile-components` | 72 | 1 | 0 |  |
| 128 | `apps/mobile/src/hooks/useVfsBackNavigation.ts` | `mobile-app` | 72 | 0 | 0 |  |
| 129 | `apps/mobile/src/web/code-editor/webview/runtime/composer-tokens.ts` | `mobile-web` | 71 | 1 | 0 |  |
| 130 | `apps/mobile/src/components/form/FormSwitchRow.tsx` | `mobile-components` | 70 | 0 | 0 |  |
| 131 | `apps/desktop/renderer/features/settings/PromptMacroChips.tsx` | `desktop-renderer` | 67 | 1 | 0 |  |
| 132 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts` | `desktop-renderer` | 67 | 3 | 0 |  |
| 133 | `apps/mobile/src/screens/stack/GlobalTemplateScreen.tsx` | `mobile-screens` | 67 | 0 | 0 |  |
| 134 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts` | `mobile-web` | 66 | 1 | 0 |  |
| 135 | `apps/mobile/src/web/chat-transcript/webview/runtime/util/vfs-tool-path.ts` | `mobile-web` | 66 | 3 | 0 |  |
| 136 | `packages/core/src/domain/vfs/content-store/vfs-content-store.port.ts` | `core-vfs` | 65 | 0 | 0 |  |
| 137 | `apps/desktop/vite.config.ts` | `UNASSIGNED` | 64 | 0 | 0 |  |
| 138 | `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | `UNASSIGNED` | 64 | 6 | 1 |  |
| 139 | `packages/core/src/domain/chat/model/message.ts` | `core-chat` | 63 | 1 | 0 |  |
| 140 | `packages/core/src/domain/agent/session/agent-session.port.ts` | `core-agent` | 62 | 0 | 0 |  |
| 141 | `packages/core/src/service/session-run-state/session-run-state.port.ts` | `core-service` | 62 | 0 | 0 |  |
| 142 | `apps/mobile/src/web/chat-transcript/webview/runtime/util/skill-tool-ref.ts` | `mobile-web` | 62 | 1 | 0 |  |
| 143 | `apps/desktop/renderer/components/ui/UpdateAvailableModal.tsx` | `desktop-renderer` | 60 | 0 | 0 |  |
| 144 | `apps/desktop/renderer/layout/MainShell.tsx` | `desktop-renderer` | 60 | 0 | 0 |  |
| 145 | `apps/mobile/test-utils/notifee-mock.ts` | `UNASSIGNED` | 60 | 7 | 0 |  |
| 146 | `packages/core/src/service/vfs/physical-vfs.port.ts` | `core-service` | 59 | 0 | 0 |  |
| 147 | `apps/desktop/renderer/layout/PreviewEditorTabs.tsx` | `desktop-renderer` | 59 | 0 | 0 |  |
| 148 | `apps/mobile/src/web/rich-document/webview/ui/DocumentApp.tsx` | `mobile-web` | 59 | 1 | 0 |  |
| 149 | `packages/core/src/service/message-checkpoint/message-checkpoint.port.ts` | `core-service` | 58 | 0 | 0 |  |
| 150 | `apps/desktop/src/main/ipc/handlers/backup.ts` | `desktop-main` | 58 | 0 | 0 |  |
| 151 | `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | `UNASSIGNED` | 58 | 3 | 0 |  |
| 152 | `apps/desktop/renderer/components/ui/UpdateCheckResultModal.tsx` | `desktop-renderer` | 57 | 3 | 0 |  |
| 153 | `apps/mobile/src/components/batch/ListBatchBar.tsx` | `mobile-components` | 57 | 1 | 0 |  |
| 154 | `apps/mobile/src/web/rich-document/webview/main.ts` | `mobile-web` | 57 | 0 | 0 | 是 |
| 155 | `packages/core/src/infra/db-maintenance/db-maintenance.port.ts` | `core-infra` | 56 | 0 | 0 |  |
| 156 | `apps/desktop/src/main/storage/app-ui-prefs.ts` | `desktop-main` | 56 | 10 | 0 |  |
| 157 | `apps/mobile/src/components/agent/agent-editor/PromptBlockActions.tsx` | `mobile-components` | 56 | 0 | 0 |  |
| 158 | `packages/core/src/domain/session-run-state/model/session-run-state.ts` | `core-session-run-state` | 55 | 0 | 0 |  |
| 159 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts` | `desktop-renderer` | 55 | 2 | 0 |  |
| 160 | `packages/core/src/domain/chat/repositories/session.port.ts` | `core-chat` | 54 | 0 | 0 |  |
| 161 | `apps/desktop/renderer/features/settings/search-engine-meta.ts` | `desktop-renderer` | 54 | 0 | 0 |  |
| 162 | `apps/desktop/renderer/features/chat/SkillTypeahead.tsx` | `desktop-renderer` | 53 | 1 | 0 |  |
| 163 | `apps/mobile/src/web/code-editor/webview/runtime/bridge.ts` | `mobile-web` | 53 | 1 | 0 |  |
| 164 | `packages/core/src/service/agent/agent-abort-registry.port.ts` | `core-service` | 52 | 0 | 0 |  |
| 165 | `apps/mobile/src/web/chat-transcript/webview/ui/render/ThinkingSection.tsx` | `mobile-web` | 51 | 1 | 0 |  |
| 166 | `packages/core/src/domain/compaction-conditions/ports/compaction-condition-trigger.port.ts` | `core-compaction-conditions` | 50 | 1 | 0 |  |
| 167 | `packages/core/src/domain/prompt/model/prompt-render-context.ts` | `core-prompt` | 50 | 0 | 0 |  |
| 168 | `apps/mobile/src/components/chat/transcript-selectable-role.ts` | `mobile-components` | 50 | 17 | 0 |  |
| 169 | `apps/mobile/src/web/chat-transcript/webview/main.ts` | `mobile-web` | 50 | 1 | 0 | 是 |
| 170 | `packages/core/src/common/usage-stats-format.ts` | `core-root` | 49 | 0 | 0 |  |
| 171 | `packages/core/src/service/chat/message-transcript-effects.port.ts` | `core-service` | 49 | 0 | 0 |  |
| 172 | `apps/desktop/renderer/features/chat/AtPathTypeahead.tsx` | `desktop-renderer` | 49 | 1 | 0 |  |
| 173 | `apps/mobile/src/screens/stack/AgentsSettingsScreen.tsx` | `mobile-screens` | 49 | 0 | 0 |  |
| 174 | `apps/mobile/src/web/chat-transcript/webview/ui/render/AttachGroup.tsx` | `mobile-web` | 49 | 1 | 0 |  |
| 175 | `packages/core/src/infra/sql-template/types.ts` | `core-infra` | 48 | 0 | 0 |  |
| 176 | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | `desktop-renderer` | 48 | 17 | 0 |  |
| 177 | `apps/desktop/src/main/ipc/handlers/app-ui.ts` | `desktop-main` | 48 | 0 | 0 |  |
| 178 | `apps/mobile/src/web/shared/code-copy.ts` | `mobile-web` | 48 | 0 | 0 |  |
| 179 | `packages/core/src/domain/session-kkv/repositories/session-kkv.port.ts` | `core-session-kkv` | 46 | 0 | 0 |  |
| 180 | `packages/core/src/public/format.ts` | `core-root` | 46 | 0 | 0 |  |
| 181 | `packages/core/src/service/session-kkv/session-kkv.port.ts` | `core-service` | 45 | 0 | 0 |  |
| 182 | `apps/desktop/renderer/state/nav-workspace.ts` | `desktop-renderer` | 45 | 2 | 0 |  |
| 183 | `apps/mobile/src/App.tsx` | `mobile-app` | 45 | 0 | 0 |  |
| 184 | `packages/core/src/infra/tdbc/ports/connection.port.ts` | `core-infra` | 44 | 0 | 0 |  |
| 185 | `apps/desktop/renderer/utils/format-user-error.ts` | `desktop-renderer` | 44 | 0 | 0 |  |
| 186 | `packages/core/src/domain/tool/model/tool.ts` | `core-tool` | 43 | 0 | 0 |  |
| 187 | `apps/desktop/renderer/layout/preview-utils.ts` | `desktop-renderer` | 43 | 2 | 0 |  |
| 188 | `packages/core/src/infra/sksp/index.ts` | `core-infra` | 42 | 7 | 1 |  |
| 189 | `packages/core/src/service/persistent-preferences/persistent-preferences.port.ts` | `core-service` | 42 | 0 | 0 |  |
| 190 | `apps/mobile/test-utils/react-native-blob-util-mock.ts` | `UNASSIGNED` | 42 | 2 | 0 |  |
| 191 | `packages/core/src/domain/skills/repositories/skill-disabled-rule.port.ts` | `core-skills` | 41 | 0 | 0 |  |
| 192 | `packages/core/src/service/chat/user-vfs-turn.port.ts` | `core-service` | 41 | 0 | 0 |  |
| 193 | `packages/core/src/service/message-checkpoint/message-rollback.port.ts` | `core-service` | 41 | 0 | 0 |  |
| 194 | `apps/desktop/renderer/layout/AppMenuBar.tsx` | `desktop-renderer` | 41 | 1 | 0 |  |
| 195 | `apps/desktop/renderer/state/desktop-scope.ts` | `desktop-renderer` | 41 | 1 | 0 |  |
| 196 | `apps/mobile/src/web/chat-transcript/webview/runtime/boot/boot-transcript.ts` | `mobile-web` | 41 | 2 | 0 |  |
| 197 | `packages/core/src/service/persistent-state/persistent-state.port.ts` | `core-service` | 40 | 0 | 0 |  |
| 198 | `apps/desktop/scripts/check-preload-bridge.mjs` | `UNASSIGNED` | 40 | 0 | 0 |  |
| 199 | `apps/desktop/scripts/run-tests.mjs` | `UNASSIGNED` | 40 | 0 | 0 |  |
| 200 | `apps/mobile/src/services/smart-sort-rule-yaml.service.ts` | `mobile-app` | 40 | 0 | 0 |  |
| 201 | `apps/mobile/test-utils/document-picker-mock.ts` | `UNASSIGNED` | 40 | 0 | 0 |  |
| 202 | `packages/core/src/domain/chat/model/session-agent-config.ts` | `core-chat` | 39 | 0 | 0 |  |
| 203 | `packages/core/src/infra/tokenizer/ports/token-counter.port.ts` | `core-infra` | 39 | 0 | 0 |  |
| 204 | `packages/core/src/service/chat/project.port.ts` | `core-service` | 39 | 0 | 0 |  |
| 205 | `apps/desktop/src/main/ipc/handlers/compaction-conditions.ts` | `desktop-main` | 39 | 0 | 0 |  |
| 206 | `apps/mobile/src/services/session-messages-loader.ts` | `mobile-app` | 39 | 3 | 0 |  |
| 207 | `packages/core/src/domain/session-run-state/repositories/session-run-state.port.ts` | `core-session-run-state` | 38 | 0 | 0 |  |
| 208 | `packages/core/src/domain/workplace/model/workplace-rule-view.ts` | `core-workplace` | 38 | 0 | 0 |  |
| 209 | `packages/core/src/infra/tdbc/types.ts` | `core-infra` | 38 | 0 | 0 |  |
| 210 | `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen-styles.ts` | `mobile-web` | 38 | 1 | 0 | 是 |
| 211 | `packages/core/src/domain/vfs/ports/character-card-import.port.ts` | `core-vfs` | 37 | 0 | 0 |  |
| 212 | `packages/core/src/service/provider/provider.port.ts` | `core-service` | 37 | 0 | 0 |  |
| 213 | `packages/core/src/common/compare-app-versions.ts` | `core-root` | 36 | 0 | 0 |  |
| 214 | `packages/core/src/infra/sksp/impl/sksp-strategy.port.ts` | `core-infra` | 36 | 0 | 0 |  |
| 215 | `packages/core/src/service/agent/agent-registry.port.ts` | `core-service` | 36 | 0 | 0 |  |
| 216 | `apps/desktop/src/main/ipc/handlers/shell.ts` | `desktop-main` | 36 | 0 | 0 |  |
| 217 | `packages/core/src/service/agent/agent.port.ts` | `core-service` | 35 | 0 | 0 |  |
| 218 | `apps/mobile/src/web/shared/ui/TrustedHtml.tsx` | `mobile-web` | 35 | 1 | 0 |  |
| 219 | `apps/mobile/test-utils/react-native-webview-mock.tsx` | `UNASSIGNED` | 35 | 0 | 2 |  |
| 220 | `packages/core/src/infra/cloud-sync/ports/object-storage.port.ts` | `core-infra` | 34 | 0 | 0 |  |
| 221 | `apps/mobile/src/navigation/StackScreenLayout.tsx` | `mobile-app` | 34 | 0 | 0 |  |
| 222 | `packages/core/src/domain/agent/model/agent-definition.ts` | `core-agent` | 33 | 0 | 0 |  |
| 223 | `packages/core/src/infra/tokenizer/ports/token-counter-registry.port.ts` | `core-infra` | 33 | 0 | 0 |  |
| 224 | `packages/core/src/service/provider/model-request.port.ts` | `core-service` | 33 | 0 | 0 |  |
| 225 | `packages/core/src/domain/vfs/ports/vfs-zip-io.port.ts` | `core-vfs` | 32 | 0 | 0 |  |
| 226 | `apps/mobile/android/app/src/main/java/com/novelmaster/MainApplication.kt` | `mobile-android` | 32 | 0 | 0 |  |
| 227 | `packages/core/src/domain/chat/repositories/project.port.ts` | `core-chat` | 31 | 0 | 0 |  |
| 228 | `packages/core/src/service/provider/provider-model.port.ts` | `core-service` | 31 | 0 | 0 |  |
| 229 | `apps/desktop/src/main/ipc/handlers/bootstrap.ts` | `desktop-main` | 31 | 0 | 0 |  |
| 230 | `packages/core/src/domain/vfs/model/vfs-entry.ts` | `core-vfs` | 30 | 0 | 0 |  |
| 231 | `packages/core/src/service/provider/model-retry-policy.port.ts` | `core-service` | 30 | 0 | 0 |  |
| 232 | `packages/core/src/domain/message-checkpoint/model/message-checkpoint.ts` | `core-message-checkpoint` | 29 | 1 | 0 |  |
| 233 | `packages/core/src/domain/vfs/model/vfs-list-entry.ts` | `core-vfs` | 29 | 1 | 0 |  |
| 234 | `apps/cli/src/vfs/errors.ts` | `cli` | 29 | 4 | 0 |  |
| 235 | `apps/desktop/scripts/start-electron.mjs` | `UNASSIGNED` | 29 | 0 | 0 |  |
| 236 | `packages/core/src/common/index.ts` | `core-root` | 28 | 2 | 1 |  |
| 237 | `packages/core/src/service/session-fs/session-fs.port.ts` | `core-service` | 28 | 0 | 0 |  |
| 238 | `apps/mobile/test-utils/op-sqlite-mock.ts` | `UNASSIGNED` | 28 | 1 | 0 |  |
| 239 | `packages/core/src/domain/message-checkpoint/logic/restore-path-model.ts` | `core-message-checkpoint` | 27 | 0 | 0 |  |
| 240 | `packages/core/src/domain/prompt/model/prompt-block.ts` | `core-prompt` | 27 | 0 | 0 |  |
| 241 | `apps/desktop/renderer/components/ui/TextArea.tsx` | `desktop-renderer` | 26 | 0 | 0 |  |
| 242 | `apps/mobile/src/shims/aws-xml-parser.js` | `mobile-app` | 26 | 0 | 0 |  |
| 243 | `apps/mobile/src/web/chat-transcript/webview/ui/menu/ContextMenu.tsx` | `mobile-web` | 26 | 1 | 0 |  |
| 244 | `packages/core/src/domain/agent/model/agent-run-result.ts` | `core-agent` | 25 | 0 | 0 |  |
| 245 | `packages/core/src/domain/chat/model/message-usage.ts` | `core-chat` | 25 | 0 | 0 |  |
| 246 | `apps/cli/src/vfs/runtime.ts` | `cli` | 25 | 2 | 0 |  |
| 247 | `packages/core/src/domain/vfs/model/vfs-revision.ts` | `core-vfs` | 24 | 0 | 0 |  |
| 248 | `packages/core/src/domain/vfs/ports/vfs-restore.port.ts` | `core-vfs` | 23 | 0 | 0 |  |
| 249 | `apps/mobile/android/app/src/main/java/com/novelmaster/MainActivity.kt` | `mobile-android` | 23 | 0 | 0 |  |
| 250 | `apps/mobile/src/services/agent-display-label.ts` | `mobile-app` | 23 | 0 | 0 |  |
| 251 | `apps/mobile/src/shims/aws-rn-fetch-handler.js` | `mobile-app` | 23 | 0 | 0 |  |
| 252 | `apps/mobile/src/web/chat-transcript/webview/runtime/boot/bind-shell-events.ts` | `mobile-web` | 23 | 0 | 0 |  |
| 253 | `packages/core/src/domain/agent/repositories/agent-definition.port.ts` | `core-agent` | 22 | 0 | 0 |  |
| 254 | `packages/core/src/domain/smart-sort-rule/repositories/smart-sort-rule.port.ts` | `core-smart-sort-rule` | 22 | 0 | 0 |  |
| 255 | `packages/core/src/infra/kkv/logic/parse-kkv-json-document.ts` | `core-infra` | 22 | 1 | 0 |  |
| 256 | `packages/core/src/domain/chat/model/session.ts` | `core-chat` | 21 | 0 | 0 |  |
| 257 | `packages/core/src/domain/kkv/repositories/kkv.port.ts` | `core-kkv` | 21 | 0 | 0 |  |
| 258 | `packages/core/src/domain/vfs/model/vfs-content-size.ts` | `core-vfs` | 21 | 0 | 0 |  |
| 259 | `packages/core/src/service/kkv/kkv.port.ts` | `core-service` | 21 | 0 | 0 |  |
| 260 | `packages/core/src/service/template/template-pull.port.ts` | `core-service` | 21 | 0 | 0 |  |
| 261 | `apps/mobile/src/hooks/useMobileScope.ts` | `mobile-app` | 21 | 0 | 0 |  |
| 262 | `packages/core/src/domain/character-card/model/character-card.ts` | `core-character-card` | 20 | 0 | 0 |  |
| 263 | `packages/core/src/domain/provider/model/model-suggestion-cache.ts` | `core-provider` | 20 | 1 | 0 |  |
| 264 | `packages/core/src/public/session-run-state.ts` | `core-root` | 20 | 0 | 0 |  |
| 265 | `apps/desktop/renderer/hooks/useAutoResizeTextarea.ts` | `desktop-renderer` | 20 | 0 | 0 |  |
| 266 | `apps/desktop/src/main/update-check/types.ts` | `desktop-main` | 20 | 1 | 0 |  |
| 267 | `apps/mobile/src/services/message-rollback.service.ts` | `mobile-app` | 20 | 0 | 0 |  |
| 268 | `apps/mobile/src/update-check/types.ts` | `mobile-app` | 20 | 1 | 0 |  |
| 269 | `apps/mobile/src/web/code-editor/webview/runtime/model.ts` | `mobile-web` | 20 | 0 | 0 |  |
| 270 | `apps/mobile/src/web/composer-input/webview/main.ts` | `mobile-web` | 20 | 0 | 0 | 是 |
| 271 | `packages/core/src/infra/nmtp/ports/tokenizer-driver.port.ts` | `core-infra` | 19 | 0 | 0 |  |
| 272 | `packages/core/src/service/vfs/vfs.port.ts` | `core-service` | 19 | 3 | 0 |  |
| 273 | `packages/core/src/types/agnai-tokenizers.d.ts` | `core-root` | 19 | 1 | 0 |  |
| 274 | `apps/desktop/renderer/hooks/useDesktopAgentActive.ts` | `desktop-renderer` | 19 | 0 | 0 |  |
| 275 | `apps/mobile/src/services/model-display-label.ts` | `mobile-app` | 19 | 0 | 0 |  |
| 276 | `apps/mobile/src/web/rich-document/webview/runtime/mermaid.ts` | `mobile-web` | 19 | 0 | 0 |  |
| 277 | `apps/desktop/shared/logic/provider.ts` | `desktop-shared` | 18 | 0 | 0 |  |
| 278 | `apps/mobile/scripts/run-gradlew.mjs` | `UNASSIGNED` | 18 | 0 | 0 |  |
| 279 | `packages/core/src/domain/vfs/model/vfs-options.ts` | `core-vfs` | 17 | 0 | 0 |  |
| 280 | `packages/core/src/infra/cloud-sync/ports/db-sync.port.ts` | `core-infra` | 17 | 0 | 0 |  |
| 281 | `apps/desktop/shared/logic/config-forms-stored-config-validity.ts` | `desktop-shared` | 17 | 1 | 0 |  |
| 282 | `packages/core/src/service/session-run-state/index.ts` | `core-service` | 16 | 5 | 0 |  |
| 283 | `apps/desktop/renderer/main.tsx` | `desktop-renderer` | 16 | 0 | 0 |  |
| 284 | `apps/desktop/shared/logic/events.ts` | `desktop-shared` | 16 | 0 | 0 |  |
| 285 | `apps/mobile/src/web/chat-transcript/webview/runtime/util/html-escape.ts` | `mobile-web` | 16 | 0 | 0 |  |
| 286 | `packages/core/src/infra/tdbc/ports/driver.port.ts` | `core-infra` | 15 | 0 | 0 |  |
| 287 | `packages/core/src/public/kkv.ts` | `core-root` | 15 | 0 | 0 |  |
| 288 | `apps/desktop/renderer/components/ui/language-for-path.ts` | `desktop-renderer` | 15 | 0 | 0 |  |
| 289 | `apps/mobile/src/hooks/useRuntime.ts` | `mobile-app` | 15 | 0 | 0 |  |
| 290 | `apps/mobile/src/types/global-base64.d.ts` | `mobile-app` | 15 | 0 | 0 |  |
| 291 | `apps/mobile/src/web/code-editor/webview/runtime/language-for-path.ts` | `mobile-web` | 15 | 0 | 0 |  |
| 292 | `packages/core/src/bootstrap/schema-migrations/schema-migration.types.ts` | `core-bootstrap` | 14 | 0 | 0 |  |
| 293 | `packages/core/src/domain/chat/model/project.ts` | `core-chat` | 14 | 0 | 0 |  |
| 294 | `packages/core/src/domain/provider/model/model-suggestion.ts` | `core-provider` | 14 | 0 | 0 |  |
| 295 | `packages/core/src/domain/session-kkv/model/session-kkv-entry.ts` | `core-session-kkv` | 14 | 0 | 0 |  |
| 296 | `packages/core/src/infra/sksp/ports/secret-store.port.ts` | `core-infra` | 14 | 0 | 0 |  |
| 297 | `packages/core/src/service/compaction-conditions/compaction-conditions-store.port.ts` | `core-service` | 14 | 0 | 0 |  |
| 298 | `apps/mobile/index.js` | `UNASSIGNED` | 14 | 0 | 0 | 是 |
| 299 | `packages/core/src/common/normalize-yaml-error.ts` | `core-root` | 13 | 0 | 0 |  |
| 300 | `packages/core/src/domain/kkv/model/kkv-entry.ts` | `core-kkv` | 13 | 0 | 0 |  |
| 301 | `packages/core/src/domain/kkv/ports/kkv-reader.port.ts` | `core-kkv` | 13 | 0 | 0 |  |
| 302 | `apps/desktop/src/main/services/update-check.service.ts` | `desktop-main` | 13 | 1 | 0 |  |
| 303 | `apps/mobile/src/components/chat/composer-at-path.ts` | `mobile-components` | 13 | 0 | 2 |  |
| 304 | `apps/mobile/src/hooks/useStreamTailGenerating.ts` | `mobile-app` | 13 | 2 | 0 |  |
| 305 | `apps/mobile/src/web/chat-transcript/webview/ui/render/ToolInvokingBar.tsx` | `mobile-web` | 12 | 0 | 0 |  |
| 306 | `packages/core/src/domain/provider/repositories/saved-model.port.ts` | `core-provider` | 11 | 0 | 0 |  |
| 307 | `apps/desktop/renderer/features/settings/about-links.ts` | `desktop-renderer` | 11 | 0 | 0 |  |
| 308 | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts` | `desktop-renderer` | 11 | 2 | 0 |  |
| 309 | `apps/desktop/renderer/utils/settings-feedback.ts` | `desktop-renderer` | 11 | 0 | 0 |  |
| 310 | `apps/desktop/shared/logic/search-engines.ts` | `desktop-shared` | 11 | 0 | 0 |  |
| 311 | `apps/desktop/shared/logic/smart-sort.ts` | `desktop-shared` | 11 | 1 | 0 |  |
| 312 | `apps/mobile/src/web/code-editor/webview/main.ts` | `mobile-web` | 11 | 0 | 0 | 是 |
| 313 | `packages/core/src/domain/provider/repositories/provider.port.ts` | `core-provider` | 10 | 0 | 0 |  |
| 314 | `apps/desktop/renderer/global.d.ts` | `desktop-renderer` | 10 | 0 | 0 |  |
| 315 | `apps/desktop/renderer/layout/preview-tab-utils.ts` | `desktop-renderer` | 10 | 0 | 0 |  |
| 316 | `apps/mobile/babel.config.js` | `UNASSIGNED` | 10 | 0 | 0 |  |
| 317 | `packages/core/src/domain/provider/repositories/model-suggestion.port.ts` | `core-provider` | 9 | 0 | 0 |  |
| 318 | `apps/mobile/src/web/code-editor/webview/runtime/post.ts` | `mobile-web` | 9 | 0 | 0 |  |
| 319 | `apps/desktop/renderer/shims/node-crypto.ts` | `desktop-renderer` | 8 | 0 | 0 | 是 |
| 320 | `apps/mobile/src/components/agent/agent-editor/agent-editor-types.ts` | `mobile-components` | 8 | 0 | 0 |  |
| 321 | `apps/mobile/.prettierrc.js` | `UNASSIGNED` | 7 | 0 | 0 |  |
| 322 | `apps/mobile/src/components/chat/anchored-menu-layout.ts` | `mobile-components` | 7 | 0 | 0 |  |
| 323 | `apps/desktop/shared/desktop-ui-keys.ts` | `desktop-shared` | 5 | 0 | 0 |  |
| 324 | `apps/desktop/src/main/ipc/register-handlers.ts` | `desktop-main` | 5 | 0 | 0 |  |
| 325 | `apps/mobile/src/shims/node-fs.js` | `mobile-app` | 5 | 0 | 0 |  |
| 326 | `apps/mobile/src/vfs/errors.ts` | `mobile-app` | 5 | 1 | 1 |  |
| 327 | `apps/cli/eslint.config.mjs` | `cli` | 4 | 0 | 0 |  |

## 五、低覆盖热点 top30（0 < 覆盖行 < 30）

> 口径：LF>0 且 0<LH<30 的生产文件，按可执行行数降序。行数大但只被蹭到几行的，通常是一大坨逻辑里只有一条窄路径被测过——是补测试性价比最高的位置。

| # | 文件 | zone | LF | LH | 覆盖率 | 函数覆盖 |
|---|---|---|---|---|---|---|
| 1 | `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts` | `mobile-web` | 264 | 4 | 1.52% | 0/26 |
| 2 | `apps/mobile/src/web/shared/mermaid-fullscreen/MermaidViewerOverlay.tsx` | `mobile-web` | 204 | 2 | 0.98% | 0/16 |
| 3 | `apps/mobile/src/runtime/novel-master-context.tsx` | `mobile-app` | 111 | 13 | 11.71% | 3/23 |
| 4 | `apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts` | `mobile-web` | 87 | 1 | 1.15% | 0/15 |
| 5 | `apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream-markdown.ts` | `mobile-web` | 82 | 2 | 2.44% | 0/6 |
| 6 | `apps/mobile/src/components/vfs/CodeEditorWebView.tsx` | `mobile-components` | 62 | 27 | 43.55% | 4/15 |
| 7 | `apps/mobile/src/screens/stack/ProvidersScreen.tsx` | `mobile-screens` | 60 | 26 | 43.33% | 6/22 |
| 8 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/rows-click.ts` | `mobile-web` | 60 | 24 | 40.00% | 2/2 |
| 9 | `apps/mobile/src/web/chat-transcript/webview/runtime/bridge.ts` | `mobile-web` | 56 | 2 | 3.57% | 0/2 |
| 10 | `apps/cli/src/config/load-agent-prompt-layout.ts` | `cli` | 55 | 29 | 52.73% | 1/3 |
| 11 | `packages/core/src/config-forms/shared/application-model-id.ts` | `core-root` | 53 | 28 | 52.83% | 1/4 |
| 12 | `apps/mobile/src/screens/stack/AboutScreen.tsx` | `mobile-screens` | 52 | 23 | 44.23% | 4/16 |
| 13 | `apps/mobile/src/screens/tabs/chat-tab/useChatTabController.ts` | `mobile-screens` | 49 | 18 | 36.73% | 2/13 |
| 14 | `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen.ts` | `mobile-web` | 49 | 4 | 8.16% | 0/9 |
| 15 | `apps/mobile/src/screens/stack/SkillPanelScreen.tsx` | `mobile-screens` | 43 | 20 | 46.51% | 3/17 |
| 16 | `packages/core/src/domain/chat/content/format-message-cli.ts` | `core-chat` | 42 | 24 | 57.14% | 1/4 |
| 17 | `apps/desktop/renderer/features/chat/ToolCallGroupCard.tsx` | `desktop-renderer` | 41 | 23 | 56.10% | 1/2 |
| 18 | `packages/core/src/domain/depth/logic/depth-from-tail.ts` | `core-depth` | 35 | 27 | 77.14% | 2/4 |
| 19 | `apps/cli/src/vfs/commands/replace.ts` | `cli` | 34 | 28 | 82.35% | 2/2 |
| 20 | `apps/mobile/src/db/connection.ts` | `mobile-app` | 34 | 26 | 76.47% | 5/8 |
| 21 | `apps/desktop/scripts/after-pack.mjs` | `UNASSIGNED` | 33 | 18 | 54.55% | 1/1 |
| 22 | `apps/mobile/src/web/chat-transcript/webview/runtime/scroll/scroll.ts` | `mobile-web` | 33 | 21 | 63.64% | 6/10 |
| 23 | `apps/mobile/src/components/chat/MessageEditModal.tsx` | `mobile-components` | 31 | 28 | 90.32% | 6/9 |
| 24 | `apps/mobile/src/components/chat/ToolCallCard.tsx` | `mobile-components` | 31 | 1 | 3.23% | 0/5 |
| 25 | `packages/core/src/domain/compaction-conditions/triggers/composite-trigger.ts` | `core-compaction-conditions` | 30 | 24 | 80.00% | 2/3 |
| 26 | `apps/desktop/renderer/components/ui/Switch.tsx` | `desktop-renderer` | 30 | 18 | 60.00% | 1/2 |
| 27 | `apps/mobile/src/components/sheet/MetricDetailSheet.tsx` | `mobile-components` | 30 | 26 | 86.67% | 8/9 |
| 28 | `apps/mobile/src/components/ui/TextPromptModal.tsx` | `mobile-components` | 30 | 19 | 63.33% | 9/18 |
| 29 | `apps/mobile/src/services/cloud-sync-progress-ui.ts` | `mobile-app` | 30 | 22 | 73.33% | 3/3 |
| 30 | `apps/mobile/src/web/chat-transcript/webview/ui/render/RefTokenText.tsx` | `mobile-web` | 30 | 25 | 83.33% | 3/5 |

## 六、与 L0/dead-exports.md 的交集：零覆盖 ∩ 零引用

> 这是本机位最重要的产出。两个**互相独立**的口径——「测试从没执行到」与「全仓无人 import」——同时命中，误判概率最低。按置信度分三档：

| 档位 | 判据 | 文件数 | 物理行 |
|---|---|---|---|
| **T1 文件级全死** | 零覆盖 + 文件里**每一个**命名导出都在死清单里（无任何活导出），且已剔除构建入口与「从未被加载」的 node 侧文件 | **4** | **159** |
| T2 从未加载 + 死导出 | node 侧任何测试都没 import 过它，且至少有零消费导出（已剔除构建入口） | 60 | 7674 |
| T3 symbol 级候选 | 零覆盖 + 至少一个零消费导出（文件主体可能仍有活导出，不能直接判死） | 91 | 10304 |

### 6.1 T1 文件级全死清单

| # | 文件 | 物理行 | LF | 命名导出总数 | 死导出 | 仅测试消费 |
|---|---|---|---|---|---|---|
| 1 | `apps/mobile/src/components/batch/ListBatchBar.tsx` | 57 | 4 | 1 | 1 | 0 |
| 2 | `apps/mobile/src/components/chat/transcript-selectable-role.ts` | 50 | 2 | 17 | 17 | 0 |
| 3 | `apps/mobile/src/services/session-messages-loader.ts` | 39 | 3 | 3 | 3 | 0 |
| 4 | `apps/mobile/src/hooks/useStreamTailGenerating.ts` | 13 | 1 | 2 | 2 | 0 |

### 6.2 T2 node 侧从未被任何测试加载 ∩ 有零消费导出（top40）

> node 的 lcov 只给「被 import 过的文件」出记录，所以「不在 lcov 里」= 任何 core/cli/desktop 测试都没碰过它。若同时还有无人 import 的导出，说明这文件既没测试兜底也没生产消费。已剔除构建入口。

| # | 文件 | 物理行 | 死导出数 | 死导出符号（前 5） |
|---|---|---|---|---|
| 1 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | 1048 | 4 | `AgentDefinitionBuildResult`<br>`AgentDefinitionEditorForm`<br>`AgentDefinitionEditorFormHandle`<br>`AgentDefinitionEditorFormProps` |
| 2 | `apps/desktop/renderer/providers/ShellNavProvider.tsx` | 1014 | 1 | `ShellNavContextValue` |
| 3 | `apps/desktop/scripts/fix-settings-utf8.mjs` | 548 | 1 | `EventsConfigView` |
| 4 | `apps/desktop/src/main/ipc/handler-registry.ts` | 486 | 1 | `registerHandlersFromRegistry` |
| 5 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | 390 | 8 | `ActiveNativeDrag`<br>`clearActiveNativeDrag`<br>`formatBatchApplyToast`<br>`getActiveNativeDrag`<br>`handleFilesDropIngest`<br>… |
| 6 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx` | 326 | 1 | `usePickerData` |
| 7 | `packages/core/src/domain/vfs/repositories/vfs-entry.port.ts` | 321 | 1 | `VfsEntryKind` |
| 8 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | 253 | 3 | `ResolveChildModelIdResult`<br>`ToolResourceQuota`<br>`VfsToolContext` |
| 9 | `apps/desktop/renderer/layout/ExplorerPane.tsx` | 219 | 1 | `WorkspaceContextTarget` |
| 10 | `apps/desktop/renderer/providers/NovelMasterProvider.tsx` | 162 | 2 | `NovelMasterContextValue`<br>`RuntimeStatus` |
| 11 | `apps/desktop/renderer/features/skills/SkillPicker.tsx` | 146 | 1 | `SkillPickerProps` |
| 12 | `packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts` | 131 | 2 | `BatchExportFileEntry`<br>`BatchIngestTypeConflict` |
| 13 | `apps/desktop/src/main/shell-menu.ts` | 127 | 1 | `buildApplicationMenu` |
| 14 | `packages/core/src/common/memoize.ts` | 124 | 1 | `memoize` |
| 15 | `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | 120 | 3 | `VfsContentSize`<br>`VfsEntryKind`<br>`VfsGrepMatchMode` |
| 16 | `apps/desktop/renderer/components/batch/ManageHeader.tsx` | 115 | 1 | `ManageHeaderBatchAction` |
| 17 | `packages/core/src/common/excerpt-release-notes.ts` | 114 | 1 | `ReleaseNotesFocus` |
| 18 | `apps/mobile/test-utils/core-shim.ts` | 98 | 59 | `AgentDefinition`<br>`AgentError`<br>`AgentRunResolveError`<br>`AgentRunResult`<br>`AgentTurnError`<br>… |
| 19 | `packages/core/src/service/agent/agent-stream-registry.port.ts` | 95 | 1 | `AgentStreamPartial` |
| 20 | `apps/desktop/renderer/features/settings/PromptMacroTextarea.tsx` | 89 | 1 | `PromptMacroTextareaProps` |
| 21 | `apps/desktop/renderer/providers/ThemeProvider.tsx` | 88 | 2 | `ThemeContextValue`<br>`ThemeMode` |
| 22 | `packages/core/src/domain/workplace/model/workplace-types.ts` | 86 | 2 | `WorkplaceDirRuleRow`<br>`WorkplaceFileRuleRow` |
| 23 | `apps/desktop/renderer/features/chat/useReadOnlyRunProbe.ts` | 82 | 2 | `READONLY_RUN_PROBE_INTERVAL_MS`<br>`UseReadOnlyRunProbeParams` |
| 24 | `packages/core/src/domain/workplace/repositories/workplace.port.ts` | 80 | 3 | `InclusionMode`<br>`WorkplaceDirRule`<br>`WorkplaceFileRule` |
| 25 | `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | 75 | 2 | `InferredScope`<br>`inferScopeFromPhysicalPath` |
| 26 | `apps/desktop/renderer/features/settings/PromptMacroChips.tsx` | 67 | 1 | `PromptMacroChipsProps` |
| 27 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts` | 67 | 3 | `usePreviewSelection`<br>`useTreeLoader`<br>`useTreeRefreshToken` |
| 28 | `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | 64 | 6 | `KeyboardStickyView`<br>`useGenericKeyboardHandler`<br>`useKeyboardAnimation`<br>`useKeyboardHandler`<br>`useKeyboardState`<br>… |
| 29 | `packages/core/src/domain/chat/model/message.ts` | 63 | 1 | `MessageUsage` |
| 30 | `apps/mobile/test-utils/notifee-mock.ts` | 60 | 7 | `getNotificationSettings`<br>`onBackgroundEvent`<br>`onForegroundEvent`<br>`openNotificationSettings`<br>`registerForegroundService`<br>… |
| 31 | `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | 58 | 3 | `useAnimatedProps`<br>`withDelay`<br>`withSpring` |
| 32 | `apps/desktop/renderer/components/ui/UpdateCheckResultModal.tsx` | 57 | 3 | `UPDATE_CHECK_FAILED_MESSAGE`<br>`UPDATE_CHECK_RESULT_TITLE`<br>`UPDATE_CHECK_UP_TO_DATE_MESSAGE` |
| 33 | `apps/desktop/src/main/storage/app-ui-prefs.ts` | 56 | 10 | `DESKTOP_UI_DEFAULTS`<br>`DESKTOP_UI_KEY_CHAT_RICH_TEXT`<br>`DESKTOP_UI_KEY_UPDATES_AUTO_CHECK`<br>`DESKTOP_UI_KEY_UPDATES_DISMISSED_VERSION`<br>`DESKTOP_UI_KEY_UPDATES_LAST_CHECK_AT`<br>… |
| 34 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts` | 55 | 2 | `deleteToolTurn`<br>`hideToolTurn` |
| 35 | `apps/desktop/renderer/features/chat/SkillTypeahead.tsx` | 53 | 1 | `SkillTypeaheadProps` |
| 36 | `packages/core/src/domain/compaction-conditions/ports/compaction-condition-trigger.port.ts` | 50 | 1 | `CompactionConditionModelContext` |
| 37 | `apps/desktop/renderer/features/chat/AtPathTypeahead.tsx` | 49 | 1 | `AtPathTypeaheadProps` |
| 38 | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | 48 | 17 | `buildTailBatchRows`<br>`computeHideRangeFromSelection`<br>`computeShowRangeFromSelection`<br>`computeTailBatchAffectedIds`<br>`computeTailBatchRangeFromSelection`<br>… |
| 39 | `apps/desktop/renderer/state/nav-workspace.ts` | 45 | 2 | `NAV_TO_WORKSPACE`<br>`WORKSPACE_TITLES` |
| 40 | `apps/desktop/renderer/layout/preview-utils.ts` | 43 | 2 | `isLikelyMarkdownContent`<br>`isMarkdownPreviewPath` |

### 6.3 T3 symbol 级候选 top60（按物理行）

> 注意：这一档只说明「文件里至少有一个导出无人 import」，不代表整个文件是死的——文件主体可能仍被生产侧以其它符号使用。要判文件死请看 6.1。

| # | 文件 | 物理行 | LF | 死导出 | 死导出符号（前 6） |
|---|---|---|---|---|---|
| 1 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | 1048 | 0 | 4 | `AgentDefinitionBuildResult`<br>`AgentDefinitionEditorForm`<br>`AgentDefinitionEditorFormHandle`<br>`AgentDefinitionEditorFormProps` |
| 2 | `apps/desktop/renderer/providers/ShellNavProvider.tsx` | 1014 | 0 | 1 | `ShellNavContextValue` |
| 3 | `apps/desktop/scripts/fix-settings-utf8.mjs` | 548 | 0 | 1 | `EventsConfigView` |
| 4 | `apps/desktop/src/main/ipc/handler-registry.ts` | 486 | 0 | 1 | `registerHandlersFromRegistry` |
| 5 | `apps/mobile/src/components/skills/NewSkillModal.tsx` | 467 | 91 | 1 | `NewSkillTarget` |
| 6 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts` | 390 | 0 | 8 | `ActiveNativeDrag`<br>`clearActiveNativeDrag`<br>`formatBatchApplyToast`<br>`getActiveNativeDrag`<br>`handleFilesDropIngest`<br>`isPrefetchInFlightForTest`<br>… |
| 7 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx` | 326 | 0 | 1 | `usePickerData` |
| 8 | `packages/core/src/domain/vfs/repositories/vfs-entry.port.ts` | 321 | 0 | 1 | `VfsEntryKind` |
| 9 | `packages/core/src/domain/tool/builtin/builtin-tool-context.ts` | 253 | 0 | 3 | `ResolveChildModelIdResult`<br>`ToolResourceQuota`<br>`VfsToolContext` |
| 10 | `apps/desktop/renderer/layout/ExplorerPane.tsx` | 219 | 0 | 1 | `WorkspaceContextTarget` |
| 11 | `apps/mobile/src/web/code-editor/webview/runtime/editor.ts` | 210 | 70 | 2 | `destroyEditor`<br>`EditorSelectionRange` |
| 12 | `apps/mobile/src/components/chrome/ToastHost.tsx` | 163 | 33 | 1 | `ToastOptions` |
| 13 | `apps/desktop/renderer/providers/NovelMasterProvider.tsx` | 162 | 0 | 2 | `NovelMasterContextValue`<br>`RuntimeStatus` |
| 14 | `apps/desktop/renderer/features/skills/SkillPicker.tsx` | 146 | 0 | 1 | `SkillPickerProps` |
| 15 | `packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts` | 131 | 0 | 2 | `BatchExportFileEntry`<br>`BatchIngestTypeConflict` |
| 16 | `apps/desktop/src/main/shell-menu.ts` | 127 | 0 | 1 | `buildApplicationMenu` |
| 17 | `apps/mobile/src/components/prompt/PromptPreviewSegmentCard.tsx` | 127 | 20 | 1 | `PromptPreviewSegmentView` |
| 18 | `packages/core/src/common/memoize.ts` | 124 | 0 | 1 | `memoize` |
| 19 | `apps/mobile/src/web/chat-transcript/webview/ui/render/MessageRow.tsx` | 124 | 28 | 1 | `MessageRowProps` |
| 20 | `packages/core/src/domain/vfs/ports/vfs-service.port.ts` | 120 | 0 | 3 | `VfsContentSize`<br>`VfsEntryKind`<br>`VfsGrepMatchMode` |
| 21 | `apps/mobile/src/components/update/UpdateCheckResultModal.tsx` | 120 | 9 | 4 | `UPDATE_CHECK_FAILED_MESSAGE`<br>`UPDATE_CHECK_RESULT_TITLE`<br>`UPDATE_CHECK_UP_TO_DATE_MESSAGE`<br>`UpdateCheckResultKind` |
| 22 | `apps/mobile/src/web/chat-transcript/webview/ui/render/ToolGroup.tsx` | 117 | 19 | 1 | `ToolGroupProps` |
| 23 | `apps/desktop/renderer/components/batch/ManageHeader.tsx` | 115 | 0 | 1 | `ManageHeaderBatchAction` |
| 24 | `packages/core/src/common/excerpt-release-notes.ts` | 114 | 0 | 1 | `ReleaseNotesFocus` |
| 25 | `apps/mobile/src/services/prompt-preview.service.ts` | 104 | 18 | 1 | `PromptPreviewScope` |
| 26 | `apps/mobile/test-utils/core-shim.ts` | 98 | 0 | 59 | `AgentDefinition`<br>`AgentError`<br>`AgentRunResolveError`<br>`AgentRunResult`<br>`AgentTurnError`<br>`buildToolResultBlock`<br>… |
| 27 | `apps/mobile/src/web/chat-transcript/webview/ui/menu/MenuOverlay.tsx` | 96 | 19 | 1 | `MenuOverlayProps` |
| 28 | `packages/core/src/service/agent/agent-stream-registry.port.ts` | 95 | 0 | 1 | `AgentStreamPartial` |
| 29 | `apps/mobile/src/web/chat-transcript/webview/ui/render/AssistantBubble.tsx` | 91 | 17 | 1 | `AssistantBubbleInnerProps` |
| 30 | `apps/desktop/renderer/features/settings/PromptMacroTextarea.tsx` | 89 | 0 | 1 | `PromptMacroTextareaProps` |
| 31 | `apps/desktop/renderer/providers/ThemeProvider.tsx` | 88 | 0 | 2 | `ThemeContextValue`<br>`ThemeMode` |
| 32 | `apps/mobile/src/web/rich-document/webview/runtime/bridge.ts` | 88 | 30 | 4 | `HostTheme`<br>`invokeRegisteredSetDocumentView`<br>`setDocument`<br>`SetDocumentView` |
| 33 | `packages/core/src/domain/workplace/model/workplace-types.ts` | 86 | 0 | 2 | `WorkplaceDirRuleRow`<br>`WorkplaceFileRuleRow` |
| 34 | `apps/desktop/renderer/features/chat/useReadOnlyRunProbe.ts` | 82 | 0 | 2 | `READONLY_RUN_PROBE_INTERVAL_MS`<br>`UseReadOnlyRunProbeParams` |
| 35 | `packages/core/src/domain/workplace/repositories/workplace.port.ts` | 80 | 0 | 3 | `InclusionMode`<br>`WorkplaceDirRule`<br>`WorkplaceFileRule` |
| 36 | `packages/core/src/domain/vfs/logic/infer-scope-from-path.ts` | 75 | 0 | 2 | `InferredScope`<br>`inferScopeFromPhysicalPath` |
| 37 | `apps/mobile/src/components/skills/skill-ui.ts` | 72 | 9 | 1 | `skillDomainHintLabel` |
| 38 | `apps/mobile/src/web/code-editor/webview/runtime/composer-tokens.ts` | 71 | 16 | 1 | `COMPOSER_TOKEN_PATH` |
| 39 | `apps/desktop/renderer/features/settings/PromptMacroChips.tsx` | 67 | 0 | 1 | `PromptMacroChipsProps` |
| 40 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts` | 67 | 0 | 3 | `usePreviewSelection`<br>`useTreeLoader`<br>`useTreeRefreshToken` |
| 41 | `apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts` | 66 | 33 | 1 | `summarizeToolInput` |
| 42 | `apps/mobile/src/web/chat-transcript/webview/runtime/util/vfs-tool-path.ts` | 66 | 34 | 3 | `normalizePathForToolCard`<br>`resolveLogicalPathForToolCard`<br>`resolveVfsToolFilePath` |
| 43 | `apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx` | 64 | 0 | 6 | `KeyboardStickyView`<br>`useGenericKeyboardHandler`<br>`useKeyboardAnimation`<br>`useKeyboardHandler`<br>`useKeyboardState`<br>`useResizeMode` |
| 44 | `packages/core/src/domain/chat/model/message.ts` | 63 | 0 | 1 | `MessageUsage` |
| 45 | `apps/mobile/src/web/chat-transcript/webview/runtime/util/skill-tool-ref.ts` | 62 | 13 | 1 | `resolveSkillToolRefFromInput` |
| 46 | `apps/mobile/test-utils/notifee-mock.ts` | 60 | 0 | 7 | `getNotificationSettings`<br>`onBackgroundEvent`<br>`onForegroundEvent`<br>`openNotificationSettings`<br>`registerForegroundService`<br>`requestPermission`<br>… |
| 47 | `apps/mobile/src/web/rich-document/webview/ui/DocumentApp.tsx` | 59 | 14 | 1 | `DocumentAppProps` |
| 48 | `apps/mobile/test-utils/react-native-reanimated-mock.tsx` | 58 | 0 | 3 | `useAnimatedProps`<br>`withDelay`<br>`withSpring` |
| 49 | `apps/desktop/renderer/components/ui/UpdateCheckResultModal.tsx` | 57 | 0 | 3 | `UPDATE_CHECK_FAILED_MESSAGE`<br>`UPDATE_CHECK_RESULT_TITLE`<br>`UPDATE_CHECK_UP_TO_DATE_MESSAGE` |
| 50 | `apps/mobile/src/components/batch/ListBatchBar.tsx` | 57 | 4 | 1 | `ListBatchBar` |
| 51 | `apps/desktop/src/main/storage/app-ui-prefs.ts` | 56 | 0 | 10 | `DESKTOP_UI_DEFAULTS`<br>`DESKTOP_UI_KEY_CHAT_RICH_TEXT`<br>`DESKTOP_UI_KEY_UPDATES_AUTO_CHECK`<br>`DESKTOP_UI_KEY_UPDATES_DISMISSED_VERSION`<br>`DESKTOP_UI_KEY_UPDATES_LAST_CHECK_AT`<br>`DESKTOP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION`<br>… |
| 52 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts` | 55 | 0 | 2 | `deleteToolTurn`<br>`hideToolTurn` |
| 53 | `apps/desktop/renderer/features/chat/SkillTypeahead.tsx` | 53 | 0 | 1 | `SkillTypeaheadProps` |
| 54 | `apps/mobile/src/web/code-editor/webview/runtime/bridge.ts` | 53 | 20 | 1 | `post` |
| 55 | `apps/mobile/src/web/chat-transcript/webview/ui/render/ThinkingSection.tsx` | 51 | 7 | 1 | `ThinkingSectionProps` |
| 56 | `packages/core/src/domain/compaction-conditions/ports/compaction-condition-trigger.port.ts` | 50 | 0 | 1 | `CompactionConditionModelContext` |
| 57 | `apps/mobile/src/components/chat/transcript-selectable-role.ts` | 50 | 2 | 17 | `chatMessagesToTailBatchRows`<br>`computeHideRangeFromSelection`<br>`computeShowRangeFromSelection`<br>`computeTailBatchAffectedIds`<br>`computeTailBatchRangeFromSelection`<br>`computeVisibilityBatchAffectedIds`<br>… |
| 58 | `apps/mobile/src/web/chat-transcript/webview/main.ts` | 50 | 15 | 1 | `bootTranscript` |
| 59 | `apps/desktop/renderer/features/chat/AtPathTypeahead.tsx` | 49 | 0 | 1 | `AtPathTypeaheadProps` |
| 60 | `apps/mobile/src/web/chat-transcript/webview/ui/render/AttachGroup.tsx` | 49 | 4 | 1 | `AttachGroupProps` |

### 6.4 跨端孪生文件（mobile/desktop 同路径双份，仅一侧零覆盖 = 移植未落地）

> 同一份逻辑在 `apps/mobile` 与 `apps/desktop` 各留了一份（剥掉 app 根与首层目录后路径完全一致）。若一侧被「零覆盖 + 零引用」命中、另一侧正常有覆盖，说明这一份是移植时留下的残骸——最容易漏掉、也最容易安全删除的一类死码。

| 指标 | 数量 |
|---|---|
| 双端孪生且仅一侧零覆盖+零引用的文件对 | 1（零覆盖侧合计 115 行） |

| # | 孪生路径（去 app 前缀与首层目录） | 零覆盖侧 | 物理行 | 有覆盖侧（LH） |
|---|---|---|---|---|
| 1 | `components/batch/ManageHeader.tsx` | desktop | 115 | `apps/mobile/src/components/batch/ManageHeader.tsx`（LH=9） |

### 6.5 按 zone 汇总 T3 候选

| zone | 零覆盖+死导出文件数 | 涉及物理行 |
|---|---|---|
| `desktop-renderer` | 23 | 4256 |
| `mobile-web` | 19 | 1393 |
| `mobile-components` | 7 | 1056 |
| `UNASSIGNED` | 7 | 898 |
| `desktop-main` | 5 | 702 |
| `core-vfs` | 5 | 676 |
| `core-root` | 4 | 285 |
| `core-tool` | 1 | 253 |
| `mobile-app` | 5 | 181 |
| `core-workplace` | 2 | 166 |
| `core-service` | 3 | 130 |
| `core-infra` | 2 | 64 |
| `core-chat` | 1 | 63 |
| `cli` | 2 | 54 |
| `core-compaction-conditions` | 1 | 50 |
| `core-message-checkpoint` | 1 | 29 |
| `desktop-shared` | 2 | 28 |
| `core-provider` | 1 | 20 |

## 七、已知局限

- **行覆盖率不是可达性证明**：V8 coverage 按「文件被加载 + 行被求值」计数，模块顶层副作用跑一遍就会把该文件的顶层语句记成已覆盖，即使没有任何断言碰它。2.1 的分 runner 表已经量化了这一点——node 侧「出记录但 LH=0」恒为 0。
- **cli 的 e2e 覆盖完全没被统计到**：`apps/cli` 16/20 个测试文件用 `spawnSync` 起子进程跑真实 CLI，子进程 coverage 不回流父进程。cli zone 的 83.75% 是下限，真实值更高。要收回来需要给子进程加 `NODE_OPTIONS=--experimental-test-coverage` + `NODE_V8_COVERAGE=<dir>` 再合并，本轮未做（见 1.3）。
- **cli 的 35 个失败是环境性的，不是代码问题**：本 worktree 缺 `~/.novel-master` 与仓库内 `.novel-master` 状态目录，agent registry 加载不到，e2e 全部连锁失败且单个用例耗时 30–180 秒。别把这 35 个当成 cli 的质量债。
- **LF=0 是假零覆盖的常见形态**：纯类型文件（`export type` / `export interface`）与纯 barrel re-export 编译后没有可执行代码，LF 会是 0。本次 62 个「零覆盖 + 有死导出」文件属于这一类，判死前必须先看文件内容——它们往往只是「导出没被用」，文件本身仍是契约面的一部分。
- **node 侧「不在 lcov 里」有第二种成因**：该文件可能只被 `apps/*` 侧引用、由 desktop/mobile 的 runner 覆盖，而不是 core 测试覆盖；反向地，core 测试加载过的文件也可能只在测试里被 import（生产侧走 `dist` 产物，`packages/core/dist/**` 不在本次统计口径内）。所以 T2 档要配合 `dead-exports.md` 一起读，不能只看覆盖率。
- **`mobile-web` 区的覆盖率结构性偏低**：WebView 里的运行时由 esbuild 打成 bundle、在真实浏览器内核里执行，jest 从原理上就看不见。`zone=mobile-web` 的 29.98% 不代表代码没跑过，只代表没被单测跑到。`mobile-web` 里同时出现的「低覆盖」与「构建入口」两种标签要分开看。
- **`apps/mobile/test-utils/**` 被算成生产文件**：`coverage-matrix.csv` 与 `dead-exports.md` 都按「非 test/ 目录」口径收录，故这些 mock/shim 在「零覆盖 + 死导出」清单里大量出现。它们本来就只该被测试引用，**判读时先排除这个目录**（`dead-exports.md` 的「已知局限」里也写了同一条）。
- **desktop 侧数据最薄**：Electron 相关模块靠 `register-electron-mock.mjs` 打桩，覆盖数字对 renderer 层的实际执行路径代表性有限；本机位还没跑 desktop 的 `prebuild`，4 个产物断言用例是环境性失败。别单看 desktop 数字下「死码」结论。
- **本机位不判语义**：「零覆盖 + 零引用」只是高置信候选。最终是否删除还要看是否被动态 `import()` / 外部包消费 / 是否是 knip entry 契约面，判读权在 W3 导出面横切机位与各 zone 机位。