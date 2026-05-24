# tdbc-driver-rn `/native` 入口 PRD

## 背景

- `apps/mobile` 为在 Metro monorepo 下使用 VFS，临时增加了 **`DeviceSqliteAdapter`**（静态 `import` `react-native-quick-sqlite`），通过 `registerRnDriver(new DeviceSqliteAdapter())` 注入。
- `@novel-master/tdbc-driver-rn` 包内已有等价的 **`QuickSqliteAdapter`**，但使用 **动态 `import()`**；从编译后的 `dist` 在 RN 打包时易失败（已踩「未安装 / failed to load」）。
- 二者逻辑重复，维护成本高；应在 **driver 包内** 提供 RN 专用入口，**删除 App 侧 adapter 副本**，保持「core + tdbc-driver-rn + app 壳」分层清晰。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 消除重复 adapter | 删除 `apps/mobile/src/vfs/device-sqlite-adapter.ts`；mobile 不再实现 `RnSqliteAdapter` |
| RN 可打包 | `@novel-master/mobile` 在 Android Debug 下 VFS 验证页 **Write → Read** 与合并前行为一致 |
| 包边界清晰 | 新增 **`@novel-master/tdbc-driver-rn/native`** 子路径，文档写明「RN App 专用」 |
| 不破坏 Node 测试 | `packages/tdbc-driver-rn` 现有 `npm test`（conformance + row-mapper）**仍全绿** |
| 主入口兼容 | 根导出 `registerRnDriver()` **行为不变**（默认仍 `QuickSqliteAdapter` 动态 import，供非 Metro / 文档示例） |

## 方案决策（PRD 级，细节见后续 SPEC）

**采用「双入口」：**

| 入口 | 用途 | 默认 adapter |
|------|------|----------------|
| `@novel-master/tdbc-driver-rn` | Node conformance、类型导出、通用 API | `QuickSqliteAdapter`（动态 import，**不在 RN 真机默认使用**） |
| `@novel-master/tdbc-driver-rn/native` | **RN App / Metro bundle** | 静态 import 的 `NativeQuickSqliteAdapter`（命名以 SPEC 为准） |

**理由：** Node 侧测试与 CI 不加载 RN native 模块；Metro 需要静态依赖图。不把静态 import 塞进主入口，避免工具链在 Node 解析主包时误拉 native peer。

## 用户与场景

| 用户 | 场景 |
|------|------|
| mobile 维护者 | `import { registerRnDriver } from '@novel-master/tdbc-driver-rn/native'` 后 `registerRnDriver()`，无需自写 adapter |
| driver 包维护者 | 单一实现源：native 与现有 adapter 共享逻辑或 native 为薄封装，避免第三份拷贝 |
| 后续 RN 应用 | 新 App workspace 复制同一 import 约定即可 |

## 范围

### 包含范围

1. **`packages/tdbc-driver-rn`**
   - 新增源码入口（如 `src/native.ts`）及 **`package.json` `exports["./native"]`** 指向 `dist/native.js`。
   - 提供 **`registerRnDriver()`**（无参时注册静态 quick-sqlite adapter）及必要 re-export（如 `RnSqliteAdapter` 类型、`RN_DRIVER_NAME`，以 SPEC 为准）。
   - 静态 `import` `react-native-quick-sqlite` 仅出现在 **native 入口** 可达模块内。

2. **`apps/mobile`**
   - `runtime.ts` 改为从 **`@novel-master/tdbc-driver-rn/native`** 调用 `registerRnDriver()`（无自定义 adapter）。
   - **删除** `src/vfs/device-sqlite-adapter.ts`。
   - Metro / Jest 配置若有 `device-sqlite-adapter` 引用则一并清理。

3. **文档**
   - 更新 `packages/tdbc-driver-rn/README.md`：何时用 `.` vs `./native`。
   - 更新 `apps/mobile/README.md` 与 `.apm/kb/docs/monorepo.md` 中相关一句说明。

4. **验证**
   - `npm test`（含 `tdbc-driver-rn`、`mobile`）。
   - `npm run build -w @novel-master/tdbc-driver-rn`。
   - 手工：Android VFS 页冒烟（与 mobile-app-scaffold 验收同族）。

### 不包含范围

- 修改 `@novel-master/core` VFS / TDBC 协议。
- 删除或重写主入口 `QuickSqliteAdapter`（动态 import 保留）。
- iOS 专项验收、Detox/E2E 自动化。
- 阅读器业务、banzhu 迁入、VFS 与 CLI 共库。
- 拆独立 npm 发布包或 semver 主版本策略变更。

## 核心需求

1. **子路径导出**：发布 `./native`，TypeScript 类型与 `import` 解析在 monorepo（mobile + Metro）下可用。
2. **静态绑定**：native 入口内对 `react-native-quick-sqlite` 使用 **静态 import**，保证 Metro 将 native 模块打入 bundle。
3. **注册语义**：`registerRnDriver()`（native 入口）注册 RN 可用 adapter，与当前 `DeviceSqliteAdapter` 行为等价（含 `location: 'default'`、execute 走 `QuickSQLite`）。
4. **去重**：移除 `apps/mobile` 内 adapter 文件；mobile 仅保留 `runtime` / `constants` / UI。
5. **测试不回退**：`tdbc-driver-rn` 全量测试通过；`row-mapper` 对 `rows._array` 的处理保持有效。
6. **主入口不变**：从 `@novel-master/tdbc-driver-rn` 导入的现有 API 不破坏；默认 `registerRnDriver()` 仍使用包内 `QuickSqliteAdapter`。

## 验收标准

### A. 包与构建

- **A1** Given `package.json` 含 `exports["./native"]`，When 在仓库根 `npm run build -w @novel-master/tdbc-driver-rn`，Then 存在 `dist/native.js` 与对应 `.d.ts`。
- **A2** Given mobile 的 `runtime.ts` 仅从 `./native` 导入 `registerRnDriver`，When TypeScript / Metro 编译，Then **无**对 `device-sqlite-adapter` 的引用。

### B. 行为等价

- **B1** Given 已合并本迭代的 App 安装到 Android 模拟器/真机，When 在 VFS 页 Write `/dev/note.md` + Read，Then 内容与版本与迭代前一致。
- **B2** Given 同上，When 执行 List / Glob / Replace / Delete 各一次，Then 无红屏、无 `undefined is not a function`、无 quick-sqlite load 失败文案。

### C. 清理与测试

- **C1** 仓库中 **不存在** `apps/mobile/src/vfs/device-sqlite-adapter.ts`。
- **C2** `npm test -w @novel-master/tdbc-driver-rn` 与根目录 `npm test` 通过。
- **C3** README（driver + mobile）明确写出：**RN App 应使用 `@novel-master/tdbc-driver-rn/native`**。

### D. 边界

- **D1** Node 侧 `npm test -w @novel-master/tdbc-driver-rn` **不**要求安装或执行 `react-native-quick-sqlite` native 二进制（测试仍用 Mock adapter）。
- **D2** 主入口 `import { registerRnDriver } from '@novel-master/tdbc-driver-rn'` 在文档中标注为 **非 RN Metro 默认路径**。

## 约束与依赖

| 项 | 说明 |
|----|------|
| 前置 | `mobile-app-scaffold` 已合并；VFS + `row-mapper` 修复已在 main |
| peer | `react-native-quick-sqlite` 仍由 **App** `dependencies` 安装 |
| Metro | monorepo `watchFolders` 配置保持；native 入口须被 Metro 解析到 **源码或 dist**（SPEC 定） |
| 决策 | 双入口；主入口默认 adapter **不**改为静态 import（见上文「方案决策」） |

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| Metro 仍不解析 `./native` 子路径 | SPEC 中验证 `resolver` + 必要时 `unstable_enablePackageExports` |
| native 入口被 Node 测试误 import | native 模块仅由 mobile 引用；测试不 import `./native` |
| 与 `QuickSqliteAdapter` 逻辑漂移 | 抽共享私有模块或 native 复用同一实现文件（SPEC） |

**SPEC 待决：** `native.ts` 是否 re-export 全部类型；Jest 是否需 mock `./native`。

## 里程碑（可选）

| 阶段 | 交付 |
|------|------|
| M1 | `exports` + `native` 实现 + build |
| M2 | mobile 切换 + 删除 device adapter |
| M3 | 测试 + README + 真机冒烟 |
