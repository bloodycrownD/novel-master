# 关于页与版本更新检查 PRD

> **边界**：本文件为产品需求（PRD），不含接口设计、模块拆分、依赖版本等技术 SPEC。  
> **关联**：[release.yml](../../../../.github/workflows/release.yml)（`v*` tag 全量 Release，本迭代 **不修改** workflow）；[storage-schema-alignment](../storage-schema-alignment/prd.md)（Client UI 偏好与 `nm-preferences` 分层）。

## 背景

Novel Master 已在 GitHub 通过 `v*` tag 发布 Android APK 与 Desktop 安装包（[apps/mobile/README.md](../../../../apps/mobile/README.md)、[apps/desktop/README.md](../../../../apps/desktop/README.md)），但 **Mobile / Desktop 均无「关于」入口与更新检查能力**。用户无法在应用内确认当前版本、访问项目主页或获知是否有新版本可下载。

产品讨论结论：

- **暂不改动** GitHub Release workflow（继续全量打 tag 发版）。
- **不做应用内自动下载/安装**（Desktop 安装包未签名；Android 侧装涉及未知来源等体验问题）。
- 更新检查以 **GitHub Releases API** 为来源，发现新版本后 **引导用户打开 Release 页自行下载**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 统一「关于」入口 | Mobile「我的」、Desktop 设置侧栏均可进入 **关于 Novel Master** 页 |
| 版本信息可见 | 关于页展示 **当前应用版本**（与 Release tag 口径一致） |
| 手动检查更新 | 用户点击「检查更新」后 **10s 内** 得到明确结果（已最新 / 有新版本 / 网络失败） |
| 可选自动检查 | 默认开启；启动后后台检查，**24h 内不重复请求**；同一新版本用户点「稍后」后 **不再自动弹窗** |
| 项目链接可达 | 关于页可外链打开 GitHub 仓库、Releases、许可证说明 |
| 零行为回归 | 现有聊天、VFS、设置、备份等核心流程 **无感知变更** |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile 用户 | 在「我的 → 关于」查看版本；偶尔检查是否有新 APK；自动检查在后台提示，不打断写作 |
| Desktop 用户 | 在「设置 → 关于」查看版本；检查 Win/macOS 安装包更新；点击链接跳转浏览器下载 |
| 维护者 | 继续 `git tag vX.Y.Z && git push` 发版，无需为更新检查单独配置 |

## 范围

### 包含范围

1. **关于 Novel Master 页面（Mobile + Desktop）**
   - 应用名称、图标（可用现有 `icon.webp` 或品牌资源）。
   - **当前版本**只读展示。
   - **外链**：GitHub 仓库、`Releases` 下载页、许可证（PolyForm Noncommercial）说明页或仓库 LICENSE 链接。

2. **手动检查更新**
   - 关于页内独立可点击项「检查更新」。
   - 检查中显示 loading 状态。
   - 结果反馈：
     - 已是最新：轻提示（Toast / 行内文案）。
     - 有新版本：对话框展示远程版本号 + Release 摘要前几行 +「前往下载」「稍后」。
     - 失败：可读错误提示（网络不可用、API 异常等）。
   - 手动检查 **不受** 自动检查开关与 24h 节流限制。

3. **自动检查更新（开关）**
   - 关于页内开关「自动检查更新」，**默认开启**。
   - 偏好持久化在 Client UI KKV（`nm-mobile-ui` / `nm-desktop-ui`），**不**写入 `nm-preferences`。
   - 应用进入主界面后 **延迟约 2s** 后台触发（不阻塞启动）。
   - 距上次检查不足 **24 小时**则跳过（仍可在关于页看到上次结果摘要）。
   - 发现新版本且用户未对该版本点「稍后」：非模态轻提示（Banner / Toast）+「查看」；点击后同手动检查的新版本对话框或直达 Release 页。
   - 用户点「稍后」：记录已忽略的版本号，该版本 **不再自动弹窗**；手动检查仍会提示。

4. **版本数据源（产品层）**
   - 以 GitHub 仓库 `bloodycrownD/novel-master` 的 **`releases/latest`** 为检查来源（与当前全量 Release workflow 对齐）。
   - 本地版本与 Release `tag_name`（去 `v` 前缀）比较。

5. **发版版本号对齐（产品要求）**
   - Release 构建产物上的版本号须与 tag 一致，确保「关于页显示版本」与「更新比较」不错位（实现细节见 SPEC）。

### 不包含范围

1. **修改 `packages/core`**（更新检查逻辑归属各客户端，便于未来 workflow 分端后独立演进）。
2. **修改 `.github/workflows/release.yml`**（分端发版、路径检测、tag 后缀等；版本号对齐所需的最小改动见 SPEC）。
3. **应用内自动下载与静默安装**（`electron-updater`、应用内 APK 安装器等）。
4. **CLI（`nm`）更新检查**。
5. **iOS** 发版与更新检查（当前产品交付以 Android 为主）。
6. **Release Notes 富文本渲染**（对话框仅展示纯文本摘要前若干行，全文用户到 GitHub 查看）。
7. **私有仓库 / GitHub Token 鉴权**（按公开仓库、匿名 API 限额设计）。
8. **强制更新、版本淘汰、协议弹窗** 等运营策略。

## 核心需求

1. Mobile、Desktop 均提供独立的 **「关于 Novel Master」** 设置页，信息架构一致（头部信息 → 更新区 → 项目链接）。
2. 关于页展示 **当前版本** 与可点击的 **项目外链**（仓库、Releases、许可证）。
3. 提供 **手动检查更新**，任意时刻可触发，反馈明确、可测试。
4. 提供 **自动检查更新开关**（默认开），后台节流检查，有新版时轻量提示且可「稍后」忽略。
5. 发现新版本时 **仅引导用户到 GitHub Release 页**（或系统浏览器打开等价 URL），不在应用内完成升级。
6. 更新相关偏好属于 **Client UI 层**，与 `chat.llmStream` 等业务偏好分离存储。
7. 本迭代 **不改变** 现有发版流程的操作方式（维护者仍打 `v*` tag）。

## 验收标准

### 关于页与导航

- **Given** Mobile 已启动并进入「我的」  
  **When** 点击「关于 Novel Master」  
  **Then** 进入关于页，标题与返回行为与其他 stack 设置页一致。

- **Given** Desktop 已打开设置 overlay  
  **When** 在侧栏选择「关于」  
  **Then** 主区展示关于页，关闭设置后状态不异常。

- **Given** 关于页已打开  
  **When** 查看页面  
  **Then** 可见应用名、当前版本号、GitHub 仓库 / Releases / 许可证链接入口。

### 外链

- **Given** 关于页已打开  
  **When** 点击「GitHub 仓库」或「发行版」  
  **Then** 在系统浏览器（或平台等价外链能力）打开对应 URL，且 URL 指向 `bloodycrownD/novel-master` 仓库或其 Releases。

### 手动检查更新

- **Given** 本地版本 **低于** GitHub `releases/latest` 的 tag  
  **When** 用户点击「检查更新」  
  **Then** 在 10s 内提示有新版本，展示远程版本号，并提供「前往下载」打开 Release 页。

- **Given** 本地版本 **等于或高于** latest tag  
  **When** 用户点击「检查更新」  
  **Then** 提示「当前已是最新版本」（或等价文案），且不打开浏览器。

- **Given** 设备无网络或 GitHub API 不可用  
  **When** 用户点击「检查更新」  
  **Then** 提示检查失败原因，应用不崩溃、不卡死。

### 自动检查更新

- **Given** 自动检查开关为 **开启**（默认）  
  **When** 应用冷启动进入主界面  
  **Then** 约 2s 后在后台发起检查；若距上次成功检查不足 24h，则不发起新请求。

- **Given** 自动检查发现新版本且用户 **未** 对该版本点「稍后」  
  **When** 检查完成  
  **Then** 出现非模态轻提示（非阻塞启动的全屏弹窗），用户可点击查看详情或忽略。

- **Given** 用户对新版本对话框点击「稍后」  
  **When** 下次自动检查仍检测到同一版本  
  **Then** **不再** 自动弹窗；手动「检查更新」仍可提示该版本。

- **Given** 用户关闭自动检查开关  
  **When** 冷启动  
  **Then** 不发起后台检查；手动检查仍可用。

### 偏好持久化

- **Given** 用户切换自动检查开关或点击「稍后」  
  **When** 重启应用  
  **Then** 开关状态与已忽略版本记录保持（存于 `nm-mobile-ui` / `nm-desktop-ui`，非 `nm-preferences`）。

### 非回归

- **Given** 未进入关于页  
  **When** 正常使用聊天、VFS、备份、Agent 配置  
  **Then** 行为与迭代前一致。
