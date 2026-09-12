# CR Fix Spec: 导出命名·文件链接跳转·技能管理优化（CR round 2，已确认执行）

## 元信息

- repo：novel-master（worktree：export-link-skill-mgmt）
- base_sha：5234817f（main）
- head_sha：26f4d8b7
- prd_path：docs/Iterations/export-link-skill-mgmt-2026-09/prd.md（总纲）+ features/{export-naming,chat-link-file-nav,skill-rename-description}/prd.md
- spec_path：docs/Iterations/export-link-skill-mgmt-2026-09/features/{export-naming,chat-link-file-nav,skill-rename-description}/spec.md
- review_round：2
- dag_version：3
- 状态：confirmed（用户已确认按本 fix-spec 执行，2026-09-10）

> 行号勘误说明：条目文件行号以 head_sha 实际代码为准；round 1 评审原单与 round 2 复核各修正过一批（round 2 勘误：MF-1 的 66/69→61/64、MF-2 的 126-131/133-138→124-129/130-135、MF-4 main.ts 的 129,135→126,131、MF-6/MF-8 问题栏描述口径修正，均以实际值为准）。

## Must-fix（按 P0 → P1 → P2）

本轮无 P0。

### MF-1 [P1] skill/B-1 String.replace 字符串替换的 $ 序列展开会静默损坏 front matter

- 维度：B（正确性缺陷）
- 文件：`packages/core/src/domain/skills/logic/with-skill-front-matter-values.ts:61,64`
  - 第 61 行：`fm.replace(re, fmLine(key, value))`——replacement 为字符串形式
  - 第 64 行：`source.replace(match[0], `---\n${fm}\n---\n`)`——replacement 为模板字符串
- 问题：
  `String.prototype.replace` 的 replacement 参数为字符串时，`$$`、`$&`、`$'`、`` $` `` 会被特殊展开，而非按字面写入。两个具体损坏路径：
  1. **键行替换**：既有键（如 `description`）的替换值经 `fmLine(key, value)` 生成字符串后传入 `fm.replace`——描述里含 `$$` 会被折叠成单个 `$`，含 `$&` 会在替换位注入整个匹配行（原键值行），落盘即损坏。
  2. **front matter 整体重写**：`source.replace(match[0], `---\n${fm}\n---\n`)` 的 replacement 里嵌着保留下来的原键值行（`fm`）——这些行含 `$'` 或 `` $` `` 时，会把匹配位置之后/之前的正文展开进 front matter 区域，静默损坏文件。
  该问题沿袭自回收前的双端私有实现（本次 diff 将其回收进 core 时原样带入），非本次引入，但回收为单源后正是一并修正的时机。
- 改法：
  两处 replacement 改为**函数形式**（函数形式不做 $ 序列展开）：
  1. 第 61 行改为 `fm.replace(re, () => fmLine(key, value))`
  2. 第 64 行改为 `source.replace(match[0], () => `---\n${fm}\n---\n`)`
  同时 T-S1 单测（`withSkillFrontMatterValues` 的 core node:test 用例）补两组边界：
  - `description` 含 `$$` / `$&` / `$'` 的值，改写后读回与提交值逐字一致（不折叠、不注入、不展开）；
  - 保留的原键值行（非本次改写目标）含 `$'` / `` $` `` 序列时，正文不展开进 front matter。
- 验收：
  - core 单测全绿（`npm test -w @novel-master/core` 范围内 T-S1 及既有用例）；
  - 真机/桌面改描述为含 `$$` 的文本，保存后读回与提交值逐字一致。
- 来源：review round 1（首轮全量评审）

### MF-2 [P2] chatlink/B-1 will-navigate 无条件拦截阻断 dev 模式 vite full-reload

- 维度：B（正确性缺陷，仅 dev）
- 文件：`apps/desktop/src/main/main.ts:124-129`（will-navigate 拦截器；相邻 130-135 为 setWindowOpenHandler，行为正确不动）
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
  - `apps/desktop/src/main/main.ts:126,131`（`will-navigate` 与 `setWindowOpenHandler` 各一处 `/^https?:\/\//i.test(url)` 内联）
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
  `onRowsClick` 对 `<a>` 空 href（`''`）分支（不拦截、不上抛、放行默认行为）无用例覆盖（「无 href（`getAttribute` 返 null）」已有用例覆盖于 rows-click-anchor.test.ts:132，仅空字符串分支裸奔），回归风险。
- 改法：
  补用例：fake 元素 `tagName: 'a'`、`getAttribute('href')` 返回 `''`（空字符串），点击后断言——`preventDefault` 未被调用、`postMessage` 未被触发（不上抛 RN）。与 132 行既有无 href 用例并列。
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
  desktop 判定与提交均先 `trim()`，mobile 两处均用原值——输入首尾空白时：mobile 会把带空白的描述原样落盘（desktop 落盘 trimmed），双端同一输入读回不一致；且 mobile 的「无实际变更」判定（`nameChanged`/`descChanged`）会被首尾空白欺骗，误判为有变更提交。（注：名字不会被带空白落盘——`validateSkillName` 对含空白名返回 reason 拦住提交；实际落盘面仅描述与变更判定。）
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

### MF-10 [P2] 双端技能管理页头注释未随菜单扩展更新（注释漂移）

- 维度：C（注释与实现不一致）
- 文件：
  - `apps/desktop/renderer/features/settings/SkillsManageView.tsx:7`（头注仍写「⋮ 菜单：编辑 / 删除」）
  - `apps/mobile/src/screens/stack/SkillsSettingsScreen.tsx:7`（头注仍写「行 ⋮ 菜单：导出 ZIP / 删除」）
- 问题：本迭代把行菜单扩为 desktop 四项（编辑/编辑信息/导出 ZIP/删除）、mobile 三项（编辑信息/导出 ZIP/删除），两处头注停在旧清单，读者按注释理解会漏新入口。
- 改法：头注更新为实际清单，并在「编辑信息」处保留一句 invalid 禁用口径。
- 验收：grep 头注与 menuItems 实际项一致；无需新测试。
- 来源：review round 2（review-full 新发现 N-1）

### MF-11 [P2] desktop SkillInfoEditModal 提交无 catch，与 mobile 错误处理不对称

- 维度：B（错误处理边界；与 MF-7/MF-8 同族的双端口径分叉）
- 文件：`apps/desktop/renderer/features/skills/SkillInfoEditModal.tsx:74-107`（`handleConfirm` 为 `try { … } finally { setSaving(false) }`，无 catch）
- 问题：handler 侧有 try/catch 包成 `{ok:false}`，正常路径不 reject；但 IPC 极端失败（bridge 断连等）时 promise reject 变 unhandled rejection（用户无提示）；mobile 同名弹窗（:105-107）有 `catch → setError`。
- 改法：`finally` 前补 `catch (err) { setError(err instanceof Error ? err.message : String(err)); return; }`（对齐 mobile；catch 内不调 onClose）。
- 验收：desktop 弹窗既有测试不回归；源码断言含 catch 分支（可并入 T-S5 桌面侧断言）。
- 来源：review round 2（review-full 新发现 N-2）

### MF-12 [P2] desktop 搜索结果面板接入链接跳转（与正文行为一致，用户拍板）

- 维度：A/C-orch（行为一致性）
- 文件：`apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx:271`（消费 MessageList 处）
- 问题：搜索结果面板复用 MessageList 渲染富文本，但未传 `onLinkClick`——路径链接点击 no-op，与正文行为不一致。
- 改法：接线 `openChatLink`（route params 已带 projectId+sessionId，与 ConversationPanel 同源；复用 ShellNavProvider 的 openChatLink 或等价传递链）。
- 验收：搜索面板内路径链接可应用内打开；desktop 既有搜索相关测试不回归；补一条源码/静态接线断言。
- 来源：待拍板第 1 项，用户拍板「desktop 要一致」

## Spec deviations

- none（两轮评审均未认定 spec 偏离；open questions 中第 1 项若拍板「不补」则无偏离，若拍板「补」则以本 fix-spec 增补承载）

## Open questions / 待拍板

（round 2 已全部处置，见「已豁免」与 MF-12）

## 已豁免（用户确认不修）

- **invalid 技能仅改描述 core 层静默 no-op**：维持现状不加显式错误码（用户确认；UI 已禁入口把住主路径，用户无此场景）。
- **href 带 `?query` 不剥离**：参考 Typora 不处理，带 query 归一化为整串路径探测必 miss、安全 no-op（用户确认）。
- **export 三条备注**：接受现状（a. desktop 文件分支测试空档不补；b. desktop 导出无 busy 防重入有惯例支撑；c. 技能名含路径分隔符属既有契约）。
- **desktop buildNewSkillDoc 裸标量漂移**：BASE 既有问题不在本 diff，不顺带收敛。
- **事务外存在性检查 TOCTOU 窄口**：接受现状（回滚无损，仅极窄窗口提示不友好）。

## 合并后 QA（manual_user）

以下真机验收项不阻塞合并（blocking: no），合并后请验收：

- **T-E7**（export-naming）：真机/桌面双端导出数据库、技能、工作区根与子目录，目检保存框默认名；desktop 导出的技能 ZIP 在 mobile 导入成功。
- **T-L7**（chat-link-file-nav）：Step 8 真机验收矩阵。
- **T-S7**（skill-rename-description）：Step 8 真机验收（含 MF-1 修复后的 `$$` 描述读回一致性抽查）。

## K 节建议（下游执行时闭合）

- 无收尾项：round 2 全维核查——CHANGELOG Unreleased 三 feature 条目完整（新增 3 + 变更 1 + 修复 1）且口径符合「用户实际见过的行为」；diff 内新增代码零调试残留（console.log/TODO/FIXME/debugger 全扫无命中）；worktree 工作区干净、无残留处置项。

---

# Round 3（diff 模式：真机验收轮增量 CR）

- 范围：e4daaec3..adb2c793（90568909 linkify / da4bc8f1 详情页移除 / 2bf999c0 未命中提示 / adb2c793 措辞与省略）
- review_round：3（diff 单轮）· dag_version：4 · 状态：executed（用户确认修复，2026-09-12 全部闭合）

## Must-fix（round 3，全部 P2）

### MF-R3-1 linkify 黑名单漏可达的两字符国别码撞车扩展
- 文件：apps/mobile/src/components/rich-content/prepare-transcript-rich-html.ts（+ 测试）
- 问题：实测 main.tf/main.cc/main.ml/Makefile.in/x.cl/y.sc/z.st/w.as 仍被链接化（两字符国别码撞车）；zip/app/page/link/file/mov 在 linkify-it 5 默认表下不可达（防御冗余，无害但注释与事实不符）。
- 改法：Set 补 'tf','cc','ml','in','cl','sc','st','as'；注释补「默认 TLD 表=16 项+两字符国别码全表+xn--，清单只盯可达撞车项，其余前向防御」；测试补 main.tf/Makefile.in 可达断言。
- 验收：mobile jest 全绿；真机 main.tf 纯文本（webview 变更须 npm run android 全量重装）。

### MF-R3-2 skill-rename-description PRD/spec 未同步「详情页入口移除」拍板
- 文件：docs/Iterations/export-link-skill-mgmt-2026-09/features/skill-rename-description/{prd.md,spec.md}
- 改法：照 chat-link 先例补「2026-09-12 用户拍板移除详情页入口，收敛为管理页行菜单单点（desktop 管理页侧 viewingSkillRef 同步保留）」标注；Step 4/5 加勘误注记不重写。
- 验收：文档与 CHANGELOG「技能管理页行菜单」口径一致。

### MF-R3-3 elideChatLinkPath 段数阈值与「超长」拍板口径不符
- 文件：packages/core/src/domain/chat/logic/resolve-chat-link-target.ts:88-96（+ 测试）
- 问题：段数>2 恒省略，/notes/2026/x.md（显示得下）也被压丢中间段；拍板措辞是「超长路径」；文件名/首段本身超长不截断，toast 仍可能撑爆。
- 改法：加显示长度门槛（建议 >20 字符才省略，段数仅作兜底）；JSDoc 补入参契约；测试补边界（纯 /、尾斜杠、超长文件名不截断）。
- 备注：用户确认按「超长才省」长度制执行（门槛 20 字符 + 层数兜底），已按此实施。
- 验收：core 测试全绿 + dist 重建；短路径 toast 完整显示。

### MF-R3-4 mobile SkillDetailScreen 头注漂移
- 文件：apps/mobile/src/screens/stack/SkillDetailScreen.tsx:1-2
- 改法：头注改「技能文件浏览器」口径，保留踢回/守卫说明。

### MF-R3-5 desktop 契约测试注释残留旧文案
- 文件：apps/desktop/test/chat-link-route.test.ts:239
- 改法：注释改「弹『{省略路径} 不存在』提示」。

## Open questions
- MF-R3-3 省略门槛形态（长度制 vs 段数制）待用户拍板。
- 过程记忆中详情页移除提交哈希 3e25868b 实为 da4bc8f1（rebase 变哈希），提请知晓不改。

## K 节（round 3）
1. MF-R3-1 属 webview 变更：真机回归须全量重装 APK。
2. 若采纳 MF-R3-3：重建 core dist。
