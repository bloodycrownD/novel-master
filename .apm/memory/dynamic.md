---
createdAt: "2026-07-25 01:05:00"
updatedAt: "2026-07-25 01:25:00"
---
task: code-dev-loop
status: dev-ready
iteration: annotate-source-anchor-render
revision: cr-fix-from-review
spec_confirmed: yes
execute_ready_confirmed: yes
prd_path: .apm/kb/docs/Iterations/annotate-source-anchor-render/prd.md
spec_path: .apm/kb/docs/Iterations/annotate-source-anchor-render/spec.md
fix_spec_path: .apm/kb/docs/Iterations/annotate-source-anchor-render/cr-fix-spec.md
branch: feature/annotate-source-anchor-render
base_sha: ee52c5b5ce74e6fdd68846ef5e0b394c64fbb00e
head_sha: dfa0da46143d9a9904a153e49b4ccece6cc17746
note: |
  执行 cr-fix-spec 完成。trim 策略 (b) 双端统一。
  T-RG7 真机仍开放。未宣称 merge-ready。
  WT 仍留 chat-transcript / soft-wrap 等非本波次改动。
dag_version: 1
wave_plan:
  - [impl-core-c1, impl-mobile-fix, impl-desktop-fix]
  - [verify-core, verify-mobile, verify-desktop]
  - [cr-func-fix]
node_status:
  impl-core-c1: { status: done, head_sha: 0f1c3032 }
  impl-mobile-fix: { status: done, head_sha: dfa0da46 }
  impl-desktop-fix: { status: done, head_sha: 03cab59b }
  verify-core: { status: done }
  verify-mobile: { status: done }
  verify-desktop: { status: done }
  cr-func-fix: { status: done, func_ready: yes }
open_must_fix: []
spec_deviations: []
current_wave: done
bundle_full:
  spec_path: .apm/kb/docs/Iterations/annotate-source-anchor-render/spec.md
  prd_path: .apm/kb/docs/Iterations/annotate-source-anchor-render/prd.md
  fix_spec_path: .apm/kb/docs/Iterations/annotate-source-anchor-render/cr-fix-spec.md
  branch: feature/annotate-source-anchor-render
  base_sha: ee52c5b5ce74e6fdd68846ef5e0b394c64fbb00e
  head_sha: dfa0da46143d9a9904a153e49b4ccece6cc17746
  blocking_fix_closed: [desktop/A-1, mobile/B-1, desktop/B-2, desktop/B-1, desktop/C-orch-1, desktop/C-1, desktop/G-1, core/C-1, mobile/C-orch-1, mobile/A-1, mobile/G-1, desktop/C-2]
  verify:
    core: 49 tests pass
    mobile: build:webview + 42 tests pass
    desktop: 53 tests pass
  commits:
    - 0f1c3032 docs(core): 钉死 buildAnnotatedSource 非预览投影合同（core/C-1）
    - c3f67c52 fix(desktop): 选区 offset 权威钉在 preview-recogito，trim 策略 (b)
    - 610d44ee fix(desktop): 恢复 FloatingBar 显式批注，mouseup 不直开 Add
    - 03cab59b test(desktop): 钉 R6 FloatingBar/cancelSelected 与 trim 委托合同
    - dfa0da46 fix(mobile): 闭合 B-1/C-orch-1/A-1/G-1（trim 策略 b、退役旧 collect/marks）
  contracts:
    - Recogito-only MD annotate
    - Desktop FloatingBar explicit create; Mobile native menu
    - quote aligned renderStart/End (trim strategy b)
    - cancelSelected after open detail
  manual_remaining: [T-RG7]
  note: 未宣称 merge-ready
