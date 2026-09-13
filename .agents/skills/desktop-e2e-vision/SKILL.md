---
name: desktop-e2e-vision
description: novel-master 桌面端（Electron）自动化回归测试：Playwright _electron 脚本驱动功能走查 + vision 子代理（glm-5.3-flash）逐张截图审查 + 问题登记到 bug 记录表 PRD。需要回归桌面端、验证桌面端功能、跑桌面端 e2e、或审查桌面端截图时使用。
---

# 桌面端 e2e 回归（脚本 + vision 审查）

## 总流程

每轮回归 = 「环境确认 → 写/跑用例脚本（截图+错误收集）→ vision 子代理审查截图 → 结论判定（脚本侧问题修脚本，产品侧问题登记 PRD）→ 覆盖矩阵与记忆更新」。

**基准原则**：桌面端行为不确定时，以手机端实现为基准做判断（用户拍板）。发现的问题登记到 `docs/iterations/desktop-regression-fixes-2026-09/prd.md`（bug 记录表，编号 D-x 缺陷 / S-x 系统性，已排除的条目保留并标注「已排除」）。

## 1. 环境（一次准备，每轮确认）

测试一律在专用 worktree 跑（不与主工作区打架）：`.worktree/desk-e2e-test`。无此 worktree 时从 main 现建（e2e 资产已随 v1.5.15+ 入库 main 的 `scripts/e2e`，旧的专用分支已清理）：

```bash
git worktree add .worktree/desk-e2e-test -b test/desk-e2e-regression main
```

```bash
# 首次/依赖变更后：
cd .worktree/desk-e2e-test && npm install
npm run build -w @novel-master/desktop
cd apps/desktop && node scripts/rebuild-native.mjs
```

前置校验（主因症状：白屏/Failed to open database/React 版本报错）：
- `apps/desktop/node_modules/react` 与 `react-dom` 必须同为 19.2.7（lockfile 嵌套副本；顶层 19.2.3 是 mobile 用的，不配对）
- better-sqlite3 须为 Electron 35 ABI（rebuild-native 的 prebuild fallback）
- 改过依赖后清 vite 预构建缓存 `apps/desktop/node_modules/.vite` 与 `.vite-temp`

## 2. 测试资产（/tmp/nm-desktop-e2e/）

| 文件 | 用途 |
|---|---|
| `lib.mjs` | 公共启动器：launchApp（vite 后台 + _electron + NOVEL_MASTER_DB 隔离库）、startMock（OpenAI SSE mock）、shot、goToProjects/enterProject/closeOverlays |
| `case-*.mjs` | 独立用例（压缩/技能/批注/搜索…），**一例一进程**：每例自起自关，弹层与视图状态天然重置 |
| `coverage.md` | 覆盖矩阵：CHANGELOG 全功能域 × 已测/未测/不测状态，每轮更新 |
| `out/` | 截图与 steps.json |

测试库：`/tmp/nm-desktop-e2e/data/novel.db`（`NOVEL_MASTER_DB` 指向，与真实 userData 完全隔离；复用可保留跨轮数据，需要冷启动场景时清空）。造统计数据可直接 python sqlite3 写 chat_message 的 token 列。

选择器速查与已知坑见 [references/selectors.md](references/selectors.md)（写用例前必读，能省掉 80% 的定位试错）。

## 3. 用例编写要点

- **一例一进程**：新功能写新 `case-xxx.mjs`，import lib.mjs；不要在一个长脚本里串多个功能（弹层叠加状态是前三轮最大的时间黑洞）
- 每步截图（`shot(page, id, name)`）+ console/pageerror 分窗口收集（errors 数组在 shot 间切片，定位是哪一步引入）
- 文本匹配选择器必须**特异**（如「批注」会撞文件页签 label「批注测试.md」）；弹层内元素优先用 data-* 属性或 placeholder 定位
- playwright 点击超时且无报错时：`elementFromPoint` 诊断命中 + `page.evaluate(() => el.click())` JS 直点兜底
- 需要真实 LLM 交互的用例接 `startMock()`（SSE 流式 + usage）；统计/大数据场景直接写库
- 结束务必 `shutdown(app, mock)`（杀 vite 孤儿进程；只杀父进程不够）

## 4. vision 审查（每批截图跑完即派）

用 `subagent` 工具派 `vision` agent（glm-5.3-flash，能读图）。派遣模板见 [references/vision-prompt.md](references/vision-prompt.md)，要点：

- 给足背景：应用布局、每张截图的预期状态、脚本侧已知的疑点（vision 常能直接定位断链在哪一步）
- 要求：逐张报告、引用画面可见文字、按严重度汇总（阻塞性/明显/轻微）、看不清就明说不要猜
- vision 擅长抓：静默失败（md5 比对前后截图无差异）、渲染异常、暗色残留、文案/风格不一致；它给的是**观察**，产品是否算 bug 由主代理对照手机端口径判定
- vision 的审查记录会自己追加到 `docs/apm/memory/20260906-desktop-e2e-screenshot-review.md`

## 5. 结论三分类

1. **脚本侧问题**（选择器/时序/状态没到）→ 修脚本重跑，不算产品缺陷
2. **产品缺陷/UX 问题** → 登记 PRD（编号顺延，写现象+影响评估+根因（能查则查代码）+手机端基准参照+复现截图编号）
3. **设计意图/特性** → 标注定性不登记（如 CodeMirror 自动续接列表、折叠消息）

## 6. 每轮收尾（不可省）

1. 更新 `coverage.md`（本轮覆盖项 ✅/❌/◻️/🔧）
2. 新问题登记 PRD bug 记录表
3. apm 记忆：追加到 `docs/apm/memory/20260906-desktop-e2e-regression-pipeline.md`（用户请求 + 本轮范围/结论/新坑），刷新 frontmatter date
4. 汇报：通过面、新问题（编号+严重度）、剩余未测优先级
