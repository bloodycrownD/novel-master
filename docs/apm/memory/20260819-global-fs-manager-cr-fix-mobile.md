# global-fs-manager CR 修复执行（impl-cr-mobile）

- 日期：2026-08-19
- 分支：feat/skills-integration（主仓），节点 impl-cr-mobile
- 事实来源：docs/Iterations/global-fs-manager/cr-fix-spec.md

## 任务范围（只动 apps/mobile/**）

1. mobile/B-1 [P2]：`GlobalTemplateScreen.tsx` 的 `beforeRemove` 监听原对一切
   移除动作无条件 `preventDefault()` 转上翻，会吞掉 RESET/POP_TO_TOP 清栈
   （如登出）。改法：拦截判定抽为纯函数 `shouldInterceptBackRemove`
   （新文件 `src/screens/stack/global-template-back.ts`），只拦
   `actionType === 'POP' && canGoUp`（侧滑手势与返回按钮的 action type
   均为 POP），其余放行。
2. mobile/G-1 [P2]：补两例测试（`apps/mobile/__tests__/`）：
   - 用例① `vfs-file-manager.breadcrumb.test.tsx`：readOnly 物理树模式下
     mock vfs.list 按路径返回带 label 的合成目录行，逐层进入后断言顶栏
     路径逐段替换（`labelByPathRef` 累积 + `pathWithLabels` 生效），顺带
     断言 `mapVfsListEntry` label 回退分支（行名 = label 而非 basename）。
   - 用例② `global-template-screen.back.test.ts`：判定函数单测替代整屏
     渲染（整屏需真实 native-stack 手势路由环境，成本高且脆弱；拦截逻辑
     已全部收敛在纯函数里）。

## 结果（2026-08-19 执行完毕）

- 顶栏路径 Text 加 `testID="vfs-current-path"`（供组件测试断言）。
- mock 形状要点：label 挂在 `/projects/{pid}` 与 `/projects/{pid}/sessions/{sid}`
  行上，`sessions` 等中间目录行不带 label——label 若挂中间层会把该段整体
  替换掉（pathWithLabels 按累积路径精确匹配）。
- 验证：apps/mobile `npx --no-install tsc --noEmit -p tsconfig.build.json` 通过；
  相关 jest 5 套件 24 例全绿（含红线 `vfs-file-manager.session.integration.test.tsx`）。
- 详见对应 commit（apps/mobile 内 B-1+G-1 一个 commit）。
