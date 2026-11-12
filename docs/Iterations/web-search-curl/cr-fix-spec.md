# web-search-curl CR fix-spec（第 1 轮）

> 来源：code-review-loop 首轮（5 审查者并行互盲：scope-core / scope-store / scope-toolsurface / scope-ui / review-global）+ 主代理真机 e2e 实测发现。
> BASE=9d912b6af HEAD=15d5fb5de（修复继续在 feat/web-search-curl 分支追加 commit）。
> 复审目标：本文件全部条目闭合后，第 2 轮复审。

## 主代理拍板记录（可被用户推翻）

1. **P1-1 修法**：按 spec §8 本来定义的 engineId 通道回接——预置引擎且 `presetOverrides[id] === true` 且表单模板与出厂逐字段相等 → 测试请求**省略 draft**（core 合并覆盖 + SKSP 现读）；表单有改动或 key/baseUrl 草稿非空 → 带 draft（草稿直测语义不变）。双端同规则。
2. **curl 多密钥整体拒绝**：维持（简单优先，spec 未约定更复杂语义）。
3. **模板引擎错误文案用引擎显示名**（`template.name`，如「博查搜索」），不用裸 id。
4. **paramHint 扩扫明文密钥**：保存路径（createCustomEngine / updatePresetOverride 的 paramHint 入参）纳入 `findPlaintextSecrets` 扫描（paramHint 流入 agent 可见工具描述，风险面成立）；name 不扫。
5. **预置展示名统一**：双端「读模型 `name` 优先、静态表仅未知 id 兜底」。
6. **iterations.yaml** `in-progress → active`：合并 main 时转（本 CR 不动）。
7. **偏离 #1 收口（双端统一严口径）**：needsKey 模板且无已存 key 且 key 草稿为空 → 保存拦截提示先配 key（mobile 现行为为基准）；非 needsKey 或有 key → 正常保存；本次零写操作（无 patch/无 key/无 baseUrl 变更）→ toast「无改动」。

## must-fix 总表

### P1

| id | 文件 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-1 | desktop `SearchEngineDetailView.tsx:133,337-339`；mobile `SearchEngineDetailScreen.tsx:486,687-693` | 预置引擎有覆盖时「测试」按钮测出厂模板而非生效模板（draft 恒传优先于 engineId；desktop 折叠区「当前使用已保存的自定义覆盖」提示与行为矛盾） | 按拍板 1 判定基线双端改造；UI-only，不扩 DTO/handler | ui/P1-1 |

### core / types.ts（一个 agent 串做，回归断言落 search-config.test.ts T-C7）

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-2 | `search/types.ts:344-353` | `envelope.okValues` 接受空数组 → 执行器「code 有值即失败」全废 | 校验 `values.length === 0 → invalid` | core/P2-3 |
| FIX-3 | `search/types.ts:272-279` | headers 不校验头名：空名/含换行头名通过保存，执行期 fetch 抛原生 TypeError 绕过 engineFailed 通道 | 头名非空 + token 字符集（`/^[!-9;-~]+$/`） | core/P2-4 |
| FIX-4 | `search/types.ts:314` | GET 模板携带 bodyTemplate 被静默丢弃（UI 表单恒有该字段，用户配置无效果） | 校验层拒绝：`GET && bodyTemplate != null → invalid` | core/P2-5 |
| FIX-5 | `search/types.ts:298-310` | JSON key 含白名单占位符（`{"{{query}}x":1}`）放行但执行器只替换值 | 校验遍历对 `Object.keys(node)` 拒绝含占位符的键 | core/P2-6 |

### core / 执行器域

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-6 | `engines/template-engine.ts:99,153` | 错误消息未脱敏：JSON parse 失败 `e.message` 内嵌响应体片段、GET URL invalid 的 `e.message` 含明文 key URL；违背 types.ts:110 自声明 | 两处 `e.message` 过 `redactSecret(…, resolved.apiKey)`；补「parse 失败且 body 回显 key」测试断言 | core/P2-2 |
| FIX-7 | `engines/template-engine.ts`（错误文案处） | 错误文案用引擎 id（"bocha API error 4001"） | 改用 `template.name` 显示名 | 拍板 3 |
| FIX-8 | `test/tool/template-engine.test.ts:30` | 孤儿注释（helper 已不存在） | 删 | core/P2-9 |
| FIX-9 | `curl-import.ts:232` | `collectSecrets(findPlaintextSecrets(header.value))` 是组合串检测的完全子集 | 删该行保留组合串调用 | core/P2-1 |
| FIX-10 | `engines/dispatch.ts:34-38` | 声明返回 Promise 但 template 缺失分支同步 throw（时序不一致） | 函数标 `async` | core/P2-7 |
| FIX-11 | `engines/duckduckgo.ts:32` | `DUCKDUCKGO_TIMEOUT_MS` 假公开（无外部消费） | 撤 export 改 const | core/P2-8 |

### core / 配置存储域（search-config.ts + search-config.test.ts 同 agent）

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-12 | `search-config.ts:457-464` | `saveEngineKey`/`clearEngineKey` 不校验 engineId 已知性（dangling SKSP ref） | 两方法校验 `state.order.includes(engineId)`，未知 throw engineNotFound；补 rejects 断言 | store/P2-1 |
| FIX-13 | `search-config.ts:266-271,322` | baseUrl 只 trim 不 normalize：canRun 与串行链口径分叉（非法 URL 判可跑） | readEngineState 逐值 `normalizeEngineBaseUrl`，非法丢弃；补 canRun 与链一致性断言 | store/P2-2 |
| FIX-14 | `search-config.ts:362-374` | 显式 engine 分支对 enabled 的 inputEngine 重复 resolveOne（多一次 SKSP IO） | 记 `pinnedTried` 跳过重复 | store/P2-3 |
| FIX-15 | `search-config.ts`（paramHint 入参处） | paramHint 明文密钥不扫描（流入 agent 可见工具描述） | createCustomEngine/updatePresetOverride 的 paramHint 过 `findPlaintextSecrets`，命中走 search_secret_detected | 拍板 4 |
| FIX-16 | `search-config.test.ts` | 测试缺口：createCustomEngine 错误分支（id 不符/重复/名空）、update/delete 未知 id、testEngine draft+engineId 组合与 draftKey 回落；FIX-2..5 回归断言 | 各 describe 补 `assert.rejects`/组合用例 | store/P2-4 |

### core / 工具面

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-17 | `search-tool.ts:92-95` | JSDoc 仍写「装配期不取数」与本次改造矛盾 | 改写为「逐引擎段消费装配期 engineSnapshot；链解析与凭据仍在 run 内」 | tool/P2-1 |
| FIX-18 | `search-tool.ts:101` + `builtin-tool-context.ts:159-161` | 空快照三路径失真：`ctx.search==null`（CLI/旧 mock）实际 run 抛「未装配搜索上下文」但描述承诺「返回配置指引」；readConfig 降级路径同样失真 | description 区分 `ctx.search == null`（中性文案「当前运行时未装配搜索能力」）与空快照（保留指引但软化）；同步修 builtin-tool-context 两处 JSDoc；T-D1 describe 扩两条断言 | tool/P2-2 |

### 双端 UI

| id | 文件 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-19 | desktop `SearchEngineDetailView.tsx:89` + mobile `SearchEngineDetailScreen.tsx:139-141,819-822` | 密钥注入头名漂移：desktop 写 `X-API-Key`、mobile 识别/删除按 `X-API-KEY` 精确匹配 → 跨端编辑误判+残留双头 | 统一常量 `X-API-Key`，mobile 匹配删除大小写不敏感 | ui/P2-1 |
| FIX-20 | desktop `SearchEnginesView.tsx:33-49` vs mobile `SearchEnginesScreen.tsx:362-386` | 帮助弹窗双端漂移：desktop 少「密钥安全」段、标题措辞不一致 | desktop 补齐五段，以一侧为真源逐字同步 | ui/P2-2 |
| FIX-21 | 双端 `search-engine-meta.ts` | deepseek/zhipu 副标题文案漂移（「按量计费 · 中文检索」vs「按量计费 · 中文」） | 定稿后双端同步 | ui/P2-3、glob/P2-2 |
| FIX-22 | desktop `SearchEngineDetailView.tsx:282-312` | 零改动保存假成功（零 IPC 仍 toast「已保存」）；needsKey 无 key 不拦截（与 mobile 不一致） | 按拍板 7：零写操作 → toast「无改动」；needsKey && !hasKey && key 草稿空 → 拦截提示 | ui/P2-4 |
| FIX-23 | 双端展示名取值 | 预置展示名双端不同源（desktop 读模型 name 优先、mobile 静态 LABELS 优先） | 按拍板 5：双端统一读模型 name 优先、静态表兜底 | glob/P2-1 |
| FIX-24 | mobile `SearchEngineDetailScreen.tsx:471-516,657,661` | 保存/删除回读走全屏 loading（表单闪屏、焦点丢失） | `load()` 拆「首次骨架屏 / 静默回读」，保存失败路径走静默分支（照列表屏 `reload({silent})` 先例） | ui/P2-5 |
| FIX-25 | mobile `SearchEngineDetailScreen.tsx`（EMPTY_DRAFT） | mobile create 表单全空白（desktop 有智能预填 headers/body/resultPath/fieldMap 默认），首次保存必被 validate 拦 | mobile EMPTY_DRAFT 对齐 desktop 预填基线 | ui-dev-4 |
| FIX-26 | 双端 Body 字段帮助文案 | 「整数占位用整值 "{{count}}"」读作裸形态（e2e 实测误导），实际必须带引号 | 改为「整数字段写 "{{count}}"（带引号），执行时自动转为数字」；帮助弹窗占位符段同步核对 | e2e 发现 |
| FIX-27 | 双端测试结果错误展示 | 失败错误灰字与说明同色，警示弱 | 错误文案改错误红（双端各自样式体系） | e2e 发现 |
| FIX-28 | mobile `__tests__/` | mobile UI 测试缺口：create 保存、预置有覆盖时测试请求不带 draft（FIX-1 回归锁）、差异提交 | 补 detail 套件用例（mockRuntime 模式照 reorder 套件抄） | ui/P2-6 |

### docs 收尾（修复波全部完成后）

| id | 文件 | 动作 | 来源 |
|---|---|---|---|
| FIX-29 | `iteration-state.yaml` | spec_deviations 补登（FIX-1 测试按钮 draft 优先已修 / FIX-20 帮助漂移已修 / FIX-19 头名漂移已修 / FIX-25 create 预填已修 / FIX-23 展示名统一——均以「已修复于 CR 第 1 轮」口径登）；Δ 清单补登 `search-engines-ui-hook.mjs`、`BuiltinTag.tsx`，注明 `jest.config.js` 豁免理由 | glob-2 + ui devs |

## 明确不做（本轮 backlog，记录在案）

- 校验失败的行内字段定位/滚动提示（现在 toast 已含字段名 reason；行内校验 UI 属较大行为改动，留后续迭代）
- mobile `ApiKeyStatusTag` 复用为 baseUrl 状态语义混用（观察级）
- desktop 自定义模板删除 `{{baseUrl}}` 引用后已存 engineBaseUrls 的 orphan 清除（观察级）
- `assembleSearchToolContext` 不 gate registry（成本极小，先例对齐可后续做）

## 执行波次（文件冲突域）

- **W1（core-types）**：FIX-2..5（types.ts 串做；断言落 T-C7 归 W2 文件——W1 只改实现+template-engine.test 若涉及，约定：FIX-2..5 的 T-C7 断言由 W2 写）
- **W2（core-config）**：FIX-12..16 + FIX-2..5 的 T-C7 回归断言（search-config.ts + search-config.test.ts）
- **W3（core-exec）**：FIX-6..11（template-engine.ts + template-engine.test.ts + curl-import.ts + dispatch.ts + duckduckgo.ts）
- **W4（core-tools）**：FIX-17..18（search-tool.ts + builtin-tool-context.ts + search-tool.test.ts）
- **W5（desktop-ui）**：FIX-1(desktop) + FIX-19(desktop 侧若涉) + FIX-20 + FIX-21(desktop) + FIX-22 + FIX-23(desktop) + FIX-26(desktop) + FIX-27(desktop)
- **W6（mobile-ui）**：FIX-1(mobile) + FIX-19(mobile) + FIX-21(mobile) + FIX-23(mobile) + FIX-24 + FIX-25 + FIX-26(mobile) + FIX-27(mobile) + FIX-28
- **W7（docs）**：FIX-29（W5/W6 完成后）

W1–W4 并行；W5/W6 并行（W5/W6 依赖 W1 的 types 校验改动可先行无依赖，实际可同波全并行——W1..W6 六 agent 同波发出）；W7 收尾。
验收门（每 agent 自跑）：触达文件 typecheck + 相关测试文件绿；主代理终检三端 typecheck + 三端全量测试 + check-style 触达路径 + commit。
