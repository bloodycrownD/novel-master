# CR Fix Spec — release-1.5.6

## 元信息

- repo：/home/bloodycrown/Dev/novel-master
- base_sha：ffec472（tag v1.5.5）
- head_sha：5b1105f（main）
- review_round：2
- dag_version：3
- 状态：fix-spec-ready
- 范围：本轮只改文档，不改任何实现代码、不跑测试。下列 Must-fix 的代码与测试修复由后续 fix wave 按条目执行；其中属文档追认/回写性质的条目（markdown-A-1 等）随本 fix-spec 或后续文档 wave 落盘。
- 评审来源：三个 readonly review-scope 节点（curl / token-usage-stats-enhance / markdown-code-block-render），共汇入 must-fix 12 条。
- 参考业务 Spec/PRD（只读）：`docs/Iterations/fetch-tool/`、`docs/Iterations/token-usage-stats-enhance/`、`docs/Iterations/markdown-code-block-render/`

## Must-fix

（本轮无 P0；按 P1 → P2 排列。）

### MF-1 release-1.5.6/stats-B-1 [P1] 流水页加载失败后无限重试

- **id**：release-1.5.6/stats-B-1
- **严重度**：P1
- **维度**：B（行为正确性）
- **文件**：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`
- **问题**：流水页请求失败会进入无限重试循环。`reqDirtyRef` 只在成功分支被置回 `false`，而首页 `useEffect` 的依赖数组里含 `reqLoading`——请求失败后 `finally` 复位 loading 触发 effect 重跑，此时 dirty 仍为 `true`，于是再次发起请求，周而复始。
- **改法**：在 catch 分支中，当 seq 未过期（即本次请求仍是最新一次）时把 `reqDirtyRef.current` 置为 `false`，让失败后的重试交还给用户（切页签 / 改筛选触发）。同时补一个 `mockRejectedValue` 测试，断言请求函数在失败场景下只被调用一次。
- **验收/测试**：新增单测通过——mock 请求 reject 后，effect 不会再次发起请求（调用次数 === 1）；成功路径行为不回归。
- **来源**：release-1.5.6 review-scope（stats 节点）

### MF-2 release-1.5.6/markdown-A-1 [P1] 复制按钮范围蔓延（spec/PRD 未记载，双端已全量实现）

- **id**：release-1.5.6/markdown-A-1
- **严重度**：P1
- **维度**：K（spec / 文档一致性）
- **文件**：`docs/Iterations/markdown-code-block-render/spec.md`、`docs/Iterations/markdown-code-block-render/prd.md`；对应实现：desktop `apps/desktop/renderer/components/`（CodeCopyButton）、mobile `apps/mobile/src/web/shared/code-copy.ts` + fence 注入 `span.code-copy` + `copyCode` 桥 + CSS
- **问题**：PRD「不包含范围」明确排除了复制按钮，spec 的变更点与测试表中也无任何记载，但双端已全量实现复制按钮（desktop CodeCopyButton；mobile code-copy.ts + fence 注入 + copyCode 桥 + CSS）。实现走在了文档前面，spec 无法解释这批代码的来源。
- **改法**：追认（用户口头需求已有实施事实）——spec 补变更点 C-14 起登记复制按钮（desktop CodeCopyButton、mobile code-copy.ts / span.code-copy / copyCode 消息 / CSS；**登记文案须注明 mermaid fence 除外——见 MF-11 口径**），并在测试用例表同步登记；PRD「不包含范围」处补一句范围变更批注（复制按钮经用户口头追加，已实施，随本轮追认）。
- **验收/测试**：纯文档——spec 能完整解释 `code-copy.ts`、`copyCode` 消息与相关 CSS 的来源（变更点与测试表均有对应行）；PRD 批注落盘。
- **来源**：release-1.5.6 review-scope（markdown 节点）

### MF-3 release-1.5.6/curl-C-1 [P2] JSDoc「仅 fetch 工具读取」改名残留

- **id**：release-1.5.6/curl-C-1
- **严重度**：P2
- **维度**：K（注释 / 文档一致性）
- **文件**：`packages/core/src/domain/tool/builtin/builtin-tool-context.ts` L211
- **问题**：JSDoc 注释仍写「仅 fetch 工具读取」，而工具已改名为 curl，注释属改名残留。
- **改法**：注释中的 `fetch` 改为 `curl`。
- **验收/测试**：文件内无 `fetch 工具` 字样残留（grep 校验即可）。
- **来源**：release-1.5.6 review-scope（curl 节点）

### MF-4 release-1.5.6/stats-B-2 [P2] listRequestUsage 的 offset 无有限性校验

- **id**：release-1.5.6/stats-B-2
- **严重度**：P2
- **维度**：B（行为正确性 / 防御性）
- **文件**：`packages/core/src/service/chat/impl/usage-stats.service.ts`（`listRequestUsage`）
- **问题**：`offset` 参数没有 `Number.isFinite` 校验——`NaN` / `Infinity` 一路进 SQL 绑定会直接抛错，与 `limit` 已有的拒收防护不对称。
- **改法**：与 `limit` 同构拒收——`offset` 非有限数值时抛 `chatInvalidArgument`（错误文案对齐 limit 现有口径）。补 `NaN` 与 `Infinity`（正负）用例。
- **验收/测试**：新增单测通过——`offset: NaN`、`offset: Infinity`、`offset: -Infinity` 均以 `chatInvalidArgument` 拒收，不触达 SQL 绑定。
- **来源**：release-1.5.6 review-scope（stats 节点）

### MF-5 release-1.5.6/stats-B-3 [P2] 流水行 key 三元组会碰撞

- **id**：release-1.5.6/stats-B-3
- **严重度**：P2
- **维度**：B（行为正确性）
- **文件**：`apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx`
- **问题**：流水行 React key 用 `createdAtMs-modelName-promptTokens` 三元组拼接——同一毫秒内同模型、同 promptTokens 的两行会得到相同 key，触发渲染异常与告警。
- **改法**：key 改为 `` `${row.createdAtMs}-${index}` ``，与 desktop 现行口径一致。
- **验收/测试**：构造同毫秒、同模型、同 token 数的两行数据，渲染无 key 冲突告警（或按项目既有 key 测试模式补断言）。
- **来源**：release-1.5.6 review-scope（stats 节点）

### MF-6 release-1.5.6/stats-C-1 [P2] 纯函数双端逐字重复 + 同体函数未合并 + 注释失真

- **id**：release-1.5.6/stats-C-1
- **严重度**：P2
- **维度**：C（代码复用 / 重复）
- **文件**：`apps/desktop/renderer/…`（统计页）与 `apps/mobile/src/screens/stack/TokenUsageStatsScreen.tsx` 中的 `pageWindowItems` / `formatRequestTime` / `formatDurationMs` 等；desktop 文件内 `formatFirstTokenMs` 与 `formatDurationMs` 同体；desktop `REQUESTS_PAGE_SIZE` 注释
- **问题**：`pageWindowItems`、`formatRequestTime`、`formatDurationMs` 等纯函数在双端逐字重复；desktop 文件内 `formatFirstTokenMs` 与 `formatDurationMs` 是同一个函数的两份拷贝；desktop `REQUESTS_PAGE_SIZE` 旁注释写「与 mobile 同口径」，但 mobile 页大小已改为 10（desktop 50），注释失真。另 `formatTokenCount` 实存三份：core/common 一份、`apps/desktop/shared/logic/format-token-count.ts` 一份（文件头自认等价复制）、mobile 已走 core 导入。
- **改法**：纯函数下沉到 `@novel-master/core` 的 common（mobile 已有 `formatTokenCount` 下沉先例可循）；desktop 文件内同体的 `formatFirstTokenMs` / `formatDurationMs` 合并为一份；desktop `shared/logic/format-token-count.ts` 本地拷贝删除、改从 `@novel-master/core/common` 导入；`REQUESTS_PAGE_SIZE` 注释改为「core 限制 1–200，desktop 取 50」。
- **验收/测试**：下沉后双端各删一份本地实现、引用 core 导出；双端 typecheck 通过；分页窗口与时间格式化既有测试不回归（如有快照随迁移更新）。
- **来源**：release-1.5.6 review-scope（stats 节点）

### MF-7 release-1.5.6/stats-C-2 [P2] UsageStatsModelRow JSDoc 嵌套畸形

- **id**：release-1.5.6/stats-C-2
- **严重度**：P2
- **维度**：K（注释 / 文档一致性）
- **文件**：`packages/core/src/service/chat/usage-stats.port.ts` L85-87
- **问题**：`UsageStatsModelRow` 的 JSDoc 出现嵌套畸形（注释块套注释块的残缺形态）。
- **改法**：恢复为单层 JSDoc（一个 `/** … */` 块完整描述该类型）。
- **验收/测试**：目视/grep 确认该类型上方为合法单层 JSDoc；typecheck 通过。
- **来源**：release-1.5.6 review-scope（stats 节点）

### MF-8 release-1.5.6/stats-G-1 [P2] boot version 升级路径无回归测试锁定

- **id**：release-1.5.6/stats-G-1
- **严重度**：P2
- **维度**：G（测试缺口）
- **文件**：`packages/core/test/bootstrap/schema-align-columns.test.ts`（同目录已有「全新库快路径」用例 L274 附近，新增用例紧随其后）
- **问题**：本轮修掉的「align 加列但未 bump 版本 → 快路径永不补列」这一 bug，没有任何测试锁定——现有 bootstrap 用例都从低版本库起步，覆盖不到「版本已是最新、但表结构缺列」的错位状态。
- **改法**：补一个用例：模拟 v8 库（`user_version=8`、`chat_message` 表无 `first_token_ms` / `duration_ms` 两列）→ 执行 bootstrap → 断言两列补齐、版本升到 `SCHEMA_BOOT_VERSION`。
- **验收/测试**：该新增用例通过，且能在本 bug 的回归形态（缺列 + 版本未 bump）下失败（即真正起到锁定作用）。
- **来源**：release-1.5.6 review-scope（stats 节点）

### MF-9 release-1.5.6/markdown-G-1 [P2] T-CB14 编号被复制按钮用例挪用

- **id**：release-1.5.6/markdown-G-1
- **严重度**：P2
- **维度**：K（spec / 文档一致性，测试编号契约）
- **文件**：`docs/Iterations/markdown-code-block-render/spec.md`（测试用例表）；涉及双端复制按钮相关测试文件
- **问题**：spec 定义 T-CB14=真机批注回归、T-CB15=流式验收，但复制按钮用例挪用了 T-CB14 编号。此前 cr-fix-spec 的 OQ3 仍挂着「T-CB14 未执行」，QA 按编号追踪会把「复制按钮用例已过」误判成「真机批注回归已过」。
- **改法**：复制按钮用例改用新编号 T-CB16 / T-CB17；spec 测试用例表同步登记这两个新编号及其归属（复制按钮）；T-CB14 / T-CB15 保留原语义（批注回归 / 流式验收）。mobile `code-block-render.test.tsx`「所有代码块带复制按钮」断言须随 MF-11 同步改写为「mermaid 无复制按钮」（同一断言块）。**执行顺序：MF-11 → MF-9 → MF-2（或在同一编辑内一并完成），避免各条独立执行互相回冲。**
- **验收/测试**：spec 测试表中 T-CB14 / T-CB15 / T-CB16 / T-CB17 四个编号语义唯一、无挪用；OQ3 的「T-CB14 未执行」表述与原语义对齐。
- **来源**：release-1.5.6 review-scope（markdown 节点）

### MF-10 release-1.5.6/markdown-B-1 [P2] desktop 复制按钮 clipboard promise 未处理 + 卸载后 setCopied 遗留

- **id**：release-1.5.6/markdown-B-1
- **严重度**：P2
- **维度**：B（行为正确性 / 防御性）
- **文件**：`apps/desktop/renderer/components/code-block.tsx` L73-78
- **问题**：`navigator.clipboard.writeText(...)` 返回的 promise 无 `.catch`——复制失败（如剪贴板权限被拒）时产生 unhandled rejection 且用户无任何反馈；同时组件卸载后 `setTimeout` 回调里的 `setCopied` 仍会执行（对已卸载组件 setState）。
- **改法**：给 `writeText` 补 `.catch`（静默吞掉或置失败样式，二选一由实现轮定，倾向静默 + console.debug）；`setCopied(true)` 的定时器句柄在卸载时清理（`useEffect` return 里 `clearTimeout`），或用 ref 守卫跳过卸载后的 setState。
- **验收/测试**：desktop 现有测试基建为 node:test + `renderToStaticMarkup` 静态渲染（不跑 effect、无法 unmount/交互），故验收降级为**源码级断言**——`writeText` 调用链上存在 `.catch`、卸载路径存在定时器清理（clearTimeout 或 ref 守卫）；交互级测试（jsdom + react-dom/client）是否立项见 Open questions 第 6 条，不阻塞本条。
- **来源**：release-1.5.6 review-scope（markdown 节点）

### MF-11 release-1.5.6/markdown-C-orch-1 [P2] 复制按钮对 mermaid 块双端不一致

- **id**：release-1.5.6/markdown-C-orch-1
- **严重度**：P2
- **维度**：C（双端一致性 / 编排口径）
- **文件**：`apps/mobile/src/web/shared/code-copy.ts`（fence 注入逻辑）、desktop `apps/desktop/renderer/components/`（MermaidBlock / code-block 分流）；双端相关测试
- **问题**：mobile 侧所有 fence（含 mermaid）都注入复制按钮，而 desktop 侧 mermaid 走 `MermaidBlock` 渲染、没有按钮。结果在 mermaid 失败态 / 流式占位态：mobile 可复制源码、desktop 不行，双端行为分裂。
- **改法**（建议口径：「mermaid 不是普通代码块」）：mobile fence renderer 对 `rawLang === 'mermaid'` 不插 `span.code-copy`（与 desktop 对齐）；双端测试补对齐断言（mermaid 块无复制按钮）。
- **验收/测试**：双端各补一条断言——mermaid fence 不出现复制按钮 / 不响应复制委托；普通代码块按钮不回归。
- **来源**：release-1.5.6 review-scope（markdown 节点）

### MF-12 release-1.5.6/markdown-G-2 [P2] copyCode 链路零测试

- **id**：release-1.5.6/markdown-G-2
- **严重度**：P2
- **维度**：G（测试缺口）
- **文件**：`apps/mobile/src/web/shared/code-copy.ts`（`attachCodeCopyDelegation`）；两个 RN 宿主的 `handleMessage`（`copyCode` → `Clipboard.setString` 分支）；desktop `CodeCopyButton` 相关测试
- **问题**：`attachCodeCopyDelegation` 的委托命中、`stopPropagation`、`textContent` 收集、copied 超时、幂等守卫均无用例；两个 RN 宿主 `handleMessage` 的 `copyCode → Clipboard.setString` 分支也无用例；desktop `CodeCopyButton` 目前只有静态断言。
- **改法**：补 `code-copy.ts` 单测（jsdom 环境 dispatch click + mock `post`，覆盖上述五个行为点）；补两个宿主桥测（mock message 事件触发 `handleMessage`，断言 `Clipboard.setString` 被调用且参数为收集到的文本）。
- **验收/测试**：上述新增用例全部通过；desktop 侧如可行补交互级断言（click → clipboard 调用），至少不再只有静态断言。
- **来源**：release-1.5.6 review-scope（markdown 节点）

## Spec deviations

stats（token-usage-stats-enhance）：

1. **流水页签整体为 spec 外追加**：用户口头追加需求、已有实施事实（同 markdown-A-1 性质），随本 fix-spec 追认——待补入 spec 变更点与测试表。
2. **空态横杠**：空态展示横杠为用户拍板偏离（原 spec 验收文案为「暂无数据」）。
3. **mobile 网格线 2 条 vs spec 3 条**：轻微偏差，随本 spec 备案。
4. **页大小 mobile=10 / desktop=50**：用户拍板偏离；desktop `REQUESTS_PAGE_SIZE` 注释随 stats-C-1 一并修正为「core 限制 1–200，desktop 取 50」。

markdown（markdown-code-block-render）：

1. **复制按钮**：PRD「不包含范围」排除但已实现，见 Must-fix MF-2（markdown-A-1）追认。
2. **T-CB14 编号挪用**：见 Must-fix MF-9（markdown-G-1）。
3. 前一轮 cr-fix-spec 的 MF-1 / MF-2 已闭合，本轮无新偏差。

curl（fetch-tool）：本轮 must-fix 仅 curl-C-1 注释残留，无 spec 偏差新增；spec 层悬置项见 Open questions 1–3。

## Open questions / 待拍板（不阻塞本 fix-spec）

1. **curl SSRF 前提失效**：spec「不做私网拦截」的理由建立在只读 GET 的前提上，而现在 curl 已可带 `Authorization` / `Cookie` 对内网发起写操作——前提不再成立，建议重拍板。低成本门可考虑：拒 IP 字面量直连。
2. **curl 空串 body 语义不对称**：`GET + ""` 拒收、`POST + ""` 静默不发，两端口径不一致，需拍板统一（拒收或放行，选一边）。
3. **curl PRD 未回写**：PRD 仍写「不包含 POST / 自定义头」，与实现不符，待回写。
4. **stats 口径四连**：内部重试的 `durationMs` 口径；负耗时行采集侧置 NULL；流水对「仅耗时无 token」行的覆盖；双端空态文案 parity。
5. **markdown 沿挂 OQ**：RN bundle 实测数字回填；双端 hljs 色表契约锁；Step 10 真机人工验收（原义 T-CB14 批注回归 + T-CB15 流式）；desktop `.hljs-*` 选择器作用域；缩进 code block 防回归；前一轮 OQ6。
6. **desktop 交互级测试基建**（review-full/G-1 提出）：是否引入 jsdom + `react-dom/client` 以支撑复制按钮点击行为、unmount 清理等交互用例——影响 MF-10 / MF-12 desktop 侧的验收上限，立项与否待拍板，不阻塞本轮。

## 已豁免

（无）

## 合并后 QA（manual_user）

- 1.5.6 三批功能（curl / 统计流水 / 代码块复制）真机双端走查，重点：
  - 复制按钮点击 → 剪贴板粘贴验证（普通代码块应有内容；mermaid 块按 MF-11 口径无按钮）。
  - mermaid 图表渲染回归（失败态 / 流式占位态双端表现一致）。
  - 统计流水翻页 / 跳页（含失败后手动切页签 / 改筛选触发重试，验证 MF-1 修复后无自动风暴）。

## K 节建议（spec / 文档后续动作）

1. 本轮 diff 内 lint / format 检查。
2. `docs/Iterations/` 三个迭代（fetch-tool、token-usage-stats-enhance、markdown-code-block-render）的 spec 状态字段更新为已发布。

## Fix-Spec Closure

| 项 | 状态 |
|------|------|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/release-1.5.6/cr-fix-spec.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 2 / 10（MF-1~MF-12；review-full 3 条修订已并入 MF-2/6/8/9/10 与 OQ6，非独立条目） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | 全部处置：追认 2 项待随 MF-2/流水分期落盘，其余拍板备案 |
| C-orch | ✅（stats 双端 parity、markdown 双端同表/色表已查） |
| C 类合并后 QA | 真机双端走查复制按钮→剪贴板、mermaid 回归、流水翻页（见「合并后 QA」段） |
