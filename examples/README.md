# UI 原型示例

本目录包含 Novel Master 的移动端和桌面端 UI 原型。

## 📁 目录结构

```
examples/
├── README.md                    # 本文件
├── docs/                        # 跨端共享文档
│   ├── comparison.md            # 桌面 vs 移动端对比
│   ├── features.md              # 功能特性说明
│   └── project-complete.md      # 项目完成报告
│
├── mobile/                      # 移动端原型
│   ├── index.html               # 主应用
│   ├── theme-demo.html          # 主题演示
│   ├── css/                     # 样式
│   ├── js/                      # 脚本
│   ├── docs/                    # 文档
│   └── README.md
│
└── desktop/                     # 桌面端原型
    ├── index.html               # 主应用
    ├── theme-demo.html          # 主题演示
    ├── css/                     # 样式
    ├── js/                      # 脚本
    ├── docs/                    # 文档
    └── README.md
```

## 🎯 快速开始

### 移动端原型

**适用场景**：手机、平板、小屏幕设备

```bash
cd mobile
start index.html  # Windows
open index.html   # macOS
```

**特点**：
- 📱 单栏垂直布局
- 👆 触摸优化交互
- 🔄 底部导航 + 抽屉
- 📏 最佳宽度：375-428px

[查看移动端文档 →](./mobile/README.md)

### 桌面端原型

**适用场景**：电脑、大屏幕设备

```bash
cd desktop
start index.html  # Windows
open index.html   # macOS
```

**特点**：
- 💻 三栏水平布局
- 🖱️ 鼠标优化交互
- 📐 侧边栏导航
- 📏 最佳宽度：1200px+

[查看桌面端文档 →](./desktop/README.md)

## 🎨 主题系统

两个原型都支持浅色/深色主题切换：

- **浅色主题**：清新明亮，适合白天使用
- **深色主题**：护眼舒适，适合夜间使用
- **一键切换**：点击主题按钮即可切换
- **自动保存**：主题偏好保存到 localStorage

## 📊 功能对比

| 功能 | 移动端 | 桌面端 |
|------|--------|--------|
| 会话管理 | ✅ | ✅ |
| AI 对话 | ✅ | ✅ |
| Agent 配置 | ✅ | ✅ |
| 文件工作区 | ✅ | ✅ |
| 会话日志 | ✅ | ✅ |
| 服务商管理 | ✅ | 🔄 |
| 压缩策略 | ✅ | 🔄 |
| 正则配置 | ✅ | 🔄 |
| 主题切换 | ✅ | ✅ |

✅ = 已实现  
🔄 = 待实现

## 🎯 选择指南

### 使用移动端原型

**适合以下情况**：
- 🎯 开发移动应用（React Native、Flutter）
- 📱 目标用户主要使用手机
- 👆 需要触摸手势支持
- 📏 屏幕宽度 < 768px
- 🚶 移动办公场景

### 使用桌面端原型

**适合以下情况**：
- 🎯 开发桌面应用（Electron、Web）
- 💻 目标用户主要使用电脑
- 🖱️ 需要鼠标键盘交互
- 📏 屏幕宽度 > 900px
- 🏢 办公室工作场景

### 两者都需要

**适合以下情况**：
- 🎯 构建跨平台应用
- 🔄 需要响应式设计
- 👥 用户在多设备间切换
- 🌐 Web 应用需要适配所有设备

[查看详细对比 →](./docs/comparison.md)

## 🚀 技术栈

### 前端技术
- **HTML5**：语义化标签
- **CSS3**：变量、Flexbox、动画
- **JavaScript**：ES6+、原生 API

### 特性
- ✅ 无依赖（纯原生实现）
- ✅ 响应式设计
- ✅ 主题切换
- ✅ 无障碍支持
- ✅ 跨浏览器兼容

## 📚 文档导航

### 移动端
- [README.md](./mobile/README.md) - 完整文档
- [文档索引](./mobile/docs/INDEX.md) - 全部文档导航
- [quickstart.md](./mobile/docs/quickstart.md) - 快速开始
- [theme-guide.md](./mobile/docs/theme-guide.md) - 主题指南
- [theme-demo.html](./mobile/theme-demo.html) - 主题演示

### 桌面端
- [README.md](./desktop/README.md) - 完整文档
- [quickstart.md](./desktop/docs/quickstart.md) - 快速开始
- [theme-demo.html](./desktop/theme-demo.html) - 主题演示

### 跨端文档
- [comparison.md](./docs/comparison.md) - 对比文档
- [features.md](./docs/features.md) - 功能特性
- [project-complete.md](./docs/project-complete.md) - 项目完成报告

## 🎓 学习路径

### 初学者
1. 📖 阅读 [移动端 README](./mobile/README.md)
2. 🎨 打开 [移动端主题演示](./mobile/theme-demo.html)
3. 💻 查看 [桌面端快速开始](./desktop/docs/quickstart.md)
4. 🔍 对比 [两端差异](./docs/comparison.md)

### 开发者
1. 📝 查看 HTML 结构
2. 🎨 研究 CSS 样式
3. ⚙️ 分析 JavaScript 逻辑
4. 🔧 尝试修改和扩展

### 设计师
1. 🎨 查看主题演示页面
2. 📐 研究布局和间距
3. 🎯 对比移动端和桌面端
4. 💡 提出改进建议

## 🛠️ 开发建议

### 本地开发

**推荐使用本地服务器**：
```bash
# Python
python -m http.server 8000

# Node.js
npx serve

# 访问
http://localhost:8000/mobile/
http://localhost:8000/desktop/
```

**或使用 VS Code Live Server**：
1. 安装 Live Server 扩展
2. 右键点击 HTML 文件
3. 选择 "Open with Live Server"

### 修改原型

**修改颜色**：
```css
/* 编辑 css/styles.css */
:root {
    --primary-color: #007AFF;  /* 改为你的品牌色 */
}
```

**修改布局**：
```css
/* 桌面端 - 调整侧边栏宽度 */
:root {
    --sidebar-width: 280px;
    --right-sidebar-width: 320px;
}
```

**添加功能**：
```javascript
// 编辑 js/app.js
function handleAction(action) {
    switch (action) {
        case 'your-action':
            // 你的代码
            break;
    }
}
```

## 🌐 浏览器支持

| 浏览器 | 移动端 | 桌面端 |
|--------|--------|--------|
| Chrome | ✅ 88+ | ✅ 88+ |
| Safari | ✅ 14+ | ✅ 14+ |
| Firefox | ✅ 85+ | ✅ 85+ |
| Edge | ✅ 88+ | ✅ 88+ |
| Opera | - | ✅ 74+ |

## 📱 设备测试

### 移动端测试
- iPhone SE (375px)
- iPhone 12/13 (390px)
- iPhone 14 Pro Max (428px)
- iPad (768px)
- Android 手机 (360-414px)

### 桌面端测试
- 笔记本 (1366x768)
- 台式机 (1920x1080)
- 2K 显示器 (2560x1440)
- 4K 显示器 (3840x2160)

## 🔧 常见问题

### Q: 可以直接用于生产环境吗？
A: 这是 UI 原型，用于设计验证和开发参考。生产环境需要：
- 后端 API 集成
- 状态管理（Redux、MobX）
- 路由管理
- 错误处理
- 性能优化
- 安全加固

### Q: 如何集成到现有项目？
A: 可以：
1. 复制 HTML 结构
2. 提取 CSS 样式
3. 改写 JavaScript 逻辑
4. 使用你的框架重新实现

### Q: 支持哪些框架？
A: 原型是原生实现，可以用任何框架重写：
- React / React Native
- Vue / Nuxt
- Angular
- Svelte
- Flutter

### Q: 如何贡献代码？
A: 欢迎提交 PR：
1. Fork 项目
2. 创建特性分支
3. 提交修改
4. 发起 Pull Request

## 📄 许可

本原型仅供内部开发参考使用。

## 🤝 支持

如有问题或建议：
- 📧 联系开发团队
- 💬 提交 Issue
- 📝 查看文档

---

**祝你使用愉快！** 🎉

选择适合你的原型，开始构建出色的应用吧！
