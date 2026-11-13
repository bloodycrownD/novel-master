# web-search-curl spec v2：透传改造（delta）

> 背景：用户对 v1 交付的方向性简化指令——「除了 AK 也就是 header json 需要特殊处理外，其他都可以透传，本身就是给 agent 用的」「响应、body 请求也不用管，直接透给 agent」「引擎唯一目的是隐藏 AK 的存在」。v1 的 title/url/snippet 标准化映射是给人看的 UI 需要，agent 不需要；映射配置（resultPath/fieldMap/answerPath/envelope）整体废除。
> 本文件与 spec.md 配对阅读：未提及的一切（存储五键/开关/装配快照/SKSP 通道/DDG 兜底/120s 预算/attempts/50KB 落盘/i18n 通道）**原样保留**。

## 1. 模板类型坍缩

`SearchEngineTemplate` 字段终态：

| 字段 | v1 | v2 |
|---|---|---|
| name / method / url | 有 | 保留不变（GET url 含 `{{query}}/{{count}}`；POST url 为固定 endpoint）（**v3 勘误**：出厂 GET 模板 URL 已去占位符——搜索词/条数全走 params，brave 为纯 endpoint、searxng 改完整端点（含 `?format=json`、无 `q=`）；占位符能力仍对自定义模板开放，见 §9） |
| headers | 有 | 保留不变（唯一特殊处理：`{{apiKey}}` 占位 + SKSP 现读） |
| bodyTemplate | POST 必填 | **改名 defaultBody，可选**——出厂预置各家标准 body（开箱即用），curl `-d` 导入预填，用户可留空（留空则依赖 agent 调用时传 params） |
| paramHint | 有 | 保留（教 agent 该引擎的 body/query 参数） |
| resultPath | 必填 | **删除** |
| fieldMap（title/url/snippet 候选） | 必填三键 | **删除** |
| answerPath | 可选 | **删除** |
| envelope（codePath/okValues/msgPath） | 可选 | **删除** |

## 2. 执行语义（template-engine.ts）

- **POST**：`body = { ...替换后的 defaultBody, ...params }`（浅合并，同名 params 覆盖）。三级自然降级：agent 传完整 params → 全覆盖；传部分（如只调 count）→ 补默认；不传 → 纯默认。defaultBody 与 params 均空 → POST `{}`（引擎自行报错，走链降级）。
- **GET**：URL 占位符替换（`{{query}}` encodeURIComponent / `{{count}}` 数字串 / `{{apiKey}}`/`{{baseUrl}}` 原样）+ params 并入 query string。原样保留。
- **响应**：删整段 fieldMap 候选遍历/resultPath 定位/title 回填/answer 提取/envelope 业务码校验。新逻辑：① 递归（显式栈先序）找**最长的对象数组**（元素为 object 的数组，按长度取最长，平局取先出现）提取；② 提取文本 50KB 字节预算内 JSON.stringify 截断（逐码点、尾部标注）。**找不到任何对象数组 → 判失败走链降级**，错误附脱敏响应摘录（300 字符，同 HTTP 错误口径）——此即链降级判据第三条，天然涵盖 bocha「HTTP 200 + body code 401」类业务码失败。
- **链降级判据坍缩为三条**：HTTP 非 2xx / 超时与网络错 / **响应中找不到对象数组**（天然涵盖 bocha「HTTP 200 + body code 401」类业务码失败——失败响应里没有结果数组）。2xx 且提取到数组 = 成功（哪怕数组短/空，不降级，agent 自己面对）。
- 错误脱敏/引擎显示名/30s 超时（v1 已实现）保留。

## 3. 校验规则（types.ts validateSearchEngineTemplate）

- 删：resultPath 点路径校验、fieldMap 三键候选校验、envelope 全部校验、POST 必有 bodyTemplate。
- 改：bodyTemplate → defaultBody 可选；配了则沿用既有校验（合法 JSON 对象文本、占位符白名单四枚、占位符在字符串值内、JSON key 不含占位符——W1 FIX-4/5 的口径，GET + defaultBody 仍拒绝）。
- 保留：name/method/url 校验（含占位符感知 URL parse）、headers 头名 token 校验（W1 FIX-3）、url/headers/defaultBody 明文密钥检测。

## 4. 出厂模板六份（preset-templates.ts）

删 resultPath/fieldMap/answerPath/envelope 字段；bodyTemplate → defaultBody（六家原 body 原样保留作默认值）；paramHint 保留并按需增强（各家 count 范围/特有参数一句话）。bocha 的 envelope code 200 配置删除（由「找不到数组」判据自然接住其业务码失败）。

## 5. UI 坍缩（双端同构）

详情页字段终态（全平铺，高级折叠区取消）：显示名 / curl 粘贴导入（改）/ method + URL / headers(JSON) / defaultBody（可选，标注「可选：留空则由 agent 调用时传参」）/ AK 注入方式 + key / baseUrl（模板引用 `{{baseUrl}}` 时才出现）/ paramHint / 测试 + 保存 + 恢复默认（预置）/ 删除（自定义）。

- 删：结果数组路径、标题/链接/摘要字段候选、answer 路径、envelope 区、高级折叠容器。
- 帮助弹窗「模板与自定义引擎」段同步简化（不再提响应映射）。
- curl 导入预填：method/URL/headers/body（-d 有则预填 defaultBody）；不再预填 resultPath/fieldMap 默认值。
- 测试按钮：返回「提取数组的前 2 条 JSON 预览 + 截断说明」，不再渲染 title/url/snippet 人类列表。

## 6. 工具面（search-tool.ts）

~~schema 不变：`search(query, engine?, maxResults?, params?)`~~（**v3 收口，拍板 A3 追认**：schema 为 `search(engine?, params?)` 两参——顶层 `query`/`maxResults` 作废，搜索词与条数由 params 承载：搜索词按 `q`/`query`/`search_query` 顺序取首个非空字符串，条数按 `count`/`max_results`/`maxResults` 回落归一 1..20，归一值只喂 {{count}} 占位符与 DDG 客户端截断；params 缺搜索词报可读错误，测试锁 T-S1 反锁两参形态）。description 通用段微调：结果以「JSON 文本」返回（引擎原始响应的结果数组提取），agent 自行读取字段；逐引擎段（paramHint）不变。

## 7. 测试处置

- 删（映射类）：template-engine.test 的 fieldMap 候选遍历/title 回填/resultPath 定位/answer/envelope 用例；preset-templates.test 形状锁中的映射字段断言。
- 改写：响应侧统一改「数组提取 + 截断 + 找不到数组降级」断言；body 浅合并三级语义（全覆盖/部分/纯默认/defaultBody+params 均空 → POST {}）；bocha 业务码失败用例改走「无数组降级」。
- 新增：多数组取最长、平局取先、非对象数组（string[]）不算、空数组 vs 无数组（空数组=成功空结果，无数组=降级）。
- UI 测试：详情页断言随字段坍缩适配；测试按钮预览形态断言更新。
- 作废声明：spec.md T-E6「maxResults 客户端截断」以本文件为准作废——v2 只把归一后的 maxResults 喂给 `{{count}}` 占位符（由模板 URL/body 自行消费），执行器对响应不做客户端截断。

## 8. 明确不变

存储五键布局与归一、引擎开关（默认仅 DDG）、enabledEngines 语义、装配期快照（**v3**：paramHint 不限长、无装配期截断，「500 截断双道」口径作废，见 §9）、SKSP 密钥通道与 `{{apiKey}}` 占位、curl 粘贴导入与密钥检测（含 paramHint 扩扫；**v3**：仅桌面端保留导入入口）、DDG 代码兜底与 HTML 解析、串行链/attempts/120s 预算/50KB 落盘、明文密钥检测、i18n 通道、desktop IPC 八通道（**v3**：`ipcSearchTestEngine` 通道随 testEngine 退役收敛为七通道）、CR W1-W6 全部保留修复（FIX-2 envelope okValues 随字段消亡自然作废）。其余未列项目以 §9 的 v3 勘误为准。

## 9. v3 契约改形（CR 第 4 轮用户拍板追认，2026-11-13）

> 背景：本轮 CR（r1 首审 + r2/r3 复审对账）发现实现已按 v3 形态落码（工具 schema、paramHint、出厂 URL、mobile 功能面、settings i18n），而 §1-§8 与 spec.md / PRD 的声明停在 v2 口径且无偏离登记（cr-fix-spec DEV-1..5）。经用户拍板（2026-11-13，A2/A3/A4/C5 四条）追认 v3 为终态口径——本节是 v3 文档真源，各文件相应处已补「**v3**」勘误标注，iteration-state.yaml spec_deviations 同步补登。代码面尚待落地的只有拍板 A4 的 desktop 收缩与 testEngine 退役（随 fix 波实施，下述第 5/6 条）。

1. **工具 schema 收口（拍板 A3 追认 params-only）**：inputSchema 只含 `engine`（string，可选）与 `params`（自由 JSON object，可选）两参；顶层 `query`（必填）与 `maxResults` 形态作废，搜索词与条数由 params 承载——搜索词按 `q`/`query`/`search_query` 顺序取第一个非空字符串（空白串跳过回退、非字符串忽略），条数按 `count`/`max_results`/`maxResults` 三键回落、归一 1..20 后只喂 {{count}} 占位符与 DDG 客户端截断，模板引擎的条数随 params 原样透传不再收敛。params 缺搜索词报可读错误「params 缺少搜索词：请传 q / query / search_query 之一」。测试锁 T-S1 已按两参形态反锁。
2. **paramHint 不限长（拍板 A2 追认）**：v1 的「≤500 保存拒绝 + 装配期防御截断」双道整体作废（`SEARCH_PARAM_HINT_MAX_LENGTH` 常量与装配侧 slice 已删）；paramHint 保存路径仅 trim 与明文密钥检测，无长度上限、装配期不截断。测试已反向锁「不限长」口径（search-tool.test.ts / search-config.test.ts）。
3. **出厂 GET 模板 URL 去占位符；searxng 改完整端点**：brave 的 URL 删除 `?q={{query}}&count={{count}}` 尾参、searxng 由 `{{baseUrl}}/search?q={{query}}&format=json` 改完整端点 `https://searx.example.com/search?format=json`（六份出厂模板 URL 均不含任何占位符）；「需 baseUrl」判据改形——新增 `isUnconfiguredSearxng`（URL 等于出厂示例值即视为未配置实例）驱动 needsBaseUrl 展示与 canRun 特判；`engineBaseUrls` 存储键仅剩自定义 `{{baseUrl}}` 模板可达。占位符四枚能力对自定义模板仍开放（{{baseUrl}} 占位符感知 URL 校验分支保留）。
4. **mobile 功能面收缩（v3 实现事实）**：详情/新建页删除 curl 粘贴导入、测试搜索按钮、DDG 详情入口（列表页 DDG 行点击无响应，无详情页）与 create 模式的 defaultBody 预填字段；认证为三态快捷选择（Authorization Bearer / 自定义头名 / 无认证）。PRD「mobile 与 desktop 同构、curl 导入非 desktop-only」的原口径随本条作废。
5. **desktop 收 v3 对齐（拍板 A4，fix 波落地）**：desktop 详情页删 defaultBody 编辑、`{{apiKey}}` 注入方式快捷选择、宏校验（`uses(macro)`）与测试搜索按钮，只留连接（method+URL，内置模板只读）+ 认证三态 + paramHint（内置只读）——双端详情页在收缩后的共同功能面内恢复同构。
6. **testEngine 整链退役（拍板 A4，fix 波落地）**：core `search-config` 的 `testEngine` store 方法、desktop IPC `handlers/search.ts` 的 `handleSearchTestEngine`、invoke-registry 通道、ipc-types 的 TestEngine DTO 与 desktop UI 测试入口全部退役；spec.md §8 的 testEngine 段与 T-C5 相应断言随拍板作废。**`core-search/B-1`（testEngine 模板分支 params={} 对 GET 模板必失败）随其退役自动消解，不再单独修**；「草稿直测」「测试消耗配额提示」等 v1/v2 能力口径一并作废。
7. **settings 域 i18n 落地（spec §10 旧口径作废）**：设置页 UI 文案迁入 settings 域双语 catalog——`packages/core/src/domain/settings/i18n/keys.ts`（153 key 真源）+ `packages/core/locales/settings.{zh-CN,en-US}.json` + core package.json 新增 `./settings` 子入口导出 + 双端 translator（desktop `shared/logic/settings-i18n.ts` 与 `renderer/i18n/settings.ts`、mobile `src/i18n/settings.ts`）。spec.md §10「双端设置页 UI 静态文案硬编码中文——本次延续，不接 MessageDescriptor 通道」作废；spec Δ 结构清单已补 5 个新文件与 exports 行。
8. **双端 settingsTranslator 固定 zh-CN（OQ-B3 备案口径）**：两端 translator 均以 `"zh-CN"` 常量构造（注释「locale 决定权留给后续设置层」），en-US catalog 运行时暂不可达——照 chat/core translator 先例留待设置层接线，属已知备案而非缺陷；另有一批 UI meta 常量在模块 import 期求值并冻结（ui-copy/i18n-1），接动态 locale 时需一并迁移到调用点求值。
9. **CR 第 2 轮拍板 3「帮助真源 mobile 逐字同步」被 v3 双端帮助分叉事实取代**：mobile 帮助弹窗四段（无测试配额段）、desktop 五段，custom_engine 段文案按端拆 `.mobile`/`.desktop` 不同句——「逐字同源」不再成立，以「双端各自 catalog 键、desktop 含测试配额段」为事实口径记录在案。
