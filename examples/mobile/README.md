# 工作区与协作 - 移动端 UI 原型

这是一个基于 [功能清单](./docs/feature-inventory.md) 创建的移动端 UI 原型，用于 React Native 实现参考。

## ✨ 新功能：主题系统

### 🎨 双主题支持
- **浅色主题**：清新明亮的日间模式
- **深色主题**：护眼舒适的夜间模式
- **一键切换**：点击顶部导航栏右侧的主题按钮
- **自动保存**：主题偏好自动保存到 localStorage

### 🚀 视觉优化
- 改进的颜色系统和对比度
- 平滑的过渡动画（0.2s）
- 增强的交互反馈（hover/active/focus）
- 毛玻璃效果（backdrop-filter）
- 分层阴影系统（sm/md/lg）
- 更圆润的圆角设计（10-20px）

### ♿ 无障碍支持
- 焦点可见性增强
- 支持 `prefers-reduced-motion`
- 支持 `prefers-contrast: high`
- 触摸目标优化（最小 44px）

## 文件结构

```
mobile/
├── index.html              # 主应用页面
├── theme-demo.html         # 主题演示页面
├── css/
│   ├── styles.css          # 核心样式文件
│   └── theme-enhancements.css  # 主题增强样式
├── js/
│   └── app.js              # 应用逻辑
├── docs/                   # 文档目录
│   ├── INDEX.md            # 文档导航
│   ├── quickstart.md       # 快速开始
│   ├── theme-guide.md      # 主题系统详细文档
│   ├── feature-inventory.md # 功能清单
│   └── ...
└── README.md               # 本文件
```

## 如何使用

### 方式 1：直接打开
```bash
# 主应用
start index.html

# 主题演示
start theme-demo.html
```

### 方式 2：本地服务器
```bash
# 使用 Python
python -m http.server 8000

# 使用 Node.js
npx serve

# 访问
http://localhost:8000/index.html
http://localhost:8000/theme-demo.html
```

### 方式 3：Live Server（VS Code）
1. 安装 Live Server 扩展
2. 右键点击 `index.html`
3. 选择 "Open with Live Server"

## 主题切换

### 用户操作
点击顶部导航栏右侧的主题切换按钮：
- 🌞 太阳图标 = 浅色主题
- 🌙 月亮图标 = 深色主题

### 编程方式
```javascript
// 切换主题
document.documentElement.setAttribute('data-theme', 'dark'); // 或 'light'

// 保存偏好
localStorage.setItem('nm-mobile-theme', 'dark');
```

## 主要页面

### 1. 对话页面（默认首页）
- 会话列表与项目模板切换
- AI 对话消息流
- 工具调用卡片展示
- 会话工作区文件管理

### 2. Agent 页面
- Agent 列表与管理
- Agent 配置编辑器
- 模型选择与采样配置

### 3. 我的页面
- 当前模型显示
- 服务商管理
- 压缩策略配置
- 正则配置
- 全局模板
- 扩展设置

### 二级页面
- 真实提示词预览
- 会话日志（工具+检查点时间线）
- 服务商详情
- 模型采样配置
- 正则组管理
- 文件编辑器

## 颜色系统

### 浅色主题
```css
--primary-color: #007AFF;
--success-color: #34C759;
--warning-color: #FF9500;
--danger-color: #FF3B30;
--bg-color: #F2F2F7;
--surface-color: #FFFFFF;
--text-primary: #000000;
--text-secondary: #8E8E93;
```

### 深色主题
```css
--primary-color: #0A84FF;
--success-color: #30D158;
--warning-color: #FF9F0A;
--danger-color: #FF453A;
--bg-color: #000000;
--surface-color: #1C1C1E;
--text-primary: #FFFFFF;
--text-secondary: #98989D;
```

## 设计规范

### 颜色
- 主色：iOS 蓝（浅色 #007AFF / 深色 #0A84FF）
- 成功：绿色
- 警告：橙色
- 危险：红色

### 字体
- 系统字体栈（iOS/Android 原生）
- 代码：`ui-monospace`, `Courier New`

### 间距
- 基础单位：4px
- 常用间距：8px, 12px, 16px, 24px

### 圆角
- 小：8-10px（按钮、输入框）
- 中：12-16px（卡片）
- 大：20-28px（模态框、Toast）
- 圆形：50%（FAB、头像）

### 阴影
- sm: `0 1px 3px rgba(0,0,0,0.08)`
- md: `0 2px 8px rgba(0,0,0,0.1)`
- lg: `0 4px 16px rgba(0,0,0,0.12)`

## React Native 实现建议

### 主题实现
```javascript
import { useColorScheme } from 'react-native';

// 使用系统主题
const colorScheme = useColorScheme();

// 或使用 Context
const ThemeContext = React.createContext();
```

### 推荐库
- **@react-navigation/native** - 导航
- **react-native-reanimated** - 动画
- **react-native-gesture-handler** - 手势
- **@gorhom/bottom-sheet** - 底部弹出
- **react-native-vector-icons** - 图标

### 样式转换
```javascript
const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3, // Android
  },
});
```

## 功能覆盖

本原型覆盖了 [功能清单](./docs/feature-inventory.md)（**已按 `index.html` + `app.js` 代码审计修订**）中的主要部分：

- ✅ **3 Tab** 导航（对话 / Agent / 我的）；对话内嵌 **会话↔项目模板**、**聊天↔会话工作区**
- ✅ 项目抽屉、会话操作抽屉、工作区模型模态框
- ✅ 列表 **批量管理**（项目/会话/Agent/服务商/模型/正则）
- ✅ VFS 文件管理器（`vfs-fm`：三域、行菜单、目录规则 Sheet）
- ✅ AI 对话 UI（meta、工具卡、输入区；发送/流式待 App 接 Core）
- ✅ 工作树规则（在 VFS 行上；真实提示词页为预览入口）
- ✅ 会话日志统一时间线 + 回滚交互
- ✅ Agent（默认 Agent、专属模型、Prompt 块编辑）
- ✅ 服务商/已保存模型/采样配置
- ✅ 正则四级栈 + 测试预览
- ✅ 压缩策略、扩展设置、全局模板
- ✅ 文件编辑器、Toast/Sheet/Modal、**双主题**

部分 CLI 能力仅在清单 **§14 App 扩展** 中（如项目详情、template pull、服务商新增），HTML 原型未做按钮。

## 浏览器兼容性

- ✅ Chrome/Edge 88+
- ✅ Safari 14+
- ✅ Firefox 85+
- ✅ iOS Safari 14+
- ✅ Chrome Android 88+

## 性能优化

- 使用 CSS 变量实现主题切换
- 硬件加速动画（transform/opacity）
- 条件动画（尊重用户偏好）
- 优化的滚动性能

## 开发建议

### 添加新组件
1. 使用 CSS 变量定义颜色
2. 添加过渡动画
3. 考虑深色主题
4. 测试无障碍性

### 示例
```css
.my-component {
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border-light);
    border-radius: 16px;
    transition: all var(--transition-speed) ease;
}

.my-component:hover {
    box-shadow: var(--shadow);
    transform: translateY(-2px);
}
```

## 相关文档

- [文档索引](./docs/INDEX.md) - 全部文档导航
- [主题指南](./docs/theme-guide.md) - 主题系统详细文档
- [功能清单](./docs/feature-inventory.md) - 功能清单
- [主题演示](./theme-demo.html) - 主题演示页面

## 后续改进

- [ ] 自动跟随系统主题
- [ ] 更多主题选项
- [ ] 主题编辑器
- [ ] 动画性能优化
- [ ] 更多组件示例

## 许可

本原型仅供内部开发参考使用。

---

**版本**: 2.0.0（新增主题系统）  
**最后更新**: 2024
