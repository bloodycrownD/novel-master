# fix-spec 编排状态（spec-check-loop + code-dev-loop 终态）

```yaml
phase: cr-dev              # 2026-10-02 用户确认 execute-ready，code-dev-loop 开工 CR-W1..W5（同步派遣；子代理禁 git，主代理波次收口统一提交）
cr_dev:
  spec: cr-fix-spec.md (R4 Go)
  waves_done: W1(9) / W2(4) / W3(1+文档) / W4(4+fix-gc) / W5(3 commits fd531e55..97a93b85)
  f19_note: status.md 侧无 M-03 行(N/A)——ledger 侧完整
  dev_ready: yes（2026-10-02 五波全 func-ready；CR 总账 21 commits 59b48913..97a93b85）
  final_numbers(W5 后): core 3328/5(4 已知+T-MP-P1 满负载漂位隔离绿)、desktop 667/667、mobile 1764/1、renderer 棘轮 190 GREEN(去坐标)、encoding 0/0/0、ci-gates OK、lint 0E
  leftovers(不阻塞 dev-ready): core 测试类型清账约 840 条(CI continue-on-error 登记)/act 警告 63 条存量/尾换行统一清理(2 处 HEAD 既有)/OQ16+17(需用户数据)/Kotlin 真机项/K14-K16/CR-F21(OQ15 甲案 UI 展开, spec 编排外占位)
  dag_version: 1
  wave_plan: [[W1 impl×6 路同步: A=F01+08+11(desktop) / B=F02(mobile) / C=F04(三端) / D=F05+06+20(core-src) / E=F03+07(core-test) / F=F09+10(kotlin)], [W1 cr-func], [W2 门禁串行 F12-16], [W3 F17+F18+F19+L1-2/3], [W4 牙齿+轻源码], [W5 扫尾+CHANGELOG]]
  node_status: {}
  commit_rule: 波次收口主代理分逻辑块提交
phase_prev: cr-spec-check       # 2026-10-02 用户裁定：cr-fix-spec.md 只是 CR 结果汇总、非可执行 spec，走 spec-check-loop 收敛至 execute-ready
cr_spec_check:
  spec_path: docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md
  evidence_sources: raw/cr1-*.md ×11 + raw/cr1-full.md + fix-spec/ 11 分片（业务 spec 上游）
  review_round: 4
  dag_version: 4
  doc_fix_plan: []          # R3 审查 9 条单行（L2 定数 42/P2-4b/P2-3b 锚点/W4 扩容容 src/F21 路径/L1-7 文件名等）已全清
  status: 待第 4 轮审查
  round_cap: 5
cr_loop:
  fix_spec_path: docs/Iterations/repo-mega-cr-2026-10/cr-fix-spec.md
  review_round: 1
  dag_version: 1
  wave_plan: [[review-scope ×11（对照 fix-spec 分片）], [spec-fix 主代理直改], [review-full]]
  scopes: [wave-a, cloudsync, core1, core2, apps, c2, c1, c-tests, kotlin, dead, guards]
review_round: 3             # spec-check-loop 侧（历史）
dag_version: 9
spec_dir: docs/Iterations/repo-mega-cr-2026-10/fix-spec/
branch: feat/repo-mega-cr
base_sha: fe79b781
head_sha: 046f4d9c          # 最后一次实质改动提交；真实 HEAD 以 git log -1 为准
open_must_fix: []
spec_deviations: []          # 各波自报偏离均经 cr-func 定性闭合；记录性遗留见 dev_leftovers
dev_dag_matrix:
  Wave A: { impl: 7/7, verify: done（无新增红）, cr-func: func-ready }          # 7 commits 5d6b9661..c24e8b27
  Wave B: { impl: 5+gap+b2, verify: done, cr-func: func-ready（M1 BOM 主代理直改） }  # 4 commits dc621d9a..37df8900
  Wave C: { impl: c2→c1 串行, verify: done, fix-C-tests 74 牙齿, cr-func: func-ready } # 3 commits c667be0f..d68a848b
  Wave D: { impl: 3 路, verify+cr-func 合并: func-ready }                        # 2 commits 496b6fd8..6594b67c
  Wave E: { impl: 3 路+fix-E, cr-func-E2: func-ready }                           # 4 commits 3b4c8d9e..046f4d9c
final_numbers: core 3291/3（确定性2+假信号）、desktop 660/660、mobile 1744/1、cli 105/24、tsc 0/0/371/0、encoding 0/0/0、lint desktop/core/drivers 0E、renderer 棘轮 371 GREEN
dev_leftovers（不阻塞 dev-ready）:
  - Kotlin 真机验证（callTimeout/abort/sksp）——需用户在场窗口（荣耀锁屏门）+ Metro 真实路径 + adb install -r -d
  - C1-8 跨 chunk 同名无 id 塌缩（生产不触发，已钉现状用例）；C1-9 中转站 4096 上限未实测
  - core test:fast 裸 tsx 零收集面（走 npm test 即安全）；mobile lint 27E 存量待收口；cli 24 存量红（E3 examples schemaVersion 漂移含）
  - desktop providers.delete 后 getSavedById 空致 currentModel 不 reset（既有缺陷，cr-func-B 发现，债务池）
blocked_by_decision（未施工格子）:
  - Wave D 批次 3（★1/★3；★1 前置 F-synth-dead-1 已完成——L0 重分桶剔 relayed 127 行）
  - MESSAGES_* 三通道（★4）；sksp 三处编码（★5）
round_cap: 5
dev_rules: 同步派遣（波内并发阻塞等齐）；子代理禁 git add/commit（主代理 wave 收口统一提交）
```

收割登记（历史总表见 registry.md；S 阶段 28 审查/judge3/dfx22、dev 阶段 5 波约 30 节点全部完成）。
