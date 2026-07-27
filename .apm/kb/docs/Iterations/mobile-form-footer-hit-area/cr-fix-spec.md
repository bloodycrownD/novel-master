# CR Fix Spec: mobile-form-footer-hit-area（多 scope CR · round 1）

## 元信息

- repo: `d:\Dev\Js\novel-master`
- branch: `feature/mobile-form-footer-hit-area`
- base_sha: `794d42dcd1684dc4f077e71d0d6fa88dd5f20ff5`（main）
- head_sha: `2e89509eed66d275ced32bcfdd5cd68257fcdd0e` + **WIP**
- prd_path:
  - `.apm/kb/docs/Iterations/provider-identity/prd.md`
  - `.apm/kb/docs/Iterations/mobile-form-footer-hit-area/prd.md`
  - `.apm/kb/docs/Iterations/vfs-revision-storage-optimize/bugs/rn-content-blob-zlib-b64/prd.md`
- spec_path:
  - `.apm/kb/docs/Iterations/provider-identity/spec.md`
  - `.apm/kb/docs/Iterations/mobile-form-footer-hit-area/bugs/sticky-footer-fullwidth/spec.md`
  - `.apm/kb/docs/Iterations/vfs-revision-storage-optimize/bugs/rn-content-blob-zlib-b64/spec.md`
- review_round: 1
- dag_version: 2
- 状态：**fix-spec-ready**（round 1 review-full 建议 yes；请用户确认后交 code-dev-loop）

### Scope 汇总

| scope id | 结论 | must-fix |
|----------|------|----------|
| `review-scope-provider-identity` | scope-ready: **no** | 1 × P1 |
| `review-scope-mobile-boot-ui` | scope-ready: **no** | 1 × P1 |
| `review-scope-vfs-blob` | scope-ready: **yes** | **无 must-fix** |

> **vfs-blob scope**：无 must-fix；实现与 bug spec 对齐，`content-store.test.ts` + `test:vfs` 已绿。

## Must-fix（按 P0 → P1 → P2）

> **code-dev-loop 状态**：C-1 / A-1 均已闭合（`240dce6a` / `f55d7917`）。下列原文保留作追溯。

### review-scope-provider-identity/C-1 [P1] rowToProvider 空 display_name 回退 UUID ✅ done

- 维度：C (+B)
- 文件：
  - `packages/core/src/domain/provider/repositories/impl/sqlite-provider.repository.ts`（`rowToProvider`）
  - 对照 `packages/core/src/bootstrap/schema-migrations/provider-identity-v1.ts`（`assertMigratedShape`）
  - 新增/扩展 repository 或集成单测（如 `packages/core/test/domain/provider/` 或现有 provider 测试套件）
- 问题：`rowToProvider` 在 `display_name` 为 null/空白时回退 `String(row.id)`；迁移后主键为 **UUID**，会把技术 id 顶进 `displayName`，三端列表/模型前缀可能直接展示 UUID，违反 PRD「主路径不见 UUID」与 SPEC「`displayName: string` 必填非空」。
- 改法：
  1. **删除** `|| String(row.id)` / 等价回退逻辑。
  2. 空白 `display_name` 行读取时 **fail-fast**：抛 `ProviderError('INVALID_ARGUMENT', …)`（或与 migration `assertMigratedShape` 同类错误码/语义一致）。
  3. **补单测**：构造/插入空 `display_name` 行，`findById` / `listAll` 等路径不得返回 UUID 作为 `displayName`；应断言抛错。
- 验收/测试：
  - 单测：空 `display_name` → 抛错，不得回退 UUID。
  - 回归：现有 T-PI3–T-PI5、T-PI8–T-PI10 不回归。
  - 手工（合并后 QA）：服务商创建/列表主路径不出现 UUID 文案。
- 来源：`review-scope-provider-identity` / round 1

### review-scope-mobile-boot-ui/A-1 [P1] StickyFormFooter 内联 Pressable 偏离 SPEC ✅ done

- 维度：A + C
- 文件：
  - `apps/mobile/src/components/form/StickyFormFooter.tsx`（对照 `apps/mobile/src/components/ui/PrototypeButtons.tsx`）
  - 对照 `.apm/kb/docs/Iterations/mobile-form-footer-hit-area/bugs/sticky-footer-fullwidth/spec.md`
- 问题：
  - 分支 `f34aa521` 已按 SPEC 落地 `PrimaryButton` + `fullWidth`。
  - WIP 又改成内联 `Pressable`，复制 primary 色 / opacity / padding / 圆角 / 字号，与 `PrimaryButton` **双轨维护**。
  - 同时 WIP 已在 `PrototypeButtons` 修了 Android 根因（去掉 `alignItems:'center'`、`Text` 加 `pointerEvents="none"`、`fullWidthLabel`），按 SPEC 应足够让 `PrimaryButton fullWidth` 在 footer 生效。
  - 违背 footer PRD「最小改动、不抽新组件体系」和 sticky-footer SPEC「只改 StickyFormFooter 一行 `fullWidth`」。
- 改法（**推荐**）：
  1. `StickyFormFooter` **恢复** `PrimaryButton` + `fullWidth`（去掉内联 Pressable 双轨样式）。
  2. **保留** `PrototypeButtons` 的 Android 命中区修复（CloudSync 等其它 `fullWidth` 消费方一并受益）。
  3. **勿**双轨维护两套 primary CTA 样式。
  - 备选（不推荐）：若坚持内联 Pressable，须同步更新 sticky-footer SPEC/PRD 并删除与 `PrimaryButton` 重复的样式轨——本 fix-spec 以推荐路径为准。
- 验收/测试：
  - footer 仅 **一处** CTA 实现（`PrimaryButton fullWidth`，无内联 Pressable 平行样式）。
  - Android 真机：点主色条**左右空白**可触发 `onPress`（与点「创建/保存」文字中心一致）；disabled 时整颗仍不可点。
  - 回归：`npm test -w @novel-master/mobile -- agent-editor-form-delete-confirm`（及其它 StickyFormFooter 消费方 smoke）不回归。
- 来源：`review-scope-mobile-boot-ui` / round 1

## Spec deviations

| ID | 描述 | 状态 |
|----|------|------|
| SD-provider-current-provider-orphan | SPEC 默认 fail-fast；实现 DELETE 清空保启动 | **fixed / 用户收窄**（对话中接受孤儿清空，避免启动失败） |
| SD-provider-orphan-suggestions-sksp | orphan suggestions / sksp | **fixed / 已收窄** |
| SD-provider-phase-docs | phase-docs-changelog | **open**（non-blocking；发版前） |
| SD-footer-inline-pressable | 内联 Pressable 偏离 SPEC | **fixed**（A-1 已恢复 PrimaryButton fullWidth） |
| SD-prototype-buttons-touch | SPEC 原写不改 PrototypeButtons | **fixed / 已收窄**（sticky-footer SPEC 已记录例外） |
| SD-prd-minimal-change | 双轨样式 | **fixed**（A-1 收敛） |
| SD-android-manual-qa | Android 真机 | **pending**（合并后 QA；不阻塞 dev-ready） |
| SD-byte-len-zlib-b64 | 父级 byte_len 字面 | **open（可收窄）**（不阻塞） |
| SD-vfs-port-comment | 注释漂移 | **open**（不阻塞） |
| SD-vfs-test-matrix | T-CS2 矩阵缺口 | **open**（不阻塞） |

## Open questions / 待拍板

> 附录：来自三 scope 汇总的 open_questions；**不阻塞** fix-spec-ready（除非用户另行要求）。

| id | 域 | 问题 | 状态 |
|----|-----|------|------|
| provider-identity/Q-current-provider-orphan | provider-identity | **`currentProviderId` 孤儿指针**：SPEC 默认 unknown 旧值 fail-fast；实现为 DELETE 清空保启动。是产品拍板「清空」还是 oversight？若选清空，须在 migration 单测显式钉死。 | 开放 |
| provider-identity/Q-phase-docs | provider-identity | Phase 7 发版文档（CLI 破坏性、`NOVEL_MASTER_PROVIDER_<UUID>_API_KEY`、撤销 mobile-bugfix）— non-blocking，发版前谁写？ | 开放 |
| provider-identity/Q-scope-bleed-footer | provider-identity | `StickyFormFooter fullWidth` 属 mobile-form-footer 迭代，与 provider-identity 无直接耦合 — 是否拆 PR / 在 fix-spec 标注 scope bleed？ | 开放 |
| mobile-boot-ui/Q-footer-approach | mobile-boot-ui | WIP 内联 Pressable 是「fullWidth 仍不够」的实测结论，还是预防性重写？若前者，建议补 Android 复现说明。 | 开放（`A-1` 推荐路径可消解） |
| mobile-boot-ui/Q-schema-boot-discipline | mobile-boot-ui | `SCHEMA_BOOT_VERSION` 依赖人工 bump，无 CI 门禁 — 是否接受「注释约定 + code review」？ | 开放 |
| mobile-boot-ui/Q-llm-fetch-defer | mobile-boot-ui | `ensureLlmFetchConfigured` 改 `setTimeout(..., 0)` 后，__DEV__ 同 tick 发 LLM 请求时 logging fetch 可能尚未注册 — 是否接受？ | 开放 |
| mobile-boot-ui/Q-android-manual | mobile-boot-ui | footer 主验收仍为 Android 真机 — 由谁、何时验收？ | 开放（见合并后 QA） |
| vfs-blob/Q-rn-detect | vfs-blob | `isReactNativeRuntime()` 仅查 `navigator.product`；是否 Mobile 启动显式 `preferZlibB64: true` 做 defense-in-depth？ | 开放（P2；不阻塞 scope-ready） |
| vfs-blob/Q-legacy-zlib-string | vfs-blob | 存量 `encoding=zlib` + string 非 base64 仍会失败 — 真机旧库是否还有别的形态？ | 开放（P2） |
| vfs-blob/Q-manual-rn | vfs-blob | PRD 要求真机：旧库读文件、新建保存再读 — CI 无法替代 | 开放（不阻塞 scope-ready） |

## 已豁免（用户确认不修）

（本轮无新增豁免条目。）

## 合并后 QA（manual_user）

> 不阻塞 fix-spec-ready 声明；真机 / 桌面由用户执行。

- **Android footer 热区**：「添加服务商」及任一 `StickyFormFooter` 表单，可保存状态下点主色条左右空白可触发；disabled 时整颗不可点。
- **Provider 创建/列表无 UUID**：Mobile + Desktop 服务商列表、详情、创建成功 toast、模型主文案前缀均为名称，主路径不见 UUID。
- **RN 旧库读文件**：Android 真机升级后打开含 VFS 内容的旧库，读文件无 `Uint8Array/ArrayBuffer` 类型错误；新建保存再读正常。

## K 节建议（下游执行时闭合）

### 实现顺序

1. **P1 Core**：`review-scope-provider-identity/C-1`（repository fail-fast + 单测）
2. **P1 Mobile**：`review-scope-mobile-boot-ui/A-1`（footer 恢复 `PrimaryButton fullWidth`，保留 PrototypeButtons 修复）
3. **文档同步**（`A-1` / `C-1` 闭合后）：更新 sticky-footer SPEC 记录 PrototypeButtons 例外；provider migration 孤儿策略若拍板则补测 + SPEC 收窄

### 下游执行检查项

- **rebuild core**：改 `packages/core` 后 Mobile/Desktop/CLI 须重新 build / 链接 core 产物（`npm run build -w @novel-master/core` 或仓库标准流程）。
- **确认无 boot-timing 残留**：合并前 grep `boot-timing`、`[nm-boot]`、`apps/mobile/src/runtime/boot-timing.ts` — 应无诊断文件与刷屏 log；`schema-migrations/index.ts` 仅在实际跑 migration 时输出。
- **allowlist / snapshot**：若 export 面有变，同步 `packages/core/test/package-exports/snapshots/*`。
- **lint / format**：仓库标准命令（下游 code-dev-loop 闭合时执行）。

### vfs-blob scope

- **无 must-fix**；`review-scope-vfs-blob` 已 scope-ready。
- 可选收尾：`SD-vfs-port-comment` 注释、`SD-vfs-test-matrix` 矩阵补测 — 非阻塞。

## Fix-Spec Closure

| 项 | 状态 |
|----|------|
| fix-spec-ready | **yes** |
| fix_spec_path | `.apm/kb/docs/Iterations/mobile-form-footer-hit-area/cr-fix-spec.md` |
| dag_version / review_round | 3 / 1（code-dev-loop 已闭合 must-fix） |
| P0 / P1 / P2（已写入且已闭合） | 0 / 2 / 0 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | blocking 无；pending/open 均为 non-blocking 或已收窄 |
| C-orch | N/A |
| vfs-blob scope | **无 must-fix**；scope-ready: yes |
| C 类合并后 QA | Android footer 热区；provider 无 UUID；RN 旧库读文件 |
| **dev-ready（fix-spec 范围）** | **yes**（`240dce6a` + `f55d7917`） |
