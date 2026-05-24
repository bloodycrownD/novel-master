# SKSP（Secret Key Storage Protocol）PRD

## 背景

Novel Master 的 **provider-model** 等能力需要在本地保存 API Key 等敏感信息。不同运行时（Windows CLI、Android RN）的**系统级密钥保护**能力不同，但业务层应使用统一引用（`secretRef`），且**持久化形态一致**，避免「Android 密文在 SQLite、Windows 在 Credential Manager」导致协议与验收分裂。

SKSP 定位为类似 **TDBC** 的**纯协议 + 可插拔驱动**：定义 `get` / `set` / `delete` / `has` 与统一密文表契约；由 `sksp-windows`、`sksp-android` 等驱动对接平台加解密。本期与 **provider-model** 一起验收凭据读写，但不把 HTTP、provider 配置规则写入本 PRD。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 统一语义 | 业务仅通过 `secretRef` 访问秘密；provider 等表**无明文** API Key |
| 统一持久化 | 秘密**密文**存入与业务相同的 `novel.db` 内 **`sksp_secrets` 表**（算法与列由 SPEC 定） |
| 平台保护密钥 | 加解密依赖平台能力（Android Keystore、Windows DPAPI），**非**应用内硬编码密钥、**非**用户主密码（本期） |
| 双驱动 v1（均必交付） | **sksp-windows**（CLI）、**sksp-android**（RN）；可选 **sksp-env** 供 CI |
| **成功指标** | 下文验收标准可判定；Windows CLI 与 Android 各至少一条 set → get 闭环 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| CLI 用户 | `nm provider edit --apiKey …` 写入后，`nm model request` 能鉴权成功 |
| RN / Android | 同库、同 `secretRef` 规则；App 内配置 provider 后调用 LLM（与 provider-model 集成为后续，本期验收 SKSP 能力本身） |
| CI / 脚本 | `sksp-env`：环境变量提供密钥，可不写入 `sksp_secrets` |

## 范围

### 包含范围

**存储模型（方案 B，本期锁定）**

```text
明文（仅内存）→ 平台驱动 encrypt → ciphertext 写入 sksp_secrets
读取：sksp_secrets → 平台驱动 decrypt → 明文（仅内存）
Provider 行：仅 secretRef（如 provider/<providerId>/apiKey），无 apiKey 明文列
```

| 平台 | 平台层（驱动内） | SQLite |
|------|------------------|--------|
| **Android** | Android Keystore 持有/使用 **AES** 密钥（如 AES-GCM） | `ref`、`ciphertext`、`iv`、`algo`、`version` 等 |
| **Windows** | **DPAPI**（`CryptProtectData` 或等价）加密后存库 | **同表结构**；`algo` 区分平台（如 `dpapi-v1` vs `android-keystore-aes-gcm-v1`） |
| **CI（可选）** | 环境变量映射到 `secretRef` | 可不落库；优先级在 SPEC 锁定 |

- **算法**：跨平台统一**概念**为「密文 + 元数据进 SQLite」；具体 primitive 由驱动实现，PRD **不**要求 Windows 与 Android 使用同一 cipher 实现，但 **表结构与 SKSP 接口一致**。
- **禁止**：API Key 明文写入 `config.json`、Git、provider 表；禁止全应用共享硬编码 `APP_SECRET` 加密。

**SKSP 协议（PRD 层）**

- `SecretStore`：`get(ref)`、`set(ref, plain)`、`delete(ref)`、`has(ref)`（异步，与 TDBC 一致）。
- `ref`：稳定字符串，建议 `provider/<providerId>/apiKey`；由 provider-model 生成规则，SKSP 不解析业务含义。
- 注册/选择驱动：运行时按平台加载（类比 TDBC registry）；默认驱动不可用时 **失败**，不回退明文落盘。

**包结构（意向，SPEC 定名）**

- `@novel-master/core` 或 `packages/sksp`：协议接口、错误类型、registry（无原生依赖）。
- `@novel-master/sksp-windows`：Node CLI / Windows。
- `@novel-master/sksp-android`：RN 原生模块 + JS 桥。
- `@novel-master/sksp-env`（可选）：环境变量后端。

**与 provider-model**

- `nm provider edit --providerId … --apiKey <值>` → `SecretStore.set(secretRef, …)`。
- `nm provider list` / `edit` 展示：**不**输出完整 key（`set` / `not set` / `****`）。
- `nm model request` → `SecretStore.get(secretRef)` 后发起 HTTP。

### 不包含范围

- **用户主密码**（PBKDF2 派生密钥、可携库跨机解密）— 后续迭代可选
- **macOS / iOS Keychain 独立驱动**（本期不做；架构预留）
- **Credential Manager 作为主存储**（不把整条 key 仅存系统保险箱而 SQLite 无行）
- **密钥轮换 UI、多 Key、HSM**
- **加密整个 novel.db**（SQLCipher 整库）— 本期仅 `sksp_secrets` 表
- **云同步、多设备合并密钥**

## 核心需求

1. **统一表**：`sksp_secrets` 位于 `novel.db`（与 TDBC 同库）；`ref` 主键或唯一索引。
2. **无明文落库**：`set` 后表中无明文；`list` 类操作不可泄露完整 secret。
3. **Android 驱动**：Keystore + 密文进 SQLite；重装/清数据后旧密文不可解密时须**可读错误**（提示重新配置 apiKey）。
4. **Windows 驱动**：DPAPI + 密文进 SQLite；拷库至其他用户/机器不可解密（符合预期）。
5. **sksp-env（可选）**：支持 `NOVEL_MASTER_PROVIDER_<ID>_API_KEY` 或 SPEC 约定命名；CI 可无 DPAPI。
6. **删除与 provider 生命周期**：`nm provider delete` 或清除 apiKey 时 `delete(ref)`；SPEC 锁定孤儿行策略。
7. **可测试性**：Windows 单测/CLI 用例可验；Android 手工或仪器测试一条（PRD 要求能力存在）。

## 验收标准

### 统一持久化

- [ ] **Given** 已通过 SKSP `set(ref, value)`，**When** 直接查询 `sksp_secrets` 表，**Then** 无 `value` 明文列或等价泄露。
- [ ] **Given** 同上，**When** `get(ref)`，**Then** 返回与 `value` 一致。

### Windows（CLI）

- [ ] **Given** Windows 上 `nm provider edit --apiKey …`，**When** `nm model request`（有效 endpoint），**Then** 鉴权成功或网络可达（非「密钥未配置」）。
- [ ] **Given** 仅拷贝 `novel.db` 到另一 Windows 用户配置文件，**When** `get(ref)`，**Then** 失败或不可用（DPAPI 绑定，SPEC 锁定具体错误文案）。

### Android

- [ ] **Given** App 内 SKSP `set` 后 `get`，**When** 同设备同应用，**Then**  round-trip 成功。
- [ ] **Given** 已存密文，**When** 清应用数据或重装后 `get`（Keystore 已清空），**Then** 失败且提示需重新配置密钥（非崩溃）。

### sksp-env（若实现）

- [ ] **Given** 环境变量已设且未 `set` 落库，**When** `get(ref)`，**Then** 返回环境变量值（优先级 SPEC 锁定）。
- [ ] **Given** 无 env 且无 DB 行，**When** `get(ref)`，**Then** `null` 或明确错误，供 `nm model request` 报「未配置 apiKey」。

### 安全红线

- [ ] **When** 检查仓库与 `config.json` 样例，**Then** 无真实 API Key 提交。
- [ ] **When** `nm provider list`，**Then** 不打印完整 apiKey。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 备份说明 | 用户备份 `novel.db` 不能单独恢复密钥（Android/Windows 平台绑定）；须在文档说明 |
| `algo` 升级 | 未来换算法需迁移或版本字段；v1 仅一种 per 平台 |
| 排期 | SKSP 与 provider-model 可并行；**windows 与 android 驱动均为本期必交付**（允许分 PR，验收前须齐） |
| RN 桥接 | Android 模块与 `react-native-quick-sqlite` 同 App 生命周期；SPEC 定初始化顺序 |

## 里程碑（可选）

1. 协议 + `sksp_secrets` DDL + registry  
2. sksp-windows + CLI 集成  
3. sksp-android + 手工验收  
4. sksp-env（CI）

## 关联文档

- [provider-model/prd.md](../provider-model/prd.md) — 使用 SKSP 的业务迭代
- [spec.md](./spec.md) — 技术规格（实现）
- [TDBC/prd.md](../TDBC/prd.md) — 同类「协议 + 驱动」模式
