---
date: 2026-09-06 09:12
title: pi-web 重启后不自启的排查与 systemd 用户服务化
keywords: pi-web, systemd, user service, enable-linger, nohup, 开机自启, reboot
abstract: 机器重启后 pi-web 消失（原为 nohup 手动启动，不随开机自启）；已改为 systemd 用户服务 ~/.config/systemd/user/pi-web.service（开机自启 + linger + 崩溃自动拉起），重启用 systemctl --user restart pi-web。
---

user:
pi web 关闭了，看起来不会自动启动 UI？

assistant:
排查：机器今早 09:06 重启过；pi-web 原来是从登录 shell 里 nohup 手动启动的，重启即消亡，没有任何自启机制。已 systemd 用户服务化：写 ~/.config/systemd/user/pi-web.service（ExecStart 用 nvm node 显式路径启动 pi-web --hostname 0.0.0.0 --no-open；PATH 环境变量含 nvm bin——subagent 扩展派子进程要从 PATH 解析 pi；Restart=on-failure RestartSec=3；日志追加到 ~/.pi-web.log；NODE_ENV=production 保持与原 shell 继承环境一致），systemctl --user enable --now pi-web + loginctl enable-linger bloodycrown（用户服务无需登录会话即可开机启动）。验证：服务 active、端口 30141 监听。管理命令：status / restart / stop 走 systemctl --user；旧的 /tmp/restart-pi-web.sh 手搓脚本作废（绕过 systemd 双起会撞端口）。重启 pi-web 前仍须先查进程树有无活跃 pi 子进程（项目记忆 #24）。
