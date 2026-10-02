# L0 覆盖矩阵说明与未覆盖清单

> 机位：确定性普查。脚本：`tmp/l0census/coverage-matrix.mjs`（可复跑：`node tmp/l0census/coverage-matrix.mjs`）。
> 矩阵文件：`L0/coverage-matrix.csv`（列：`path,lines,zone,w1,w2`）。
> `w1` / `w2` 列填**认领该文件所在 zone 的报告文件名**（多个机位认领同一 zone 时用 `+` 连接）；认领依据是各报告 front matter 的 `zone` + `files_scanned` + `paths`，zone 级口径，不逐文件精确。

## 一、zone × 机位 认领表

| CSV zone | 文件数 | W1 机位 | W2 机位 |
|---|---|---|---|
| `tests` | 889 | — | — |
| `desktop-renderer` | 141 | — | `w2-desktop-core.md` `w2-desktop-features.md` |
| `mobile-app` | 134 | — | `w2-mobile-nav.md` `w2-mobile-runtime.md` |
| `mobile-components` | 133 | `w1-mobile-chat-ui.md` | `w2-mobile-ui.md` |
| `core-infra` | 129 | — | `w2-core-infra-misc.md` `w2-core-infra-proto.md` `w2-core-infra-sql.md` |
| `core-service` | 123 | — | `w2-core-service-agent.md` `w2-core-service-chat.md` `w2-core-service-vfs.md` |
| `packages-periph` | 102 | — | `w2-cli-periph.md` |
| `desktop-main` | 80 | `w1-desktop-main.md` | — |
| `mobile-web` | 67 | — | `w2-mobile-web.md` |
| `core-chat` | 61 | `w1-core-chat.md` | — |
| `core-root` | 57 | — | `w2-core-bootstrap.md` |
| `core-vfs` | 57 | — | — |
| `cli` | 50 | — | `w2-cli-periph.md` |
| `mobile-screens` | 48 | `w1-mobile-chat-ui.md` | `w2-mobile-nav.md` `w2-mobile-ui.md` |
| `core-provider` | 33 | — | `w2-core-provider.md` |
| `core-bootstrap` | 31 | — | `w2-core-bootstrap.md` |
| `core-tool` | 29 | `w1-core-tool.md` | — |
| `UNASSIGNED` | 29 | — | — |
| `desktop-shared` | 21 | `w1-desktop-main.md` | `w2-desktop-core.md` |
| `core-workplace` | 19 | — | `w2-core-workplace.md` |
| `core-message-checkpoint` | 17 | — | `w2-core-checkpoint.md` |
| `core-agent` | 14 | — | `w2-core-agent.md` |
| `core-prompt` | 12 | — | `w2-core-prompt.md` |
| `core-character-card` | 9 | — | `w2-core-skills.md` |
| `core-skills` | 9 | — | `w2-core-skills.md` |
| `core-smart-sort-rule` | 9 | — | `w2-core-small.md` |
| `core-compaction-conditions` | 7 | — | `w2-core-small.md` |
| `core-session-kkv` | 6 | — | `w2-core-small.md` |
| `core-format` | 5 | — | `w2-core-prompt.md` |
| `core-kkv` | 4 | — | `w2-core-small.md` |
| `core-depth` | 3 | — | `w2-core-small.md` |
| `core-session-run-state` | 3 | — | `w2-core-agent.md` |
| `mobile-android` | 2 | — | — |
| `core-events` | 1 | — | `w2-core-small.md` |
| `core-feature-flags` | 1 | — | `w2-core-small.md` |

## 二、覆盖概览

| 指标 | 数量 |
|---|---|
| 矩阵总行 | 2335 |
| 测试文件（zone=tests，不计认领） | 889 |
| 生产文件 | 1446 |
| 已被 ≥1 机位认领的生产文件 | 1358 |
| **未被任何机位认领的生产文件** | **88** |

## 三、未被任何机位认领的文件清单（补扫清单）

> 口径：`zone=tests` 的 889 个测试文件不进本清单（各机位 `files_scanned` 已隐含扫过对应 zone 的测试，测试覆盖另立矩阵）；此处只列 `UNASSIGNED` 与 tests 之外的生产文件。

| zone | 文件数 | 行数合计 | 路径 |
|---|---|---|---|
| `core-vfs` | 57 | 7407 | `packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts`<br>`packages/core/src/domain/vfs/content-store/logic/blob-bytes-codec.ts`<br>`packages/core/src/domain/vfs/content-store/logic/hash-content.ts`<br>`packages/core/src/domain/vfs/content-store/logic/resolve-stored-content.ts`<br>`packages/core/src/domain/vfs/content-store/logic/zlib-codec.ts`<br>`packages/core/src/domain/vfs/content-store/vfs-content-store.port.ts`<br>`packages/core/src/domain/vfs/logic/action-xml-to-tool-uses.ts`<br>`packages/core/src/domain/vfs/logic/compute-replace-not-found-error.ts`<br>`packages/core/src/domain/vfs/logic/compute-replace-result.ts`<br>`packages/core/src/domain/vfs/logic/deferred-blob-gc.ts`<br>`packages/core/src/domain/vfs/logic/ensure-parent-dirs.ts`<br>`packages/core/src/domain/vfs/logic/entry-sequence-repair.ts`<br>`packages/core/src/domain/vfs/logic/extract-mutating-paths.ts`<br>`packages/core/src/domain/vfs/logic/format-vfs-error-for-llm.ts`<br>`packages/core/src/domain/vfs/logic/format-vfs-error-for-user.ts`<br>`packages/core/src/domain/vfs/logic/infer-scope-from-path.ts`<br>`packages/core/src/domain/vfs/logic/longest-common-substring.ts`<br>`packages/core/src/domain/vfs/logic/normalize-for-match.ts`<br>`packages/core/src/domain/vfs/logic/parent-dir.ts`<br>`packages/core/src/domain/vfs/logic/read-user-vfs-save-baseline.ts`<br>`packages/core/src/domain/vfs/logic/restore-mutating-path-heads.ts`<br>`packages/core/src/domain/vfs/logic/revision-pair-key.ts`<br>`packages/core/src/domain/vfs/logic/revision-ref-count.ts`<br>`packages/core/src/domain/vfs/logic/seed-live-head-revisions.ts`<br>`packages/core/src/domain/vfs/logic/strip-known-physical-prefixes.ts`<br>`packages/core/src/domain/vfs/logic/user-vfs-save-mapping.ts`<br>`packages/core/src/domain/vfs/logic/validate-entry-name.ts`<br>`packages/core/src/domain/vfs/logic/vfs-batch-path.ts`<br>`packages/core/src/domain/vfs/logic/vfs-copy.ts`<br>`packages/core/src/domain/vfs/logic/vfs-exclude-prefixes.ts`<br>`packages/core/src/domain/vfs/logic/vfs-grep.ts`<br>`packages/core/src/domain/vfs/logic/vfs-move.ts`<br>`packages/core/src/domain/vfs/logic/vfs-path-mapper.ts`<br>`packages/core/src/domain/vfs/logic/vfs-rename-primitive.ts`<br>`packages/core/src/domain/vfs/logic/vfs-tree-copy.ts`<br>`packages/core/src/domain/vfs/logic/vfs-zip-build.ts`<br>`packages/core/src/domain/vfs/logic/vfs-zip-central-dir.ts`<br>`packages/core/src/domain/vfs/logic/vfs-zip-filename-decode.ts`<br>`packages/core/src/domain/vfs/logic/vfs-zip-parse.ts`<br>`packages/core/src/domain/vfs/logic/vfs-zip-path.ts`<br>`packages/core/src/domain/vfs/logic/vfs-zip-validate.ts`<br>`packages/core/src/domain/vfs/model/vfs-content-size.ts`<br>`packages/core/src/domain/vfs/model/vfs-entry.ts`<br>`packages/core/src/domain/vfs/model/vfs-list-entry.ts`<br>`packages/core/src/domain/vfs/model/vfs-options.ts`<br>`packages/core/src/domain/vfs/model/vfs-revision.ts`<br>`packages/core/src/domain/vfs/ports/character-card-import.port.ts`<br>`packages/core/src/domain/vfs/ports/vfs-batch-io.port.ts`<br>`packages/core/src/domain/vfs/ports/vfs-restore.port.ts`<br>`packages/core/src/domain/vfs/ports/vfs-service.port.ts`<br>`packages/core/src/domain/vfs/ports/vfs-zip-io.port.ts`<br>`packages/core/src/domain/vfs/repositories/impl/normalize-path.ts`<br>`packages/core/src/domain/vfs/repositories/impl/scope-prefix-helpers.ts`<br>`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts`<br>`packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts`<br>`packages/core/src/domain/vfs/repositories/vfs-entry.port.ts`<br>`packages/core/src/domain/vfs/repositories/vfs-revision.port.ts` |
| `UNASSIGNED` | 29 | 3027 | `apps/desktop/eslint.config.mjs`<br>`apps/desktop/scripts/after-pack.mjs`<br>`apps/desktop/scripts/check-preload-bridge.mjs`<br>`apps/desktop/scripts/ensure-test-native.mjs`<br>`apps/desktop/scripts/fix-settings-utf8.mjs`<br>`apps/desktop/scripts/generate-desktop-events.mjs`<br>`apps/desktop/scripts/generate-icons.mjs`<br>`apps/desktop/scripts/rebuild-native-for-node.mjs`<br>`apps/desktop/scripts/rebuild-native.mjs`<br>`apps/desktop/scripts/run-tests.mjs`<br>`apps/desktop/scripts/start-electron.mjs`<br>`apps/desktop/vite.config.ts`<br>`apps/mobile/.prettierrc.js`<br>`apps/mobile/babel.config.js`<br>`apps/mobile/eslint.config.mjs`<br>`apps/mobile/index.js`<br>`apps/mobile/jest.config.js`<br>`apps/mobile/metro.config.js`<br>`apps/mobile/scripts/build-webview.mjs`<br>`apps/mobile/scripts/generate-app-icons.mjs`<br>`apps/mobile/scripts/run-gradlew.mjs`<br>`apps/mobile/test-utils/core-shim.ts`<br>`apps/mobile/test-utils/document-picker-mock.ts`<br>`apps/mobile/test-utils/notifee-mock.ts`<br>`apps/mobile/test-utils/op-sqlite-mock.ts`<br>`apps/mobile/test-utils/react-native-blob-util-mock.ts`<br>`apps/mobile/test-utils/react-native-keyboard-controller-mock.tsx`<br>`apps/mobile/test-utils/react-native-reanimated-mock.tsx`<br>`apps/mobile/test-utils/react-native-webview-mock.tsx` |
| `mobile-android` | 2 | 55 | `apps/mobile/android/app/src/main/java/com/novelmaster/MainActivity.kt`<br>`apps/mobile/android/app/src/main/java/com/novelmaster/MainApplication.kt` |

### 缺口说明

- **`core-vfs`（57 文件 / 7407 行）是本波最大的空洞**：`w2-core-service-vfs.md` 只扫了 `packages/core/src/service/**`（对应 `core-service` zone），`packages/core/src/domain/vfs/**` 全域没有任何 W1/W2 机位认领。W3 需补一个 core-vfs 域测绘机位。
- `UNASSIGNED`（29 文件）：桌面构建/打包脚本、`vite.config.ts`、各端 `babel.config.js` / `jest.config.js` / `eslint.config.mjs` / `.prettierrc.js`、mobile `index.js` 入口等。要么归入「构建与工程配置」zone，要么显式标记为不评审。
- `mobile-android`（2 文件 Kotlin 原生）：`MainActivity.kt` / `MainApplication.kt`。`w2-cli-periph.md` 只「另核对 4 个 Kotlin 原生文件」（sksp-android），未覆盖 mobile 主壳的 Kotlin 侧。

## 四、口径与已知局限

- zone 映射表见脚本内 `ZONE_MAP`；映射依据是各报告 front matter 的 `zone` 与摘要自述范围（例如 `w2-core-small` 的摘要自述覆盖 depth / events / feature-flags / kkv / session-kkv / smart-sort-rule / compaction-conditions 七个小域）。
- front matter 里逐文件列出的（`w2-core-prompt`、`w2-core-service-agent`）走**精确认领**，其余走 zone 级认领。
- `zone=tests` 的 889 个测试文件不在本矩阵的认领口径内（各报告的 `files_scanned` 隐含扫过对应 zone 的测试）；如需测试覆盖矩阵另开一列。
- CSV 里的 `zone` 列沿用既有 L0 归区结果，本机位不改写 zone，只补 `w1`/`w2` 两列。