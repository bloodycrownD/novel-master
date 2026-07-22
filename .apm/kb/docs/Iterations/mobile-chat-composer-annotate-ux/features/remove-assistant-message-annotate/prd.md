---
date: 2026-07-22
dependency: Iterations/mobile-chat-composer-annotate-ux/prd.md
---

# remove-assistant-message-annotate Feature PRD

> **已被 `remove-message-annotate` 取代**（2026-07-22）：产品确认 User+Assistant 消息批注全部移除，不再仅收窄为「仅 user」。  
> 请改读：`features/remove-message-annotate/prd.md`。  
> 本文件保留以免断链。

> 敏捷名称：`remove-assistant-message-annotate`（已 superseded）  
> 所属迭代：`mobile-chat-composer-annotate-ux`  
> 平台：仅 Mobile；Desktop 无消息批注，勿改。

## 背景与变更动机

父迭代交付了消息正文划词批注（选区菜单「批注」+「复制」），入口对全部 `.row.message` 开放，助手与用户消息均可批注。产品改为：**仅用户消息**可批注；助手消息上点「批注」应无效果。

## 范围说明

| 项 | 说明 |
|----|------|
| **纳入** | Mobile transcript 划词批注门闩：仅 `.row.message.user`；宿主按 `role === 'user'` 二次校验；父 PRD/SPEC 口径改为「仅用户消息」 |
| **保留** | 文件批注；User 消息批注；Core `__message__:` 管线；Undo skip 伪 path；消息批注 store/builder/§ tag |
| **不改** | Desktop；⋯ 消息菜单（本无批注项）；Core 消息批注 schema/builder 删除 |

## 验收标准

1. **Given** 用户消息正文划词并点「批注」，**When** resolve 成功，**Then** 仍可弹录入、写消息批注 store、插 Composer tag。
2. **Given** 助手消息正文划词并点「批注」，**When** resolve，**Then** 不弹 composer modal、不写 store（静默取消）。
3. **Given** 任意消息划词，**When** 点「复制」，**Then** 仍写入系统剪贴板。
4. **Given** RN WebView `menuItems` 为静态，**When** 无法按选区角色隐藏「批注」，**Then** 允许菜单仍显示「批注」+「复制」，以门闩静默为准（注释说明）。
