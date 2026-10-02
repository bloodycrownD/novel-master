# CR Round 1 · Wave A 评审报告（cr-wavea）

- **模式**：scope（只读评审，未改任何代码 / spec / git 状态）
- **仓库**：`D:\Dev\nm-worktree\mcr`（branch `feat/repo-mega-cr`）
- **BASE / HEAD**：`fe79b781` / `046f4d9c`
- **本 scope**：`5d6b9661~1 .. c24e8b27`（7 commits，21 files，+480 / −53）
- **业务 spec**：`docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-a.md`（A1–A7 七条）
- **CR fix-spec**：`docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md`（draft，Must-fix 段仍是「首轮评审进行中」占位）
- **评审机位**：Windows / Node v22.22.0 ／ worktree 检出在 HEAD `046f4d9c`（实跑项已注明是 HEAD 口径还是 c24e8b27 口径）

## 0 · 结论速览

| 维度 | 结论 |
|---|---|
| A 对照 spec 验收 | 6/7 条达标；A7（编码批次 1）只落 1/6，其余 5 个文件转 A7b / 后续波次（HEAD 已全清） |
| B 正确性 | 未发现功能缺陷。四条 P0（RT-02 / N-P0-01 / N-P0-02 / N-P0-03）均已实跑验证通过 |
| C 质量 / DRY | 3 处重复或口径描述失真（见 C-1 / C-2 / C-3） |
| C-orch 编排 | 7 commits 切分与 spec 的「可独立落 / 有序 / 跨分片」约束一致，无越界改动 |
| G 测试 | 牙齿齐备（4 条 P0 都有可复现的负向证据）；一处测试强度缺口（G-1） |
| **P0 / P1 / P2** | **0 / 1 / 6** |
| **scope-ready** | **是**（Wave A 可收口；唯一未在本波闭合的 A7 5 个文件已在 HEAD 前清零） |

---

## 1 · Must-fix

### P1

#### WA-P1-01 · `run-tests.mjs` 的 spawn 失败诊断在唯一需要它的分支里不可达

- **文件**：`D:\Dev\nm-worktree\mcr\apps\desktop\scripts\run-tests.mjs`（本 scope 版本 `:42-56`）
- **维度**：B 正确性 / C 质量
- **描述**

  规范 `wave-a.md:481-485` 与风险表 `:590` 把「stdout 超 `maxBuffer` ⇒ `status=null` + 静默截断」
  列为本条**头号风险**，给出的缓解是「错误信息里额外带 `result.error?.code`，让 `ENOBUFS` 这类信号直接可读」。
  实现照抄了这个缓解，但控制流让它变成**死代码**：

  ```js
  process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) {
    process.exit(result.status ?? 1);   // ← status 为 null 时也走这里
  }
  const collected = /^\s*# tests (\d+)$/m.exec(result.stdout ?? "")?.[1];
  if (collected === undefined || Number(collected) === 0) {
    console.error(`... spawnSync error=${result.error?.code ?? "none"} ...`);
  }
  ```

  `spawnSync` 超 `maxBuffer` 时返回 `{status: null, error: ENOBUFS, stdout: 被截断}`。
  `null !== 0` 为真 ⇒ 脚本在守卫之前就 `process.exit(1)` 了，`result.error?.code` **永远不会被打印**。
  净效果是：真实原因（内存上限）+ 被截掉的输出尾部（正是 tap 汇总与失败明细）**双失**，
  开发者只看到一个无解释的 exit 1 —— 比规范担心的「误导性错误信息」更糟（连误导信息都没有）。

  同一模式已被 wave-e H6 复制进通用守卫：`046f4d9c` 的 `run-tests.mjs:60-68`
  仍把 `spawnSync error=${result.error?.code}` 作为 `details` 传给
  `scripts/lib/zero-collect-guard.mjs` 的 `assertNonZeroCollected`，而调用点同样在
  `if (result.status !== 0) process.exit(...)` 之后 ⇒ **同一个洞有两份**。

  > 注：`maxBuffer` 64 MiB vs 实测 219,942 字节（本次全量 desktop 跑），触发概率极低；
  > 且**假绿方向不可达**（脚本只会更早红，不会更绿）。所以定 P1 而不是 P0 ——
  > 它坏的是「坏了之后能不能查」，不是「对不对」。

- **改法**

  把「子进程异常」与「子进程跑挂了」两种非零退出拆开判，并在**截断发生前**把诊断打出来：

  ```js
  process.stdout.write(result.stdout ?? "");
  if (result.error != null) {
    // ENOBUFS / spawn 失败：stdout 已被截断，务必先说清真实原因，
    // 否则下面 status!==0 的分支会带着半截输出 exit 1，把人引向错误的排查方向。
    console.error(
      `[run-tests] 子进程异常：${result.error.code ?? result.error.message}；` +
        `stdout 已截断（上限 ${maxBuffer} 字节），以下输出不完整。` +
        `shell=${process.platform}；testTargets=${testTargets}。`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status);
  }
  ```

  通用版 `assertNonZeroCollected` 同理：让调用方在传 `details` 之前先判 `result.error`，
  或把 `details` 的构造与 `status !== 0` 的早退解耦（wave-e H6 范围内一并收）。

### P2

#### WA-P2-01 · RT-02 的两条新用例都测不出「透传的条数接错口径」

- **文件**：`D:\Dev\nm-worktree\mcr\packages\core\test\agent\agent-runner-compaction.test.ts`（T-RT02-a / T-RT02-b）
- **维度**：G 测试
- **描述**

  两条用例的夹具分别是 `visibleFloor: 999`（恒不触发）与 `visibleFloor: 0`（恒触发），
  都落在阈值的**极端外侧**。这意味着：只要 `visibleMessageCount` 是**任意正数**，
  两条断言都成立 —— 包括「误取 `prepare` 之后的 `visible.length`」（RT-02 规范自己点名的头号陷阱，
  `wave-a.md:79-80`）、「误取 prompt 渲染后的条数」这类语义漂移。

  实跑确认现状是对的（`agent-runner.ts:417` 取在 `:457` 的 prepare 覆盖之前，
  且 `:413`→`:525` 之间只有 `assembleWorkplaceDisplay` / `prepareUserMessagesForPrompt` /
  `buildPromptLlmInputFromLayout` 三个不写 `chat_message` 的步骤），
  但**没有任何一条断言把「条数本身」钉住**，下一次重构把取值点挪错不会被任何用例拦下。

  T-RT02-b 自己的注释其实已经承认了这点（「透传删掉后触发器回落 list() 得到同样的条数，这里不变」），
  但它只声明了「少读一次 ≠ 不读」，没有覆盖「读到了错的数」。

- **改法**

  补一条边界用例，把条数钉在阈值上（同一 `CountingAgentSession` 夹具，只换 `visibleFloor`）：

  ```ts
  // 夹具：session 里恰好 N 条可见消息，visibleFloor 分别取 N 与 N-1
  it("T-RT02-c（口径）：visibleMessageCount 等于可见条数本身（floor=N 不触发 / floor=N-1 触发）", ...)
  ```

  取 `N` 的方式：`await session.list()` 在装配后立刻数一次并把该数字传给
  `realVisibleFloorEvaluator`，再分别用 `N` / `N - 1` 各跑一条 run，断言
  「floor=N ⇒ `runCompaction` 0 次」「floor=N-1 ⇒ 命中」。这样任何把
  `visible.length` 取错位置的改法都会让其中一条红。

#### WA-P2-02 · A-14 新注释里的行号自指失效（同一 commit 自己造成的）

- **文件**：
  - `D:\Dev\nm-worktree\mcr\packages\core\src\domain\tool\builtin\builtin-tool-context.ts:174`、`:179`
  - `D:\Dev\nm-worktree\mcr\packages\core\src\domain\tool\logic\tool-path-policy.ts:13`
- **维度**：C 质量（本仓 RULE 明记「行号类结论一律实测复核」）
- **描述**

  commit `63e6ed55` 新写的注释里引用了三处行号，其中两处在**该 commit 自身落地后就已经偏了**：

  | 注释写的 | c24e8b27 实测 | 偏差成因 |
  |---|---|---|
  | `run-agent-turn.ts:1351` | `:1350` | 同 commit 删掉了它前面 `:994` 的 `resourceQuota` 行 |
  | `tool-path-policy.ts:43` | `:50` | 同 commit 往该文件上方插了 7 行注记 |
  | `run-agent-turn.ts:993` / `create-user-vfs-turn-service.ts:83` | 一致 ✅ | — |
  | `vfs-tools.ts:459`（`glob.options.cwd`）/ `:519`（`grep.options.pathPrefix`） | 一致 ✅ | — |

  这几行注释是「接线前必须先修的三处缺口」的施工清单，是后续 A-14 收尾时唯一会被人读的坐标，
  指向错行会让接线的人去改错地方。

- **改法**：把四处行号一次性校到 `c24e8b27` 的实测值（`:1350` 与 `:50`），
  或更稳妥地改成**符号名锚点**（如「`pathStartsWithPrefix()`（`tool-path-policy.ts`）」）——
  行号在同仓高频改动下必然再次腐烂，符号名不会。

#### WA-P2-03 · A-14 的「三处缺口」清单在两个文件里逐字重复

- **文件**：
  - `D:\Dev\nm-worktree\mcr\packages\core\src\domain\tool\builtin\builtin-tool-context.ts:176-187`
  - `D:\Dev\nm-worktree\mcr\packages\core\src\domain\tool\logic\tool-path-policy.ts:15-18`
- **维度**：C 质量 / DRY
- **描述**

  `tool-path-policy.ts` 的模块头注记把 `①前缀比对不解 ..` / `②PATH_FIELDS 漏两项` /
  `③filePath 无工具声明` 这三条**连同行号**又抄了一遍，只在末尾加了一句「详见 `BuiltinToolContext.allowedPaths` 的字段注释」。
  规范 `wave-a.md:1107` 要求的 A-14 动作是「零行为改动，只补注释」，
  并没有要求两处都写全 —— 写全的代价是**改一处忘一处**（WA-P2-02 正好演示了行号会各自腐烂）。

- **改法**：`tool-path-policy.ts` 保留一句「本模块是 A-14 的实现面，缺口清单见
  `BuiltinToolContext.allowedPaths` 字段注释」即可，三条明细只在字段注释里留一份。

#### WA-P2-04 · `parseAgentId` 与 `parseCreatedProviderId` 的尾行提取逐行重复，且 JSDoc 口径描述不实

- **文件**：`D:\Dev\nm-worktree\mcr\apps\cli\test\helpers.ts:139-156`
- **维度**：C 质量 / DRY
- **描述**

  新增的 `parseAgentId` 里 5 行「split → map(trim) → filter(非空) → at(-1)」与
  `parseCreatedProviderId:128-132` 逐行相同。更要紧的是它的 JSDoc：

  > 口径与 {@link parseCreatedProviderId} 一致：取 stdout 尾行并校验 UUID。

  实际上两者有**两处不一致**：`parseCreatedProviderId` 读的是 **stderr** 且**根本不校验 UUID**
  （它只判空）。这条注释是给未来的人指路的，指错了方向。

- **改法**：抽一个 `lastNonEmptyLine(text: string): string | undefined` 私有函数给两者共用；
  把 `parseAgentId` 的 JSDoc 改成实话（「取 stdout 尾行并校验 UUID 形态；
  `parseCreatedProviderId` 是老口径（读 stderr、不校验形态），两者有意不同」）。

#### WA-P2-05 · `nm agent create` 的 name 回落到 `args[0]`，会把 flag 当成 agent 名

- **文件**：`D:\Dev\nm-worktree\mcr\apps\cli\src\agent\registry-commands.ts:52-55`
- **维度**：B 正确性（低影响）
- **描述**

  ```ts
  const name = flagString(flags, "name") ?? args[0];
  ```

  `--name` 缺省时回落到**原始 args 的第 0 项**，而 `args` 里 flag 本身也在。
  `nm agent create --description "写手" smoke` 会把 agent 命名成 `--description`
  并静默成功（随后 `session create` 照样能开 ⇒ 不报错，只是名字离谱）。
  同样写法在 `show` / `delete` / `import` 三个既有 case 里已存在，属**沿袭既有模式**，
  所以不是新引入的缺陷类别。

- **改法**：`parseCliArgs` 之后从 args 里滤掉以 `-` 开头的项再取首个位置参数
  （或直接用 `parseCliArgs` 已产出的位置参数集合，若它有的话）。
  三个既有 case 一并收，避免只改新增的这一个造成行为不一致。

#### WA-P2-06 · desktop `npm test` 全量 stdout 改内存缓冲，长套件期间零实时输出

- **文件**：`D:\Dev\nm-worktree\mcr\apps\desktop\scripts\run-tests.mjs:46`、`:53`
- **维度**：C 质量（开发体验）
- **描述**

  `stdio` 从 `inherit` 改成 `["inherit", "pipe", "inherit"]` 是零收集守卫的必要代价，
  `wave-a.md:587` 已明确接受。但**实测代价比规范记的更大**：本次全量跑 **37 秒 / 219,942 字节**，
  这 37 秒里终端**一个字都不出**。规范只提了「跑完一次性 `process.stdout.write` 转发」，
  没量化这个静默窗口。另外 reporter 也被顺带改了 —— 改之前子进程继承的是终端（TTY ⇒ `spec` reporter），
  改之后 stdout 是管道（⇒ `tap` reporter），**交互式本地跑的输出格式永久性地从 spec 变成了 TAP**。
  这不是 bug，但没人跟用户说过。

- **改法**：接受缓冲（守卫必需），但在 `spawnSync` 前打一行
  `[run-tests] 跑全量套件，输出将在结束后一次性回放（约 200KB，TAP 格式）`；
  并在 `wave-a.md` / CHANGELOG 里记一句「desktop 本地测试输出格式由 spec 改为 TAP」。

---

## 2 · Open questions（待拍板 / 需补证）

1. **CI typecheck 转 blocking 的跨平台绿**：规范 `wave-a.md:17` 的「全仓 typecheck exit 0」只在
   **Windows 机位**实测过，而 CI `runs-on: ubuntu-latest`。本轮也没在 Linux 上补跑。
   typecheck 从 `continue-on-error` 摘掉的那一刻，任何 Linux-only 的类型问题会直接红 CI。
   要不要在合入前让 Linux 机位补一次 `npm run typecheck --workspaces --if-present`？（本条无可改代码，纯取证。）
2. **`Lint` 步的收口承诺是否已兑现**：commit `b5724046` 在 ci.yml 里写下
   「lint 逐项清账见 wave-e X1 的 lint 批次」，且注释里承诺处置顺序是
   「先清零 27 个 error，再把上限提到实测值」。到 HEAD `046f4d9c` 为止，
   `Lint` 步**仍然**是 `continue-on-error: true`（`ci.yml:69-71`），
   X1 只加了另一条「Lint (blocking: desktop/core/drivers)」（`ci.yml:77-94`）覆盖非 mobile 包。
   ⇒ 这条注释在 HEAD 上是**过期承诺**。是补 mobile 清账，还是把注释改成「X1 已覆盖 15 个包，mobile 仍未收口」？
3. **「我就是想跑 0 条」的心智冲突**：`npm test -- <不存在的路径>` 现在会 exit 1
   （实测确认，node 自身先报 `Could not find ...`，退出码 1）。规范 `:589` 已判为「可接受」。
   本轮无异议，仅登记 —— 若将来有人抱怨「点错了路径报得像测试挂了」，这里是已知解释。
4. **A5.4 ② 的 YAML 形状检查**：规范 `:963-972` 特意警告「cmd 下多行 `node -e` 会被静默丢弃」。
   commit `b5724046` 只改了 yaml，**没有把那条可跑的三 shell 单行命令固化成任何脚本或注释**。
   要不要把它落成 `scripts/check-ci-gates.mjs`（与 wave-e 的 `check-encoding.mjs` 同族），
   免得下一个改 ci.yml 的人重新踩这个坑？

---

## 3 · Spec deviations

| # | 条目 | 规范要求 | 实际落地 | 判定 |
|---|---|---|---|---|
| D1 | **A7 编码批次 1** | `wave-a.md:1327` 「可落的 6 个文件」 | **只落 1 个**（`packages/core/test/chat/message-body-text.test.ts`）。其余 5 个在 c24e8b27 仍是坏的：实测 `session-prompt-input.service.ts` = **INVALID UTF-8 / 178 处 U+FFFD**、`vfs.ts` 2、`tool-definitions.ts` 1、`agent-runner.test.ts` 64、`openai-content-mapper.test.ts` 4 | **有意延期，非缺陷**。commit `c24e8b27` 的 message 明写「余 5 文件转 A7b 逐处替换」；实测 HEAD `046f4d9c` 上 `git ls-files` 全仓扫描只剩 `docs/.../prd.md`（规范 Step 5 已明确排除的文档面）⇒ **5 个文件已在后续波次闭合**。留痕即可，无需返工 |
| D2 | **A6 ①b 删除面** | `wave-a.md:1188` 期望 `builtin-tool-context.ts` **净 −14** | 实测 `+14 / −20` ＝ **净 −6** | **断言按字面会红，但意图达成**。多出的 14 行全是新增 JSDoc（`builtin-tool-context.ts:176-187` + `:164-175` 改写）；删除面仍精确对齐（`ToolResourceQuota` 接口 12 行 + `resourceQuota` 字段 4 行 = 16，另 2 行是被并入的旧 JSDoc）。**问题在规范的算式**：它写「接口 12 + 字段 2 + JSDoc 归并 = 14」，但字段块实测是 4 行不是 2 行，而净行数又被新增注释抵消 ⇒ 该条断言本身不自洽。建议规范侧改成「删除面 16 行 / 新增注释行数不限」 |
| D3 | **A3 零收集守卫正则** | `wave-a.md:503` 写 `/^# tests (\d+)$/m` | 实现用 `/^\s*# tests (\d+)$/m` | **良性放宽**。规范自己的风险表 `:588` 就建议过「若 banner 污染行首，`^` 换成 `^\s*# tests`」。实测 Windows 上能匹配（desktop 全量跑 `# tests 660` 被正确识别、guard 未误触发） |
| D4 | **A4 Step 3 空态文案** | `wave-a.md:739-742` 描述为「追加一句 `or: nm agent create --name <name>`」 | 实现合并成一行输出：`"No agents in registry. Run: nm agent import <path>, or: nm agent create --name <name>"` | **文案等价，无功能差异**。仅记录 |
| D5 | **A1.2「明确不做」四条** | 不给 `AgentSession` 加接口 / 不加 memo / 不碰 `chat-agent-session.ts` / 不动 `CompositeConditionTrigger` 与 `TokenRatioConditionTrigger` | 逐条核对 diff：**全部遵守**，四个文件之外的 compaction-conditions 源码零改动 | ✅ 无偏差 |

**验收面实跑结果**（本轮亲自跑，非照抄 commit message）：

| 规范验收项 | 命令 | 结果 |
|---|---|---|
| A1.3 ① 四个 compaction-conditions 回归 | `npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/compaction-conditions/{run-compaction,compaction-conditions-store.service,compaction-conditions-v3-migration,token-ratio-trigger}.test.ts` | `# tests 22 / # pass 22 / # fail 0` ✅ |
| A1.3 ② RT-02 牙齿 | 同上 `--test test/agent/agent-runner-compaction.test.ts` | `# tests 3 / # pass 3 / # fail 0` ✅ |
| A2.3 ③ 白名单等价断言 | `cd apps\mobile && npx jest __tests__/prompt-macro-input.test.ts --maxWorkers=1` | `14 passed / 14 total` ✅（含新增的「白名单与 core 单源一致」） |
| A2.2 Step 2「composer-input 不再拖 core」 | `git grep -n '@novel-master/core' c24e8b27 -- apps/mobile/src/web/composer-input` | **零命中** ✅（门 B 白名单 = 空数组，与规范 `wave-a.md:400-403` 的终值一致） |
| A3.3 ① 收集数 > 0 | `cd apps\desktop && node scripts/run-tests.mjs` | 37s，`# tests 660 / # pass 658 / # fail 2`，219,942 字节，**假绿已根除** ✅<br>（注：这是 **HEAD** 口径；2 条 fail 来自后续波次引入的用例，与 Wave A 无关） |
| A3.3 ① 单文件不被守卫误伤 | `node scripts/run-tests.mjs test/vfs-delete-handler.test.ts` | **exit 0** ✅（证明 `^\s*# tests` 正则在 Windows 上确实匹配） |
| A3.3 ③ 退出码透传 | `node scripts/run-tests.mjs test/zzz-nonexistent.test.ts` | **exit 1** ✅（node 自身报错，退出码透传未被守卫吞掉） |
| A4.3 ①③ 三条 e2e | `cd apps\cli && npx tsx --test test/agent-registry-e2e.test.ts` | `ok 6/7/8` 三条新用例全绿 ✅；唯一 fail 是**既有**的 `E3: compaction-conditions set and show`（存量红，非本波引入） |
| A6.3 ② `resourceQuota` 清零 | `git grep -n "resourceQuota" c24e8b27 -- packages apps` | **零命中** ✅ |
| A6.3 ③ 闸门语义未变 | `--test test/tool/{tool-runner-path-policy,tool-runner}.test.ts` | `# tests 20 / # pass 20 / # fail 0` ✅ |
| A7.3 ② 严格 UTF-8（本波动的 1 个文件） | 字节级 `TextDecoder(fatal:true)` @ c24e8b27 | `message-body-text.test.ts` = **VALID / fffd=0** ✅（用例名与规范 `wave-a.md:1352` 的三条正确形态逐字一致） |

---

## 4 · fix-spec 可执行性

`docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md` 当前 752 字节、
状态 `draft`、Must-fix 段是「（首轮评审进行中）」占位 ⇒ **本轮结束时它还不是可执行文档**。
以下是把本报告的 7 条 must-fix 灌进去时必须注意的**可执行性约束**：

1. **P0 为空、只有 1 条 P1 + 6 条 P2** ⇒ 灌进去后整体是「低风险收口批」，
   不该被排到 Wave A 前面抢跑；建议**排在 Wave A 之后、Wave B 之前的独立 fix 批**。
2. **WA-P1-01 是唯一需要动控制流的一条**，且它的两个落点跨波
   （`apps/desktop/scripts/run-tests.mjs` 是 Wave A 的，
   `scripts/lib/zero-collect-guard.mjs` 是 wave-e H6 的）。
   若 fix 批在 Wave E 之前执行，`lib/zero-collect-guard.mjs` 尚不存在 ⇒ **只能改一半**。
   ⇒ 要么把 WA-P1-01 拆成 `WA-P1-01a`（desktop 脚本）与 `WA-P1-01b`（通用守卫，挂 wave-e 之后），
   要么把整条 fix 批排到 Wave E 之后。**建议拆**，否则会出现「一个洞修一半」的中间态。
3. **WA-P2-01 必须带上 T-RT02-c 的完整夹具**（`CountingAgentSession` + `realVisibleFloorEvaluator`
   已在 `agent-runner-compaction.test.ts:250-282`，新用例直接复用即可，不要另造），
   否则执行者会重写一套装配并重新踩「stub evaluator 无牙」的坑（规范 `wave-a.md:157-165` 的硬约束）。
4. **WA-P2-02 的「改法」不要写成「把行号校到当前值」** —— 那等于给同一颗定时炸弹续命。
   fix-spec 里应直接写死「改成符号名锚点」，否则下一波 Wave A~E 的改动又会把它冲歪。
5. **WA-P2-04 / WA-P2-05 / WA-P2-06 都不该阻塞合入**：P2-04 是测试 helper 的整洁度、
   P2-05 是沿袭既有模式且无数据损坏、P2-06 是规范已接受的开发体验代价。
   建议在 fix-spec 里标为「follow-up，不进本批」。
6. **规范侧要同步修的两处**（属 `spec_deviations` D2 / Open question 1、2），
   不应塞进本轮 fix-spec 的 Must-fix —— 它们是**规范文本缺陷**，
   要么改 `wave-a.md` 的算式，要么补一次 Linux 机位取证。
7. 本轮**没有**发现「规范自相矛盾到无法执行」的项（原 wave-a.md 修订已把
   A6 ①a/①b 拆开、A4 验收脚本的 `先建 project` 前置写死，这两处在本轮实施中都确实被执行了）。

---

## 5 · 逐条小结（七条 Wave A 条目）

| 条目 | 严重度 | 落地 | 实跑 | 遗留 |
|---|---|---|---|---|
| **A1 / RT-02** runner 每 step 双重全量读合一 | P0 | ✅ 四处（port 增可选字段 / trigger 复用 / runner 取数 / evaluation 透传），**严格等价变换成立**（`:413`→`:525` 之间三步均不写 `chat_message`） | ✅ 3/3 绿 | WA-P2-01（测试强度） |
| **A2 / N-P0-01** composer-input 白屏 | P0 | ✅ 单文件内联 + 等价断言；`src/web/composer-input` 对 `@novel-master/core` **零命中** | ✅ 14/14 绿 | 无（wave-e X3 门 B 归后续波） |
| **A3 / N-P0-02** Windows 假绿 | P0 | ✅ 双引号 glob + `spawnSync` + 零收集守卫 + `maxBuffer` 放大 | ✅ exit 0 / exit 1 / 660 收集 三项全对 | WA-P1-01、WA-P2-06 |
| **A4 / N-P0-03** CLI 开不了第一个会话 + stdout 污染 | P0 | ✅ `nm agent create`（含 usage / 转发 / 空态文案三处文案）+ `[nm-boot]` 三处改 stderr + `parseAgentId` | ✅ 3 条新 e2e 全绿 | WA-P2-04、WA-P2-05 |
| **A5 / CI** typecheck 转 blocking | P0 门禁面 | ✅ 摘掉 `continue-on-error` + mobile lint 失效差距入注释 | 未跑 Linux typecheck | Open question 1、2 |
| **A6 / A-14** intentional + `resourceQuota` 清账 + search 死路径注记 | — | ✅ 接口/字段/3 处赋值/1 处导出全删；闸门装配点与 policy 调用**零改动**；search 侧只加注释 | ✅ `resourceQuota` 零命中、闸门 20/20 绿 | WA-P2-02、WA-P2-03；D2 |
| **A7 / 编码批次 1** | P2 | ⚠️ **1/6**（`message-body-text.test.ts` ✅） | 该文件 VALID / fffd=0 ✅ | D1（HEAD 已闭合） |

---

## 6 · scope-ready

**是。**

- Wave A 的**四条 P0 全部落地且被本轮实跑证据正面验证**（RT-02 3/3、mobile 14/14、desktop 收集 660 且退出码语义正确、CLI 3 条新 e2e 全绿），未发现任何功能缺陷或假绿残留。
- 七条条目里只有 A7 部分落地，且是**有记录的、有意的**延期，5 个文件在 HEAD 前已清零（实测全仓扫描仅剩规范明确排除的文档面文件）。
- 遗留 7 条 must-fix 中 6 条 P2、1 条 P1，**全部不阻塞 Wave A 收口**；其中 WA-P1-01 需要拆成两批以避开 wave-e 的 `zero-collect-guard.mjs` 依赖（见 §4 第 2 条）。
- 建议动作：**Wave A 结项**，把本报告的 must-fix 灌进 `cr-fix-spec.md`（状态从 `draft` 转可执行），
  排成 Wave A 之后的独立 fix 批；同时把 §3 的 D2 与 §2 的两条取证项回写进 `wave-a.md`。
