# release-1.5.6 三迭代合并 CR fix-spec（spec-fix 节点）

- 日期：2026-08-29
- 节点：spec-fix-release-1.5.6（dag_version=2，review_round=1，状态 draft）
- 仓库主 worktree：base ffec472（v1.5.5）→ head 5b1105f（main）
- 产出：`docs/Iterations/release-1.5.6/cr-fix-spec.md`（目录一并新建）

## 决策记录

- 本轮只改文档，不改实现代码、不跑测试；12 条 must-fix 全部落档，无 P0（P1×2、P2×10）。
- P1 两条：stats-B-1（mobile 统计流水页失败后 reqDirtyRef + reqLoading 依赖导致无限重试）、markdown-A-1（复制按钮 PRD 排除但双端已实现，走追认：spec 补变更点 C-14 起 + PRD 范围批注）。
- markdown 口径：T-CB16/T-CB17 给复制按钮用例，T-CB14/15 保留原语义（G-1）；mermaid 块建议口径「不是普通代码块」，mobile 不插复制按钮（C-orch-1）。
- Open questions 不阻塞：curl SSRF 前提失效（可带凭证写内网，建议低成本门拒 IP 字面量直连）、空串 body 语义不对称、PRD 未回写、stats 口径四连、markdown 沿挂 OQ。

## 注意点

- 评审简报里 mobile `code-copy.ts` 只写了省略路径，实际在 `apps/mobile/src/web/shared/code-copy.ts`，fix-spec 按真实路径落档。
- desktop `REQUESTS_PAGE_SIZE` 注释失真（写「与 mobile 同口径」，mobile 已改 10），随 stats-C-1 改为「core 限制 1–200，desktop 取 50」。
- 后续 fix wave 需按 must-fix 执行代码/测试修复；K 节建议含三个迭代 spec 状态字段更新为已发布。

## fix wave 补记：MF-10（impl-desktop-copybtn）

- 日期：2026-08-29；分支 fix/2026-08-release-1-5-6-cr，单 commit。
- `CodeCopyButton`：`writeText(...).then(...)` 链尾补 `.catch`（console.debug 静默降级）；`setCopied(true)` 复位定时器句柄存 `useRef<number|null>`，卸载 useEffect return 里 `clearTimeout`。
- 验收按 spec 降级口径：desktop 静态渲染跑不了 effect，在 `test/code-block-render.test.tsx` 新增 T-CB16 源码级断言（readFileSync 读源码，断言 writeText 链含 .catch、存在 clearTimeout 与句柄 ref），参照既有读 shell.css 模式。
- 注意：T-CB14 编号归还（MF-9）是另一节点；本次只动 code-block.tsx 与其测试。typecheck + 10 用例全过。

## fix wave 补记：MF-11 → MF-9 → MF-2（impl-markdown-chain，单会话三 commit）

- 日期：2026-08-29；分支 fix/2026-08-release-1-5-6-cr，三 commit：056ae00（MF-11）、5864a25（MF-9）、19ec5d9（MF-2）。
- MF-11：fence renderer 对 rawLang === 'mermaid' 不插 span.code-copy（copyBtn 空串）；mobile 断言 3→2 + 补 mermaid pre 不含 code-copy。
- MF-9：mobile 两用例 T-CB14→T-CB16（渲染）/T-CB17（CSS）；desktop T-CB14→T-CB16/T-CB17（渲染+CSS 合并一例），T-CB3 注释同步。**撞号处理：MF-10 节点已提交的源码级断言暂用了 T-CB16，顺延为 T-CB18**（仅改编号字符串）；spec 测试表登记 T-CB16/T-CB17（含 mermaid 例外）+ T-CB18。
- MF-2：spec 变更点补 C-14~C-17（desktop CodeCopyButton+shell.css / mobile code-copy.ts+copyCode 桥+两 RN 宿主 / fence 注入 span.code-copy 注明 mermaid 除外 / rich-content-styles CSS）；测试表已在 MF-9 commit 内登记（同会话互锁，不重复）；PRD「不包含范围」补范围变更批注。
- 验证：mobile typecheck + jest 12/12、desktop tsx --test 10/10 全过。后续 MF-12 补测试时编号需从 T-CB19 起，勿再撞 T-CB16~T-CB18。

## fix wave 补记：MF-4 / MF-7 / MF-8（impl-core-stats）

- 日期：2026-08-29；分支 fix/2026-08-release-1-5-6-cr，三个单项 commit（d917185 / f6d5359 / 8c148b8）。
- MF-4：`listRequestUsage` 的 offset 补 `Number.isFinite` 校验（与 limit 同构，NaN/±Infinity 走 chatInvalidArgument 拒收），校验顺序调整为先 limit 后 offset 再取值；测试补 NaN/±Infinity 三例断言 /offset/ 拒收。
- MF-7：`usage-stats.port.ts` 里 `UsageStatsModelRow` 的嵌套 JSDoc 恢复单层，语义不变。
- MF-8：`schema-align-columns.test.ts` 新增 A12——先完整 bootstrap，再 `ALTER TABLE chat_message DROP COLUMN` 裁掉耗时两列 + `PRAGMA user_version = 8` 模拟 v8 存量库，二次 bootstrap 后断言两列补齐且 user_version == SCHEMA_BOOT_VERSION（常量从 @novel-master/core 导入，未硬编码）。
- 关键发现：`@novel-master/core` 的 exports 指向 `dist/`，测试里 bootstrap/常量跑的是编译产物——改 src 后必须先 `npm run build` 再跑测试才生效；回归验证（SCHEMA_BOOT_VERSION 回拨 8 + rebuild）确认 A12 会红，锁定效果真实。
- 验证：两测试文件 36 用例全过 + `npm run build` 类型门禁通过。

## fix wave 补记：MF-1/MF-5（impl-mobile-stats）

- 日期：2026-08-29；分支 fix/2026-08-release-1-5-6-cr，单 commit。
- MF-1：`loadRequests` catch 分支在 `seq === reqSeqRef.current` 时同步 `reqDirtyRef.current = false`，断开「失败 → reqLoading 复位 → effect 重跑 → 仍标脏再拉」的循环；重试交给用户切页签/改筛选触发。新用例 mockRejectedValue 后切流水页签，两轮 flush 后仍断言只调 1 次，并做过反向验证（撤修复用例必挂）。
- MF-5：流水行 key 改 `createdAtMs-index`，与 desktop 口径一致，防同毫秒同模型碰撞。
- 注意：工作区同期出现 desktop code-block 两处未提交改动，非本节点产物，未纳入提交。

## fix wave 补记：MF-12（impl-copy-tests）

- 日期：2026-08-29；分支 fix/2026-08-release-1-5-6-cr，单 commit，只新增 `apps/mobile/__tests__/code-copy.test.ts`，不改实现。
- 环境适配：mobile jest 是 RN 环境无 jsdom，fix-spec 原「jsdom dispatch click」验收照 mermaid-fullscreen 样板降级为「读源码 + dist」契约测试。
- 用例 T-CB19（捕获阶段 click 委托 + closest + stopPropagation）/ T-CB20（copyCode 负载 + copied 1500ms + attached 幂等）/ T-CB21（两包 dist app.js 含 code-copy 标记，跑前重建 build:webview）/ T-CB22（双宿主 handleMessage copyCode→Clipboard.setString + 两 bridge 类型定义）/ T-CB23（bind-shell-events 与 rich-document main 挂接）。
- 验证：typecheck 过 + 新文件 5/5 过；全量 jest 有既有失败 tool-policy-picker（工具总数 9→10 文案断言过期），与本节点无关。

## fix wave 补记：MF-6（impl-shared-sink）

- 日期：2026-08-29；分支 fix/2026-08-release-1-5-6-cr，单 commit。
- 架构约束覆盖 fix-spec 原改法：desktop renderer 禁止 import core（eslint X1 门禁），纯函数不能只下沉 core 一份了事——mobile 走 core/common，desktop 在 shared/logic 维护等价镜像，双份文件头互指（对齐 format-token-count 惯例）。
- core 侧：`packages/core/src/common/usage-stats-format.ts` 新建，收编 mobile 屏幕的 pageWindowItems / formatRequestTime / formatDurationMs，经 common barrel 导出；mobile 屏幕删本地实现改 import。
- desktop 侧：`apps/desktop/shared/logic/usage-stats-format.ts` 新建；TokenUsageStatsView 里同体的 formatFirstTokenMs / formatDurationMs 合并为一个 formatDurationMs（秒级 x.x s / 毫秒级 xxx ms / null→—），三处 formatFirstTokenMs 调用点改用合并后函数；视图删本地实现改从 @shared/logic 导入。
- REQUESTS_PAGE_SIZE 注释改「core 限制 1–200，desktop 取 50」；formatTokenCount 维持双副本现状（fix-spec 里「删副本改引 core」违反 X1 门禁，主代理已裁定维持惯例，fix-spec 备注偏离）。
- 验证：core npm run build（common 出口类型门禁）、mobile typecheck + jest 28/28、desktop typecheck + tsx --test 26/26 全过。
