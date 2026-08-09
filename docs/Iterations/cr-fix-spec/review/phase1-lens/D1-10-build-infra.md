# D1-10：L10 工程化基建一致性

> 角度横扫结果。readonly，不改任何代码，不宣布 ready。本报告只看「代码能不能可靠地被构建、测试、发布」——也就是 CI、TypeScript、ESLint、测试运行器、Node engines 这五条工具链脉络在三端 + 10 个子包之间对不对齐。构建管线的增量失效（`--force`、prebuild 重复劳动、TS 项目引用未建立）归 L2，本报告只在「版本分裂导致的双重安装风险」这一条上和 L2 接边；包依赖图归 L3。代码逻辑、测试内容本身一概不看。

## 元信息

- 角度：L10 工程化基建一致性
- 模式：readonly 全局横扫
- 范围：根 + 3 个 app + 10 个 workspace package 的 `package.json` / `tsconfig*.json` / `eslint.config.*` / `.eslintrc.*` / `.nvmrc` / `.github/workflows/*` / 测试 runner 脚本
- 参考文档：`docs/review/guides/lens-L10-build-infra.md`、`docs/review/phase0/D0-1-code-map.md`、`docs/review/phase1-lens/D1-02-algorithm.md`（构建增量部分）
- 轮次：Phase 1 第 1 轮
- 产出日期：2026-08-05

## 结论

诶～这个仓库的工程地基嘛，怎么说呢，**问题不在「哪一条线烂」，而在「五条线各自烂出了不同的形状」**。最致命的一条是 **CI 完全没有 PR/push 检查**——`.github/workflows/` 下只有 `release.yml`，触发条件是 `push tags v*`，也就是说 1700+ commit 全程没有 lint / typecheck / test / build 的机器把关，纯靠本地自觉。这条单拎出来就是 S 级，因为它是其他所有角度（L1 数据模型、L2 算法、L4 错误处理、L7 测试、L9 死代码）发现的问题**无法被自动捕捉的根因**：再好的规则，没人执行等于没写。

工具链版本这一层，**TypeScript 主版本在 monorepo 内部分裂成 6.x 和 5.8.x 两套并存**。core/cli/desktop 走 TS 6.0.3（从根 hoist 或 desktop 自带），mobile/sksp-android/tdbc-driver-rn/tokenizer-driver-rn 自己钉死 TS 5.8.3。这不是「devDep 没对齐」的小问题——TS 6 和 TS 5 在装饰器语义、`const` 类型参数、`using` 资源管理、模块解析严格度上都有差异，**同一段类型代码在 core 编译通过、被 mobile 引用时可能在 TS 5 下报错**，反之亦然。叠加 ESLint 这边 core/desktop 用 ESLint 9 flat config、mobile 用 ESLint 8 + `.eslintrc.js`（`@react-native` 规则集），等于 lint 规则也是两套，`no-unused-vars` 在 core 是 warn，在 mobile 走的是 RN 默认（off），行为完全不可比。

测试运行器更碎，**node:test / jest / 自定义 wrapper 三套并存**，外加 mobile e2e 还有第四套 wdio/mocha。core/cli 加上几乎所有 Node 侧子包（cloud-sync-driver-s3、sksp-windows、sksp-mac、tdbc-driver-better-sqlite3、tdbc-conformance、tokenizer-driver-node）走 `tsx --test`；mobile 走 jest + `@react-native/jest-preset`；desktop 走 `scripts/run-tests.mjs`（本质是包了一层 electron mock 的 `tsx --test`）。运行器不统一最直接的后果就是 **knip 没法一致地识别测试入口**——74 个 desktop test 文件、17 个 mobile e2e 文件被 L9 标 unused，根因就在这里。Node engines 也是各说各的：根写 `>=20`，mobile 写 `>=22.11.0`，desktop/core/cli 全部不声明，`.nvmrc` 又写死 `22.22.0`——**到底最低支持 Node 20 还是 22，仓库里没有单一事实源**。

整体判断：**这个仓库的工程化一致性不是「差一点」，而是「五条线各自演化、没有任何一条线做过全局对齐」**。修起来其实不难（统一 TS 主版本、统一 ESLint major、收敛测试运行器、补一个 PR workflow、统一 engines），但**优先级必须排在 CI 缺失之后**——先补 CI 把现状锁住，再做版本对齐，否则对齐过程中引入的回归没人拦。

## 基建一致性对照表

下面这张表把五个维度逐 workspace 对照。`?` 表示该 package 不声明该字段，行为依赖 hoist 或运行时默认。

### TypeScript 版本（devDependency 声明）

| workspace | TS 版本 | 来源 |
|-----------|---------|------|
| 根 | `^6.0.3` | 显式 devDep |
| packages/core | ? | 从根 hoist → 6.0.3 |
| packages/cloud-sync-driver-s3 | ? | 从根 hoist → 6.0.3 |
| packages/sksp-mac | ? | 从根 hoist → 6.0.3 |
| packages/sksp-windows | ? | 从根 hoist → 6.0.3 |
| packages/tdbc-conformance | ? | 从根 hoist → 6.0.3 |
| packages/tdbc-driver-better-sqlite3 | ? | 从根 hoist → 6.0.3 |
| packages/tokenizer-driver-node | ? | 从根 hoist → 6.0.3 |
| **packages/sksp-android** | `^5.8.3` | 显式 devDep（钉死） |
| **packages/tdbc-driver-rn** | `^5.8.3` | 显式 devDep（钉死） |
| **packages/tokenizer-driver-rn** | `^5.8.3` | 显式 devDep（钉死） |
| apps/cli | ? | 从根 hoist → 6.0.3 |
| apps/desktop | `^6.0.3` | 显式 devDep（与根重复声明） |
| **apps/mobile** | `^5.8.3` | 显式 devDep（钉死） |

**分裂结果**：7 个包走 TS 6.0.3，4 个包（mobile + 3 个 RN 侧 driver）走 TS 5.8.3。pnpm 实际安装后 `node_modules` 里会同时存在两份 TypeScript 二进制。

> 额外风险：`@typescript-eslint/eslint-plugin@8.61.1` 的 peerDep 是 `typescript: >=4.8.4 <6.1.0`。当前 TS 6.0.3 刚好擦边落在区间内，但只要升到 6.1.0+ 就会 peerDep 冲突——这是一个**延迟引爆的版本地雷**。

### tsconfig 继承链 & 关键 compilerOptions

| workspace | extends | target | module / resolution | strict | noUnusedLocals/Params | composite/incremental |
|-----------|---------|--------|---------------------|--------|------------------------|------------------------|
| tsconfig.base.json（根基线） | — | ES2022 | NodeNext / NodeNext | true | true / true | true / true |
| packages/core | base | ES2022 | NodeNext | true | true | true |
| packages/cli | base | ES2022 | NodeNext | true | true | true |
| packages/cloud-sync-driver-s3 | base | ES2022 | NodeNext | true | true | true |
| packages/sksp-windows / sksp-mac | base | ES2022 | NodeNext | true | true | true |
| packages/tdbc-driver-better-sqlite3 / tdbc-conformance | base | ES2022 | NodeNext | true | true | true |
| packages/sksp-android / tdbc-driver-rn / tokenizer-driver-rn | base | ES2022 | NodeNext | true | true | true |
| apps/desktop（main） | base | ES2022 | NodeNext（+ lib DOM） | true | true | true |
| apps/desktop（renderer） | base | ES2022 | **ESNext / bundler** | true | true | noEmit |
| **apps/mobile（主）** | **@react-native/typescript-config** | RN 默认 | **ESNext / bundler + customConditions react-native** | true | **未设** | noEmit / isolatedModules |
| apps/mobile（tsconfig.build） | mobile 主 | RN 默认 | ESNext / bundler | true | 未设 | noEmit |
| **apps/mobile（webview-boot）** | **不继承任何** | **ES2018** | ESNext / bundler | true | **未设** | noEmit / isolatedModules |
| **apps/mobile/e2e** | **不继承任何** | ES2022 | ESNext / bundler | true | **未设** | noEmit |

**分裂结果**：

1. **target 出现三档**：ES2022（Node 侧 + desktop）、RN 默认（mobile 主）、ES2018（webview-boot）。同一个仓库编译出来的产物 target 不一致。
2. **`noUnusedLocals` / `noUnusedParameters` 在 mobile 整条线全失效**——base 设的 `true` 因为 mobile 不继承 base 而完全没传到。core 写 unused 变量会被 TS 拦，mobile 写就不会。这条规则层面的不对称，是 L9（死代码）在 mobile 侧误判率更高的结构性原因之一。
3. **mobile 整套（主 / build / webview-boot / e2e）完全不进 base 的统一约束**，是 tsconfig 一致性最大的孤岛。webview-boot 和 e2e 连 `extends` 都没有，等于完全独立的 tsconfig。
4. `ignoreDeprecations: "6.0"` 在 core 和 desktop renderer 出现——这是 TS 6 才需要的迁移开关，从侧面印证 Node 侧已经升到 TS 6，而 mobile 还停在 TS 5 不需要这个开关。

### ESLint 配置

| workspace | ESLint major | 配置形态 | 共享规则来源 |
|-----------|--------------|----------|--------------|
| 根（base 导出） | 9 | flat（`eslint.config.base.mjs` 导出 `createTsEslintConfig`） | — |
| packages/core | 9（从根 hoist） | flat，复用 `createTsEslintConfig` | `eslint.config.base.mjs` |
| apps/cli | 9（从根 hoist） | flat，复用 `createTsEslintConfig` | `eslint.config.base.mjs` |
| apps/desktop | 9（自带 `^9.22.0` 实际从根 hoist） | flat，**手抄 sharedTsRules**（没复用 base 导出） | 自己复制了一份 |
| **apps/mobile** | **8.19.0**（自带） | **legacy `.eslintrc.js`**，`extends: '@react-native'` | RN 规则集，与 base 完全无关 |
| 其他 8 个子包（cloud-sync-driver-s3 / sksp-* / tdbc-* / tokenizer-*） | ? | **无 lint 脚本、无 eslint 配置** | 完全没接入 ESLint |

**分裂结果**：

1. **ESLint 9（flat）和 ESLint 8（legacy）在一个仓库里共存**。这两代 ESLint 的配置文件格式、插件加载机制、规则命名都不兼容。
2. 共享规则的唯一载体 `eslint.config.base.mjs` 只被 core / cli 真正复用；desktop 名义上对齐了（注释写「Align with eslint.config.base.mjs sharedTsRules」），实际是把规则**手抄**了一份，将来 base 改规则 desktop 不会跟着变。
3. mobile 走 `@react-native/eslint-config`，规则集和另两套没有交集。`@typescript-eslint/no-unused-vars` 在 core/cli/desktop 是 `warn`，在 mobile 是 RN 默认（通常 off）。
4. **10 个子包里有 8 个完全没接入 ESLint**（cloud-sync-driver-s3、sksp-mac/windows/android、tdbc-conformance、tdbc-driver-better-sqlite3/rn、tokenizer-driver-node/rn）——它们的 `package.json` 没有 `lint` 脚本，根的 `npm run lint --workspaces --if-present` 对它们是 no-op。

### 测试运行器

| workspace | 运行器 | 入口脚本 | 备注 |
|-----------|--------|----------|------|
| packages/core | node:test（通过 tsx） | `tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test ...` | 有 `test:fast` / `test:msg` / `test:vfs` / `test:perf` 子命令 |
| apps/cli | node:test（通过 tsx） | `tsx --test test/**/*.test.ts` | |
| packages/cloud-sync-driver-s3 | node:test | `tsx --test test/**/*.test.ts` | |
| packages/sksp-windows / sksp-mac | node:test | `tsx --test test/**/*.test.ts` | |
| packages/tdbc-driver-better-sqlite3 / tdbc-conformance / tokenizer-driver-node | node:test | `tsx --test test/**/*.test.ts` | |
| packages/sksp-android | **无 test 脚本** | — | |
| packages/tdbc-driver-rn | node:test | `tsx --test test/**/*.test.ts` | |
| packages/tokenizer-driver-rn | **无 test 脚本** | — | |
| **apps/mobile** | **jest 29** + `@react-native/jest-preset` | `jest` | 走 `jest.config.js`，moduleNameMapper 把 workspace 包重映射到 dist |
| apps/desktop | **自定义 wrapper**（`scripts/run-tests.mjs`） | `node scripts/run-tests.mjs` | 本质是 `npx tsx --tsconfig tsconfig.renderer.json --test`，外加 `--import test/register-electron-mock.mjs` 注入 electron mock |
| apps/mobile（e2e） | **wdio 9 + mocha** | `wdio run ./e2e/wdio.conf.ts` | 第四套运行器 |

**分裂结果**：

1. **四套测试运行器并存**：node:test（绝大多数 Node 侧）、jest（mobile 单测）、自定义 wrapper（desktop 单测）、wdio+mocha（mobile e2e）。
2. desktop 的 `run-tests.mjs` 名义上是「自定义 runner」，实际是对 node:test 的二次封装（加 electron mock）。封装本身合理，但它让外部工具（knip、覆盖率统计、IDE test runner）**无法统一识别 desktop 的测试入口**——这是 L9 报告里 74 个 desktop test 文件被标 unused 的直接根因。
3. mobile 的 jest 用了 14+ 条 `moduleNameMapper` 把 `@novel-master/core/*` 重定向到 `packages/core/dist/*.js`（编译产物），意味着 **mobile 跑测试前必须先 build core**（`pretest` 脚本印证了这一点）。core 改一行代码，mobile 测试要重 build 才能反映——这套耦合是测试基建强加的，不是逻辑必需。
4. sksp-android 和 tokenizer-driver-rn **没有任何测试脚本**，等于这两个包在工具链层面是测试盲区（这点和 L7 测试覆盖交叉）。

### Node engines

| 位置 | engines.node | 备注 |
|------|--------------|------|
| 根 `package.json` | `>=20` | 唯一的「下限」声明 |
| apps/mobile | `>=22.11.0` | 比 root 高一个大版本 |
| apps/desktop | ? | 不声明 |
| apps/cli | ? | 不声明 |
| 全部 10 个 packages/* | ? | 全部不声明 |
| `.nvmrc` | `22.22.0`（写死） | `nvm use` 会切到这个 |
| `.github/workflows/release.yml` | `node-version: "22"` | CI 实际跑的 |

**分裂结果**：

1. **根说最低 Node 20，mobile 说最低 22.11.0，`.nvmrc` 说 22.22.0**——三个数字互相矛盾。新人用 `nvm use` 会装 22.22.0（OK），但如果用 `fnm` 或手动选了 20.x，根 engines 不会拦，mobile 的 engines 只在 mobile 目录 install 时才检查，**core/cli/desktop 在 Node 20 下能不能跑、有没有用上 22 才有的 API（如 `node:sqlite`），没人验证过**。
2. **10 个子包 + desktop + cli 全部不声明 engines**，等于把「能跑的 Node 版本」这个契约完全甩给根的 `>=20`，但根的 `>=20` 又和 mobile 的 `>=22.11.0` 打架。
3. `.nvmrc` 写死 `22.22.0` 而不是写一个范围，意味着只要 Node 22 出小版本更新，这个文件就过时——它更像「当前开发者机器上的版本快照」而不是「项目契约」。

### CI 覆盖

| 检查类型 | 是否有 workflow | 覆盖范围 |
|----------|-----------------|----------|
| PR / push 上的 lint | **无** | — |
| PR / push 上的 typecheck | **无** | — |
| PR / push 上的 test | **无** | — |
| PR / push 上的 build | **无** | — |
| Release（tag 触发） | 有（`release.yml`） | 只构建 mobile APK + desktop Win/macOS 安装包；**不跑 lint/test/typecheck** |
| 版本号管理 | `release.yml` 里只对 `@novel-master/mobile` 和 `@novel-master/desktop` 执行 `npm version` | 其他 8 个 package 永远停在 `0.0.0` |

**分裂结果**：CI 在「PR 检查」这个维度上是**零覆盖**。Release workflow 本身也不带任何质量 gate，等于「打包能成功就发版」，lint/test 失败不会阻塞 release。

### 三端工具链对比表（指导文档要求）

| 维度 | core / cli / Node 侧子包 | desktop | mobile | 一致？ |
|------|--------------------------|---------|--------|--------|
| TypeScript | 6.0.3（hoist） | 6.0.3（自带） | **5.8.3** | ❌ |
| tsconfig 基线 | 继承 `tsconfig.base.json` | 继承 base（main + renderer 分裂） | **不继承 base**（@react-native/config + 独立 webview-boot） | ❌ |
| target | ES2022 | ES2022 | RN 默认 / webview ES2018 | ❌ |
| `noUnusedLocals` | true | true | **未设** | ❌ |
| ESLint | 9 flat（复用 base 导出） | 9 flat（**手抄 base 规则**） | **8 legacy**（@react-native） | ❌ |
| 测试运行器 | node:test（tsx） | 自定义 wrapper 包 node:test | jest 29 | ❌ |
| Node engines | ?（依赖根 `>=20`） | ? | `>=22.11.0` | ❌ |
| 构建 | tsc + tsc-alias（仅 core）/ tsc | vite + esbuild + tsc | Metro + 独立 build:webview + tsc --noEmit | —（构建管线差异属 L2） |
| CI 覆盖 | 无 | 无 | 无 | ❌（全部为空） |
| Prettier | 无 | 无 | `2.8.8` + `format:check` | ❌ |

## 发现清单

### S 工程化 CI 完全缺失（PR/push 无任何自动检查）

- 位置：`.github/workflows/`（只有 `release.yml`，触发 `on: push: tags: ["v*"]`）
- 问题：1700+ commit 全程没有任何 PR / push 级别的 lint / typecheck / test / build 自动检查。`release.yml` 只在打 tag 时构建安装包，本身也不跑质量 gate。
- 依据：`.github/workflows/release.yml` 全文确认；`docs/review/guides/lens-L10-build-infra.md` 判定标准「PR/push 上无任何 lint/test/typecheck → 标 S」。
- 建议：补一个 `.github/workflows/ci.yml`，至少在 `on: [push, pull_request]` 上跑 `npm run lint --workspaces --if-present`、`npm run build --workspaces --if-present`、`npm run test --workspaces --if-present`，再加一个 `tsc --noEmit` 的 typecheck job。这一条是其他所有角度（L1/L2/L4/L7/L9）发现的问题无法被自动捕捉的**根因中的根因**。
- 涉及角度：全部（CI 是所有质量门的兜底）

### A TypeScript 主版本在 monorepo 内部分裂为 6.x 和 5.8.x 两套

- 位置：根 `package.json` (`typescript: ^6.0.3`)、`apps/mobile/package.json`、`packages/sksp-android/package.json`、`packages/tdbc-driver-rn/package.json`、`packages/tokenizer-driver-rn/package.json`（均 `^5.8.3`）
- 问题：同一个 monorepo 同时安装两份 TypeScript 二进制（TS 6 和 TS 5）。TS 6 和 TS 5 在装饰器、`const` 类型参数、`using`、模块解析严格度上有行为差异，**core（TS 6）编译通过的类型定义被 mobile（TS 5）引用时可能在 TS 5 下报错**。`apps/desktop` 还和根重复声明 `typescript: ^6.0.3`（虽然 hoist 后是同一份，但声明重复本身是配置噪音）。
- 依据：`grep '"typescript"'` 结果 + 各子包 `package.json` devDep 实读。
- 建议：选定一个主版本统一收敛。如果 mobile/RN 侧暂时不能升 TS 6（@react-native/babel-preset 兼容性），就把 core/cli/desktop 也降回 TS 5.8.x；如果决定全升 TS 6，需要先验证 RN 0.85 + @react-native/typescript-config 在 TS 6 下的兼容性。**不要长期维持 5/6 并存**。
- 涉及角度：L3（包依赖图会看到同样的分裂）、L2（构建产物 target 也受 TS 版本影响）

### A ESLint 9 flat config 与 ESLint 8 legacy 并存，共享规则载体只被一半 workspace 用

- 位置：`eslint.config.base.mjs`（根，flat）、`packages/core/eslint.config.mjs`、`apps/cli/eslint.config.mjs`、`apps/desktop/eslint.config.mjs`（均 flat，ESLint 9）、`apps/mobile/.eslintrc.js`（legacy，ESLint 8.19.0）
- 问题：core/cli 真正复用 `createTsEslintConfig` 导出；desktop 名义对齐但**手抄了一份 `sharedTsRules`**（`eslint.config.mjs` 第 7-11 行），base 改规则 desktop 不会跟；mobile 完全独立走 `@react-native/eslint-config`，规则集和另两套没交集。更糟的是 10 个子包里有 8 个**完全没有 lint 脚本也没有 eslint 配置**，根的 `npm run lint --workspaces --if-present` 对它们是 no-op。
- 依据：5 个 eslint 配置文件实读 + 各 `package.json` 的 `lint` 脚本检查。
- 建议：先统一 ESLint major（要么全 9 flat，要么先把 mobile 也迁到 flat）；把 desktop 手抄的规则改回复用 `createTsEslintConfig`；给 8 个没接入的子包补 lint 脚本。mobile 迁移成本最高（RN 生态对 ESLint 9 的支持还在追赶），可以分阶段。
- 涉及角度：L9（knip 误判和 lint 规则不对称相关）

### A 测试运行器四套并存（node:test / jest / 自定义 wrapper / wdio+mocha）

- 位置：core 等 Node 侧子包用 `tsx --test`；`apps/mobile/jest.config.js` + `package.json` `"test": "jest"`；`apps/desktop/scripts/run-tests.mjs`；`apps/mobile/e2e/wdio.conf.ts`
- 问题：四套运行器并存导致：① knip 无法一致识别测试入口（desktop 74 个 test 文件、mobile 17 个 e2e 文件被 L9 标 unused，根因在此）；② 覆盖率统计无法统一（node:test 走 c8/v8，jest 走 istanbul，wdio 走另算）；③ mobile 的 jest 用 `moduleNameMapper` 把 `@novel-master/core/*` 重定向到 `packages/core/dist/*.js`，强制 mobile 测试前必须 build core，引入了不必要的构建耦合。
- 依据：各 `package.json` test 脚本实读 + `jest.config.js` + `run-tests.mjs` 实读；D0-1 code-map §6 测试覆盖分布印证。
- 建议：短期内至少给 desktop 的 `run-tests.mjs` 在 `package.json` 里加一个标准的 `test` 入口描述（或导出文件列表供 knip 消费），让 L9 的 knip 误判能消解。中长期方向是 mobile 单测能否从 jest 迁到 node:test（取决于 RN 生态），或者至少让 jest 配置不再依赖 core 的 dist 产物（改用 ts-jest 或源码映射）。
- 涉及角度：L7（测试内容）、L9（knip 误判根因）

### A Node engines 声明互相矛盾，最低支持版本没有单一事实源

- 位置：根 `package.json` (`engines.node: ">=20"`)、`apps/mobile/package.json` (`">=22.11.0"`)、`.nvmrc` (`22.22.0`)、`.github/workflows/release.yml` (`node-version: "22"`)
- 问题：四处声明四个意思——根说 20+，mobile 说 22.11.0+，`.nvmrc` 写死 22.22.0，CI 跑 22。core/cli/desktop 和全部 10 个子包不声明 engines，完全把契约甩给根的 `>=20`。**没有人验证过 core/cli/desktop 在 Node 20 下能不能跑**（比如有没有用到 Node 22 才有的 `node:sqlite`、`--watch-paths` 等）。
- 依据：4 处 engines 声明实读；`grep '"engines"'` 确认只有根 + mobile 声明。
- 建议：先确定项目到底支持哪个 Node 最低版本（推荐 `>=22.11.0`，因为 mobile 已经强制了这个下限，再低就分裂）。然后把根 engines、`.nvmrc`（改成 `lts/jod` 或写范围）、CI node-version 全部对齐到同一个数。给每个 workspace package 补 engines 或在根统一声明。
- 涉及角度：L6 跨平台（Node 版本差异会引发 native module 兼容问题）

### B tsconfig 基线在 mobile 整条线完全脱离 base 约束

- 位置：`apps/mobile/tsconfig.json`（extends `@react-native/typescript-config`）、`apps/mobile/tsconfig.webview-boot.json`（不继承任何）、`apps/mobile/e2e/tsconfig.json`（不继承任何）、`apps/mobile/src/web/tsconfig.json`（extends webview-boot）
- 问题：base 里设的 `noUnusedLocals: true` / `noUnusedParameters: true` / `target: ES2022` 全部没传到 mobile 侧。结果是：① core 写 unused 变量会被 TS 拦，mobile 不会——规则不对称；② target 在仓库里出现三档（ES2022 / RN 默认 / ES2018），同一份代码在不同 tsconfig 下编译产物不一致；③ webview-boot 和 e2e 连 `extends` 都没有，等于完全独立的 tsconfig，没有任何基线约束。
- 依据：4 个 mobile 侧 tsconfig 实读；对照 `tsconfig.base.json`。
- 建议：mobile 主 tsconfig 因为 RN 生态约束不能直接换 extends，但可以在 `compilerOptions` 里**显式补齐** `noUnusedLocals` / `noUnusedParameters` / `target` 对齐 base。webview-boot 和 e2e 至少应该 `extends` 一个最小基线（哪怕不复用 base，也要有一个 mobile 内部的 local base）。
- 涉及角度：L9（规则不对称导致死代码判定标准不一）

### B Prettier 只在 mobile 接入，其余 12 个 workspace 完全没有格式化基建

- 位置：`apps/mobile/package.json`（`prettier: 2.8.8` + `format:check` 脚本）；根 `package.json` 有 `format:check` 聚合脚本但 `--workspaces --if-present`，实际只有 mobile 响应
- 问题：core/cli/desktop 和 9 个子包没有任何 prettier 配置或格式化脚本。仓库里的代码风格一致性纯靠人。
- 依据：`grep '"prettier"'` + 各 `package.json` 脚本检查。
- 建议：在根加一个 `prettier` + `.prettierrc`，配一个根级 `format:check` 直接扫全仓（而不是走 workspace if-present）。mobile 的 prettier 2.8.8 太老（当前主流 3.x），统一升级时一并迁。
- 涉及角度：无（纯工程化）

### C @typescript-eslint peerDep 与 TS 6 的版本地雷

- 位置：`node_modules/.pnpm/@typescript-eslint+eslint-plugin@8.61.1/.../package.json` 的 `peerDependencies.typescript: ">=4.8.4 <6.1.0"`
- 问题：当前 TS 6.0.3 刚好落在区间内（`<6.1.0`），但只要 TypeScript 发了 6.1.0 并且有人把 `^6.0.3` 升上去，就会 peerDep 冲突。这是一个延迟引爆的版本地雷，本身不是当前 bug，但值得登记。
- 依据：pnpm lockfile 里 `@typescript-eslint/eslint-plugin@8.61.1` 的 peerDep 声明。
- 建议：关注 typescript-eslint 9.x（已支持 TS 6.1+）的发布节奏，到时候一起升。
- 涉及角度：L3（依赖图）

### C Release workflow 不给其他 8 个 package bump 版本

- 位置：`.github/workflows/release.yml`（只对 `@novel-master/mobile` 和 `@novel-master/desktop` 执行 `npm version`）
- 问题：core/cli 和全部 10 个 packages 永远停在 `0.0.0`。release.yml 里 build 了 core/cloud-sync-driver-s3/tdbc-driver-better-sqlite3/sksp-windows/sksp-mac/tokenizer-driver-node，但它们的版本号始终是 0.0.0。如果哪天要把这些包单独发出去（哪怕内部消费），版本号缺失会很麻烦。
- 依据：release.yml 第 87、187、258 行 `npm version --workspace=...` 只针对 mobile/desktop。
- 建议：发版流程统一所有 workspace 的版本号（monorepo 统一版本策略），或者明确这些包就是不发版、文档里说清楚。
- 涉及角度：L11（文档承诺）

## 覆盖声明

查了：根 `package.json`、`.nvmrc`、`.github/workflows/release.yml`、`eslint.config.base.mjs`、`tsconfig.base.json`、`tsconfig.json`（根）；3 个 app（cli/desktop/mobile）+ 10 个 workspace package 的 `package.json`；core/cli/desktop/mobile 四端的全部 `tsconfig*.json`（共 9 份）；5 个 ESLint 配置（core/cli/desktop 的 flat + mobile 的 legacy + 根 base）；mobile 的 `jest.config.js` 和 desktop 的 `scripts/run-tests.mjs`；以及 3 个代表性子包（cloud-sync-driver-s3 / sksp-android / tdbc-driver-rn）的 tsconfig 抽样。

没查：① 各子包 `test/` 目录里的实际测试文件用什么断言风格（那是 L7 的活）；② pnpm lockfile 里实际锁定的 TS / ESLint 具体小版本（只确认了 major 走向，精细版本对齐留待 fix-spec）；③ native 模块（better-sqlite3 / sharp / dpapi）在不同 Node 版本下的 prebuilt binary 可用性矩阵（这是 L6 跨平台的关注点）；④ `package-lock.json` 和 `pnpm-lock.yaml` 共存的问题——这个仓库同时有两份 lockfile，但本次没深入判定哪个是真源（属于 L3 包依赖图）。

## 待交叉的线索

1. **和 L2 的接边**：L2 报告已经详述了 core build 的 `--force` 禁用增量和 mobile `preandroid/preios/prestart` 的重复全量构建。本报告不重复，但**版本分裂会让「统一 build 命令」这件事更难**——如果将来要把 core 的 build 改成 project references 模式，mobile 的 TS 5.8.3 和 core 的 TS 6.0.3 在 `tsc --build` 跨版本引用时会有兼容问题（TS 的 project references 要求引用方和被引用方 TS 版本接近）。这条要丢给 Phase 3 让 L2 和 L10 一起辩。

2. **和 L3 的潜在重叠**：L3 看包依赖图也会发现 TS 版本分裂（因为它读 devDep）。本报告看的是「工具链行为后果」（双重安装、规则不对称、peerDep 地雷），L3 看的是「依赖图结构」（哪个包声明了什么）。Phase 3 时如果两边都列了同一条，**严重度按 L10 的 A 算**（工具链视角更靠近用户体验），L3 那边标成同一条的引用即可，不重复登记。

3. **和 L9 的因果链**：L9 处理 knip 误判的症状（逐条核实），本报告给出的是根因（运行器分裂 + lint 规则不对称）。Phase 3 整合时，L9 的 desktop 74 test / mobile 17 e2e 误判条目应该**合并到本报告的「测试运行器四套并存」这条 A 级发现下**作为症状证据，而不是各标各的。

4. **和 L6 的接边**：Node engines 矛盾这条，L6 跨平台会从「native module 在不同 Node 版本下的 prebuilt 可用性」角度再看一遍。两边结论应该互补——本报告说「契约层面不一致」，L6 说「运行时层面会不会炸」。

5. **和 L7 的因果链**：L7 测试覆盖盲区里 sksp-android / tokenizer-driver-rn 没有测试，本报告补充了**结构性原因**——这两个包连 `test` 脚本都没有，不是「测试少」而是「测试基建根本没接」。Phase 3 合并时这条归 L10 还是 L7 可以辩，但根因登记在本报告更合适。
