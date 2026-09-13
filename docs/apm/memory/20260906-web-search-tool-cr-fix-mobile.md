---
date: 2026-09-06 21:30
title: web-search-tool CR 修复 mobile 节点（fix-mobile）
keywords: web-search-tool, cr-fix-spec, fix-mobile, ui/B-3 保存失败回读, ui/C-1 mobile 侧, KEY_ENGINE_IDS 重导出, core-shim, SEARCH_KEY_ENGINE_IDS 删除
abstract: fix-mobile 节点闭合 cr-fix-spec 的 ui/B-3（SearchEnginesScreen.handleSave catch 补 await load()，部分提交生效后状态标签立即回读刷新）与 ui/C-1 mobile 侧（删 SEARCH_KEY_ENGINE_IDS 手工副本，store 重导出 core 的 KEY_ENGINE_IDS，调用点同步更名）。踩坑两处：jest 把 @novel-master/core 映射到 test-utils/core-shim.ts，重导出链须在 shim 补 ENGINE_IDS/KEY_ENGINE_IDS 否则测试环境拿到 undefined；TestRenderer 里 RN 宿主组件会把自定义 props 复制到内部嵌套节点，按 props findAll 会重复匹配，应改用 findAllByType(mock 组件)。新增 search-engines-screen-save-reload.test 锁定 B-3 验收（setSearxngBaseUrl 抛错而 saveEngineKey 成功时 bocha 标签立即变 set）。commit c3a98ec8，typecheck + 指定 jest 全绿，全仓引擎数组字面量唯一真源收敛 core types.ts。
---

user:
【语言要求】全程中文；代码注释与 commit message 中文；标识符保持英文。节点：fix-mobile，类型：fix，worktree /home/bloodycrown/Dev/novel-master/.worktree/web-search-tool（分支 web-search-tool）。按 docs/Iterations/web-search-tool/cr-fix-spec.md 执行两条：ui/B-3 SearchEnginesScreen.handleSave catch（约 L139-143）toast 后补 await load()；ui/C-1 mobile 部分 search-config.store.ts L23-34 删 SEARCH_KEY_ENGINE_IDS 手工副本改 import core 的 KEY_ENGINE_IDS 并重导出或直接改用（同步调用点）。core 已导出 ENGINE_IDS/KEY_ENGINE_IDS（dist 已重建）。验证：NODE_ENV=test jest 指定两文件 + 官方 typecheck 脚本。验收：typecheck 绿、UI 渲染顺序不变、grep 全仓无第二个硬编码 ['bocha','tavily','brave'] 字面量。1 个 commit、只 add 显式路径，禁动 apps/desktop 与 packages/core。

assistant:
两条全部闭合，单笔 commit c3a98ec8（4 files changed，含新测试文件）。typecheck（官方三段脚本：tsconfig.build.json + web + e2e）零 error，指定 jest 三套件 9/9 绿，验收 grep 通过：源码（排除 dist）唯一 ['bocha','tavily','brave'] 数组字面量在 packages/core/src/domain/tool/builtin/search/types.ts L28，旧名 SEARCH_KEY_ENGINE_IDS 全仓清零。要点与坑：

- ui/B-3：catch 内 `showToast` 后补 `await load()`（load 自带 try/catch 不会二次抛），注释写明与 desktop 93f534ea 口径对齐；成功路径原本就回读，行为不变。
- ui/C-1 mobile 侧：store 删八行手工副本，改 `export {KEY_ENGINE_IDS} from '@novel-master/core'`（重导出走模块收口风格，screen 不直接碰 core 的值导出）；SearchEnginesScreen 三处调用点同步更名。KEY_ENGINE_IDS 顺序 bocha/tavily/brave 与原副本一致，渲染顺序不变。
- 关键坑①：jest 的 moduleNameMapper 把 `^@novel-master/core$` 映到 `<rootDir>/test-utils/core-shim.ts`（绕开 barrel 的 yaml ESM 问题），重导出链在 jest 环境拿到 undefined、screen 渲染直接 `Cannot read properties of undefined (reading 'map')`——shim 须补一行从 `packages/core/dist/domain/tool/builtin/search/types.js` 导出 ENGINE_IDS/KEY_ENGINE_IDS。以后凡 core 新导出被 mobile 引用，都要同步补 shim 白名单。
- 关键坑②：TestRenderer 直测里 RN 宿主组件（Text/Pressable）会把自定义 props 复制到内部嵌套节点，按 props `findAll(n => n.props.x === y)` 会匹配双份（3 个输入框匹配出 6 个）；正确姿势是 `import {FormTextInput} from '…'`（jest.mock 替换后的引用）+ `findAllByType(FormTextInput)` 精确匹配，再按 props.secureTextEntry 过滤。保存按钮在 ScreenFormLayout 的 footer prop 里，mock 布局组件时记得把 footer 透传进树，否则 findByType 找不到。
- 测试细节：draft 输入与点保存必须分两个 act（handleSave 闭包捕获渲染时 state 快照，同一 act 内先 onChangeText 再 onPress 会读到旧 draft）；mock readConfig 用 mockImplementation 动态返回 bocha configured = saveEngineKey.mock.calls.length > 0，模拟「key 已落库生效」的半程状态。
- prettier 对 screen 有几处历史断行规整（import 合并、长表达式换行），顺手 --write，无逻辑变化；worktree 上 eslint 对测试文件的 project-service 报错是既有环境问题（见全局约束），不当回归。
- worktree 里残留的 M package-lock.json 与未跟踪 docs/apm/memory/20260906-web-search-tool-overflow-sink.md 非本节点产物，未纳入提交。
