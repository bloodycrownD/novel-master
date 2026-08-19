---
date: 2026-08-19
title: global-fs-manager cr-func 只读功能小检（s1-s4 / s5-s6）
keywords: global-fs-manager, cr-func, skill-relocate, pull-removal, PhysicalVfsService, T-SR, T-PR, T-PB, func-ready
abstract: 对 .woktree/global-fs 做 readonly 功能审查。s1-s4（5f8aba0..HEAD，Step 1-4）：五段变更点落地、blocking 测试齐全，func-ready yes，两条记录（resolve-vfs-scope 重复 case 死代码 P2、T-SR3 blob 半段断言缺失）。s5-s6（171a6f6/33877b4/81adbba/ea6faf5/17553d9，Step 5 mobile + Step 6 desktop + fix-sr3-blob）：矩阵逐条落地、双端红线守住、T-SR3 blob 断言补齐，抽跑 mobile readonly 3/3 与 desktop physical-vfs-ipc 5/5 全绿；无 must-fix；func-ready yes。前次 P2 死代码已由 2898f49 修复。
---

user:
readonly 功能小检（cr-func-s1-s4）：核对 Step 1-4 矩阵落地、抽跑测试、复查七个高风险点，返回矩阵对照/must-fix/spec_deviations/func-ready。

assistant:
逐文件核对 + 抽跑 physical-vfs.test.ts（7 pass）与 vfs-gc-trigger.test.ts（3 pass）。要点：
- scopeKeyOfLocation 双用途拆分正确：vfsScopeKeyOfLocation（meta key，喂 sweep）与 disabledScopeKeyOfProject（project:{pid}，喂 ruleRepo）分开；setDisabled/effectiveSkills/deleteSkill/removeScope 四处负清单 key 一致。
- ProjectService.delete() 补了 project:{pid}:meta 清理；copy() 补 meta 域 copyVfsTree + seedLiveHeadRevisions（copyScopeRules 是基线已有）。
- initializeSessionWorkspace 的 excludePrefixes 已删；session 侧保留链（sessionTemplatePull/copyScope/replaceVfsSubtree）完好。
- PhysicalVfsService：port 类型层面仅 list/read；五前缀解析顺序正确；虚拟目录合成含空项目/空会话。
- desktop showSync 收窄 chat-only 后仍走 ipcSessionsPullTemplate；T-PR3 全仓 grep 复核零命中；schema/migrations 零 diff。
发现：
1. apps/desktop/src/main/ipc/resolve-vfs-scope.ts L30-31 重复 case "session": 标签（死代码，无行为影响，TS 不报错）——P2 待删一行。
2. T-SR3 spec 字面要求「delete 后 runDeferredBlobGc 无 orphan blob」，测试只断言了三域 entry 零残留，blob 半段全仓测试无落点——spec deviation，风险低（GC 按全库引用集与 scopeKey 无关）。
结论：func-ready: yes（两条均不阻塞）。

---

user(第二轮, cr-func-s5-s6):
readonly 功能小检：Step 5（mobile）+ Step 6（desktop）+ fix-sr3-blob（171a6f6/33877b4/81adbba/ea6faf5/17553d9），核对矩阵落地、抽跑 mobile readonly 测试与 desktop physical-vfs-ipc、复查六项重点（双端红线、FileEditor physical、physical 通道安全、GlobalTemplateScreen 换源、PRD 验收）。

assistant:
逐文件核对 + 抽跑 jest（3/3）与 node（5/5）。要点：
- mobile：readOnly 为可选 prop，171a6f6 diff 证实不传时全部改动只剩类型收窄（writableVfs 同一对象）+ testID，默认路径零影响；写入口五层收口（更多菜单/行菜单/长按批量/pull 按钮/菜单项数组置空）；FileEditor physical 分支 isReadOnly 双保险（handleSave 早退 + disabled）且隐藏编辑切换；session 集成测试按当前 reload 语义（vfs.list 为权威源）mock，未过时。
- desktop：仅 nm:physical/list 与 nm:physical/read 两通道；resolveVfsScopeFromRequest 对 physical 显式抛 VfsScopeError（写 handler 天然拒绝，测试断言写后内容未被篡改）；面板层 row/blank 右键、拖入拖出、prefetch 全部 isPhysical/readOnly 门闩；PreviewPane physicalReadOnly 无编辑切换无保存（mode 恒 read，Ctrl+S 不可达）；session/chat 面板代码路径未动。
- GlobalTemplateScreen：数据源 physicalVfs + 根 /，banner 换只读文案（「从上级同步」入口消失），逐级返回与基线同机制（组件内上级目录按钮，基线本就未接系统返回 ref）。
- T-SR3 blob 断言（17553d9）真实落地：delete 后显式跑 runDeferredBlobGc，断言全库 orphan blob = 0。前次 P2（resolve-vfs-scope 重复 case）已由 2898f49 修复。
- T-PR3 grep 复核：global-fs 内 desktop 零命中（其余命中均为别的 worktree/主仓，不算）。
spec_deviations（均不阻塞）：①spec「保留下拉刷新」——VfsFileManager 基线本无 RefreshControl，无从保留；②desktop physical list IPC 用 BFS 一次拉全树并默认全展开，非逐层懒加载（core 服务本身懒，单机规模可接受）；③T-SR3 orphan SQL 只反查 vfs_revision，未含 vfs_entry.content_hash 引用半边（测试通过说明场景内成立，语义上比提交信息声称的 entry ∪ revision 窄）。
结论：func-ready: yes。
