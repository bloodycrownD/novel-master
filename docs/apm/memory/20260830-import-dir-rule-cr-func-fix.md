---
date: 2026-08-30
---

# import-dir-rule-default-on 迭代 cr-func-cr-import 只读检查（fix 波次）

## 请求

对 worktree `.woktree/import-dir-rule`（分支 feat/import-dir-rule-default-on）做 readonly 功能检查（节点 cr-func-cr-import）：按 `docs/Iterations/import-dir-rule-default-on/cr-fix-spec.md` 逐条核验 4 条 must-fix（MF-1 根短路 / MF-2 双重断言 / MF-3 逐目录容错 / MF-4 ZIP 故障注入）在代码与测试中实质闭合，抽查测试断言真实口径（根导入、逐目录容错、ZIP 故障注入三类用例），评审核验 verify 证据链（含一条未记名 flaky 的风险评估），并判定有无新引入未登记偏离。范围 git diff e355cc5..7c4d938（4 提交）。

## 结论

func-ready: yes（无残留 must-fix）。

- 矩阵 4/4 闭合：MF-1 短路已删、内核 `backfillMissingDirRules` 的 `logicalPath === "/"` 跳根保留、T-I6 改写为「导入到根：子目录补行、根自身无行」且断言升级为真实查询与补行清单；MF-2 双重断言与 `WorkplaceScope` import 已删（已核实该类型确为 `VfsScope` 纯别名）；MF-3 在 `writeDefaultRule` 回调内逐目录 try/catch + console.warn，内核未动、vfs-tools 复用路径未受影响；MF-4 补 T-Z10（真实 SQL 失败注入，断言导入成功 + 文件完整 + workplace 无残留行）。
- 断言真实口径抽查通过：T-I7/T-Z8 走真实 DB + `WorkplaceService.getDirRule` 逐字段断言（含 ruleEnabled/headCount/tailCount/fillPolicy/scopeKey）+ 根自身 undefined；T-I8/T-Z9 故障注入精确到单个 logicalPath，断言 warn 恰一次且含 directory= 路径、失败前后目录均有行、失败目录无行、导入 doesNotReject；目录全集 `ORDER BY path` 已在 sqlite repo 核实，测试注释的排序前提成立。
- 证据链：增量 4 文件与 diff --stat 一致（亲自复核）；core 全量 1791 pass 与 tsc exit 0 为 verify 自报、本轮 readonly 未重跑；flaky 一例未抓到用例名，三次复跑全绿，评估为低风险残留（建议下次复跑时记录名字）。
- spec_deviations：无新引入。仅 cr-fix-spec 偏离表第 1 条状态仍写「open → 待 MF-1 修复后 fixed」，代码已修但文档状态未翻转为 fixed，属簿记项非阻塞。
