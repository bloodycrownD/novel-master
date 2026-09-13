---
date: 2026-09-12 12:00
title: 升级 openchamber 到 1.23.1
keywords: openchamber, pnpm, 全局包升级
abstract: 用户口中的 openchamper 实为 OpenChamber（openchamber.dev），经 pnpm 全局装为 @openchamber/web；从 1.23.0 升到 1.23.1，@latest 解析被旧缓存黏住时需显式指定版本号。
---

user:
帮我更新下 openchamper，应该已经安装了。

assistant:
在 PATH 里没找到 openchamper 这个名字，翻了 shell 历史发现之前是用官方脚本（openchamber.dev/install）装的，实际命令叫 openchamber，落在 pnpm 全局目录 ~/.local/share/pnpm/bin/openchamber，对应 npm 包名是 @openchamber/web（作用域包，不带作用域的 openchamber 在 registry 里不存在），当时版本 1.23.0。

升级时 registry 的 latest 标签已指向 1.23.1，但 `pnpm add -g @openchamber/web@latest` 因全局解析缓存仍装回 1.23.0；显式 `pnpm add -g @openchamber/web@1.23.1` 后成功升到 1.23.1，`openchamber --version` 验证通过。结论：pnpm 全局包升级遇到 @latest 不走新版本时，直接指定目标版本号即可。
