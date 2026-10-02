# repo-mega-cr fix-spec 总纲（S 阶段）

> 目标：把 `ledger-v2.md`（基线 `fe79b781`）的 Wave A–E 提案加工成 **execute-ready fix-spec**。
> 判据（spec-check-loop）：无未闭合 P0（矛盾 / 缺失契约 / 与代码硬冲突 / 验收不可测）；
> P1 已修或已入「已知限制」；全局 judge Go。
> 协议见 `../PLAN.md` 第四章；编排状态见 `state.md`。

## 1 · 范围

- **spec 化对象**：全部 P0（5）+ 全部 P1 + 入选 Wave 的 P2/死码批次/防再犯钩子。
  - **P1 计数口径（R2 更新，对齐磁盘实况，judge-r1 R2-18）**：台账 P1 **40** 条（§2.2~§2.9 各簇 39 + §8.1 终裁入账 RT-01）
    + §6 复核入账 **7** 条（#4/#5/#8/#9/#10/#11/#12；**#3 composer-draft 降 P2、不计入**）
    = **47 条，R2 补写完成后全部有落位**（含 7 条 R2 补写：AM-3 / CD-01 / CS-03 / M-01 / S-D-04 / E / F-synth-dead-1）。
    其中 `F-synth-dead-2` 不计入「已落位」——它是 ★1 的解锁产物，见 §4 的显式登记。
- **不 spec 化**：其余 P2/P3（约 300 条）留 `ledger-v2.md` §3 作债务池；reviewer 每轮对本簇抽验 ≥10%。
- **§6 十条单源**：8 条建议入账（#1 归并 M-25、#7 suspected 留产品确认）。分片撰写机位顺带做**第二源独立复核**（对照代码重推导），复核成立的按 P1 写进对应分片；复核不成立的回退台账待验证节。
  - **R1 轮裁决更新（2026-10-01）**：**#3（composer-draft 全有或全无）被第三源复核推翻 P1 立论**（写入方恒写 `attachments: []`，数组级判废生产不可达——`raw/sr1-core1-c.md` R-1/R-2），降 **P2**（潜伏风险硬化，是否直接删草稿 attachments 字段留用户拍板）；#4/#5/#8/#9/#10/#11/#12 复核成立维持 P1。⇒ §6 实际入账 P1 为 7 条。

## 2 · 分片分配表

| 分片文件 | 撰写机位 | 条目 | 顺带复核（§6） |
|---|---|---|---|
| `wave-a.md` | s-wave-a | RT-02、**N-P0-01**（台账 Wave 表漏了修复格，本总纲补入 Wave A：白名单 3 项内联或深层直引，零风险）、N-P0-02、N-P0-03、CI typecheck 转 blocking、A-14、编码还原批次1（blocked ★5） | — |
| `wave-b-cloudsync.md` | s-cloudsync | 云同步生命周期包：S-CS-01(P0)、S-CS-16、S-CS-02、S-CS-03、S-CS-07（优先级最高：唯一不可逆数据丢失，可先落）、D5 条件化 | #1 PushAgentMutex（预期归并 M-25） |
| `wave-b-cloudsync-x1.md` | s-cloudsync-x1（补写，sr1-cloudsync-c 发现的分配缺口） | S-CS-04（busy 泄漏≡AM-2）、S-CS-08（driver 多余拷贝）、S-CS-09（rev 被 etag-only 重读覆盖） | — |
| `wave-b-core1.md` | s-core-b1 | CS-01 renamePrefix、N-P1-01（+CS-04 同族合并 PR）、RT-04（含 project-agent-config.schema.ts 第二处）、RT-08、RT-01（P1：memo+失效 或 tool_use 窄读口） | #3 composer-draft、#4 附件数组降级 |
| `wave-b-core2.md` | s-core-b2 | N-P1-02、M-06 SSE `data:` 无空格、summarizeToolInput 统一、P1-S 批次：M-03、M-04、CS-02、CS-07、CS-08、B、S-D-02、§6#8 之外的既有小条 | — |
| `wave-b-apps.md` | s-apps-b | N-P1-04 定时器闭包、§6#5 搜索面板白屏、AM-1 forgetSession+LRU、N-P1-03 死路由参数 | #5 白屏（即条目本体）、#6 invoke-registry（并入 N-P1-05 P2 侧注记）、#7 scope suspected（只注记不 spec 化） |
| `wave-c1.md` | s-wave-c1 | 全量读收窄残留（CD-01、truncateAfter、subagent-tool:219 及 RULE 记录的 5 处名单）、N-P1-06/07 smart-sort 事务、协议三条 | #8 gemini 同名并行、#9 max_tokens 4096、#10 thinkingSignature、#11 Kotlin callTimeout、#12 SKSP executor |
| `wave-c2.md` | s-wave-c2 | 事务边界：CS-05、backfill 移出事务、CS-11 copy header 投影、CS-06→CS-07 revision 对齐、backfill 倒扫 JOIN、listBySessionOffset 投影、CS-09 ZIP 闸、CS-10 AST 分片、**CD-01**（R2 补写：回滚 plan 四步重排，量 L，judge-r1 A.2(a) 终裁归本片）、**CS-03**（R2 补写：LCS DP 滚动两行 + `Math.min(...arr)` 换循环 + 超阈值降级，量 M） | — |
| `wave-d.md` | s-wave-d | 死码批次1（D-101~116 + 三处施工单修正）、批次2（D-201~209，前置 rebuild core）、批次3（348+17 符号按**批量操作规程**写，含三组新目标）、死通道 8 条 + 3 条 blocked ★4 | — |
| `wave-e.md` | s-wave-e | X1 收口、renderer typecheck 门禁（424 基线分批）、WebView 产物门禁、tsconfig.test paths 对齐、防再犯钩子①~⑥、注释承诺≠实现 | — |
| `baseline.md` | s-baseline | **实跑基线**：core/desktop/renderer/mobile 四域 `tsc --noEmit`、三包 `npm test`（mobile `--maxWorkers=2`、desktop `--test-concurrency=2`）、mobile lint 警告数实测。产出已知红清单（Wave D 验收线的地基） | — |

注：CS-07 在 ledger Wave B（P1-S 批次）与 Wave C（revision 对齐）两处出现——s-core-b2 与 s-wave-c2 撰写时按 `ledger-v2.md` §2.4 原文归一，不得写成两条重复条目；judge 轮专查这一点。

## 3 · 全局依赖图

```
baseline.md（S1） ──→ Wave D 验收线（已知红基线）／renderer 门禁分批（E）／wave-a A4（N-P0-03 的 apps/cli 基线，判据 (b)）
RT-02（A）       ──→ RT-01（B）读数基线
CI typecheck blocking（A）──→ X1 收口（E）／renderer 门禁（E）
S-CS-07（B-cs）  ──→ 可独立先落（唯一不可逆数据丢失）
CS-06（C2）      ──→ CS-07（C2，顺序约束）
rebuild core     ──→ Wave D 批次2
N-P0-02（A3）    ──→ H6（E）    同一个 run-tests.mjs 的同一段；wave-a A3 落最小版（改引号 + 注释中性化 + 调用守卫）在前，
                                     wave-e H6 只承接通用化（packages/core/scripts/run-tests.mjs 化 + 各包 collect-check.mjs
                                     + 双 shell CI job）；零收集守卫实现全仓只能有一份（scripts/lib/zero-collect-guard.mjs），
                                     两片必须同 PR 或严格有序（wave-a 在前）
D-207（D 批次2） ──→ X4（E）    同一个 tsconfig.test.json:26；顺序 D-207 在前：把 :26 改指 ./src/public/kkv.ts
                                     并删 src/service/kkv/index.ts，X4 在后只加守卫测试 + 补 kkv 进 SUBPATHS
★5（拍板）       ──→ 编码批次1（A）
★17（拍板）      ──→ Wave B/C 搜索面验收口径
★16（拍板）      ──→ Wave C 缓存分支（默认：整条撤下不重建）
★1/★3（拍板）    ──→ Wave D 批次3
★4（拍板）       ──→ Wave D 三条 batch 通道
```

## 4 · 拍板项处理（终局随 execute-ready 确认一并请用户拍，spec 不替拍）

ledger §7 全部 17 项。spec 主文一律按「默认建议」列撰写；备选案差异写成条目内注记；
阻塞对应格子的标 `blocked-by-decision(★N)`。★1/★2/★3/★4/★5/★16/★17 七项阻塞——
其中 ★2（D-311 保留/D-314 可删）与 ★5（先还原 7 个纯注释文件）默认案可先写，
真正卡执行的只有 ★1/★3/★4（Wave D 批次3 与死通道）和 ★17（搜索验收口径）、★5 的 sksp 三处。

**显式登记（F-synth-dead-2，judge-r1 A.2(c) 终裁）**：`F-synth-dead-2`（13 份快照 551 个去重名字，
`ledger-v2.md:181`）**不是一个可独立施工的条目，而是 ★1 的解锁产物本身**——它不按「漏条」处理、
不补写七要素条目，**随 ★1 一并处置**。登记在此只为避免下轮有人当成漏条重排。
（其兄弟条 `F-synth-dead-1` = L0 桶定义缺陷，属半条补齐：落 `wave-d.md`，量 S，不阻塞 D 批次 1/2。）

## 5 · 验收基线

见 `baseline.md`（S1 实跑产出）。规则：Wave D 每批验收 = 四域 tsc + 三包测试对照**本基线的已知红清单**判增量，不对照零基线误判。移动端/桌面端满负载假信号纪律按 RULE（降并发复跑）。

## 6 · 债务池附注（R1 抽验裁决，2026-10-01）

- **CD-20 改写降 P3**：病灶文件 `message-content-compaction.ts` 已随 v1.5.29 明文化删除；残留净后果 = 手动清理未清 `nm-message-content/startupMaintenancePending`，而该标记现由 `message-content-decompression.ts` 消费 ⇒ 下次冷启动多跑一次维护。
- **CD-34 核销（stale，前提消失）**：消解池缓存已整体撤销（`decodeMessageContent` 现为纯函数），两分支差异不存在——并入 ledger §9「已被 v1.5.29 消化的条目」。
- **S-CS-18 与 S-CS-19 合并**（同函数同根因：setConfig 非事务 + 不重置 rev）为单条 P2；**S-CS-14 改口径**为「S-CS-07 的残留子项：抽 replaceDbFileWithSnapshot 单一内核消除双份实现」（防「S-CS-07 已修 ⇒ S-CS-14 自然消失」的错误核销）——均待 judge 终裁后回写 ledger。
- **S-CS-13 与 S-CS-03 写死边界**：S-CS-13 = push 侧上传后复检前移；S-CS-03 = pull 侧导入前复检。不同侧不同位置，**两条都做**，防 Wave C 漏做。
- **台账 P2/P3 明细行号普遍未随 v1.5.29 刷新**（CD-03/CD-09 已实证漂移、CD-20 文件消失）——judge 轮统一安排一次行号刷新或在 ledger 标注「引用前以 git log 复核」。
