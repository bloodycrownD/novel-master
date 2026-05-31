# 工作区与协作 - 桌面端 UI 原型

这是一个基于移动端原型创建的桌面端 UI 原型，采用更适合大屏幕的三栏布局设计。

## ✨ 特性

### 🖥️ 桌面端优化布局
- **三栏布局**：左侧导航 + 中间主内容 + 右侧工具栏
- **固定侧边栏**：280px 左侧边栏，320px 右侧边栏
- **响应式设计**：适配不同屏幕尺寸
- **多任务视图**：同时查看聊天和文件工作区

### 🎨 主题系统
- **浅色主题**：清新明亮的日间模式
- **深色主题**：护眼舒适的夜间模式
- **一键切换**：点击左上角主题按钮
- **自动保存**：主题偏好保存到 localStorage

### 📱 核心功能
- **会话管理**：左侧边栏快速切换会话
- **Agent 配置**：独立的 Agent 编辑视图
- **文件工作区**：右侧边栏实时查看文件树
- **会话日志**：工具调用和操作记录
- **设置中心**：服务商、压缩策略、正则配置等

## 📁 文件结构

```
desktop/
├── index.html          # 主应用页面
├── theme-demo.html     # 主题演示页面
├── css/
│   └── styles.css      # 样式文件
├── js/
│   └── app.js          # 应用逻辑
├── docs/               # 文档目录
│   ├── quickstart.md   # 快速开始
│   └── summary.md      # 开发总结
└── README.md           # 本文件
```

## 🚀 如何使用

### 方式 1：直接打开
```bash
# Windows
start index.html

# macOS
open index.html

# Linux
xdg-open index.html
```

### 方式 2：本地服务器
```bash
# 使用 Python
python -m http.server 8000

# 使用 Node.js
npx serve

# 访问
http://localhost:8000/index.html
```

### 方式 3：Live Server（VS Code）
1. 安装 Live Server 扩展
2. 右键点击 `index.html`
3. 选择 "Open with Live Server"

## 🎯 布局说明

### 左侧边栏（280px）
- **顶部**：应用标题 + 主题切换
- **导航标签**：会话 / Agent / 设置
- **项目选择器**：当前项目信息
- **内容区域**：根据导航标签显示不同列表

### 中间主内容区（自适应）
- **聊天视图**：消息列表 + 输入框
- **编辑器视图**：Agent 配置编辑
- **设置视图**：各类设置详情

### 右侧边栏（320px）
- **工作区面板**：会话文件树
- **日志面板**：工具调用记录

## 🎨 设计规范

### 颜色系统
```css
/* 浅色主题 */
--primary-color: #007AFF;
--success-color: #34C759;
--warning-color: #FF9500;
--danger-color: #FF3B30;
--bg-color: #F5F5F7;
--surface-color: #FFFFFF;
--text-primary: #1D1D1F;
--text-secondary: #86868B;

/* 深色主题 */
--primary-color: #0A84FF;
--success-color: #30D158;
--warning-color: #FF9F0A;
--danger-color: #FF453A;
--bg-color: #1C1C1E;
--surface-color: #2C2C2E;
--text-primary: #F5F5F7;
--text-secondary: #98989D;
```

### 字体
- 系统字体栈（跨平台）
- 代码：`ui-monospace`, `Courier New`

### 间距
- 基础单位：4px
- 常用间距：8px, 12px, 16px, 24px

### 圆角
- 小：6-8px（按钮、输入框）
- 中：10-12px（卡片）
- 大：16px（面板）

### 阴影
- sm: `0 1px 3px rgba(0,0,0,0.06)`
- md: `0 2px 8px rgba(0,0,0,0.08)`
- lg: `0 4px 16px rgba(0,0,0,0.1)`

## 🔧 技术实现

### HTML 结构
- 语义化标签
- 无障碍属性（ARIA）
- 数据属性驱动交互

### CSS 特性
- CSS 变量（主题切换）
- Flexbox 布局
- 过渡动画
- 响应式媒体查询

### JavaScript
- 原生 JavaScript（无依赖）
- 事件委托
- 状态管理
- 模块化代码

## 📊 功能覆盖

本原型覆盖了以下功能：

- ✅ 三栏桌面布局
- ✅ 会话管理与切换
- ✅ Agent 列表与编辑
- ✅ 消息流展示
- ✅ 工具调用卡片
- ✅ 文件工作区树
- ✅ 会话日志记录
- ✅ 设置中心
- ✅ 主题切换（浅色/深色）
- ✅ Toast 提示
- ✅ 响应式设计

## 🎯 与移动端的区别

| 特性 | 移动端 | 桌面端 |
|------|--------|--------|
| 布局 | 单栏 + 底部导航 | 三栏固定布局 |
| 导航 | 底部 Tab | 左侧边栏 |
| 项目切换 | 抽屉 | 下拉选择器 |
| 工作区 | Tab 切换 | 右侧固定面板 |
| 消息气泡 | 移动端样式 | 桌面端样式 |
| 交互方式 | 触摸优化 | 鼠标优化 |

## 🌐 浏览器兼容性

- ✅ Chrome/Edge 88+
- ✅ Firefox 85+
- ✅ Safari 14+
- ✅ Opera 74+

## 📱 响应式断点

```css
/* 中等屏幕 */
@media (max-width: 1200px) {
    --sidebar-width: 240px;
    --right-sidebar-width: 280px;
}

/* 小屏幕 */
@media (max-width: 900px) {
    /* 隐藏右侧边栏 */
    #rightSidebar { display: none; }
}
```

## 🔮 后续改进

- [ ] 拖拽调整侧边栏宽度
- [ ] 多窗口/标签页支持
- [ ] 快捷键系统
- [ ] 搜索功能
- [ ] 更多动画效果
- [ ] 虚拟滚动优化
- [ ] 离线支持

## 🎓 学习资源

- [快速开始](./docs/quickstart.md)
- [开发总结](./docs/summary.md)
- [桌面 vs 移动端对比](../docs/comparison.md)

## 🎓 外部参考

- [CSS Grid 布局](https://css-tricks.com/snippets/css/complete-guide-grid/)
- [Flexbox 布局](https://css-tricks.com/snippets/css/a-guide-to-flexbox/)
- [CSS 变量](https://developer.mozilla.org/zh-CN/docs/Web/CSS/Using_CSS_custom_properties)
- [无障碍设计](https://www.w3.org/WAI/WCAG21/quickref/)

## 📄 许可

本原型仅供内部开发参考使用。

---

**版本**: 1.0.0  
**最后更新**: 2024  
**基于**: mobile 端原型 v2.0.0
