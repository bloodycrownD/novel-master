# L10：工程化基建一致性

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**工程化基建（CI / 工具链 / 版本对齐 / 测试运行器）**这一个角度扫遍整个仓库。

## 你的一句话职责

查清这个仓库的**工程地基牢不牢**——CI 有没有把关、TypeScript/ESLint/Node 版本三端对不对齐、测试运行器统不统一、构建脚本合不合理。你不看代码逻辑，只看"代码能不能可靠地被构建、测试、发布"。

## 你的独有抓手

- **CI 缺失或覆盖不全**：PR/push 上有没有自动跑 lint/test/build，还是纯靠本地自觉
- **工具链版本分裂**：TypeScript、ESLint、Node 在不同 workspace 里版本不一致，导致同一段代码在不同端行为不同
- **测试运行器割裂**：node:test / jest / 自定义 runner 三套并存，knip 配置和覆盖率统计全乱
- **构建脚本低效**：`--force` 禁用增量、prebuild 链重复构建无缓存
- **版本声明混乱**：`engines.node` 各 package 各说各的，`.nvmrc` 又写死一个值
- **配置漂移**：ESLint flat config vs legacy `.eslintrc`，tsconfig 继承链断裂

## Phase 0 已确认的工程化现实

Phase 0 侦察已摸清关键事实：

### CI 现状

- `.github/workflows/` 下**只有 `release.yml`**，没有任何 PR/push 上的 lint/test/typecheck/build workflow
- 也就是说 1700+ commit 全程没有机器把关，纯靠本地自觉
- `release.yml` 只对 `@novel-master/mobile` 和 `@novel-master/desktop` 执行 `npm version`，其他 8 个 package 永远停在 0.0.0

### 已知的版本分裂

| 维度 | 分裂情况 |
|------|----------|
| TypeScript | core/cli/desktop 用 `^6.0.3`；mobile/sksp-android/tdbc-driver-rn 用 `^5.8.3` |
| ESLint | core/desktop 用 ESLint 9 + flat config；mobile 用 ESLint 8 + `.eslintrc.js` |
| Node engines | 根 `>=20`；mobile `>=22.11.0`；desktop 无声明；`.nvmrc` 写死 `22.22.0` |
| 测试运行器 | core/cli 用 `node:test`；mobile 用 jest；desktop 用自定义 `scripts/run-tests.mjs` |
| Prettier | 部分有 `format:check` 脚本，部分没有 |

### 已知的构建脚本问题

- `packages/core` 的 build 脚本是 `tsc --build tsconfig.json --force`——`--force` 禁用了增量编译（尽管 tsconfig 设了 `composite: true` 和 `incremental: true`）
- `apps/mobile` 的 `preandroid`/`preios`/`prestart` 各自跑一遍 5 个 workspace 全量构建，之间无缓存复用
- 三套构建管线：core 走 tsc + tsc-alias，desktop 走 vite + esbuild，mobile 走 Metro + 独立 `build:webview`

## 读什么文件

### 核心目标

| 目标 | 看什么 |
|------|--------|
| `.github/workflows/` | **只有 release.yml**——确认 CI 是否真的缺失 PR/push workflow |
| 所有 `package.json`（根 + 10 个 workspace） | scripts、dependencies、devDependencies、engines、版本号 |
| `.nvmrc` | 写死的 Node 版本 |
| 所有 `tsconfig*.json` | 继承链、compilerOptions 是否一致 |
| 所有 `eslint.config.*` 和 `.eslintrc.*` | flat vs legacy、规则集差异 |
| `scripts/` 下的工具脚本 | 构建辅助、测试 runner、检查脚本 |
| `apps/desktop/scripts/run-tests.mjs`（如存在） | desktop 自定义测试 runner |

### grep / find 模式

```text
# 找所有 package.json
find_path: "**/package.json"  # 排除 node_modules

# 找所有 tsconfig
find_path: "**/tsconfig*.json"  # 排除 node_modules

# 找所有 eslint 配置
find_path: "**/.eslintrc*"
find_path: "**/eslint.config.*"

# 找所有 workflows
find_path: ".github/workflows/*"

# 找测试运行器配置
find_path: "**/jest.config.*"
find_path: "**/wdio*.conf.*"
find_path: "**/vitest.config.*"

# 找 engines 声明
include: "**/package.json"
regex: '"engines"'
```

## 典型问题清单 & 检查手法

### 1. CI 缺失（最严重）
**怎么查**：读 `.github/workflows/` 下所有文件。确认：
- 有没有 `on: [push]` 或 `on: [pull_request]` 的 workflow？
- 如果只有 `release.yml`，那 PR 上完全没自动检查
- 如果有，覆盖了哪些 workspace？跑的是 lint 还是 test 还是 build？

**判定标准**：PR/push 上无任何 lint/test/typecheck → 标 S（这是所有其他角度发现的问题无法被自动捕捉的根因）。

### 2. TypeScript 版本分裂
**怎么查**：grep 所有 package.json 的 `typescript` 版本。分组统计。然后判断：
- TS 6 和 TS 5 的行为差异（装饰器、`const` 类型参数、`using` 等）是否影响这个项目？
- 同一个 type 在 TS 6 编译通过，在 TS 5 下会不会报错？

**判定标准**：同 monorepo 内 TS 主版本不一致且无迁移计划 → 标 A。

### 3. ESLint 配置分裂
**怎么查**：对比 core/desktop（ESLint 9 flat config）和 mobile（ESLint 8 `.eslintrc`）的规则集：
- 共享规则有没有？（`eslint.config.base.mjs` 是否被所有 workspace 用？）
- mobile 的 ESLint 8 规则和 core 的 ESLint 9 规则是否冲突？
- `@typescript-eslint/no-unused-vars` 在 core 是 warn，在 mobile 是什么？

**判定标准**：同仓库两套 ESLint 主版本且无统一计划 → 标 A。

### 4. Node engines 不一致
**怎么查**：对比所有 package.json 的 `engines.node` + `.nvmrc`。已有数据：
- 根 `>=20`、mobile `>=22.11.0`、desktop 无、`.nvmrc` `22.22.0`
- 这四个声明互相矛盾：到底最低支持 Node 20 还是 22？

**判定标准**：engines 声明互相矛盾且影响依赖解析 → 标 A。

### 5. 测试运行器割裂
**怎么查**：列每个 workspace 用的测试运行器：
- core/cli：`node:test`（Node 原生）
- mobile：jest
- desktop：自定义 runner

判断：
- 测试 API 差异（`describe`/`it`/`expect` 的行为在不同运行器下是否一致？）
- knip 误判的根因（74 desktop test、17 mobile e2e 被标 unused，就是运行器入口不统一导致的）

**判定标准**：三套测试运行器并存导致工具链（knip、覆盖率统计）无法统一工作 → 标 A。

### 6. 构建增量被禁用
**怎么查**：读 `packages/core/package.json` 的 build 脚本：`tsc --build tsconfig.json --force`。
- `--force` 禁用了 tsc 的 project references 增量构建
- 但 tsconfig 设了 `composite: true` 和 `incremental: true`——这两个被 `--force` 抵消
- 为什么要加 `--force`？是历史遗留还是有特定原因？

**判定标准**：构建增量被显式禁用且无注释说明原因 → 标 B。

### 7. prebuild 链重复构建
**怎么查**：读 mobile 的 `preandroid`/`preios`/`prestart`。每次都跑 5 个 workspace 全量构建。
- 如果连续跑 `android` 然后 `start`，core 会被构建两次
- 有没有缓存机制？

**判定标准**：相邻命令重复全量构建 → 标 B。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L7 测试** | 你说"测试运行器不统一"，L7 说"测试覆盖不足" | 互补——L7 看测试内容，你看测试基建。L7 的盲区判定受你影响（knip 误判源于运行器分裂） |
| **L9 死代码** | 你说"knip 误判源于配置不一致"，L9 也在处理 knip 误判 | 互补——你诊断根因（配置），L9 处理症状（逐条核实） |
| **L2 算法** | 你说"构建 --force 禁用增量"，L2 关心运行时复杂度 | 不冲突——你管构建时，L2 管运行时 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-10-build-infra.md`。

**特别要求**：你的报告必须包含一张**三端工具链对比表**：

| 维度 | core/cli | desktop | mobile | 一致？ |
|------|----------|---------|--------|--------|
| TypeScript | 6.0.3 | 6.0.3 | 5.8.3 | ❌ |
| ESLint | 9 flat | 9 flat | 8 legacy | ❌ |
| 测试运行器 | node:test | 自定义 | jest | ❌ |
| Node engines | >=20 | 无 | >=22.11.0 | ❌ |
| 构建 | tsc + tsc-alias | vite + esbuild | Metro + webview | — |
| CI 覆盖 | 无 | 无 | 无 | ❌ |

这张表会被 D3-2 债务登记表直接引用。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | CI 完全缺失（PR 上无任何自动检查）——这是所有其他角度发现的问题无法被捕捉的根因 |
| **A** | 工具链主版本分裂（TS 6 vs 5、ESLint 9 vs 8）；测试运行器割裂导致工具失效；engines 矛盾 |
| **B** | 构建增量被禁用；prebuild 链重复；Prettier 覆盖不全 |
| **C** | 脚本命名不一致；配置组织风格差异 |
