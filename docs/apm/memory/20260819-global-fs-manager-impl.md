---
date: 2026-08-20 00:30
title: global-fs-manager 全程：dev→CR→真机修复（BackHandler 聚焦守卫为最终钥匙）
keywords: global-fs-manager, BackHandler, 聚焦守卫, 侧滑, native-stack, gestureEnabled, 子 agent 会话, 延迟挂载
abstract: global-fs-manager 从 code-dev-loop 到 CR-fix 再到真机走查修复的全程记录；真机阶段侧滑失效最终由日志实锤为 BackHandler 全局性缺乏 isFocused 守卫，教训是交互 bug 别猜根因、直接埋日志。
---

# 2026-08-19 global-fs-manager 迭代执行（多轮）

## 2026-08-19/20 真机走查修复轮（侧滑退出 + 冷启动 + 子会话目录）

用户真机反馈三问题与最终修复（提交均在 feat/skills-integration）：

1. **详情页侧滑无法退出（偶发连坐退出浏览器）**——历经三错一中对：
   - ❌ `56037c8` 猜「幽灵 POP」350ms 窗口吞事件：无效，模块+测试已在 `69a932f` 删除
   - ❌ 误诊为浏览器列表页子目录问题，又在容器层面绕了两轮（纯讨论未改码）
   - ⚠️ 用户怒斥「找不到问题就打日志」→ 埋 `[swipe-debug]`（`68072fe`），日志一发钉死：**详情页在栈顶时，底下浏览器的 BackHandler 抢走返回事件偷偷 goUp**（日志铁证：FileEditor mount 后出现 `Browser hardwareBack canGoUp=true`，且全程无 FileEditor beforeRemove）
   - ✅ `7c4f8c8` 修法：BackHandler 回调开头加 `if (!navigation.isFocused()) return false`——GlobalTemplateScreen 与 SkillDetailScreen（同款雷）一起修
2. **冷启动卡顿**（`dc0a131`）：只读详情页延迟 80ms 挂 WebView，转场先跑、loading 圈顶上；预览管线本有 12K 超限保护，卡的是推屏转场与 WebView 创建同帧
3. **子 agent 会话空目录刷屏**（`b7812e7`）：真相是子 agent 共享父会话 VFS（run-agent-turn 注释明说），createSubSession 不建独立工作区；空目录行是物理树 BFS 合成的展示产物非数据残留。修法：子会话仅当有 VFS 条目（历史残留）才显示，主会话保持空也显示
- 副作用盘点（用户问「要不要回滚」）：无功能副作用；可感知变化仅三点——空目录消失、大文件先 loading 再出内容、**iOS 子目录侧滑无反应**（走返回箭头；安卓侧滑走 BackHandler 链不受影响，上翻正常）

### 纪律（跨会话有效）

- **RN BackHandler 是全局广播，不看栈顶**：任何屏幕注册 hardwareBackPress 必须加 `navigation.isFocused()` 守卫，否则会吞掉上层屏幕的返回/侧滑（安卓侧滑返回走 BackHandler 链）
- **native-stack 的 beforeRemove+preventDefault 拦不住手势 pop**：手势发起的原生转换已开始，JS 拦不干净还破坏后续手势；要禁用侧滑用 `gestureEnabled: false`（一等公民开关），不要嵌套容器绕（手势活在导航层不在组件树，View 嵌套挡不住）
- **交互 bug 两轮猜不中就必须埋日志**：focus/blur/beforeRemove/关键时序 + 时间戳，让用户发 metro 日志实锤；本轮省掉两轮弯路
- **Tab 内无侧滑行为是「问题不存在」不是「问题被解决」**：聊天工作区没侧滑问题是因为 Tab 导航无手势，非实现更优

## 2026-08-19 终态：code-dev-loop dev-ready（主代理收尾汇总）

- DAG（3 版）：wave-0 impl-s1 → verify(main) → wave-2 [impl-s2s4-core ∥ impl-s3-clients] → verify(main)+cr-func-s1-s4(func-ready) → wave-5 [fix-sr3-blob ∥ impl-s5 ∥ impl-s6] → cr-func-s5-s6(func-ready) → s7 文案，executor: main。
- 结果：spec 8 步中 1-7 全闭合，Step 8 真机走查留用户；blocking 测试 T-SR1/2/3、T-PR1/2/3、T-PB1/2/3/4 全绿；core 2029 pass；T-PR3 全仓 grep 零命中；schema 零 diff、SCHEMA_BOOT_VERSION=7 未动。
- 主代理修复：resolve-vfs-scope 重复 case "session" 死代码（impl-s1 手误，2898f49）；Step 7 文案（17ad044：README 流程、monorepo 删 pull 命令行、ProfileTab 入口「文件浏览器」、spec 下拉刷新措辞对齐）。
- 记录级偏差（不阻塞）：desktop physical list 为 BFS 一次拉全树（非逐层懒加载，单机可接受观察项）；T-SR3 orphan SQL 只反查 vfs_revision（比声称范围窄，方向假阳性非假阴性）。
- 已知预存问题（非本送代）：CLI e2e T2/T6 基线即败（agent registry 校验根因）；mobile tsconfig.build.json baseUrl 弃用告警需 --ignoreDeprecations 6.0；worktree 借主仓 node_modules 缺 markdown-it 致 chat-tab-screen.integration 无法启动；desktop 全量 4 fail 为 dist 构建产物缺失。
- 分支 feat/global-fs-manager（worktree .woktree/global-fs），基于 feat/skills-integration@5f8aba0，未合未 push。

## 2026-08-19 第 4 轮：impl-s6-desktop（Step 6）

- 节点：impl-s6-desktop，worktree `.woktree/global-fs`，分支 `feat/global-fs-manager`，基线 2898f49。
- 任务：desktop projects 视图全局面板改只读物理树浏览器——`WorkspacePanelScope` 加 `'physical'`、物理浏览 IPC（list/read 两 handler 走 `rt.physicalVfs()`，无写 handler）、`resolve-vfs-scope` 保持既有解析不动（physical 在 handler 层分流）、renderer invoke 封装、`nav-workspace`/`ExplorerPane`/`WorkspaceTree` 只读换源（隐藏全部写菜单/拖拽）、`PreviewPane` 只读预览路由、T-PB4 测试（IPC 层单测）。
- 约束：不碰 `packages/**` 与 `apps/mobile/**`（并行子代理在改）；既有面板（global/session/chat/meta）行为不变；CRLF 禁 python 文本模式；验证 `npm run typecheck`（apps/desktop）+ `node scripts/run-tests.mjs --test-concurrency=1`。
- 相关记忆：`20260819-global-fs-manager-spec-review.md`（spec 评审轮）。

## 2026-08-19 第 5 轮：impl-s5-mobile（Step 5）

- 节点：impl-s5-mobile，worktree `.woktree/global-fs`，分支 `feat/global-fs-manager`，基线 2898f49（本轮实际 HEAD 含并行 desktop 提交 ea6faf5）。
- 任务：mobile 全局工作区改只读物理树浏览器（T-PB3）——`VfsFileManager` 新增 `readOnly` prop 分支（隐藏新建/重命名/删除/移动/ZIP/批量/规则/更多菜单，保留导航；`vfs` prop 放宽为 `VfsService | PhysicalVfsService`，写路径走 `writableVfs` 收窄）；`GlobalTemplateScreen` 换 `runtime.physicalVfs()` 根 `/`、banner 删「从上级同步」、标题改「文件浏览器」（header-config）；`FileEditorScreen`+`navigation/types.ts` scopeKind 加 `physical`（保存禁用、隐藏编辑切换）；`file-annotate-gate` 类型收口。
- 红线守住：默认（readOnly 不传）行为零变化，session 集成回归全绿；行主体新增 testID `vfs-row-item-{name}` 供测试定位（无行为影响）。
- 提交：171a6f6（readOnly+FileEditor 基础）、33877b4（换源+文案+T-PB3 测试）。
- 验证：mobile tsc -p tsconfig.build.json --ignoreDeprecations 6.0 通过；jest 8 套件 30 例全绿（readOnly 3 例 + file-editor 8 例含 T-PB3 + session 集成 4 例 + 键盘/会话面板/角色卡菜单/legacy-scroll）。
- 已知环境预存问题：`chat-tab-screen.integration.test.tsx` 因主仓库 node_modules 缺 `markdown-it` 无法启动（worktree 借主仓库依赖），与本轮改动无关。

## 2026-08-19 CR-fix 轮（code-dev-loop 执行 cr-fix-spec）

- DAG：wave-0 impl-cr-core（P0 meta 双前缀修复 + listTree 批量接口 + core 四条，2036/0）→ wave-1 [impl-cr-desktop ∥ impl-cr-mobile] → cr-func（子代理上下文耗尽提前收尾，主代理补齐三项复核与归因二）→ fix toCoreVfsScope（main）。
- 关键修复：P0 双前缀按 fix-spec「list 输入侧传物理目录作 base」执行；desktop BFS 改单次 listTree + per-scope 错误隔离；mobile beforeRemove 仅拦 POP；cli 补下线负向断言。
- 新踩坑与纪律：
  - desktop `tsconfig.json` 仅含 src/main+shared，**renderer 是独立 tsconfig 且非门禁**（293 预存错误）——renderer 侧类型错误不会被发现，改动 WorkspacePanelScope 等 shared union 时须手动 grep renderer 的 switch 穷尽性（本次 toCoreVfsScope TS2366 即此盲区漏网）。
  - CLI `template-pull-e2e.test.ts` T3 红灯为**预存缺陷**（v1.4.21 即红），根因方向 sessionTemplatePull→replaceVfsSubtree 删除侧不彻底，待另立条目。
  - cr-func 子代理在 /tmp 建 4 个临时 worktree 做归因实验，上下文耗尽后遗留未清——派遣做 worktree 实验的子代理须在 prompt 里强调自清。
- 状态：dev-ready；CR 3 条 spec deviations（label 增强/返回拦截/BFS 全树）随「按 cr spec 开发」指令视同接受，后续回写 spec 附录。
