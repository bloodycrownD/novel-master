---
date: 2026-09-08 22:25
title: 桌面端回归修复 SPEC 第 1 轮审查修复（D-12 第四分发点 + P2 批量）
keywords: [desktop-regression, spec-review, D-12, 导航守卫, OPEN_SETTINGS_VIEW_EVENT, D-15, 批注]
abstract: 桌面端回归修复迭代 spec.md 第 1 轮审查修复：P1-1 补 D-12 第四分发点（编程式跳转 pending 化 + hidden 态可见性契约 + T-G4 + navState 换对象实现注），P2-1~P2-6 批量闭合（rollback 清 store 路径、两者皆否出口、console.error 钉死、收敛轮询、断言放宽、行号对齐），PRD 两处联动同步。
---

user:
非 readonly 模式修复 SPEC 文档（只改文档不改实现代码）：docs/iterations/desktop-regression-fixes-2026-09/spec.md 第 1 轮审查。must-fix：P1-1（D-12 守卫漏第四条导航路径 OPEN_SETTINGS_VIEW_EVENT 编程式跳转，含 hidden 态不可见确认框与 viewingSkillRef 覆写静默丢编辑两个失效模式）+ P2 批量（P2-1 rollback 清 store 路径补证、P2-2 两者皆否出口、P2-3 console.error 钉死、P2-4 disabled 分支收敛轮询、P2-5 断言②放宽、P2-6 行号对齐）。要求三处联动自洽（变更点清单/Step 8/测试用例清单），最小侵入。

assistant:
全部闭合。核实与修订要点：

- **P1-1（结构性补充）**：D-12 变更点清单第 2 条改「四个泄漏分发点」；新增第 3 条「第四分发点：OPEN_SETTINGS_VIEW_EVENT 编程式跳转」——证据链全部实测核实（SettingsOverlay L109-126 handler、L117 整理→navigateTopLevel、L120 覆写先于守卫、L121 viewId 不变不 push、SkillDetailView L103-122 useEffect [ref?.name] 重载链），两个失效模式照录；修复规定三条：全部导航副作用包 pending 动作过同一套 ConfirmModal、hidden 态可见性契约（锚定 App.tsx L80-89 同名监听 setSettingsOpen(true) 同事件同批渲染的事实，定为显式契约 + T-G4 断言保护）、实现注 navState 换对象陷阱（handleClose L170 换对象 + nav memo deps [pushView,popView] 稳定不重算 → nav.navState 与 ref 分叉不是一帧窗口而是持续到 memo 失效，比审查指令的「短暂失联窗口」说法更严重，实现须统一 dirty 读写引用或使 memo 失效）。原 3/4 条顺延为 4/5，第 5 条补与第 3 条的边界（toggle 不拦的是原页重现，dirty 存活期间 hidden 态导航切换必须拦）。
- **P2-1~P2-5 全部闭合**：D-15 已知事实链改「清空常规路径有两条」（append 回调 L153-168 + rollback-annotate-restore.ts L48-50 rewind 清全部草稿）；处置段/Step 3 补「两者皆否」出口（回 PRD 重新定性）；Step 4 钉死 renderer console.error（launchApp 只收 type==="error"，lib.mjs L75，过滤名单仅 Electron Security Warning/Insecure Content）；Step 1 disabled 分支 return 前补收敛轮询（slow mock 分段×300ms 一轮 ~12s，4s 固定等待竞态）；Step 9 断言②与 T-P1 同步放宽为「不含 setVersion」。
- **P2-6 行号**：L354→L348 ✓、121-122→121 ✓；两处与审查指令有出入按实测写：lib.mjs console 收集实际 L75（指令写 L71）、append effect 实际 L153-168（指令写 153-169）；**App.tsx toggle 不采纳指令的 L341**——主检出与 desk-e2e-test worktree 双向 grep 均为 L343，spec 原行号保留。
- **PRD 联动两句**：D-12 根因补第三条泄漏路径（编程式跳转 viewingSkillRef 覆写）；D-15 排查方向补 2026-09-08 修正（onChange 假设证伪、rollback 路径、两者皆否回表定性）。
- 风险表补 D-12 第四分发点一行；单元测试段拦截判定扩为「卸载或改写 ref 入参」。

关键事实：App.tsx L80-89 对 OPEN_SETTINGS_VIEW_EVENT 无条件 setSettingsOpen(true)（detail != null 即开）——编程式跳转天然带「打开设置页」语义，hidden 态守卫弹窗可见性靠它成立，属跨组件隐式契约；SettingsOverlay 的 nav memo deps 是 [pushView, popView]（空依赖稳定），navStateRef.current 换对象后 memo 不重算，nav.navState 与 ref 会持续分叉。
