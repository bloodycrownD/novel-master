---
layout: home

hero:
  name: Novel Master
  text: 专注长篇小说创作的 AI Agent 工作台
  tagline: 文件树 + Agent 同空间改稿 + 上下文你说了算
  image:
    src: /screenshots/workspace.png
    alt: Novel Master 会话工作区

  actions:
    - theme: brand
      text: 快速上手
      link: /docs/guide/quickstart
    - theme: alt
      text: 下载安装
      link: https://github.com/bloodycrownD/novel-master/releases
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/bloodycrownD/novel-master

features:
  - icon: 🎛️
    title: 上下文你说了算
    details: 目录级规则决定每个文件在上下文里露多少：全文、头部或仅文件名，还能排序。不动的设定常驻，正在改的章节置顶。

  - icon: 🤖
    title: 多智能体分工
    details: 只读分析、全权写作、资料整理各归其位。每个智能体可配工具允许 / 拒绝名单，需要时再派子代理跑子任务。

  - icon: 🧩
    title: SKILL.md 标准技能
    details: 技能遵循 SKILL.md 标准，社区技能打包成 ZIP 导入即用，内置管理界面可直接查看与编辑。

  - icon: 💸
    title: 前缀缓存命中率优化
    details: 工作区常驻前缀加回合内快照，连续对话中前缀缓存命中保持 90%+，不用费心搭配预设。

  - icon: 📜
    title: 长对话不失控
    details: 按 token 自动压缩旧消息，也可手动置位锚定可见历史；划词批注定点改稿，改动批次执行、可回滚。

  - icon: 📊
    title: 内置用量统计
    details: token 消耗、缓存命中率、生成速率、首字延迟一屏看清，支持按日与「服务商 × 模型」筛选。
---

## 界面一览

<div style="overflow-x: auto;">

<table>
  <tr>
    <td align="center">
      <img src="/screenshots/home.png" width="270" alt="首页"><br>
      <sub>首页 — 项目与会话总览</sub>
    </td>
    <td align="center">
      <img src="/screenshots/chat.png" width="270" alt="对话"><br>
      <sub>对话 — 聊天面板与输入框</sub>
    </td>
    <td align="center">
      <img src="/screenshots/workspace.png" width="270" alt="工作区"><br>
      <sub>工作区 — 会话文件树</sub>
    </td>
    <td align="center">
      <img src="/screenshots/annotate.png" width="270" alt="批注"><br>
      <sub>批注 — 划词写意见，随消息定点改稿</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="/screenshots/context.png" width="270" alt="消息菜单"><br>
      <sub>消息菜单 — 编辑、复制、置位、分叉、回滚</sub>
    </td>
    <td align="center">
      <img src="/screenshots/agents.png" width="270" alt="智能体"><br>
      <sub>智能体 — 子智能体列表</sub>
    </td>
    <td align="center">
      <img src="/screenshots/skills.png" width="270" alt="技能"><br>
      <sub>技能 — 技能管理列表</sub>
    </td>
    <td align="center">
      <img src="/screenshots/stats.png" width="270" alt="统计"><br>
      <sub>统计 — 数据统计页（图表 / 汇总 / 流水）</sub>
    </td>
  </tr>
</table>

</div>
