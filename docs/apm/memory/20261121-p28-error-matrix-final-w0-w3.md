# p28 error-matrix-final W0-W3：控制流哨兵三类退役与矩阵下半句落地

user:
按 error-matrix-final spec 干（W0 码表 → W1 CoordinatedWrite → W2 DatabaseReplacedError → W3 ChatPromptBuildBailedError → W4 存量四片 → W5 判定器收口），W4 派工作流。

assistant:
W0-W3 手工完成（提交 79ecf290e / 6854dd105 / 9e3cc623d / 92654838d），core 全量 2856/0、desktop 774/0、mobile 2384/0（mobile 首跑 1 红为 #287 高并发假红，复跑全绿）。

**矩阵落地**：码表新增 `INFRA_ROLLBACK_DEGRADED(110006)`（回滚损坏，rollbackErrors/cause 进 details/cause）与 `DB_BACKUP_REPLACE_INCOMPLETE(125015)`（换代收尾失败，providerTablesRestored 进 details）。三个控制流哨兵类全部退役：
- R1 CoordinatedWriteRollbackError → `run()` 零 throw 纯 Result：回滚损坏走 110006、未知异常走 `INFRA_UNEXPECTED_ERROR{cause}`、TypeError→assert；run-agent-turn :806 分支加 key 分级 WARN。
- R2 DatabaseReplacedError → key 判定；desktop handler 的 **Result 分支**补 key 判定（coordinator 纯 Result 后换代失败不再经异常通道进 catch），service recordPull 排除换代失败（注定失败的写不如不写）。
- R3 ChatPromptBuildBailedError → **null 哨兵**（弃权是无结果的数据不是错误）：buildAdapter 返 `Result<Bundle|null, AppError>`，双端 tokens 消费链判 null，core Outcome.cancelled/replaced 直接映射 null，删反向转码。

**三个可复用的坑**：
1. **cause 塞 params 会被 firstDescriptorOf 误认 descriptor**——AppError 实例带 key 字段，长得像 `{key}`，把 messageKey 污染成内层错误 key，visibleMessage 沿 cause 链渲染出内层文案（外表是「IpcResult message 不对」，实根因在构造）。cause 必须走第三参 options：`new AppError(k, params, {cause})`。
2. **IpcResult 线格式断言用 `error.code` 不是 `.key`**——formatIpcError 产 `{code, message}`，code 装 ErrorKey。
3. **key 命名要落域段**——测试按 key 前缀推导域名查 DOMAIN_RANGES：`DB_SYNC_` 推不出 DB_BACKUP 段，改名 `DB_BACKUP_REPLACE_INCOMPLETE` 自动落段；新码要同步登记测试的 PARAM_FIELDS 手工字段清单。

**测试适配模式**：W1 后 CoordinatedWrite 相关 4 用例（T-SC1/T-SC2/T-SC3/T-DS3b）从 `assert.rejects` 改 `unwrapErr`（新 helper，取 Err 载荷判 key/cause）；T-DS3b 的 stub 未注入 delete → 回滚也失败 → 落 110006 而非 UNEXPECTED——恰好钉住「回滚损坏优先上报」分级，比原断言语义更准。

**W4** 派 dwfrun-3ce433b1 四片（core 24/mobile 32/desktop 12/pkgs 10 文件，非白名单站点 78 文件清单写死进脚本——#277 纪律），判据五条（Result 化/改签名/平台强制 KEEP/渲染器 UI 错误边界 KEEP/assert 化），后续编译收敛+三端测试+残留盘点。用户问「worker 怎么只有一个」——确认图按 phase 画节点不按 worker 画，4 worker 在「四片并行」单节点内并发（fan-out 期间只能一个 current phase，规范如此）。

W5 待办：CONTROL_SIGNAL_CLASSES 清空（三类已退役）+ cloud-sync.service.ts 文件级 allow 复核 + BOUNDARY 判据收窄（等 W4 残留定形）+ baseline 重建 + tag p28-matrix-final。

## W4-W5 收口（0bf1a2330 / 9d79b406c，tag p28-matrix-final）

**W4 四片**（dwfrun-3ce433b1）：工作流 workspace 是主仓不是 worktree——四片 51 文件改动写进了主仓 main 工作区，errored 在 world.run spawn 不到 npm（沙箱 ENOENT）。处置：主仓 `git diff > patch` → `git checkout -- .` 还原主仓 → worktree `git apply --3way`（7 文件分支差异，4 个 UU 手工合并——p27 namespace 新名 × W4 KEEP 注释，i18n 化文案全保留）。教训：**派工作流改码必须确认 workspace 路径**（本会话 cwd 在主仓，工作流继承它；改码类工作流要么先 cd worktree 再 dispatch，要么脚本里用绝对路径清单）。

- desktop escalated 二轮裁决：renderer workspace-actions/desktop-scope 7 站点 KEEP（renderer 零 @novel-master/core 运行时 import 是架构边界，改签名会拉 core 进 renderer bundle）；vfs-batch.clearStaging Result 化（S-D-02 护栏走 INFRA_VALIDATION_FAILED+detail，handler 判 r.ok，测试 4 处改判）。
- core 片 22 处尾巴手清：全部 KEEP（llm-protocol 三 adapter 协议层边界转码 / 三 sse-parser parser 通道 / restore 校验门 / Outcome→throw 转码 / mapResolveError adapter / p26 门⑦漏斗 3 处）——无一该改。

**W5 判定器**：CONTROL_SIGNAL_CLASSES 清空（control-signal 分支删除）；payload 规则改「disposition 跟随当前机器判定刷新、旧人工 reason 优先保留」（salvage 不再让旧 BOUNDARY 登记压住新 KEEP 注释）；T-TA2 反白名单化。baseline 终态 **146 站点 = KEEP 128 + ALLOWED 18，UNTRIAGED 0 / BOUNDARY 0**——非平台强制 throw 站点全仓清零。dup 新增 4 组判保留登记（双端镜像 / webview bundle 隔离 / 语义无关同名 / 独立桥装配面）。

**终态门禁**：typecheck 15ws 0；core 2856/0；desktop 774/0；mobile 2384/0；signatures=0 top-let=0；throw-audit PASS（blockers=0/UNTRIAGED=0）；dup gate PASS；nm-style 自身 109/0。nm-style 的 world.run 沙箱 spawn ENOENT（nvm shim 不在沙箱 PATH）——工作流里跑 npm 系命令不可靠，收敛类 gate 用 `node <script>` 直跑形式。
