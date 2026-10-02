# CR Fix Spec: token-count-perf-r2

## 元信息
- repo: D:\Dev\nm-worktree\tnc（分支 feat/tokenizer-native-cancel）
- base_sha: d6cd59c17 / head_sha: 2f9663e24
- prd_path: 无（用户口述，记录于 memory 20261001-chat-webview-unify-spec.md）
- spec_path: docs/Iterations/token-count-perf-r2/spec.md
- review_round: 1 / dag_version: 2
- 状态: fix-spec-ready（待用户确认开工）

## Must-fix（P1 → P2）

### cr2-B-01 [P1] 探针三量模块级+入口重置：同会话并发双轮互相清零、收尾日志张冠李戴
- 维度：C-orch（验收量具可信度）
- 文件：packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts:84-93,395-397,407-417
- 问题：probeChunkTotal/probeMisses/probeRoute 是模块级 let，countSerialized 入口无条件重置；而「chip 精确轮 + 压缩预热轮同会话并发」是 R6 已知形态（:338-340 注释自认）。A 轮在途时 B 轮起步会清掉 A 的计数，A 收尾打出的 route=/l2Hit= 是 B 的；取消轮最严重。Step 3/10 验收拿这条日志当唯一量具，串味会导出「看起来更快/更 native」方向的错误结论。
- 改法：探针收成**每轮局部对象**向下传——`countSerialized` 内 `const probe = {chunkTotal: 0, chunkMisses: 0, route: "js"}`，作为末位可选参传入 `countChunksWithL2`/`fallbackCount`/`mapNativeResult`/`countGptViaNative`/`countHeuristicViaNative`（后两者内部写 `probe.route`），删除三个模块级 let；收尾只读本地 probe。
- 验收：mobile-prompt-token-counter 全量复绿（既有 28 用例含探针相关路由断言）；新增一条并发护栏——两条 countSerialized 交错推进（Promise 编排）后各自收尾日志的 route 互不污染（jest 里 spy console.info 断言两次输出各自正确）。
- 来源：review diff r1

### cr2-B-11 [P1] spec 未覆盖 Part C/D/探针：下一轮对照评审失去基线
- 维度：A
- 文件：docs/Iterations/token-count-perf-r2/spec.md（变更点清单/决策表/兼容矩阵/执行终态注记）
- 问题：代码已含 Part C（heuristic 原生优先）与 Part D（1200→300、2500→800），spec 只写到 Part A/B；探针提交也只被当「已修遥测」一笔带过。
- 改法：① 变更点清单追加 C/D 两段与探针三条（copyMs/jniMs、[nm-tok-js] 壳、OPT_OUT）；② 决策表追加三行（heuristic 上原生=换算力不换口径 / 首刷窗口撤回理由 / gpt 原生与 JS 表不解耦+表不可用落 heuristic）；③ 兼容矩阵追加「升级安装 heuristic 档」「延迟 800ms 切会话立刻退出的三层兜底」两行；④ 执行终态注记补 C/D/探针与真机验收结果（用户确认「快了不少」）；⑤ 体积数字回填（cl100k 2.5MB/o200k 5.2MB）；⑥ spec T-H4 改述为实际落地形态（确定性+幂等；T-H2 合成语料强于真实语料说明）。
- 验收：spec 通读无 A/B/C/D 之外的实现事实缺漏；变更点与 diff 可一一对应。
- 来源：review diff r1

### cr2-B-02 [P2] countChunksWithL2 的 JSDoc 被探针声明块顶掉
- 维度：F
- 文件：count-prompt-llm-input.ts:79-93
- 改法：探针注释+声明整块上移到 :79 之前（cr2-B-01 改局部对象后此块自然缩小），让函数 JSDoc 重新紧贴声明。
- 验收：目视两个连续 JSDoc 消失。

### cr2-B-03 [P2] 桥契约层缺 vendorModelId 双语义注释（spec 变更点 8 未执行）
- 维度：A+F
- 文件：packages/tokenizer-driver-rn/src/android-native-bridge.ts:11-22
- 改法：NativeCountRequest.vendorModelId 补 JSDoc（WEB/SP=真实 id 仅诊断；tiktoken=编码名，Kotlin encodingNameFor 据此选词表，传错值 Engine 抛异常落回 js 档）。
- 验收：注释三处（桥/驱动 buildNativeCountRequest/Kotlin Module）口径一致。

### cr2-B-04 [P2] chunk-splitter「无生产消费方」声明现已反向错误（spec 变更点 12 未执行）
- 维度：A+F
- 文件：packages/core/src/infra/tokenizer/logic/chunk-splitter.ts:8-13
- 改法：改为如实描述（消费方=node/rn 两驱动 countChunksWithL2；键值域已随 v2 切换），删掉「若真接上须同 PR 补二次切分」的死 TODO（改述为「贪吃段二次切分未实现，现网无病理样本触发」）。
- 验收：core tokenizer 测试复绿（chunk-splitter golden 不动）。

### cr2-B-05 [P2] 首刷窗口恒等三元+失效注释
- 维度：F+死逻辑
- 文件：apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:306-310
- 改法：`slot.hasLabel ? A : A` 收敛为单常量引用；注释改述「错峰窗口已于 Part D 撤回；恢复时须同时回看 PRECISE_UPGRADE_START_DELAY_MS 与取消链路」。
- 验收：use-chat-tab-scope-token-debounce 复绿（用例推进 1200 对 300 窗口仍触发）。

### cr2-B-06 [P2] spCache 4→6 无独立理由
- 维度：A（范围纪律）
- 文件：TokenizerEngine.kt:57
- 改法：回 spCache 为 4（SP 家族零新增，内存账最小化）；webCache 保持 6。
- 验收：Kotlin JVM 测试复绿。

### cr2-B-07 [P2] 词表来源未钉 commit
- 维度：A
- 文件：packages/tokenizer-driver-rn/android/src/main/assets/tokenizers/README.md:12-18
- 改法：来源表补 HF repo commit hash 两串（换版比对的锚点），注明「commit 是换版比对锚点」。
- 验收：manifest 含 repo+commit+日期+体积四要素。

### cr2-B-08 [P2] 四条测试护栏缺口
- 维度：G
- 文件：apps/mobile/__tests__/mobile-prompt-token-counter.test.ts
- 改法：①gpt 档「桥抛非取消错→同 null 路径」用例（mock reject Error+family tiktoken→结果=纯 js 档读数）；②heuristic 原生轮取消上抛用例（照 :707 gpt 模板）；③出界用例补「桥零调用」双断言；④JS 表建不起来时 tiktoken 放弃原生落折算的注入用例（__setRnEncodingFactoryForTests 抛错）。
- 验收：mobile-prompt-token-counter 全量绿且新增 4 条含变异验证（改坏 catch 路径必红）。

### cr2-B-09 [P2] T-H4 护栏被换成另一件事（memoization 防线缺失）
- 维度：A+G
- 文件：packages/core/test/infra/tokenizer/token-chunk-cache.test.ts（T-H4 用例）
- 改法：补计数式用例——对重复出现的块文本断言被查两次且无跨块复用（N 块=N 次哈希语义），或最低限在 T-H4 注释明写「spec 原定调用计数护栏未落、风险由评审约束」并同步 spec（与 cr2-B-11⑥ 合并执行）。
- 验收：变异验证——临时加 memoization 后有用例红。

### cr2-B-10 [P2] gpt 原生与 JS 编码表强耦合未记录未测
- 维度：F+G
- 文件：count-prompt-llm-input.ts:303-315
- 改法：注释写明耦合链（overhead 公式需真表→原生路线与 JS 表可用性耦合→表建不起来即便原生词表就绪也落 heuristic；解耦方案=overhead 闭式，留后续）；行为护栏由 cr2-B-08④ 用例承担。
- 验收：注释+用例双落地。

## Spec deviations（除上述外）
- TokenizerAssetPaths.kt:3 头注释「mirrors core」失真 → 顺手改（并入 cr2-B-03 批次）。
- 金标 JSON version 1→2 但 ParityTest 不校验 version（纯装饰）→ open，不阻塞；将来做格式迁移闸时补校验。
- token-chunk-cache.test.ts T-H1 一处逗号前多余空格（prettier 风险）→ K 节顺手。

## Open questions / 待拍板
1. **[nm-tok-js] 探针门控**：验收期保留无门（Step 3/10 唯一量具）；merge 前拍板三选一（保留/`__DEV__` 门/开关化生产可观测）。注意 release 下 console.* 可能被剥离，先真机 release 验一次再定，勿凭推测改。
2. RULE:122 提醒：dev 下该日志自身 100-400ms 落在计数之后阻塞 JS——若后续真机验收再现「数字慢」，第一嫌疑是这条日志而非窗口值。

## 已豁免（用户确认不修）
-（无）

## 合并后 QA（manual_user）
- 真机 Step 3/10 复测一轮，验收数据**只采信修完 cr2-B-01 之后的 [nm-tok-js] 轮次**（当前已采数据仅作参考）。
- release 包验证 console.info 是否真出（open question 1 的依据）。
- 真机多模型用户内存与冷载观察（webCache 6 槽 < 10 WEB 条目仍会互踢；重载一次 ~1s 可接受）。

## K 节建议（下游执行时闭合）
1. lint/prettier 过一遍（含 T-H1 空格 nit）。
2. dist 重建（core+driver，merge 前必做——mobile jest 吃 dist）。
3. CHANGELOG 两条（计数缓存哈希提速 / GPT 家族原生计数）延至 merge 准备期。
4. 主仓 README 首句口径复核。

## Fix-Spec Closure
| 项 | 状态 |
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/token-count-perf-r2/cr-fix-spec.md |
| dag_version / review_round | 2 / 1 |
| P0 / P1 / P2（已写入） | 0 / 2 / 9 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open 2（金标 version 校验、探针门控——均已列 open questions，不阻塞） |
| C-orch | ✅（cr2-B-01） |
| C 类合并后 QA | 已列（验收数据采信窗口） |
