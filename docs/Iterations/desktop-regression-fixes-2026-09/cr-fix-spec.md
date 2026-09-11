# CR Fix Spec: desktop-regression-fixes 2026-09（首轮评审修复说明书）

## 元信息

- repo：novel-master（worktree `.worktree/desktop-regression-fixes`）
- base_sha：4b9fac01（v1.5.13 版本 bump）
- head_sha：79cadb7a
- prd_path：docs/Iterations/desktop-regression-fixes-2026-09/prd.md（只读参考）
- spec_path：docs/Iterations/desktop-regression-fixes-2026-09/spec.md（只读参考）
- review_round：1
- dag_version：1
- 状态：fix-spec-ready（round 2 review-full 建议 yes + CR-full/D-1 已补写）

> 行号说明：评审原文个别行号相对当前 HEAD 有漂移（如 lib.mjs pkill 行 112→127、case-models-skills.mjs MODEL_READDED 行 73→51），本 spec 按当前 head_sha=79cadb7a 实测行号落笔；下游执行时以文件内容定位为准，行号仅作锚点。

## Must-fix（按 P0 → P1 → P2）

### P0

本轮无 P0 条目。

### P1

#### e2e/A-1 [P1] T-A1 附件双发守门断言不进 results，ALL_PASS 恒绿
- 维度：A + G
- 文件：scripts/e2e/case-regression-fixes.mjs（TA2 段）
- 问题：T-A1（spec 标 blocking: yes 的用例）在 case-regression-fixes 的 TA2 段只 console.log 观察结果、不写入 results——ALL_PASS 恒为绿。附件双发一旦复发（或产品竞态真出现）无任何守门，等于 spec 声明的 blocking 验收点实际失效。
- 改法：TA2 段把 attachAssert 探测结果收口进结果记录：`record("T-A1", attach.matched && attach.hasAttach, ...)`（重试式探测结构已具备，只差最后一步纳入 record）。case-annotate2 保持观察式不强制（探索脚本定位，可接受）。
- 验收/测试：临时恢复旧 sendMessage 注入双发后重跑 case-regression-fixes，ALL_PASS=false（守门真实生效）；正常代码下 T-A1 记录为 pass。
- 来源：review-scope-e2e · round 1

#### e2e/C-1 [P1] .gitignore 三条 pattern 锚定错位全部失效，data/ 裸奔且 novel.db 已 tracked
- 维度：C + B
- 文件：scripts/e2e/.gitignore；scripts/e2e/coverage.md；scripts/e2e/data/novel.db（去跟踪操作）
- 问题：.gitignore 现有三条 pattern（`scripts/e2e/node_modules/`、`scripts/e2e/out/`、`scripts/e2e/data/`）是带目录前缀的形式，位于 scripts/e2e/.gitignore 时锚定错位，git check-ignore 实证全部失效——data/ 目录完全裸奔；data/novel.db（233KB 二进制）已被 tracked，与 ignore 意图直接矛盾；连带风险：脏库混入提交、SQLite wal/shm 伴生文件噪声、陈旧快照误导后续单跑。
- 改法：
  1. .gitignore 改为相对形式三行：`node_modules/`、`out/`、`data/`；
  2. `git rm --cached scripts/e2e/data/novel.db` 移出跟踪（方向待用户拍板，与待拍板 ④ 联动；若用户决定保留跟踪，则本步豁免并在「已豁免」登记）；
  3. coverage.md 补序列编排约定：全量序列 = `rm data/*` 后先 bootstrap 再跑全部 case；单跑依赖本机已 bootstrap 的库，不再提交产物。
- 验收/测试：`git check-ignore scripts/e2e/node_modules/x scripts/e2e/out/x scripts/e2e/data/x` 三条均命中；跑一轮 e2e 后 `git status` 无 data/ 噪声；novel.db 按拍板结果处理（默认移出跟踪后 git status 不再列）。
- 来源：review-scope-e2e · round 1

#### e2e/G-1 [P1] MODEL_READDED 断言 `>= 0` 恒真，模型重添加环节唯一报警面失效
- 维度：G
- 文件：scripts/e2e/case-models-skills.mjs:51（评审原文行号 73，HEAD 实测 51）
- 问题：`(await page.locator(...).filter({ hasText: "glm-regression-test" }).count()) >= 0` 对 count() 恒成立（locator count 最小为 0）——断言恒真。模型重添加环节唯一的报警面失效：删光模型后仍报 true，下游 subagent 环节因无可用模型而远因失败，诊断被引向错误方向。
- 改法：改为 `>= 1`（或 `=== 1`），并在 false 时输出带 FAIL 前缀的日志（与脚本其余 case 的 FAIL 约定一致）。
- 验收/测试：重跑 case-models-skills 输出真实计数；人为断掉添加步骤（如临时注释添加动作）时能看到 FAIL 输出。
- 来源：review-scope-e2e · round 1

### P2

#### e2e/B-1 [P2] shutdown 第二条 pkill 无根前缀按子串匹配，误杀并行会话的任意 vite
- 维度：B
- 文件：scripts/e2e/lib.mjs:127（shutdown 函数内；评审原文行号 112，HEAD 实测 127）
- 问题：shutdown 中 `pkill -9 -f "npm exec vite"` 没有任何路径前缀，按子串匹配进程命令行——多 worktree 并行会话是本仓常态，这条会误杀其它 worktree 正在使用的 vite。而前一行 `process.kill(-vite.pid, "SIGKILL")` 已按进程组杀掉本脚本拉起的 vite 全组，此条兜底零收益、纯风险。
- 改法：删除第二条 pkill；若仍想保留兜底，并入第一条、统一带 `${ROOT}` 路径前缀匹配（只杀本 worktree 的 vite）。
- 验收/测试：e2e 收尾后，其它 worktree 中由其自身会话启动的 vite 进程存活（`pgrep -f vite` 对照前后快照）。
- 来源：review-scope-e2e · round 1

#### e2e/B-2 [P2] launchApp 在 waitForPort 超时 / _electron.launch 抛出时泄漏 vite（孤儿占 5173 连锁挂）
- 维度：B
- 文件：scripts/e2e/lib.mjs:61-84（launchApp 函数）
- 问题：launchApp 先 detached 拉起 vite，再 waitForPort(5173)、_electron.launch。任一步失败（端口超时、ELECTRON_BIN 路径错误等）时异常直接抛出，vite 进程组无人回收——孤儿 vite 占住 5173，下一次 launchApp 的 waitForPort 会误判「端口已就绪」而连锁挂起。
- 改法：launchApp 内对 `waitForPort` 之后的 `_electron.launch` 段包 try/catch，失败时先 `process.kill(-vite.pid, "SIGKILL")` 再 rethrow；mock 进程由调用方管理，此边界在注释中写明。
- 验收/测试：把 ELECTRON_BIN 改成错误路径跑一次 launchApp，异常抛出后 5173 端口无残留监听（`ss -ltn | grep 5173` 为空）。
- 来源：review-scope-e2e · round 1

#### e2e/B-3 [P2] waitRunSettled 两段超时静默返回 + bootstrap 不设退出码，失败被吞成绿
- 维度：B + G
- 文件：scripts/e2e/lib.mjs（waitRunSettled）；scripts/e2e/bootstrap.mjs（末尾校验）；scripts/e2e/case-regression-fixes.mjs（ALL_PASS 退出码）
- 问题：waitRunSettled 的「离开段」与「回归段」两处超时都静默返回——发送失败时离开段等满 5s 超时、回归段首查即过，形成「发送→零等待假收敛」的复发形态，此前回归正是这个形态。bootstrap 对 BOOTSTRAP_STATE 只 console.log、不断言、不设退出码——库未就绪也以 0 退出，串联序列把失败静默传递下去。
- 改法：
  1. waitRunSettled 两段超时改为 console.warn（带最终 label 值），失败可见；
  2. bootstrap 末尾加硬校验：`msgs >= 2 && composerOk`，不满足则 `process.exitCode = 1`；
  3. case-regression-fixes 在 ALL_PASS=false 时同样设非零退出码——串联序列（`&&` 编排）自动断链，失败不再向后传导。
- 验收/测试：用端口占用的 mock 跑 bootstrap：非零退出 + warn 可见；人为让 regression-fixes 某条 record(false) 后，脚本退出码非零。
- 来源：review-scope-e2e · round 1

#### e2e/B-4 [P2] 三栏拖拽对比 b0c 取在 mouse.up 之后恒 false，b0 死变量
- 维度：B + G
- 文件：scripts/e2e/case-s3-update.mjs:88-107
- 问题：三栏拖拽对比中，`b0c` 列宽快照在 mouse.up 之后才取——与 b1 之间无任何 DOM 变化，`changed` 恒为 false，日志误导诊断（此前 vision 像素实测曾被迫兜底）；`b0`（#app 总宽）取后从未使用，是死变量。
- 改法：拖拽前取列宽快照 `before`，拖拽后取 `after` 对比输出；删除死变量 b0。
- 验收/测试：重跑该段日志输出 `changed: true` 且列宽差值为拖拽位移量级（约 -42px 对应 mouse.move(sb.x - 120) 的实际生效份额）。
- 来源：review-scope-e2e · round 1

#### e2e/C-2 [P2] 死代码三处：旧 worktree 绝对路径 OUT、未用 spawn import、无人使用的 enterProject/双参 sleep
- 维度：C
- 文件：scripts/e2e/case-zip-backup.mjs:8；scripts/e2e/case-subagent.mjs:2；scripts/e2e/lib.mjs（enterProject、sleep 双参导出）
- 问题：① case-zip-backup.mjs:8 的 OUT 指向旧 worktree `desk-e2e-test` 的绝对路径——spec Step1 ① 同方向反例的残留，明示「不得依赖绝对路径」却自带一条；② case-subagent.mjs:2 import 的 spawn 从未使用；③ lib.mjs 的 enterProject 无人 import、`sleep(page, ms)` 双参版无人使用（各脚本都用本地单参版）。
- 改法：删除 case-zip-backup 的 OUT 行；删除 case-subagent 的 spawn import 行；删除 lib.mjs 的 enterProject 函数与 sleep 双参导出（各脚本本地单参版保留不动）。
- 验收/测试：`grep -rn "enterProject\|desk-e2e-test\|from \"./lib.mjs\".*sleep" scripts/e2e/` 无死引用；e2e 序列重跑全绿。
- 来源：review-scope-e2e · round 1

#### e2e/C-3 [P2] 会话自足逻辑两脚本不对称 + 附件断言 ~20 行逐字重复 + closeOverlays 动态 import
- 维度：C + C-orch
- 文件：scripts/e2e/lib.mjs（新增公共函数）；scripts/e2e/case-annotate2.mjs；scripts/e2e/case-regression-fixes.mjs
- 问题：① 会话自足逻辑不对称：annotate2 有完整的「逐个尝试会话直至可用（未绑模型则自行绑定）」逻辑，而 regression-fixes 的 ensureSession 只查会话存在、不查 disabled/未绑模型——首个会话未绑模型时会静默走 force click 空发，失败且无诊断；② 附件断言 ~20 行在两脚本逐字重复（annotate2 的重试式探测与 regression-fixes 的 attachAssert 是同一段逻辑的两份拷贝）；③ annotate2 对 closeOverlays 用动态 import，与文件顶部静态 import 的其余符号不一致。
- 改法：lib.mjs 新增 `pickUsableSession(page)`（吸收 annotate2 的完整逐个尝试 + 自足绑模型逻辑）与 `assertLastUserAttach(page, needle)`（吸收重试式探测），两脚本改为复用；closeOverlays 并入 annotate2 顶部 import。
- 验收/测试：人为构造「首个会话未绑模型」的库，单独跑 case-regression-fixes 仍能正确选中可用会话（不空发）；两脚本 grep 无重复的附件探测代码段。
- 来源：review-scope-e2e · round 1

#### e2e/K-1 [P2] coverage.md B 节批注行仍标 ❌ D-15，与 PRD 已改判结论不一致
- 维度：K
- 文件：scripts/e2e/coverage.md（B 节批注行、投影行）
- 问题：coverage.md B 节批注行仍标 ❌ D-15，但 PRD 已改判 D-15 为已排除（脚本双发误报）；投影行 ◻️ 也仍被 D-15 掩蔽，而 2026-09-09 已结案：重开不恢复系双端一致设计 + 草稿态投影正常（commit 257ee650 存疑终态记录）。文档状态与 PRD/结案结论脱节，误导后续回归判断。
- 改法：D-15 行改为「✅（D-15 已排除：脚本双发误报，见 PRD 定性）」；投影行改为「✅ 草稿态投影正常；重开不恢复系双端一致设计（2026-09-09 结案）」。
- 验收/测试：coverage.md 与 PRD 的 D-15/投影结论逐项一致，无遗留 ❌/◻️。
- 来源：review-scope-e2e · round 1

#### renderer/G-1 [P2] settings-nav-guard 用例引用已删除的 SettingsViewId 成员，并入 dev 即类型漂移
- 维度：G + B
- 文件：apps/desktop/test/settings-nav-guard.test.ts:208-218
- 问题：用例以 `"regexRuleEditor"` / `"regexGroups"` / `"regexRules"` 作为 SettingsViewId——v1.5.14（commit 5234817f 正则系统移除）已从联合类型删除这三个成员，用例直接并入 dev 分支时类型漂移（TS2345）且用例语义已过时（守护的视图不再存在）。
- 改法：换成仍存在的成员：`regexRuleEditor → modelSampling`、`regexGroups → providerDetail`、`regexRules → agentEditor`（三个替换成员语义等价：均为真实存在的设置视图，用例结构/断言语义不变）。
- 验收/测试：`NODE_ENV=development npm test` 全绿；`grep -n "regexRuleEditor\|regexGroups\|regexRules" apps/desktop/test/settings-nav-guard.test.ts` 无已删除成员引用。
- 来源：review-scope-renderer · round 1

## Spec deviations

- 本轮无新增。
- DEV-1（accepted）：Step 8 附带修复——SkillDetailView 文件加载 effect deps 补技能三元组；不补则守卫确认切技能后旧 selected 不触发重载、上一技能脏内容挂新技能名下（保存即写错目标），守卫确认路径完整性必需；cr-func-mid 论证后接受。
- DEV-2（accepted）：e2e 附带修复——bootstrap B4 收尾 drawer+picker 叠开残留改用 closeOverlays（既有缺陷，可执行性所需）。
- 两条登记原文在主仓 docs/.iteration-state.yaml 与 apm 记忆（未随分支提交），此处摘要使分支自包含。

## Open questions / 待拍板（不阻塞 fix-spec 执行）

1. **dismissUpdatePrompt 等待窗口**：实为有界轮询（弹窗出现即点击即返回，15s 仅上限）——清库首跑通常 2~4s 内返回，续库 snooze 已写时需等满窗口（每脚本约 2~15s）。是否引入读 novel.db 探测 snooze 状态以缩短续库场景？代价：e2e 增加 sqlite 读依赖与存储结构耦合。
2. **coverage.md 备忘「勿用 ^锚点$ 正则」与现状冲突**：备忘如此记载，但脚本现状锚点正则遍布且全绿——是备忘过时（应更新备忘）还是应统一收敛（改脚本去锚点）？
3. **case-subagent 自建 mock 与 lib.startMock 的时序假设**：case-subagent 自建 mock 无 /models 分支，且依赖 `callCount === 1` 的时序假设。是否预防性对齐 lib.startMock（统一 mock 面）？
4. **novel.db 去留**（与 e2e/C-1 联动）：推荐移出跟踪（干净仓库 + 序列编排约定文档化于 coverage.md）；备选保留跟踪以便利单跑。待用户拍板后闭合 e2e/C-1 第 ② 步或转入「已豁免」。

## 已豁免（用户确认不修）

- 本轮无。

## 合并后 QA（manual_user）

- 无新增（现有 manual_user 项以 PRD/spec 为准，不在此重复）。

## K 节建议（下游执行时闭合）

- e2e/K-1 即本轮 K 维条目（coverage.md 状态同步），已进 Must-fix，下游执行时闭合；无其它 lint/format/调试残留类收尾项。


## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/desktop-regression-fixes-2026-09/cr-fix-spec.md |
| dag_version / review_round | 2 / 2 |
| P0 / P1 / P2（已写入） | 0 / 3 / 9（含 CR-full/D-1 已就地闭合） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none open（DEV-1/DEV-2 accepted，分支内自包含摘要已补） |
| C-orch | ✅（review-full 终判合格） |
| C 类合并后 QA | 无新增 |
