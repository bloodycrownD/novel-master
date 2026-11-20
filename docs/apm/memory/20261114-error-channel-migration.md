---
date: 2026-11-20
title: 错误通道迁移：总纲 + 一期 spec（errors/ 收敛）
keywords: Either, Result, Outcome, Interrupt, AppError, 错误通道, 错误码表, Error 子类, 错误工厂, format-ipc-error, spec-generate, 分期迁移
abstract: 错误通道迁移全记录：一期定四类型（Outcome/Interrupt/AppError/Result）与总纲，历期推进至 p26——throw-audit 四形态工具化进 nm-style、门⑦ 18 处定性修复（mobile 读链 Result 化 + 总纲 §五例外 7 边界转码登记）、drivers 92 条 signatures 机械清、IntegrityRepairOperation 接口 Result 化（例外 6 退役）。tag p26-throw-audit。
---

# 错误通道迁移

user:
先问「`compactionConditionsInvalidSchema`、`skillInvalidName` 这类错误工厂函数意义不大且丑」，随后澄清真实意图是「清理剩下 `PromptError extends Error` 这种 error 架构，Either 迁移已执行一部分、可以整体迁移」，并追问 AppError 的封装有没有更好的方案（内部封装 / 类内静态方法 / 总之收敛）。

讨论了多轮控制流语义：用户以 Java 工程师视角追问「一个流程控制为什么要 throw？正常 return 不就行吗？」，并指出 Java 的 `InterruptedException` 之所以 throw 是因为它可能出现在线程当前执行的任何函数上、自己控制不了；而我们的检查点是自己主动请求，属于「已知」，按他的原则「未知 throw 合法、已知应该 Either」。最终拍板 **全量 Either 化**，并倾向 `Either<Signal, AppError>` 这种「控制流不是错误」的表达。

设计收敛过程：我先提出三态（ok/signal/error），用户追问「成功不也是一个信号吗」，于是定为**四分支平级的 `Outcome<T>`**（completed/cancelled/replaced/failed），`checkpoint()` 返回更窄的 `Interrupt | null`。

用户要求「先有一个总纲，再进行 error-channel-slim 的设计，确保整个流程不会偏移」，并让我把五期合并成三期、给出每期改动量级预估。

**探索结论（3 个 readonly 子代理，实测数字，推翻此前口径）**：
- `packages/core/src/errors` 15 文件 1430 行：**8 个 `extends Error` 类**（不是 29）、**39 个工厂且纯转发仅 4 个**（不是 38）、6 个守卫、2 个文案 builder
- 全仓 32 个自定义 Error 类（errors/ 8 + core 其余 15 + 跨包 3 + apps 6）
- 约 875 处 `throw`（core/service 261、core/domain 211、core/infra 100、apps 约 285）
- 约 217 个文件提到 `Result`，50 个直接 import `errors/either`
- **`Result.attempt*` / `revive` 零生产调用**；边界 `if (!r.ok) throw r.error` 生产接线仅 2 处
- 三套失败通道并存：core `Result`（domain 74 文件）、app `IpcResult` 裸对象（desktop 30 文件）、纯 `throw`（service/cli）；CLI 完全不用 core `Result`
- `isVfsError`/`isSessionFsError` 刻意用 `name + code` 结构判别（src/dist 双实例），不能改 instanceof
- 6 个零调用死码：`vfsInvalidName`、`sessionFsRestoreRevisionMissing`、`isRollbackConflictError`、`sessionFsRollbackNoCheckpoint`、`formatRollbackRevisionBackfillAlertMessage`、`vfsReplaceNotFound`

**落盘产物**：
- `docs/iterations/error-channel-migration/strategy.md`（总纲）：第一原则「已知走返回值，未知走 throw」+ 三问判定树、四类型职责边界、通道转码矩阵、平台例外四处（fetch abort / better-sqlite3 事务回滚 / Promise.race reject / AbortSignal.throwIfAborted）、三期路线、验收不变量、风险表
- `docs/iterations/error-channel-migration/spec.md`（一期）：新增 `errors/outcome.ts`（Outcome/Interrupt + 组合子）、`AppError.details` 泛型化、删 6 死码、内联 3 个低频纯转发（保留高频 `chatInvalidArgument` 26 调用）、7 个类迁 AppError（40-52 个新码）、instanceof → isAppError、双端三条格式化链适配；11 个 Step、16 条 T 用例

**三期量级预估**：一期 60-70 文件 / 750-900 行；二期 180-220 文件 / 1500-1800 行；三期 140-160 文件 / 1100-1400 行。

**后续修正（同一轮对话内）**：
- 工厂函数方案被用户连纠三次：① 我先写成「全部保留」→ ② 改成「升静态方法 / 降私有 / 内联」三分类 → ③ 用户第三次指出「我是让你处理函数，是处理那些有复用 message 模版的情况」。最终定为：**message 模板搬进码表（`{ code, desc, messageKey }`）+ `ErrorParamsMap` 参数类型表 + `AppError` 构造器 `(key, params?, options?)`，39 个工厂与 7 个 per-domain 子类全部退役**，`errors/` 从 15 文件降到 5 文件。依据是 nm-code-style §3 第 45 条「只有 `new XxxError` 的 wrapper 直接删」。
- 用户纠正 `throw new AppError(...)` 样例：「either 啊」——终态是 `return Result.err(...)` / `Outcome.failed(...)`，`throw` 只在边界。一期因此明确**只改「错误怎么造」，不改「怎么传播」**。
- 用户指出「一期 errors/、二期 core、三期 apps」是**分步不是分期，容易迁不干净**，要求把剩下两期 spec 也产出。回应：保留按层切（`errors/` 是公共依赖，按模块切会让码表与 public 面被三期反复改），但补三条**机械 grep 门**作为防遗漏保障——一期后 `src/errors` 不得再有 `class .* extends Error` 与转发工厂；二期后 core 的 `throw new AppError` 只允许白名单文件；三期后全仓只允许白名单。验收按文件清单锁，不按处数。

**补充探索（二期 / 三期，2 个 readonly 子代理）**：
- 二期 core：592 处 throw（service 264/37、infra 100/31、domain 228/52）；45 个 domain 文件已返回 Result、172 处 `Result.err(new AppError)`、零自定义 Error 构造；`if (!x.ok) throw x.error` 103 处（事务内 26 处必须保留）；编程错误 11 处、平台边界约 90、控制流 10 处 + **7 处「取消伪装成 toolFailed」**；无 AbortScope（signal-abort-scope 未落地）；core 测试 441 文件、136 文件 / 536 处 throws/rejects 断言。
- 三期 apps：`IpcResult` 是裸对象（`data`/`error`），改成 core `Result` 会打断 63 文件，定死**线格式不变、只改 `error.code` 取值空间为 AppError key**；`AppErrorWire` 只有生产端零消费端；`Result`/`Outcome` 完全不在 public 面，三期首次新增 `./errors` 子路径；public 41 符号 = 11 有生产消费者 / 3 仅测试 / 27 零消费者；desktop 65 throw/210 catch/13 instanceof、mobile 120/377/19、cli 134/9/17 且只有两档 exit code；双端 17 对镜像 service，`format-error` 与 `format-ipc-error` 已漂移（mobile 有 ProviderError 硬编码中文、desktop 有 Zod 与 VFS 兼容映射）。

**落盘产物（4 份）**：
- `docs/iterations/error-channel-migration/strategy.md`（总纲 + 期次口径 + 三条 grep 门）
- `docs/iterations/error-channel-migration/spec.md`（一期：11 Step、20 条 T 用例）
- `docs/iterations/error-channel-migration/spec-2-core.md`（二期：9 Step、8 条 T 用例）
- `docs/iterations/error-channel-migration/spec-3-apps.md`（三期：8 Step、9 条 T 用例）

状态：四份文档已落盘，**待用户确认**。一期量级 80-90 文件 / 1000-1200 行；二期 180-220 / 1500-1800；三期 140-160 / 1100-1400。

**三轮 spec-check-loop（2026-11-14，额度用满）**：

用户要求「至多三次」loop。每轮都是 1 个全局 judge + 3 个模块审查者互盲，轮后主代理直接 doc-fix，不派修复子代理。

- **第 1 轮**：全局 No-Go + 三模块全 ready: no，去重约 16 条 P0 → 一期/二期/三期 spec **全部重写**。主线问题：一期 messageKey 未同步 i18n（`keys.ts` 封闭联合 + 双 catalog 双向覆盖锁）、`messageParams` camelCase/snake_case 冲突、`firstDescriptorOf` 不可实现、7 类退役后结构守卫无生产者；二期「工具取消改 `Outcome.cancelled`」与「保留 ToolError 并发协议」自相矛盾、`legacy-vfs-error` 波及面漏列（实为 6 文件约 50 处）、cloud-sync 改 Result 与 apps 消费面断层；三期迁码表不全（handler 直构漏 6 处）、`CloudSyncError` 无改码机制、锁测试指错文件（真正的门是 `public-subpath-allowlist.test.ts` + 16 个快照，不是 `package-exports-t0`）、分派链 3/4 步互斥致 `PROVIDER_*` 不可达。
- **第 2 轮**：二期 ready: yes；全局 No-Go、一期/三期 no。关键修复：一期 A1「`Error.message` 的 descriptor 命中时必须取英文 `desc`，不能塞 `descriptor.key`」（否则 7 个 skill 工厂迁移后 message 变 key 原文）、A2「catalog 既有占位符随字段名改 snake_case + T-K1 增占位符⊆字段名断言」、A3「`ErrorParams` 增可选 `descriptor?: CoreMessageDescriptor` 通道」；三期补 handler 4 处、`CloudSyncError` 39 处清扫面、grep 门②③可执行化。
- **第 3 轮（终态）**：全局 **Go**、二期 **yes**、一期/三期各剩 3 条行级残留（风险表 message 顺序与正文互斥、守卫计数 4→3、`format-vfs-error-for-llm` 动作张冠李戴、`cloud-sync-driver-s3` 6 处实构漏列、grep 门③ 的 `physical.ts:87` 无主、`isSessionFsError`「apps 已实证」断言为假）。全部一次性修完，四份文档现无待修项。

**四条教训**：
1. 写迁移 spec 不能只写「改什么」，必须写「**谁生产、谁消费、消费形态**」——legacy mapper 与结构守卫的闭环、`CloudSyncError` 的跨端消费面，都是靠这条挖出来的。
2. 「码表只动一次」要精确到「**结构**只动一次、**条目**可各期追加」，否则一期写不出二/三期的码（`TOOL_CANCELLED`、`CLOUD_SYNC_*`）。
3. 数字类验收（处数、文件数）必然漂移，全部改为「按文件清单锁 + 处数只作参考」；但 grep 门本身必须**可执行**（限定路径、给白名单），否则门永红。
4. 审查者说「当前代码不存在 X」时要区分**规划缺陷**与**交接前提**——一期/二期是规划文档，三期审查报的 P0-N4（`outcome.ts` 不存在）就是这类误判；判断前先读相邻期的认领段。

**进入一期开发（2026-11-14）**：

- 用户就 `VfsError` 类型别名去留选 **A：不保留**。理由写进 spec：留 `type VfsError = AppError` 会让「类已退役」在类型层面看不出来，实施 agent 继续写 `VfsError` 编译器不拦；因此直接把 `format-vfs-error-for-llm.ts` 的 `VfsError | AppError` 收窄成 `AppError`，两个调用方同波改判。`VfsErrorCode` / `VfsErrorKey` 是字符串短码联合，不是类类型，保留。
- worktree：`D:\worktree\error-channel-slim`，分支 `feat/error-channel-slim`，基线 `6575b46c2`（文档提交）。
- **worktree 要先全量 build 一次**：core 的 `types` 指向 `dist/index.d.ts`，apps 通过 dist 消费 core 类型；只 `npm ci` 不 build 会让根 typecheck 在 apps/cli、apps/desktop 处红（core 自身 typecheck 却是绿的，容易误判成代码改错）。`npm run build` 全量 59s，之后根 typecheck 31s。
- 动态工作流 `dwfrun-5e952db6-fd07-4a78-b2c0-2475bee0d024`：12 个 impl 节点一一对应 spec 的 12 个 Step（串行，因每个 Step 结束都要求全仓 tsc 绿），每个节点交卷后由流程自己跑 `core build + 根 typecheck` 作为确定性门，红则同 agent 重试最多 3 轮；4 个只读 cr-func 节点（Step 1-2 / 3-4 / 5-8 / 整体）。提速用的关键形态：`world.run("cmd", ["/c", "npm", "run", "--prefix", <abs>", "typecheck"])`——npm 的 `--prefix` 会 chdir，绕开 workflow 固定 cwd 的限制。

**工作流 v1 → v2（并发调整）**：v1 把 12 个 Step 排成纯串行链（峰值并发 1），用户当即指出并发太低。根因是我把「每个 Step 结束都要全仓 tsc 绿」当成硬约束——但那只是串行才需要的；并行波只要**文件集不相交 + 波末统一收敛**，中间态红是允许的。v2 重排为 6 个波次：① Step 1 ∥ Step 2（outcome.ts 与码表零交集）② Step 3+4 合一（共享 kkv/preferences/compaction errors）③ **Step 5 ∥ 6 ∥ 7 ∥ 8**（四个域各碰自己的 errors 与调用点，`public/*.ts` 从波内剥离）④ public 重导出清理 + 波末收敛（四个 agent 会抢 `public/vfs.ts`，只能集中做）⑤ Step 9+10 合一（共享 format-ipc-error.ts）⑥ Step 11+12。峰值并发从 1 提到 4。并行波内明确禁止 agent 跑 build、跑根 typecheck、git commit、改 public/。

**并行波的文件所有权裁决**（Step 6 实现者 escalation 触发）：v2 脚本给并行波下的纪律「不要动 packages/core/src/public/ 下任何文件」过粗，实际删类时 `public/prompt.ts` 的重导出必然红。正确口径是按**独占 vs 共享**分：

- **独占文件可以自己摘**：`public/prompt.ts` 只有 Step 6 碰、`public/provider.ts` 只有 Step 8 碰、`public/chat.ts` 只有 Step 5 碰 —— 各自动手，否则自检永远绿不了。
- **共享文件必须留到波末**：`src/index.ts` 被四路同时改（Step 5 删 ChatError、Step 7 删 VfsError、Step 8 删 ProviderError 的导出都在同一文件），并行写会互相覆盖丢改动；`public/vfs.ts` 同时导出 VfsError（Step 7）与 VfsZipError（Step 8），同理。
- **自检判据**：`npm run --prefix packages/core typecheck` 后只看**不在 `src/index.ts` 里**的 error TS，剩下那些是波内预期红，不算实施者责任。

教训：并行波的纪律不能只写「禁止改某目录」，要按文件所有权枚举——写「禁止改共享文件，独占文件自行处理」并点出具体清单。

**一期工作流实跑结果与验证（2026-11-15 复核）**：`dwfrun-ddc8e02f` 跑满 5h29m / 50 步 / 1.82 亿 token，四个 cr-func 全判未通过，但**报告基于中间态**——它审的是 `e0f9b411a`（Step 5-8 四路刚合流），那时 118 条测试红是真的；Step 9-10 的 47 个未提交改动把这些都修了。主代理亲自复验的真实状态：根 typecheck exit=0，core 3428 用例全绿、desktop 739 绿、mobile 2366 绿、cli 76/24 与 main 基线一字不差。

**一条 cr-func 没抓到、主代理抓到的真回归**：cli 比基线多 1 条失败（`rejects enabled conditions with no triggers`），根因是 `CONFIG_DECODE_INVALID_SCHEMA` 的 zod 细节被塞进 `params.detail` 而 catalog 模板没有 `{detail}` 占位符——信息在迁移中静默丢失。修法：zh-CN/en-US 两条模板加占位符后重生成 catalog。**教训：错误迁移里「params 有字段但模板没占位符」是一类系统性静默缺陷，必须专项审计**（已作为一个独立审计节点放进收尾工作流）。另注意 YAML 里值是 `...: {detail}` 形态必须加引号，否则被当 flow mapping 解析炸掉；zh-CN 因为用全角 `：` 不触发。

**一期剩余真实缺口**：`AppError` 旧签名重载仍在、71 处旧签名调用（27 个文件，最大 `rule-snapshot-codec.ts` 7 处）、spec 的 grep 门写法会误命中 `K extends ErrorKey`。收尾工作流 `dwfrun-0ed17c1b` 按 4 个不相交文件分区并行改写 → 删旧重载 → 全量测试 → 占位符审计 → grep 门修正 + tag `p1-errors-slim`。

**二期/三期拓扑（读 spec 确认）**：二期 Step 3-7 spec 明写「文件集不相交可并行波」，Step 1（两哨兵改 Interrupt + core 3 处 + apps 4 处 catch + public 导出联动）必须先做；三期依赖 1→2→3→4→5→6→7→8，但 Step 2/3/4/5 分属 desktop 服务、mobile 格式化、mobile 服务、cli，三端代码树独立，可在 Step 1 之后四路并行；Step 6 依赖 1-5 全部（public 撤导出需 apps 已改认 key）。

## 六期收口（2026-11-16）：nm style 全量 + 三端测试修红，tag `p6-nm-style`

**终态（全部主代理实跑复核）**：`HEAD eecff1b29`，工作树 0 未提交。desktop 739/739/0、mobile 266 suites/2362 tests 全绿、cli 117/93/0/24skip（与主干基线一致）、根 typecheck 15 workspace exit 0、core 575/575/0。`check-signatures` **744 → 0（PASS）**、`check-inline` 195 → 28、`check-methods` 132 → 21。上一轮累计：`throw x.error` 344 → 0、`throw new AppError` 171 → 47（剩不变量/事务/控制信号三类合法保留）。

**nm style 基线与拆法**：`check-style --all` 在 616 个 src 文件上报 signatures 744 / inline 195 / methods 132 阻断。拆到标签是 PARAMS 293、ARGS 265、VARDECL 179、INLINE_LOCAL 163、INLINE_METHOD 96。这批主要是错误通道迁移过程中把 `Promise<Result<T, AppError>>` 签名和调用拆成多行写出来的，不是主干存量（命中最多的十个文件全是本轮改过的大文件）。

**分片三次翻车、三种不同原因**：
1. **slice 截断**（dwfrun-30515274 桶B 六片 / 测试修六片）：把一份 12000/9000 字符的探针输出 `slice(0, N)` 喂给多个 agent，清单在中间被切断，六个 agent 抢同一批文件。靠 agent escalate 才发现。
2. **目录包含关系**（dwfrun-907a2830）：`service/chat`、`service/chat/impl`、`service` 三个片范围互相包含，`service` 那片会重做前六片的活。补 `scope` 排他字段后修好。
3. **目录枚举漏项**（dwfrun-d04a918c）：15 片清单只列了 `service/{5 子目录+其余}` + `infra` + `domain` + `common` + 三端，**漏了 `core/src/bootstrap`（58 signatures + 12 inline）、`core/src/errors`（17）、`core/src/i18n`**。补完轮才收掉。

**教训：派分片必须给「按片切好的确定清单」，不能给「一份全文让 agent 自己挑」；目录分片必须显式写排除规则；清单要按 `ls` 枚举而不能凭记忆列。**

**`prettier --write --print-width 200` 与 check-signatures 直接冲突**：对全仓跑让 signatures 从 0 反弹到 148（`git restore .` 回滚后复验回 0）。prettier 会把超长签名/调用拆成多行，而 check-signatures 要求一行写完。**signatures 已 PASS 的仓库不要再跑全局 prettier。**

**六期打坏 122 个 apps 测试，三类根因**：
1. **dist 不同步（最隐蔽）**：`packages/tokenizer-driver-node/dist` 停在 Result 化之前（01:38 构建 vs 源码 `b55be6aaa` 09:38），旧 dist 返裸值、core dist 按 `.ok` 判 → `local.ok === undefined` → 本地精确计数全线判失败 → compaction T-IPC2、chat-prompt-tokens T-T9b/T-T9b2/T-T9b3/T-T9c、usage-stats IPC 15 条全红。主代理重建该包 dist 后转绿，测试与源码零改动。**dist 是 gitignore 的构建产物，git 干净 ≠ 运行时一致；core 测试直读 src、apps 测试走 workspace 解析到 dist，两边看到的世界不一样。**
2. **测试替身没跟 Result 契约**（大头）：mock 还 `mockResolvedValue(undefined)` 而端口已返 `Result`。改 mock，测试文件零改动、断言强度原样。
3. **源码文本断言被 nm style 打断**：`expect(src).toMatch(/export type .../)` 这类，源码被内联/并行/假公开审计改了形态后正则失效。按「改断言匹配新形态、不回退源码」处理。

**mobile 全量高并发会产生超时假红**：8 worker 下首跑报 111 红，其中 12 个 suite 是 5 秒超时、单跑全绿；`--maxWorkers=2` 复跑真实红只有 20 个。**判红前先降并发复跑。**

**剩余 28 + 21 处是规则冲突不是活**：inline 28 里 26 处带 `KEEP_LOCAL`，另 2 处（`isVfsError`、`deliverNativeChunk`）是 check-signatures 与 check-inline 互相矛盾（要一行就得提取具名函数，提取后 inline 又要求内联回去）；methods 21 里 12 处是 `errors/either.ts` 的 `Ok`/`Err` 跨类同名 `DEAD_METHOD` 误判（动它就拆 Result 运行时），剩 9 处是接口实现、`AppError.toJSON` 序列化钩子、120 次调用的公开方法。**要让这两段 PASS 得改 check-style 判据（接口实现/序列化钩子/导出 API/规则冲突四项豁免），不是在代码里加注释。**

**关掉的两条规则**：`AMBIGUOUS_METHOD`（221 条，同名多定义）不计阻断；`DEAD`（215 条）大量假阳性——`core/domain` 106 条里只 2 条真死（`VfsPortError` 整文件、`createRevisionRefCountRepairOperation`），其余是只在类型位置被引用或测试契约常量。

## 七期～B 收官（2026-11-17）：四轮工作流 + 一次 spec 合规审查

**七期 `p7-error-debt`**（`3df20fb4c`）：`common/assert.ts` 建立（`AssertionError`/`assert`/`assertNever`），**9 处** `*_INVARIANT_VIOLATION`（core 8 + mobile `rn-file-io.ts:44`）改 assert，四个码退役；工具取消 11 处构造点里 4 处 `throw` 改 `return Result.err(TOOL_CANCELLED)`、`curl-tool` 的 `phaseError` 两调用点同批改、`TOOL_CANCELLED` **码保留作展示标签**（它有 messageKey + i18n + LLM 可见文案 + CLI exit 130 的完整展示契约）；30 处业务失败改 `Result.err`；`errors/vfs-errors.ts` + `session-fs-errors.ts` 合并进 `guards.ts`，`errors/` 8→6 文件。三个 grep 闸全 0。

**八期 `abort-scope`**（`a97fafdc4`）：`domain/abort` 六个文件从零建（`abort-scope`/`abort-key`/`create-abort-scope`/`create-abort-error`/`create-abort-registry`/`abort-registry.port`）+ `public/abort.ts` barrel；`checkpoint(): Interrupt | null`；core 四个 port 换 `scope`；`tool-runner` 竞速走 `signalView(...).race(...)`；repository 六个 mapRows 读口 + batchInsert 返回 `Outcome`；桌面 6 类 handler 走 `createAbortScope + matchOutcome` 三分派；移动 4 类 service + CloudSyncCoordinator 阶段边界；native request 加 `requestId` 走 OkHttp `Call.cancel()` 真断连。三端 739→757 / 2362→2372 / core 3485 全绿。

**九期 `p9-bare-throw`**（`f3cf8eeb7`）：**裸 `throw new Error` 是前三轮审查的盲区**——三期/五期/七期只扫 `throw new AppError` 和 `throw x.error`。实测 src 211 处（含 test 则 202+108）。按 A/B/C 三类处置：A 类（`Usage:`/`Unknown`/`Missing`/`No current` 等用户可触发失败）转通道，B 类（不变量 / webview bridge / native bridge / OS 加密 / S3 / tdbc / tiktoken / update-check 链）加 `// nm-throw: keep — <理由>`，C 类进 notes。**终态：无 keep 注释的裸 Error 归零（排 cli/test）**。

**十期 `p10-clean-noise`**（`7e6076be3`）：签名重复门禁 5 组新增全判为刻意重复（`createAbortScope` 内部 vs `signalView` 裸 signal 适配、repository ↔ message.service 转发链）；`known-false-positives.json` 22 条覆盖 33 行阻断，只改 `check-style.mjs` **汇总层**（子脚本判据一行未改），`suppressPrefixes: ["apps/cli/"]`；`scripts/prettier-guard.mjs` 拒绝无 `--print-width` 的 write 与全仓通配。**清单移除后仍能复现原始 37/21，证明降级是清单驱动而非判据放松。**

**B：八期 spec 合规审查 `abort-scope-audited`**（`67bf45d11`）：4 片只读审计，**P0 5 / P1 17 / P2 14**。5 个 P0：① desktop cloud-sync 的 coordinator 阶段边界 `checkpoint` **一处未传**（`service.pull/push` 不接收，全文件 grep 0）→ 分钟级 S3 传输期间取消静默无效；② desktop backup export 的 scope 在**对话框之前**创建（spec 要求之后），300s deadline 覆盖的是用户盯对话框的时间且超时后无检查点可观测；③④ mobile `db-backup.service.ts` 与 `db-maintenance.service.ts` **完全没有取消面**（`core/abort` import 数 0）；⑤ spec 自身两处 `hit !== null` 与同文件 `:209-210` 的强制口径冲突（代码全对，是文档地雷）。P1 里最重：T-S15 只覆盖 2/6 类 handler 的异步段 abort、T-S8/S24/S25/S28 无测试、core `createAgentAbortRegistry` 仍是独立 Map 而非 `scopeFromController` 薄包装、mobile `runManualCompaction` 两个调用点 `void` 无 catch。

**这轮新增的硬教训**：

1. **工作流自报的数字不可信，必须自己复跑**。两次因脚本 `runQ` 的 tail 提取 bug 误判 partial（七期三闸全 0 被滤成空串、九期 `wc -l` 输出被吃掉）。修法是 tail 里单独保留纯数字行与 jest `Tests:` 行。
2. **测试用「第 N 次调用」定位检查点极其脆弱**。`session-prompt-input.service.test.ts` 用 `bailAt(3)` 定位「工作区装配之后」，八期给 `listBySession` 加分片级 checkpoint 后 `shouldBail` 调用次数前移，第 3 次从「assemble 之后」变成「分页之中」。改成**足迹判据**（`counts.workplace > 0 && counts.skills === 0`）才稳。
3. **目录枚举漏项第三次翻车**：六期 15 片清单漏了 `core/src/bootstrap`(58) / `core/src/errors`(17) / `core/src/i18n`(1)，占总残留一半。**清单必须按 `ls` 枚举，不能凭记忆列。**
4. **`prettier --print-width 200` 与 check-signatures 直接冲突**：全仓跑让 signatures 从 0 反弹到 148。已建 `prettier-guard.mjs` 拦截。
5. **工具改动必须两边同步**：十期把清单机制改在 worktree 的 `.agents/`，主仓那份没变，导致我在主仓跑检查时误判「十期没做」。已同步并提交 `cd4067c07`。

## 七期～p12-common-ns-tool-decouple 收官（2026-11-17）

**七期 `p7-error-debt`**（`3df20fb4c`）：`common/assert.ts` 建立，**9 处** `*_INVARIANT_VIOLATION`（core 8 + mobile `rn-file-io.ts:44`）改 assert，四个码退役；工具取消 11 处构造点里 4 处 `throw` 改 `return Result.err(TOOL_CANCELLED)`、`curl-tool` 的 `phaseError` 两调用点同批改、**`TOOL_CANCELLED` 码保留作展示标签**（有 messageKey + i18n + LLM 可见文案 + CLI exit 130 的完整展示契约）；30 处业务失败改 `Result.err`；`errors/vfs-errors.ts` + `session-fs-errors.ts` 合并进 `guards.ts`，`errors/` 8→6 文件。

**八期 `abort-scope`**（`a97fafdc4`）：`domain/abort` 六个文件从零建 + `public/abort.ts` barrel；`checkpoint(): Interrupt | null`；core 四个 port 换 `scope`；`tool-runner` 竞速走 `signalView(...).race(...)`；repository 六个 mapRows 读口 + batchInsert 返回 `Outcome`；桌面 6 类 handler 走 `createAbortScope + matchOutcome` 三分派；移动 4 类 service + CloudSyncCoordinator 阶段边界；native request 加 `requestId` 走 OkHttp `Call.cancel()`。

**九期 `p9-bare-throw`**（`f3cf8eeb7`）：**裸 `throw new Error` 是前三轮审查的盲区**——三期/五期/七期只扫 `throw new AppError` 和 `throw x.error`。A 类（用法/参数校验）转通道，B 类（不变量 / webview bridge / native bridge / OS 加密 / S3 / tdbc / tiktoken / update-check）加 `// nm-throw: keep — <理由>`。终态：**无 keep 注释的裸 Error 归零（排 cli/test）**。

**十期 `p10-clean-noise`**（`7e6076be3`）：签名重复门禁 5 组新增全判为刻意重复；`known-false-positives.json` 22 条覆盖 33 行阻断，只改 `check-style.mjs` **汇总层**（子脚本判据一行未改）；`scripts/prettier-guard.mjs` 拒绝无 `--print-width` 的 write 与全仓通配。**清单移除后仍能复现原始 37/21，证明降级是清单驱动而非判据放松。**

**B 轮 spec 合规审查 `abort-scope-audited`**（`67bf45d11`）：4 片只读审计，**P0 5 / P1 17 / P2 14**。5 个 P0：① desktop cloud-sync 的 coordinator 阶段边界 `checkpoint` 一处未传 → 分钟级 S3 传输期间取消静默无效；② desktop backup export 的 scope 在对话框**之前**创建，300s deadline 覆盖的是用户盯对话框的时间；③④ mobile `db-backup.service.ts` 与 `db-maintenance.service.ts` **完全没有取消面**；⑤ spec 自身两处 `hit !== null` 与同文件强制口径冲突（代码全对，是文档地雷）。

**C 轮 `abort-scope-ui`**（`26f3c30aa`）：Step 14 三端 UI 取消入口补全（renderer `ipcRunAbort` + 四类长任务 runId + `IPC_ABORTED` 静默处理；db-maintenance 禁用态按钮；移动两屏取消 + 压缩入口 action toast + 补 `.catch` 消除 unhandled rejection）。

**D 轮 `p11-dup-merge`**（`ddd0d2880`）：合 3 组（`pad`→`common/format-number`、`escapeHtml`→mobile `components/common/html.ts`（**因 composer-input 产物门禁要求零 core 模块，没放 core**）、`onAbort`→`watchAbort`）。判不该合 5 组且理由具体（`flushText` 闭包状态不同、`requireString` `Result<AppError>` vs `string|null` 且空串语义不同、`clearTimer` 额外复位 `scheduledMs`、`walkDir` fs 条目 vs VFS 规则树、`themeFromTokens` 多 `primaryMuted` 派生字段）。

**十二期 `p12-common-ns`**（`9f3451562`）：`common/` 从 25 个平铺裸导出改成 **11 个 object namespace**（`Coerce` 8 方法 / `Guards` 4 / `Json` 2 / `Text` 3 / `Number` 3 / `Encoding` 3 / `Xml` 3 / `Hash` 1 / `Errors` 3 / `Release` 2 / `TokenFormat` 6）；`assert` / `assertNever` / `AssertionError` / `createTranslator` + i18n 类型族保持裸函数（用户拍板）。7 片并行（C1 common 本体 + C2~C7 调用点）+ 补完轮（测试目录 53 处）一次性改完，**不留 re-export 过渡层**。三端 3525 / 773 / 2385 全绿。

**`p12-common-ns-tool-decouple`**（`8e5e4dbdd`）：删 `asString(value, fallback = "")` 别名改 `Coerce.string`（9 处调用，fallback 从未被传过）。其余 4 个带 `label` 的域内函数判**不该改**——`requireString` 是「非空字符串不 trim」而 `Coerce.nonEmptyText` 是「trim 后非空」，语义不等价；`parseDayLocalDate` 是正则+日期溢出检查；`assertSpanWithin` / `decodeCompressedBytes` 的 `label` 是域内诊断标识。**结论：`common/` 那 25 个函数本身就没有业务名词，改完 namespace 后 §5.2 已满足；`label`/`fallback` 只出现在域内私有函数上，那是域的职责不是耦合。**

**新增/更新的规则**：nm-code-style 从 250 行补到 341 行，新增 §5.1 语义族收敛（含 8 族分类表：类型窄化 / 类型谓词 / JSON / 截断转义 / 数值格式化 → 收敛；row mapper / UI 回调 → 不收敛；错误构造 wrapper → 删）、§5.2 工具与业务边界、§5.3 object namespace 形态、§5.4 私有 helper 不得重写已导出函数；§8 加 `list-dup-signatures.mjs`；§9.3 补「无状态 class 一律不用」。

**这轮最贵的四个教训**：

1. **`\bname\b` 是计数假象**。`Coerce.nullableText` 里的 `nullableText` 会被 `\bnullableText\b` 匹配。判「旧名是否清零」必须用 `(^|[^.A-Za-z_])name\(` 排除前缀。**我两次被这个假象误导**：先生成 350 条迁移清单（含假阳性），后判「残留 79 处」实为 0。
2. **探针 grep 有三个盲区**：不抓 `export { x } from "..."` 这类转发行（C6 自己发现 `shared/logic/common.ts` 漏了，不改会断 X11 bridge）、不抓同名遮蔽、不抓动态引用。下次要同时 grep `from "@novel-master/core/common"` 的导出行。
3. **「同名 = 重复」是错的**。55 组同名里真正该合的只有约 10 组：11 组是 UI 组件回调（`handleSave` 9 处，各提交不同实体）、6 组是 tdbc 接口实现、约 15 组是局部闭包同名、2 组是 tokenizer 双驱动同构。跨域同名才是真信号。
4. **测试目录要单独排一轮**。十二期 C6/C7 我写了「排除 test」，但波 4 没安排改测试，导致 desktop 3 红 + mobile 9 用例红，又开了一轮补完。

---

## 2026-11-17：签名审计「审—修—审」循环（十七 / 十八期 + 第 3 轮终审）

### 做了什么

`scripts/list-dup-signatures.mjs` 从「只查非 export」改成「全部函数 + 标 `[export]`/`[local]`」，同名组 52→105、形态组 124→253（**翻倍，因为「一处 export、一处私有」以前根本进不了视图**）。接进 `check-style` 成独立段，判据是增量（`--gate`）。

**十七期 `p17-signature-audit-r1`**（`b1b93e86f`）：三路签名审计（各 13/12/13 组）+ 30 组收口，9 片并行。同名 105→66、形态 253→182。

**十八期 `p18-signature-audit-r2`**（`abb21d755`）：第 2 轮三路审（各 12/12/13 组）+ 10 组修复。同名 117→65、形态 258→181，**新增 0**。签名总数 3297→3256→3200（**少 97 个，说明壳是真删掉了不是改名**）。

**第 3 轮终审换了角度**（T1 导出面 / T2 悬空与单点 / T3 语义等价，全只读）：T1「dev-ready，无阻塞项，663 个 public re-export 符号在目标 src 全部真实存在」；T2「0 悬空 / 0 新单点 / 42 处 check-inline 全是已登记豁免」；T3「8 组全行为等价，0 静默回归，0 名实不符」。

### 五条硬教训

1. **「存量删除」在签名层看不出来，必须核函数体**。R1 组2 / R3 组1+2 都报「`createCallbackSlot` 工厂造了但 9 处旧槽位没迁，工厂成了无消费者的孤岛」——**证伪**：迁移是上一轮 `52e9f8076` 就落地了，只是外面留了 12 个一行转发壳。**派单时要写明「上一轮报告称已迁，请核实函数体」，否则只读签名的审会把「壳还在」当成「没迁」。**

2. **「消费者多」是我上轮没算的成本**。我说「删 27 个 prefs 门面，`getBooleanPref("llmStream")` 与 `getLlmStreamEnabled()` 类型安全等价」——类型层对，但实测 **114 个生产调用点 / 33 个文件**，且 `setCurrentModelId` 额外做 trim + 旧路径拒绝 + UUID 校验（R2 猜的 `setAndInvalidatePromptTokenCache` **不存在**，失效在共享私有 `setPointer` 里）。**判「该不该删门面」必须同时算「类型是否等价」和「改多少调用点」。**

3. **保留清单要逐条补验「差异参数是否真的被使用」**。我把 16 组登记为「双端镜像有意保留」，R1 指出 `refreshComposerStatusAfterSessionKkvCleared` 双端首参都是 `_rt` / `_runtime` 死参——**「runtime 类型不同所以不能合并」这条理由在签名层就能证伪**。修法：对每组读两端函数体，只看一个问题「`runtime` 真被用了吗」，没用就上收 core。R1 原话值得抄：**「建议收口时对保留清单逐条补验『双端差异参数是否真的被使用』，而不只看名字相同。」**

4. **`dup-gate` 的差集只能按键算，不能按 sites 算**。第一版拿 `{name: [sites]}` 的 sites 全等求差集，行号一改（`format-ipc-error.ts:22` → `:26`）就把 105 组存量**全判成新增**；第二版没注意 `dup-r2.json` 的 `dupByName` 是**数组**不是对象，`Object.entries` 拿到 `0,1,2...`，差点把 233 个数组索引写进 baseline。**正确做法：只按 `name` / `shape` 键求差集。**

5. **工作流的门禁正则不可信，必须自己实跑**。十七期和十八期连续两次，工作流都报 `sig=false inline=false methods=false`，实跑全是 `signatures=PASS inline=PASS methods=PASS`（`check-style` 汇总行里明明有 `signatures=PASS`，它的正则没匹配）。但也**不能一概否认**——十八期它报的 `dup=false` 是**对的**（真新增 1 组）。**判据：自报全红时逐段实跑，把「工作流报的」和「实跑到的」分开记账。**

### 两处「只看签名会误判」的实证

- `handleAgentAbortAlias`（`run-abort.ts:67`）：R1 判「名字即自白的转发壳」，实际函数体是 `await abortRegisteredKey(ABORT_KEY.agent(req.sessionId))`，做的是 `AgentAbortRequest{sessionId}` → `ABORT_KEY.agent` 的适配，**不能删**。
- `DefaultVfsService` 三个 revision 方法：R2 判「显式 no-op、接口偏胖」，实际**本就返回 `Result.err(VFS_OPERATION_UNSUPPORTED)`**（`vfs.service.ts:180-199`），且「目标参数全下划线」也不准——`resetHeadToVersion` 的 scopeKey/path、`renamePath` 的 fromLogical 都进了错误 detail，只有真正不用的带下划线。

### 一条语义收紧（T3 挖出来的）

`update-check` 白名单并入 core 后：**desktop 新增 `html_url` 域名白名单**（`common/update-check.ts:93-100`，收紧不是放宽——我上轮把方向理解反了）；**mobile 继承了 `NOVEL_MASTER_DISABLE_UPDATE_CHECK` 短路钩子**（原本没有，RN Hermes 下 `process.env` 该键不可能置位，属惰性增量）。两处都可接受但要有意识。

### 工具侧补的三处

- `list-all-signatures.mjs` 头部改成「扫描 1179 文件 / 883 个含函数 / 共 3200 个签名」——原来只写 1181 文件，三路审都会以为覆盖了 1181 个有函数的文件。
- `isParamDerived` 加**对象字面量分支**（空对象 false、shorthand 必须同名、spread/getter/method 一律判不是纯转发），补前 `createMessageCheckpointService` 的 `return new Impl({conn})` 不报、补后报 PASS_THROUGH。
- 别名检测第一版有 1063 处假阳性（`const rt = built.value` 这种函数体内局部变量被当成模块级别名），收紧为 `ts.isPropertyAccessExpression(init) && ex === "export " && ts.isSourceFile(node.parent)` 后剩 21 处真的。

---

## 十九期：错误类五层清理（tag `p19-error-classes`，worktree HEAD `d76a209f2`）

你问「`TokenizerError` 是不是还有类似的」，扫全仓 `class Xxx extends Error` 找到 **16 个**，三份 spec 只认定性了 6 个。十九期清到 **11 个**（68 文件 +371/−465），三端与 check-style 三段全绿。

### 从 16 到 11 的构成

```
删  TokenizerError              → registry 改 assert（3 个构造点全在 createDriverRegistry 的工厂里）
删  AgentTurnError              → 带 messageKey 却不在 AppError，加 AGENT_MESSAGE_EMPTY(101017)
删  ProviderTableSnapshotError  → 14 个 descriptor 改 14 个码（新开 125 DB_BACKUP 段）
合  DatabaseReplacedError       → 双端各一份 → 上收 core（跨包 instanceof 原来永远 false）
合  ChatPromptBuildBailedError  → 双端各一份 → 上收 core
留  AppError / AssertionError / SkspError / SqlTemplateError / TdbcError
    / CoordinatedWriteRollbackError / NativeSseTransportError / NativeSseAbortError
    / PromptCountCancelledError
```

### 六条记下来的

1. **`throw createAbortError()` 是门⑦ 抓不到的第二个通道**。`check-unwrap-throw.mjs` 匹配 `throw x.error` 这个形态，载荷换成裸 `Error` 的 `throw createAbortError()` 就静默漏掉——全仓 **44 处**（排除 cli/test/dist 后 32 处），报告从未出现过。而它比 `throw x.error` 更糟：`AbortError` 是 `new Error("Request aborted")`，**信息量为零**，边界只能靠 `isAbortLikeError` 按 name 猜。**门禁按载荷形态匹配是结构性盲区，必须按「函数返回类型 + 是否在事务回调/边界白名单」判定，不能按抛的字符串。**

2. **档1/档2/档3 三分才是 `throw createAbortError` 的正确处置**。档1「不可能中断」（注释自承认不注入 hooks）→ 改 `assert`；档2「已是 Outcome 通道」→ 改 `return Outcome.cancelled`；**档3「Result 通道但 kind 可能是 cancelled」只报不改**——塞进 `Result.err` 就是「控制流伪装成业务错误」，正是要消灭的东西。十九期实测 11 / 2 / 8 / 11（白名单），档3 的 8 处是 spec-2 的债：`message.service` / `session.service` 这批根本没接 `Outcome`。

3. **工作流门禁自报第五次误报，这次是 `classes=0`**。我的 grep 写 `grep -v "/dist/"`，Windows 路径是 `packages\core\dist\`，反斜杠匹配不上；再加上 `\b` 在 ugrep 里报错退出 → `wc -l` 拿空输入 → 0。工作流据此打了 `p19-error-classes-partial`，实跑真值是 **11**（正好达标），我把 tag 改成了正式的。**`grep -v` 过滤路径不能写死单一分隔符，用 `grep -v "dist"` 这种宽松词更稳。**

4. **L5 四片清单不互斥，第四次翻车**。L1-L4 我逐片列死了文件清单，L5 只写了「按档位处理 `packages/core/src/domain/` 下的位置」+ 一句范围提示——结果 L5d 的任务是「apps 三端」，它的报告却是「档1 共 11 处：**core 7 处** + desktop 3 处 + mobile 1 处」，越界改了 core，和 L5b/L5c 撞上。L5c 发现后**停手改为核验**（`git status` 从 51 变 66，mtime 10:07–10:10 有并发写者），没造成丢失。**教训：分片清单必须逐片列死文件，「按档位/按目录」这种描述性范围等于没边界。**

5. **双端各一份 class 比双端各一份函数更糟**。`instanceof` 跨包根本不成立——desktop 的 catch 永远抓不到 mobile 那侧的实例，反之亦然。现在不炸只因为「desktop 的 cloud-sync 只走 desktop 的 db-backup」，任何跨包复用就会静默失效。上收 core 后 desktop 那个 `await import("./db-backup.service.js")` 的动态 import 也顺手去掉了。

6. **收敛轮次计为 failed 节点是正常现象**。十九期 31 个节点里 `nodes_failed=7`，全是波2/波3/波5 的「typecheck 红第 N 轮」「测试红第 N 轮」——每轮一个 node，绿了就继续。**看 `nodes_failed` 不能只看数字，要配合 `status: completed` 和最终门禁一起读。**

---

## 函数归属审计（跨域）：签名清单的第四种用法

你指出 `normalize-for-llm-export.ts` 里的 `isVfsSemanticSegment` 跨域，并问「能不能和之前一样导出签名就看出来」。答案：**能，但判据要比「参数跨域」精确得多**——`normalizeForLlmExport(messages: ChatMessageData[], ...)` 的参数本来就跨域，按那个判全仓一半函数都"跨域"。

### 三条件判据

```
① 文件的域 ≠ 参数类型的域（从路径判域）
② 函数不含本域任何专属类型（全原始类型或他域类型）
③ 名字与文件主题无关
```

`resolveZone(...): LlmExportZone` ② 不成立（返回本域类型）→ 本域，不动。另外三个 ①②③ 全成立 → 候选。

### 三路结果与共识

三路各报 9-19 组，去重约 20 组。**三路都报的 1 组**：

```
fileCacheKey(status: WorkplaceDisplayStatus, path: string): string
  domain/session-kkv/model/session-kkv-domains.ts:127
```

**和 `VFS_SEMANTIC_KINDS` 完全同构**：workplace 域的联合类型住在 session-kkv 的域常量表。三路各自给的证据还一致——file-cache 这个特性被劈成三段（payload serde 在 workplace `rule-snapshot-codec.ts`、blob 在 session-kkv、key 在 session-kkv 却绑死 workplace 类型）。

**两路以上共识的另外三组**：`isDevEnvironment()` 住 abort 域、`decodeLatin1()` 住 character-card、**mobile 的 `buildNewSkillDoc` 副本已经漂移**（core 版多了 `variant` 参数，mobile 版没有——不是「可能漂移」，是已经漂移）。

### 最值钱的一条（R2 独有）

```
packages/core/src/errors/guards.ts:98   readRollbackRevisionBackfillMissingPaths(error: unknown): readonly string[]
packages/core/src/errors/guards.ts:112  isRollbackVfsDegradableError(error: unknown): boolean
```

`errors/guards.ts` 一直被我当通用层（`domainOf` / `inDomain` 在那），但它混进了两个具体域的谓词——backfill 的知识在 `domain/message-checkpoint/logic/backfill-missing-revision.ts`，vfs 降级的知识在 `domain/vfs/logic/`。**改了 checkpoint 的错误 code，这两个函数静默漏判，而改的人不会去通用 errors 层找消费者。**

### 这个信号的两个盲区

- **抓不到常量级**：`VFS_SEMANTIC_KINDS` 本身没被三路抓到——它在模块级 `const` 里，不在函数签名清单。要另一条信号：跨域联合类型的子集被复制进本域常量。
- **会混进「通用工具沦陷」**：R3 的 B 部分 8 组（LCS 算法住 vfs、自然排序住 workplace、`splitLines` 住 vfs、`parseJson` 五处各写一份）不是跨域，是「通用工具没上收」，属于另一类问题，别混排。

### 两个「有家不回」

```
isNonEmptyString(value: unknown): value is string   住 prompt/logic/validate-agent-prompt-layout.ts:35
  → common/guards.ts 已存在
yieldToEventLoop(): Promise<void>                   住 vfs/logic/vfs-import-chunk.ts:25
  → common/concurrency.ts 已存在（createBusyFlag 在那）
```

两路独立报出 `yieldToEventLoop`。**判据不是「有没有第二份」，而是「common 里有没有它的家」**——有家不回就搬。

user:
执行 docs/Iterations/throw-audit/spec.md：门⑦ 回归 18 处定性修复 + drivers 92 条 signatures 机械清 + throw-audit 规则进 nm-style + IntegrityRepairOperation 接口 Result 化，目标 tag p26-throw-audit。

assistant:
四波全部收口，tag p26-throw-audit（14 提交），验收八项全过（typecheck 15 workspace / core 3540 / desktop 774 / mobile 2381 / 门⑦ FIND 0 / throw-audit gate PASS / drivers 六包 signatures 0 / dup+bare gate PASS）。关键定性决策与数字：

- R3 工具：四形态（T1 unwrap / T2 createAbortError / T3 new AppError / T4 new Error），实扫 186 站点 = T1 64 / T2 0（grep 命中全是 JSDoc 文本）/ T3 33 / T4 89；KEEP 65 与九期「65 带标记」对上。修掉两个自身 bug：返回形态最初取到最外层函数（回调标注被外层顶替），修正为最近一层；事务回调从文件名模式扩为 AST 判定（.transaction(...) 回调实参内自动放行，T3 也吃到 14 处）。
- 门⑦对拍：18 处全部命中且 core 一致；mobile 屏 20+ 处 T1 是门⑦只扫 .ts 的盲区（口径漂移实锤），throw-audit 含 .tsx 修复。
- R1 定性：mobile 读链 4 处真修（unit/manager 的 loadTail/loadOlder Result 化，消费方 UI 回调全吞错——relay 浅且保行为）；run:588 的 throw 喂同函数 catch 漏斗（FAILED('') 补发 + onRunFailed 记账，直接 return 会断 composer 解锁链）→ 边界登记；AgentSession.list 的 Result 化只会把 unwrap-throw 挪进 agent-runner（同款 raiseRunError 已存在）→ 登记例外 7c；assertFileName 槽位是 zod preprocess 同款例外。总纲 §五：例外 2 扩 tdbc 双判据 + 新增例外 7（五亚类 a-e）。
- R2：子代理机械清六包 37+23+19+6+4+3 全归零、无超 200 行；主代理逐包串行重建 dist + 分包 commit。
- R4：接口 Result 化 + safeDetect 统一收口（Result.err 与平台异常都保守判 needsRepair），报告语义不变；门⑦撤销 provider-identity 登记、总纲例外 6 标退役。
- baseline：166 键 = BOUNDARY 47 / ALLOWED 30 / KEEP 61 / UNTRIAGED 28（29 站点实例，存量欠账显数不拦，下轮还）。

user:
这轮有什么坑要记住？

assistant:
三个实锤：① Windows 下 git add 传小写路径（docs/iterations/...）而 tracked 是大写（docs/Iterations/...）时命令静默不匹配，R1/R4 两笔各漏带 strategy.md，靠 git status 复查发现后补交——大写目录名 add 时要么 tab 补全要么事后 status 核对；② mobile 测试在 apps/mobile/__tests__/（不是 src 或 test/），按目录模式 grep 消费方时会漏，chat-session-view-cache 是全量跑才现形的漏网；③ throw-audit 的「返回 Result + 同函数 catch」不一定是 VIOLATION——run() 前奏的 throw 靠 catch 漏斗发终态事件，机械改 return 会断行为，矩阵判定要读 catch 块有没有副作用再定性。另：drivers hygiene 债（Dpapi.protect/unprotect 单点、conformance TEST_ONLY、convertMetadata/resolveColumnNames 内联候选）是 range 模式浮出的存量，R2 spec 明确不碰，留在未处理项。
