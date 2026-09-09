# CR Fix Spec: 导出命名·文件链接跳转·技能管理优化（CR round 1）

## 元信息

- repo：novel-master（worktree：export-link-skill-mgmt）
- base_sha：5234817f（main）
- head_sha：26f4d8b7
- prd_path：docs/Iterations/export-link-skill-mgmt-2026-09/prd.md（总纲）+ features/{export-naming,chat-link-file-nav,skill-rename-description}/prd.md
- spec_path：docs/Iterations/export-link-skill-mgmt-2026-09/features/{export-naming,chat-link-file-nav,skill-rename-description}/spec.md
- review_round：1
- dag_version：2
- 状态：draft

> 行号勘误说明：以下条目文件行号均已按 head_sha 实际代码逐一核对；评审原单个别行号与实际有出入（skill/C-3 的 yamlScalar、chatlink/C-1 的两处 HTTPS_PATTERN、skill/C-1 的 desktop 校验行、chatlink/C-2 的 ShellNavProvider 路径），本文以实际行号为准，条目内注明。

## Must-fix（按 P0 → P1 → P2）

本轮无 P0。

### MF-1 [P1] skill/B-1 String.replace 字符串替换的 $ 序列展开会静默损坏 front matter

- 维度：B（正确性缺陷）
- 文件：`packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:66,69`
  - 第 66 行：`fm.replace(re, fmLine(key, value))`——replacement 为字符串形式
  - 第 69 行：`source.replace(match[0], `---\n${fm}\n---\n`)`——replacement 为模板字符串
- 问题：
  `String.prototype.replace` 的 replacement 参数为字符串时，`$$`、`$&`、`$'`、`` $` `` 会被特殊展开，而非按字面写入。两个具体损坏路径：
  1. **键行替换**：既有键（如 `description`）的替换值经 `fmLine(key, value)` 生成字符串后传入 `fm.replace`——描述里含 `$$` 会被折叠成单个 `$`，含 `$&` 会在替换位注入整个匹配行（原键值行），落盘即损坏。
  2. **front matter 整体重写**：`source.replace(match[0], `---\n${fm}\n---\n`)` 的 replacement 里嵌着保留下来的原键值行（`fm`）——这些行含 `$'` 或 `` $` `` 时，会把匹配位置之后/之前的正文展开进 front matter 区域，静默损坏文件。
  该问题沿袭自回收前的双端私有实现（本次 diff 将其回收进 core 时原样带入），非本次引入，但回收为单源后正是一并修正的时机。
- 改法：
  两处 replacement 改为**函数形式**（函数形式不做 $ 序列展开）：
  1. 第 66 行改为 `fm.replace(re, () => fmLine(key, value))`
  2. 第 69 行改为 `source.replace(match[0], () => `---\n${fm}\n---\n`)`
  同时 T-S1 单测（`withSkillFrontMatterValues` 的 core node:test 用例）补两组边界：
  - `description` 含 `$$` / `$&` / `$'` 的值，改写后读回与提交值逐字一致（不折叠、不注入、不展开）；
  - 保留的原键值行（非本次改写目标）含 `$'` / `` $` `` 序列时，正文不展开进 front matter。
- 验收：
  - core 单测全绿（`npm test -w @novel-master/core` 范围内 T-S1 及既有用例）；
  - 真机/桌面改描述为含 `$$` 的文本，保存后读回与提交值逐字一致。
- 来源：review round 1（首轮全量评审）

### MF-2 [P2] chatlink/B-1 will-navigate 无条件拦截阻断 dev 模式 vite full-reload

- 维度：B（正确性缺陷，仅 dev）
- 文件：`apps/desktop/src/main/main.ts:126-131`（will-navigate 拦截器；相邻 133-138 为 setWindowOpenHandler，行为正确不动）
- 问题：
  `location.reload()` 同样会触发 `will-navigate` 事件。当前拦截器对一切页内导航无条件 `event.preventDefault()`，导致 dev 模式下 vite 触发的 full-reload（如依赖变更、HMR 失败回退）被拦死，页面停留在旧状态不刷新。生产行为正确（生产无 vite reload，reload 场景本就该拦）。
- 改法：
  `isDev` 时放行 `DEV_SERVER_URL` 同源导航（或等价判定：目标 URL 与当前 `window.webContents.getURL()` 同 origin 且同 path 的导航视为 reload 放行），其余照旧拦截。示例形态：
  ```ts
  window.webContents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith(DEV_SERVER_URL)) {
      return; // dev：vite full-reload 放行
    }
    event.preventDefault();
    if (isHttpUrl(url)) {
      void shell.openExternal(url).catch(() => undefined);
    }
  });
  ```
- 验收：
  - dev 模式下触发 vite full-reload，页面能正常刷新到新构建；
  - 生产路径行为不变：页内导航仍全拦、http(s) 仍转系统浏览器。
- 来源：review round 1

### MF-3 [P2] chatlink/G-1 chat-link-route 测试断言强度与注释不符 + IS_DIRECTORY 用例注释错位

- 维度：G（测试质量）
- 文件：`apps/desktop/test/chat-link-route.test.ts:33-37`（makeVfsRead 的 calls 记录）、`86-108`（T-L6 IS_DIRECTORY 用例）
- 问题：
  1. `makeVfsRead` 的 `calls` 只记录 `{ workspaceScope, path }` 两个字段，而探测请求还携带 `projectId` / `sessionId`（chat 域必传）——测试无法断言请求全字段，探测请求拼错 projectId 时测试不报。
  2. T-L6 用例内注释「`/notes` 是目录：chat 域返回 IS_DIRECTORY 必须按未命中，不得当文件打开」之后的断言却是 session 域命中 preview——注释描述的是「续探」行为，实际用例展示的是「按未命中续探 session 域后命中」，注释与断言错位，易误读为「IS_DIRECTORY 不得打开」的单域用例。
- 改法：
  1. `calls` 记录完整 `req`（`workspaceScope` / `projectId` / `sessionId` / `path` 全字段），各用例断言补 `projectId` / `sessionId`（chat 域断言两者、session 域断言 projectId 且无 sessionId）；
  2. 重写该 IS_DIRECTORY 用例注释为「chat 域 IS_DIRECTORY 按未命中续探 session 域」，说明语义为非 ok 一律按未命中继续探测而非否决；
  3. 补「两域均 IS_DIRECTORY → none」对称用例（table 两 key 均为 `"IS_DIRECTORY"`，断言最终 `{ kind: "none" }`）。
- 验收：
  - `node:test` 直测该文件全绿，且探测请求全字段（scope/projectId/sessionId/path）均有断言覆盖。
- 来源：review round 1

### MF-4 [P2] chatlink/C-1 http(s) 判定正则三处重复

- 维度：C（DRY）
- 文件（三处重复，行号为实际核对值）：
  - `apps/mobile/src/screens/tabs/chat-tab/chat-link-nav.ts:30`（`const HTTPS_PATTERN = /^https?:\/\//i`，44 行消费）
  - `apps/desktop/renderer/features/chat/chat-link-route.ts:37`（同正则本地定义，66 行消费）
  - `apps/desktop/src/main/main.ts:129,135`（`will-navigate` 与 `setWindowOpenHandler` 各一处 `/^https?:\/\//i.test(url)` 内联）
- 问题：
  同一 http(s) 判定知识在 mobile RN、desktop renderer、desktop main 三个入口各持一份正则，口径漂移风险（如未来允许 ws:// 时三处要同步改）。
- 改法：
  - core 新增导出 `isHttpUrl(href: string): boolean`（与 `resolveChatLinkTarget` 同文件：`packages/core/src/domain/chat/logic/resolve-chat-link-target.ts`，经 `@novel-master/core/chat` 出口），实现即 `return HTTPS_PATTERN.test(href)`（正则收编为该文件内部常量）；
  - 三端消费：mobile `chat-link-nav.ts` 删本地 `HTTPS_PATTERN` 改调 `isHttpUrl`；desktop `chat-link-route.ts` 同样替换；desktop `main.ts` 两处内联正则改调（main 进程可经 core 主入口或 chat 子路径消费，与现有 core import 方式一致）；
  - core 该文件内部如有同语义判定一并替换为 `isHttpUrl`。
- 验收：
  - 三处重复正则消除（grep `https\?:` 全仓只剩 core 一处定义）；
  - T-L1 / T-L5 / T-L6 及 mobile rows-click 相关既有用例不回归。
- 来源：review round 1

### MF-5 [P2] chatlink/C-2 探测 miss「留日志」注释与实现不符（生产未接 log）

- 维度：C（注释/契约一致性）
- 文件：
  - `apps/desktop/renderer/features/chat/chat-link-route.ts:14-15`（模块头注「一切非 ok……按未命中并留日志」）、`64`（`const log = deps.log ?? (() => undefined)` 缺省静默）、`88-95`（chat/session 域 miss 处 `log(...)` 调用）
  - `apps/desktop/renderer/providers/ShellNavProvider.tsx:386-404`（`openChatLink` 调 `resolveChatLinkAction` 未传 `log`——生产唯一接线点）
- 问题：
  模块头注承诺「按未命中并留日志」，但生产调用方 `openChatLink` 没传 `log`，`deps.log ?? (() => undefined)` 使日志仅存在于测试注入——注释描述的生产行为实际是静默，契约与实现不符。
- 改法（二选一，倾向方案 a）：
  - **a. 接线（倾向）**：`openChatLink` 的 deps 补 `log: (message, detail) => console.info(message, detail)`——renderer console 语义，生产可观测探测 miss；
  - b. 或改注释为「日志仅测试注入，生产静默」，如实描述现状。
- 验收：
  - 选 a：补源码契约测试（断言 `openChatLink` 构造的 deps 含 log 接线，或以注入 spy 断言 miss 时日志被调用）；
  - 选 b：注释与实现一致即可，无需新测试。
- 来源：review round 1

### MF-6 [P2] chatlink/G-2 rows-click 空 href 分支无行为测试

- 维度：G（测试覆盖缺口）
- 文件：`apps/mobile/__tests__/rows-click-anchor.test.ts`（新增用例，不改既有结构）
- 问题：
  `onRowsClick` 对 `<a>` 无 href / 空 href 的分支（不拦截、不上抛、放行默认行为）无任何用例覆盖，回归风险裸奔。
- 改法：
  补用例：fake 元素 `tagName: 'a'`、`getAttribute('href')` 返回 `''`（空字符串），点击后断言——`preventDefault` 未被调用、`postMessage` 未被触发（不上抛 RN）。
- 验收：
  - `NODE_ENV=test npx jest`（apps/mobile）全绿，含新用例。
- 来源：review round 1

### MF-7 [P2] skill/C-1 双端弹窗校验口径分叉（desktop 本地正则 vs mobile core validateSkillName）

- 维度：C（口径分叉）
- 文件：
  - desktop：`apps/desktop/renderer/features/skills/SkillInfoEditModal.tsx:65`（提交前校验消费本地 `isValidSkillNameInput`，该函数定义在 `apps/desktop/renderer/features/skills/skill-ui.ts:41-44`——裸 `SKILL_NAME_PATTERN.test` 布尔判定）
  - mobile：`apps/mobile/src/components/skills/SkillInfoEditModal.tsx:83-84`（消费 core `validateSkillName`，`@novel-master/core/skills` 子路径已导出，定义在 `packages/core/src/domain/skills/model/skill-name.ts:30`）
- 问题：
  desktop 本地布尔校验相对 core `validateSkillName` 的 reason 全口径**漏两类**：保留名 `SKILL.md`（core 返回具名 reason，desktop 裸正则放行到提交才由后端拒）；空白全口径（如纯空白名 trim 后为空的场景）。且 desktop 错误提示走保存后的 `setError(res.error.message)`，不像 mobile 在输入期即出内联 reason——同一错误双端文案与出现时机不一致。
- 改法：
  - `apps/desktop/shared/logic/skills.ts`（desktop 对 core 的具名薄再导出层）补一行：`export { validateSkillName } from "@novel-master/core/skills";`
  - `SkillInfoEditModal.tsx` 提交前校验改为消费 `validateSkillName(trimmedName)`，以返回的 reason 作内联错误展示（复用现有 error 展示位或输入下方内联提示，与 mobile 的 nameIssue 展示语义对齐）；
  - `isValidSkillNameInput` 既有消费方（`NewSkillModal.tsx:120` 等）**不动**——仅本弹窗切换口径，避免扩散改动面。
- 验收：
  - desktop 弹窗尝试改名为 `SKILL.md`：提示文案与 mobile 相同（同为 core validateSkillName 的 reason 文案），且在提交前（输入期/点保存时）即出现，不再走保存后错误；
  - desktop skills 相关既有测试不回归。
- 来源：review round 1

### MF-8 [P2] skill/C-2 双端提交值 trim 分叉

- 维度：C（口径分叉）
- 文件：`apps/mobile/src/components/skills/SkillInfoEditModal.tsx:83-84`（`nameIssue` / 变更判定消费原值）、`103-110`（提交 `newName: name`、`description` 均原值）
  - 对照 desktop：`apps/desktop/renderer/features/skills/SkillInfoEditModal.tsx:55-58`（判定用 `trimmedName` / `trimmedDesc`）、`78-79`（提交 trimmed 值）
- 问题：
  desktop 判定与提交均先 `trim()`，mobile 两处均用原值——输入首尾空白时：mobile 会把带空白的名字/描述原样落盘（desktop 落盘 trimmed），双端同一输入读回不一致；且 mobile 的「无实际变更」判定（`nameChanged`）会被首尾空白欺骗，误判为有变更提交。
- 改法：
  mobile `nameChanged` / `descChanged` 判定与提交值统一先 `trim()`（对齐 desktop：`const trimmedName = name.trim(); const trimmedDesc = description.trim();` 判定与提交均消费 trimmed 值）。
- 验收：
  - 双端输入首尾带空白的描述，保存后读回一致（均为 trimmed 值）；
  - mobile jest（含 skills 弹窗相关既有用例）全绿。
- 来源：review round 1

### MF-9 [P2] skill/C-3 mobile yamlScalar 死导出

- 维度：C（死代码）
- 文件：`apps/mobile/src/components/skills/skill-ui.ts:47`（`export function yamlScalar(...)`；评审原单记 37-40，实际在 47-50，同文件内 55-56 行消费）
- 问题：
  `yamlScalar` 仅本文件内 `buildNewSkillDoc`（55-56 行）消费，无任何外部 import——`export` 关键字是死导出面，无谓暴露模块内部实现细节。
- 改法：
  去掉 `export` 关键字，降为模块内私有函数（`function yamlScalar(...)`）。
- 验收：
  - mobile typecheck（官方 typecheck 脚本）与既有 jest 全绿。
- 来源：review round 1

## Spec deviations

- none（round 1 未认定 spec 偏离；open questions 中第 1 项若拍板「不补」则无偏离，若拍板「补」则以本 fix-spec 或 spec 增补承载）

## Open questions / 待拍板

1. **desktop 搜索结果面板链接接线**：ChatHistorySearchPanel 消费 MessageList 处未接 `onLinkClick`——路径链接点击 no-op。现状相对基线无劣化（原也无处可跳），但不满足「正文文件链接 100% 应用内打开」口径的自然延伸。接线可行（route params 齐全，复用 openChatLink 即可）。是否补接线请拍板。
2. **invalid 技能仅改描述的 core 层静默 no-op**：`updateSkillInfo` 对 invalid 技能（front matter 不可解析）仅改描述时静默返回成功但不落盘。UI 已禁入口把住主路径（invalid 技能编辑按钮禁用），core 层无显式错误码。是否加显式错误码请拍板。
3. **href 带 `?query` 的归一化**：`resolveChatLinkTarget` 将带 query 的 href 归一化为整串路径探测，必 miss、安全 no-op（Typora 亦不处理 query）。是否剥 query 再探测请拍板。
4. **export scope 三条备注**：a) desktop 文件分支纯函数测试空档可低成本补；b) desktop 导出无 busy 防重入，与库内既有惯例一致、有惯例支撑；c) 技能名含路径分隔符属既有契约（core 校验拒绝），非本 diff 引入。
5. **desktop buildNewSkillDoc 裸标量漂移**：desktop 侧 `buildNewSkillDoc` 未走 yamlScalar 转义，属 BASE 既有问题、不在本 diff 范围（mobile 侧本 diff 已含 yamlScalar，见 MF-9 仅调整其可见性）。
6. **事务外存在性检查的极窄 TOCTOU 窗口**：并发删除下错误码退化为包装文案，事务回滚无损。倾向接受，请确认。

## 已豁免（用户确认不修）

- 暂无。

## 合并后 QA（manual_user）

以下真机验收项不阻塞合并（blocking: no），合并后请验收：

- **T-E7**（export-naming）：真机/桌面双端导出数据库、技能、工作区根与子目录，目检保存框默认名；desktop 导出的技能 ZIP 在 mobile 导入成功。
- **T-L7**（chat-link-file-nav）：Step 8 真机验收矩阵。
- **T-S7**（skill-rename-description）：Step 8 真机验收（含 MF-1 修复后的 `$$` 描述读回一致性抽查）。

## K 节建议（下游执行时闭合）

- 待后续轮次评审补充；round 1 无已认定项。
