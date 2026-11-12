# web-search-curl spec v2：透传改造（delta）

> 背景：用户对 v1 交付的方向性简化指令——「除了 AK 也就是 header json 需要特殊处理外，其他都可以透传，本身就是给 agent 用的」「响应、body 请求也不用管，直接透给 agent」「引擎唯一目的是隐藏 AK 的存在」。v1 的 title/url/snippet 标准化映射是给人看的 UI 需要，agent 不需要；映射配置（resultPath/fieldMap/answerPath/envelope）整体废除。
> 本文件与 spec.md 配对阅读：未提及的一切（存储五键/开关/装配快照/SKSP 通道/DDG 兜底/120s 预算/attempts/50KB 落盘/i18n 通道）**原样保留**。

## 1. 模板类型坍缩

`SearchEngineTemplate` 字段终态：

| 字段 | v1 | v2 |
|---|---|---|
| name / method / url | 有 | 保留不变（GET url 含 `{{query}}/{{count}}`；POST url 为固定 endpoint） |
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

schema 不变：`search(query, engine?, maxResults?, params?)`。description 通用段微调：结果以「JSON 文本」返回（引擎原始响应的结果数组提取），agent 自行读取字段；逐引擎段（paramHint）不变。

## 7. 测试处置

- 删（映射类）：template-engine.test 的 fieldMap 候选遍历/title 回填/resultPath 定位/answer/envelope 用例；preset-templates.test 形状锁中的映射字段断言。
- 改写：响应侧统一改「数组提取 + 截断 + 找不到数组降级」断言；body 浅合并三级语义（全覆盖/部分/纯默认/defaultBody+params 均空 → POST {}）；bocha 业务码失败用例改走「无数组降级」。
- 新增：多数组取最长、平局取先、非对象数组（string[]）不算、空数组 vs 无数组（空数组=成功空结果，无数组=降级）。
- UI 测试：详情页断言随字段坍缩适配；测试按钮预览形态断言更新。

## 8. 明确不变

存储五键布局与归一、引擎开关（默认仅 DDG）、enabledEngines 语义、装配期快照与 paramHint 500 截断双道、SKSP 密钥通道与 `{{apiKey}}` 占位、curl 粘贴导入与密钥检测（含 paramHint 扩扫）、DDG 代码兜底与 HTML 解析、串行链/attempts/120s 预算/50KB 落盘、明文密钥检测、i18n 通道、desktop IPC 八通道、CR W1-W6 全部保留修复（FIX-2 envelope okValues 随字段消亡自然作废）。
