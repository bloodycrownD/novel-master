# 发版策略

> 对应条目：A-18。原则声明见 [`packages/core/ARCHITECTURE.md`](../packages/core/ARCHITECTURE.md) 的「发版策略」一节。

本仓库是 monorepo，内部包和端产品承担的角色不一样，所以发版义务要分开看——内部包不承担 semver 义务，只有端产品才发版。

## 内部包：锁 0.0.0，不发版

`packages/*` 下的所有包，以及 `apps/cli`，都属于内部包。它们的 `version` 字段统一锁在 `0.0.0`，private，不会单独发布到任何 registry。

之所以能这么做，是因为内部包之间的引用靠 npm workspaces 解析。依赖声明里直接写包名（例如 `"@novel-master/core": "*"`），npm 在 install 时会把它指向 workspace 里的本地源码，版本号根本不参与解析。既然版本号没有实际作用，统一锁 `0.0.0` 反而最干净——既明确表达「这一层不发版」，又避免内部包之间因为版本号不同步产生噪音。

## 端产品：走 semver

真正承担发版义务的是端产品：

- `apps/desktop` —— Electron 桌面应用，通过 electron-builder 打包分发，保留独立 semver（见各自 `package.json` 的 `version`）。
- `apps/mobile` —— React Native 安卓应用，保留独立 semver。
- `apps/cli` —— 当 CLI 作为对外分发的可执行产物时，按需打 tag 发版；作为内部 workspace 成员时，它和其他内部包一样锁 `0.0.0`。

端产品的版本号各自维护，按各自的产品节奏迭代。版本语义只在外部可见的产物上才有意义。

## Release 流程要点

发版动作只发生在端产品这一层，流程大致是这样的。

先确认 main 分支干净、CI 全绿。然后针对要发版的端产品，按它的语义化版本规则 bump `version` 字段（patch / minor / major 视变更内容而定），同时更新各自的变更日志。bump 完打 git tag（tag 命名建议带产品前缀，例如 `desktop-v1.4.18`，避免不同端产品的版本号撞车），再走各自的构建脚本产出安装包或可执行文件。

整个过程中，内部包的 `0.0.0` 不需要动，也不应该动——它们没有独立的发版时刻，永远跟着 main 走。如果某个内部包做了破坏性改动，影响的是依赖它的端产品，那么这个影响应该在端产品的版本号 bump 里体现（比如 desktop 因为 core 改动而升 minor），而不是在内部包自己身上记版本。

## 为什么不用 `workspace:*` 协议

当前内部包之间的依赖声明写的是裸包名加 `"*"`，而不是 pnpm/yarn 风格的 `workspace:*`。这是有意为之——本项目用 npm workspaces，npm 原生不识别 `workspace:` 协议前缀，裸 `"*"` 已经能让 workspace 正确解析到本地源码。换协议反而会引入额外的工具链依赖，得不偿失。日常只要保证内部包的依赖写的是包名、版本号锁 `0.0.0`，workspace 解析就是可靠的。
