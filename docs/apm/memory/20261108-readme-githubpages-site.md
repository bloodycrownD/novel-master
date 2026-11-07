---
date: 2026-11-08 01:10
title: README 优化 + GitHub Pages 官网制作立项（暗夜书房视觉方案）
keywords: README, GitHub Pages, VitePress, 截图, 模拟器, 美学, 配色, 动态工作流
abstract: 用户拍板把 README 重写与 GitHub Pages 官网制作整体交给 agent，用动态工作流派子代理（模型固定 opencode-go-chat/deepseek-v4.1-flash$max）。视觉方案定为「暗夜书房」：品牌层用图标的暖色像素风（暖调中性深底 #141210、暖米白文字、琥珀金 #E6913F 主强调、陶土红 #A24E44 次强调），产品截图放真实 app 界面（亮色主题优先）；技术栈 VitePress（base /novel-master/），GitHub Actions 部署，gh 已登录 bloodycrownD。截图用模拟器 + 虚构演示项目《星轨旅人》，禁止动真机数据；桌面端在 README/官网只一句带过。
---

user:
这个项目 readme 非常简陋，也没有 GitHub Pages，这么复杂的项目用 page 展示更好。手机截图你可以自己截吧？能不能放心把 README 优化和 gitpage 制作都交给你？桌面端完成度不好，不用详细介绍。

assistant:
盘点后确认三块都能落地：README 重写、模拟器实景截图（本机有 Medium_Phone_API_36.1 / Pixel_7 / nm33 / nm35 / nm36 五个 AVD，gh 已登录）、VitePress 官网 + Actions 部署。美学思路：app 界面代码（apps/mobile/src/theme/tokens.ts）是标准 iOS 双主题（亮 #F2F2F7/#007AFF、暗 #000/#0A84FF），品牌层（像素风暖色图标：暖棕底、奶油黄书页、陶土红书封、琥珀金点睛）与产品层分开对待——官网走暖调中性深底 + 琥珀金/陶土红强调，截图放真实 app 界面且优先亮色主题。资料三层保险：guide skill 七份 reference、docs/apm/memory 200+ 份记忆（含 20260904-intro-copywriting.md 文案初稿、模拟器 e2e 经验）、代码核对入口路径。

user:
（用户纠正）「app 界面是纯黑底」是因为那是黑夜模式，看代码 css 才知道风格。

assistant:
认错并读 tokens.ts 确认双主题 iOS 原生风。修正方案：页面底色从浓浓可可色收敛为带一点暖调的中性深色（#141210 档），品牌强调色保留琥珀金主、陶土红次，像素元素只当调味料（eyebrow/徽章），截图优先亮色主题，避免与 iOS 截图打架。

user:
同意开搞。活不需要都自己干，动态工作流派子代理可以，注意工作流指定模型为 deepseek flash。

assistant:
启动动态工作流（subagent_model=opencode-go-chat/deepseek-v4.1-flash$max，遵守记忆 #217）：八张合同截图（home/chat/workspace/annotate/context/agents/skills/stats.png）落 assets/screenshots/ 并复制 website/public/screenshots/；演示项目《星轨旅人》虚构内容；七份指南文档由七个写手并行从 references/ 改写；落地页 + README 重写参考 intro-copywriting 记忆；构建门控 npm --prefix website run docs:build 循环修到绿；独立复审员换人读稿。纪律：任何设备禁 uninstall/pm clear（含模拟器），装包只 adb install -r -d；Metro 必须从真实路径起；debug 包不内嵌 bundle。先本地提交，push 与开启 Pages（gh api 设 build_type=workflow）前征求用户确认。
