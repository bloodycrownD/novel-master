---
date: 2026-06-21
dependency: Iterations/cross-device-cloud-sync/prd.md
---

# Mobile 云同步 RN 兼容修复 PRD

## 背景

`cross-device-cloud-sync` 迭代已在 **main** 交付 Desktop / Mobile 双端云同步能力：用户自备 **S3 兼容** 对象存储，通过手动 **Pull / Push** 与租约锁实现跨端数据互通。Mobile 侧入口为「我的 → 数据管理 → 云存储配置」（`CloudSyncConfigScreen`）与 Pull/Push 操作区（`StorageConfigScreen`）。

### 已确认问题（Android 真机 + 阿里云 OSS）

用户在「云存储配置」点击「**测试连接**」时，Toast 展示类似：

> 连接失败：Property 'DOMParser' doesn't exist  
> Deserialization error: to see the raw response, inspect the hidden field {error}.$response on this object.

**根因已明确**，属于 **Mobile 运行时兼容缺陷**，而非用户 OSS 配置错误：

| 现象 | 含义 |
|------|------|
| `DOMParser doesn't exist` | React Native / Hermes **不提供**浏览器级 `DOMParser` API |
| `Deserialization error` | S3 请求**往往已发出并收到 XML 响应**，但 AWS SDK v3 **反序列化失败** |

调用链：`testCloudSyncConnection` → `@aws-sdk/client-s3`（HeadBucket / ListObjectsV2）→ S3/OSS 返回 **XML** → `@aws-sdk/xml-builder` 在 RN 下走 **browser 版 XML 解析器**（依赖 `DOMParser`）→ 在 Hermes 上抛出 ReferenceError。

**影响范围**：凡经 AWS SDK 解析 S3 XML 响应的路径均受影响，包括 **测试连接、读取远程 rev、Pull、Push**；不仅限于「测试连接」按钮。

**易误判项（本期非根因）**：Region 留空、路径前缀格式、Path style 开关等配置问题，正常应表现为鉴权失败、桶不存在、403 等业务错误；**不应**出现 `DOMParser` 字样。出现该关键字即可判定为运行时兼容问题，修复前**无法**据此评估 OSS 配置是否正确。

### 现状缺口

- 项目已为 Mobile 配置部分 Hermes polyfill（随机数、URL、Buffer、ReadableStream）及 Metro 对 AWS SDK `runtimeConfig.native` 的解析，但 **未覆盖 DOM / XML 解析**。
- `mapSdkError` 仅映射少数鉴权类错误，其余 SDK 异常（含反序列化失败）会 **原样进入 Toast**，用户看到开发者向文案。
- 现有 Jest 用例 **mock** 了 `@aws-sdk/client-s3`，**未覆盖真机 SDK + XML 解析路径**。

用户期望与 **Desktop 共用同一阿里云 OSS 桶** 完成双端互通；Desktop 端云同步已可用，缺口集中在 **Mobile Android 运行时兼容与错误展示**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 修复 RN XML 解析兼容 | Android 真机上 S3 API 响应可正常反序列化；**0 次**因 `DOMParser` 缺失导致的 ReferenceError / `Deserialization error` 阻断 |
| Android 云同步全链路可用 | 在阿里云 OSS 上，**测试连接、读取远程 rev、Pull、Push** 均可完成或返回**明确业务错误**（凭据无效、桶不存在、需先拉取等） |
| 与 Desktop 双端互通 | Desktop 与 Android Mobile 配置**同一 OSS 桶**后：一端 Push 成功、另一端 Pull 可恢复项目/会话等核心数据，**1 轮**端到端用例通过 |
| 错误提示可理解 | 连接/同步失败时，Toast 为**中文业务语义**；**不得**向用户展示 `DOMParser`、`Deserialization error`、`@aws-sdk`、`ReferenceError` 等开发者向关键字 |
| 不破坏既有能力 | Desktop 云同步、Mobile 本地导入导出、现有 `CloudSyncError` 错误码语义**保持不变** |
| 回归可测 | CI（`npm run test:fast` 或 Mobile jest）覆盖 polyfill / 错误映射等关键逻辑；真机 OSS 用例作为补充验收 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 双端创作者（Android + Desktop） | Desktop 在家写作并已 Push 到阿里云 OSS；外出用手机 **测试连接** 通过后 **Pull**，继续同一项目创作 |
| 首次配置 Mobile 的用户 | 按 Desktop 相同 Endpoint / Bucket / AK/SK 填写 OSS 配置；修复前即使配置正确也会报 `DOMParser`；修复后 **测试连接** 可真实反映连通性 |
| 谨慎型用户 | 测试连接仅校验桶权限（与现有文案一致）；失败时看到「凭据无效」「无法访问桶」等可读原因，而非 SDK 内部异常 |

## 范围

### 包含范围

1. **Android Mobile：AWS SDK S3 XML 解析运行时兼容**  
   使 Hermes 环境下 `@aws-sdk/client-s3` 能正常解析 S3/OSS 返回的 XML 响应，`testCloudSyncConnection`、`readRemoteRev`、`pullCloudSync`、`pushCloudSync` 均可执行。

2. **全链路操作**  
   - 云存储配置页「**测试连接**」  
   - 数据管理页 **Pull / Push** 及云端版本 / 建议先拉取状态展示  

3. **错误体验**  
   - 消除 `DOMParser` / `Deserialization error` 对用户的暴露（通过运行时修复 + 错误映射兜底）。  
   - 将常见 SDK 失败（鉴权、网络、桶不可达等）映射为中文业务提示；保留既有 `CloudSyncError` 语义（`AUTH`、`NOT_CONFIGURED`、`NEED_PULL_FIRST` 等）。

4. **验收环境**  
   - 平台：**Android**  
   - 对象存储：**阿里云 OSS**（S3 兼容 API，Path style 等沿用现有配置项）  
   - 双端：**与 Desktop 共用同一桶** 的 Push → Pull 互通  

5. **测试**  
   补充 Jest / 快速测试套件回归（polyfill 生效、错误格式化）；真机 OSS 手工用例记入验收清单。

### 不包含范围

1. **iOS**（本期不验收；修复若天然惠及 iOS 可不阻塞合并）  
2. **新云同步业务能力**（自动后台同步、WebDAV、实体 merge 等）  
3. **Desktop 端功能变更**（除非 `cloud-sync-driver-s3` / core 共有缺陷且为 Mobile 修复所必需）  
4. **CLI 云同步子命令**  
5. **弃用 AWS SDK 或重做存储驱动**（本期在现有架构下补齐 RN 兼容）  
6. **替用户纠正 OSS 配置**（Region、Endpoint 等仍由用户按厂商文档填写；本期只保证配置正确时能连上、配置错误时给出业务向提示）

## 核心需求

1. **消除 DOMParser 阻断**  
   Android 真机上任何云同步 S3 调用不得因 `DOMParser` 缺失而失败；用户不应再看到该关键字。

2. **测试连接真实可用**  
   `CloudSyncConfigScreen` 点击「测试连接」后，成功提示「连接成功」；失败时根据实际原因（凭据、桶权限、网络等）给出可读中文，**而非** SDK 反序列化异常原文。

3. **Pull / Push 与状态读取可用**  
   `StorageConfigScreen` 上 Pull、Push 及远程 rev 展示在 Android 真机可正常执行（含 Agent 空闲守卫、先拉后推、锁冲突等既有规则）。

4. **Desktop ↔ Android 互通**  
   同一 OSS 桶与路径前缀下，Desktop Push → Android Pull、Android Push → Desktop Pull 均可恢复核心创作数据；导入后本机服务商 / API Key 仍按既有规则保留。

5. **错误映射兜底**  
   未识别的 SDK / 网络异常不得原样展示技术栈信息；至少归类为「连接失败，请检查网络与配置」类用户向文案。

6. **回归**  
   自动化测试覆盖兼容层与错误映射；验收清单含阿里云 OSS + Android 真机 + Desktop 同桶互通。

## 验收标准

### 根因修复（DOMParser / 反序列化）

- **Given** Android 真机、已修复构建，**When** 在「云存储配置」填入**与 Desktop 相同且已验证有效**的阿里云 OSS 参数并点击「测试连接」，**Then** 显示「连接成功」，**且** Toast / 日志中**不出现** `DOMParser`、`Deserialization error`、`ReferenceError`。
- **Given** 修复前复现用例（同桶、同 AK、Path style 开启），**When** 再次测试连接，**Then** 行为由「必现 DOMParser 失败」变为「成功或业务向失败」，证明问题为运行时兼容而非 OSS 本身不可用。

### 业务错误可区分

- **Given** 故意填写错误 Secret Key，**When** 测试连接，**Then** 提示凭据或访问失败类中文信息（如「云存储凭据无效」），**而非** SDK 内部异常。
- **Given** 故意填写错误 Bucket 名，**When** 测试连接，**Then** 提示桶不存在或无法访问类中文信息，**而非** `Deserialization error`。

### 全链路与双端互通

- **Given** 已保存有效 OSS 配置且云端有快照，**When** 数据管理页 Pull，**Then** 导入完成或按既有规则提示，**不因** XML 解析失败中断。
- **Given** 本机已与云端 rev 对齐且 Agent 空闲，**When** Push，**Then** 上传成功并更新同步状态。
- **Given** Desktop 与 Android 配置同一 Endpoint、Bucket、路径前缀与凭据，**When** Desktop Push 后 Android Pull，**Then** Android 可见 Desktop 侧项目/会话数据。
- **Given** Android 本地有变更且满足 Push 条件，**When** Android Push 后 Desktop Pull，**Then** Desktop 可恢复 Android 侧数据。

### 错误体验

- **Given** 任意云同步失败路径，**When** 错误展示给用户，**Then** 文案为中文业务描述，**不包含** `DOMParser`、`Deserialization`、`@aws-sdk`、`ReferenceError` 等开发者向关键字。

### 回归

- **Given** 本次变更合入，**When** 运行 `npm run test:fast` 与 `npm test -w @novel-master/mobile`（含 cloud-sync 相关用例），**Then** 全部通过。
