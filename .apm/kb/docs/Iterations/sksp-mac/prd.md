# SKSP macOS 驱动 PRD

## 背景

Novel Master 的 SKSP 协议已在 `@novel-master/core/sksp` 落地，v1 交付了 Windows（`sksp-windows` / DPAPI）与 Android（`sksp-android` / Keystore）两套平台驱动。密文统一存入 `novel.db` 的 `sksp_secrets` 表，业务层仅通过 `secretRef` 访问密钥。

原 [SKSP PRD](../sksp/prd.md) 将 **macOS Keychain 驱动** 列为后续迭代。随着 Electron desktop 与 macOS CLI 使用场景明确，需要补齐第三套 Node 侧平台驱动，使同一套 SKSP 协议可在 macOS 上完成 `set` / `get` 闭环。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 交付 macOS SKSP 驱动包 | 新增 `@novel-master/sksp-mac`，实现 `SecretStore` 端口 |
| 统一持久化 | 密文写入 `sksp_secrets`，`algo` 区分平台；**无明文**落库 |
| 平台密钥保护 | 加解密依赖 macOS Keychain，非应用内硬编码密钥 |
| 可测试 | CI 可在非 macOS 环境跑通单测（test passthrough）；macOS 实机可验收 round-trip |
| **成功指标** | 包可 build + test 通过；macOS 上 `set → get` 闭环；表中 `algo` 为约定值 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 未来 Desktop（Electron）开发者 | 在 macOS 上注册 `sksp-mac` 驱动后，provider apiKey 可安全落库（**本期不接线**） |
| 未来 macOS CLI 用户 | 在 macOS 上运行 `nm provider edit --apiKey` 时可选用 macOS 驱动（**本期不接线**） |
| 库维护者 | 按与 `sksp-windows` 相同模式新增/维护平台驱动，无需改 core 协议 |

## 范围

### 包含范围

- 新包 `packages/sksp-mac`：`registerSkspMacDriver()`、SQLite `sksp_secrets` CRUD、macOS Keychain 加解密
- 单测：round-trip、`algo` 校验、非 macOS CI passthrough、错误码语义
- 包级 `package.json` / `tsconfig` / `README`（简要使用说明）
- monorepo workspace 注册（根 `package-lock` 随 `npm install` 更新）

### 不包含范围

- **CLI / Desktop / Mobile 运行时接入**（`apps/cli`、`apps/desktop` 平台自动选择 — 后续迭代）
- Linux SKSP 驱动
- 用户主密码、整库 SQLCipher、密钥轮换 UI
- 跨平台拷库后密钥可解密（与 Windows DPAPI 一致，**预期不可解密**）
- provider-model UI 或 HTTP 联调验收

## 核心需求

1. **驱动注册**：`registerSkspMacDriver()` 向 core registry 注册名称为 `macos` 的驱动；`createMacSecretStore(conn)` 返回 `SecretStore`。
2. **统一表结构**：复用 core 已有 `sksp_secrets` DDL；驱动不负责建表。
3. **算法标识**：`algo = macos-keychain-aes-gcm-v1`；`iv` 列必填（AES-GCM）。
4. **Keychain 保护**：应用主密钥存 macOS Login Keychain；明文仅内存中出现，密文 + iv 写入 SQLite。
5. **错误语义**：加密/解密/Keychain 失败抛 `SkspError`（`ENCRYPT_FAILED` / `DECRYPT_FAILED`），文案提示重新配置 apiKey。
6. **可测试性**：提供 test passthrough 钩子，使 Linux/Windows CI 可跑 store 单测而不访问 Keychain。
7. **零 core 协议变更**：不修改 `SecretStore` 接口、registry 语义、`sksp_secrets` schema。

## 验收标准

### 包构建与注册

- [ ] **Given** monorepo 根目录执行 `npm install`，**When** `npm run build -w @novel-master/sksp-mac`，**Then** 编译成功且无类型错误。
- [ ] **Given** 测试进程调用 `registerSkspMacDriver()`，**When** `resolveSkspDriver("macos")`，**Then** 返回已注册驱动且 `createStore` 可构造 `SecretStore`。

### 功能（CI / passthrough）

- [ ] **Given** test passthrough 已启用、内存 SQLite 已 bootstrap，**When** `set(ref, "secret")` 后 `get(ref)`，**Then** 返回 `"secret"` 且 `has(ref)` 为 true。
- [ ] **Given** 同上，`set` 之后，**When** 查询 `sksp_secrets`，**Then** 存在对应行、`algo = macos-keychain-aes-gcm-v1`、`iv` 非空、无明文 secret。
- [ ] **Given** 已 `set` 的 ref，**When** `delete(ref)`，**Then** 返回 true 且 `get(ref)` 为 null。

### 功能（macOS 实机，手工或 macOS runner）

- [ ] **Given** macOS 上 passthrough 关闭、真实 Keychain 可用，**When** `set` → `get` round-trip，**Then** 成功且密文与 Windows `dpapi-v1` 行不兼容（`algo` 不同）。
- [ ] **Given** macOS 上已存密文，**When** 模拟 Keychain 条目不可用后 `get(ref)`，**Then** 抛 `SkspError` 且 `code = DECRYPT_FAILED`（非未处理异常）。

### 边界

- [ ] **Given** 表中 `algo` 为 `dpapi-v1` 的行，**When** macOS store `get(ref)`，**Then** 抛 `DECRYPT_FAILED` 并提示重新配置。
- [ ] **Given** 本期范围，**When** 检查 `apps/cli` 与 `apps/desktop`，**Then** **无** 新增对 `@novel-master/sksp-mac` 的依赖或注册代码。
