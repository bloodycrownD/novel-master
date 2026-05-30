# 工作区与协作 — 移动端 UI 原型

基于 [`docs/feature-inventory.md`](docs/feature-inventory.md) 的静态原型，**直接双击 `index.html` 即可**（无需本地服务器）。

## 文件结构

```text
examples/mobile/
├── index.html
├── styles.css
├── app.js
├── README.md
├── docs/
│   └── feature-inventory.md
└── archive/
    └── mobile.html          # 旧版单文件原型（不维护）
```

## 使用

```powershell
start examples/mobile/index.html
```

或在资源管理器中双击 `index.html`。

## 信息架构（摘要）

| 底栏 | 说明 |
|------|------|
| 对话 | 会话列表页上 Tab：**会话 / 项目模板** → 点会话进入聊天；聊天上 Tab：**聊天 / 会话工作区** |
| Agent | Agent 配置列表 |
| 我的 | 服务商、全局模板、设置等 |

底栏 **对话 / Agent / 我的** 互相独立：切换 Tab **不会**把对话从「聊天中」打回「会话列表」；只有顶栏返回、切换项目等操作才会。

**VFS 三域**（`session` / `project` / `global`）共用浏览器组件，交互参考 st-virtual-file-system：路径栏、返回上级、工作树徽标/规则灯、行菜单（纳入三态/目录策略等）。

项目列表：顶栏 **☰** 左侧抽屉。

## 维护

- 交互逻辑：编辑 `app.js`（单文件，按功能分块注释）
- 样式：编辑 `styles.css`
- 结构：编辑 `index.html`
