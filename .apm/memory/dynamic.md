---
createdAt: "2026-05-23 17:38:51"
updatedAt: "2026-07-19 23:10:00"
---

# Code Review Loop — annotate-user-ops-unify

```yaml
task: code-review-loop annotate-user-ops-unify
phase: wave_exec
status: in-progress
branch: feat/annotate-user-ops-unify
base_sha: 4e6b76a4
head_sha: 6c37cb3f
spec_path: Iterations/annotate-user-ops-unify/spec.md
prd_path: Iterations/annotate-user-ops-unify/prd.md
dag_version: 2
wave_plan:
  - [review-scope-core, review-scope-apps]  # done: both not scope-ready
  - [fix-core, fix-apps]
  - [verify-all]
  - [cleanup-check]
  - [review-full]
node_status:
  review-scope-core: { status: done, conclusion: "scope-ready: no" }
  review-scope-apps: { status: done, conclusion: "scope-ready: no" }
  fix-core: { status: pending }
  fix-apps: { status: done }
must_fix:
  - { id: review-scope-apps/A-1, sev: P0, dim: A+B+C-orch+G, files: [annotate-marks.ts, annotate.ts, FileMarkdownPreview.tsx], src: review-scope-apps }
  - { id: review-scope-core/B-01, sev: P1, dim: B, files: [prepare-user-messages-for-prompt.ts], src: review-scope-core }
  - { id: review-scope-core/G-01, sev: P1, dim: G, files: [annotate-drafts-send.test.ts], src: review-scope-core }
  - { id: review-scope-apps/B-1, sev: P1, dim: B, files: [PreviewPane.tsx], src: review-scope-apps }
  - { id: review-scope-apps/B-2, sev: P1, dim: B, files: [preview-annotate.ts, PreviewPane.tsx], src: review-scope-apps }
  - { id: review-scope-apps/B-3, sev: P1, dim: B+G, files: [annotate-marks.ts], src: review-scope-apps }
  - { id: review-scope-core/A-01, sev: P2, dim: A, files: [message-attachment.schema.ts], src: review-scope-core }
  - { id: review-scope-core/C-01, sev: P2, dim: C, files: [prompt-path-seen.ts, build-user-ops-attachment.ts, synthesize-user-vfs-flush-actions.ts, public/chat.ts], src: review-scope-core }
  - { id: review-scope-apps/C-1, sev: P2, dim: C, files: [PreviewAnnotateUi.tsx], src: review-scope-apps }
  - { id: review-scope-apps/C-2, sev: P2, dim: C, files: [chat-composer-draft.ts], src: review-scope-apps }
spec_deviations:
  - { id: apps-same-text-multi-annotate, status: fixed, closes_with: review-scope-apps/A-1 }
open_questions:
  - 空正文+pending+annotate 强制 append→U-U 为 SPEC 规定后果，不认定 must-fix
```
