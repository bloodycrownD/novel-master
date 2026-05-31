# 主题系统使用指南

## 概述

移动端 UI 原型现已支持完整的浅色/深色主题切换功能，并进行了全面的视觉优化。

## 主要特性

### 🎨 双主题支持

- **浅色主题**：清新明亮，适合白天使用
- **深色主题**：护眼舒适，适合夜间使用
- **平滑过渡**：主题切换时所有元素都有流畅的过渡动画

### ✨ 视觉优化

1. **改进的颜色系统**
   - 更丰富的颜色变量（主色、次要色、边框色等）
   - 深色主题专门优化的配色方案
   - 更好的对比度和可读性

2. **增强的交互反馈**
   - 悬停效果（hover）
   - 点击反馈（active）
   - 焦点状态（focus）
   - 平滑的过渡动画

3. **优化的组件样式**
   - 更圆润的圆角（10px-20px）
   - 分层的阴影系统（sm/md/lg）
   - 毛玻璃效果（backdrop-filter）
   - 改进的间距和排版

4. **无障碍支持**
   - 焦点可见性增强
   - 支持减少动画偏好
   - 支持高对比度模式
   - 触摸目标优化（最小 44px）

## 使用方法

### 切换主题

点击顶部导航栏右侧的主题切换按钮：
- 🌞 太阳图标 = 当前为浅色主题
- 🌙 月亮图标 = 当前为深色主题

主题偏好会自动保存到 localStorage，下次打开时会记住你的选择。

### 编程方式

```javascript
// 获取当前主题
const currentTheme = document.documentElement.getAttribute('data-theme');

// 设置主题
document.documentElement.setAttribute('data-theme', 'dark'); // 或 'light'

// 保存到 localStorage
localStorage.setItem('nm-mobile-theme', 'dark');
```

## 颜色变量

### 浅色主题

```css
--primary-color: #007AFF;      /* 主色 */
--success-color: #34C759;      /* 成功色 */
--warning-color: #FF9500;      /* 警告色 */
--danger-color: #FF3B30;       /* 危险色 */
--bg-color: #F2F2F7;           /* 背景色 */
--surface-color: #FFFFFF;      /* 表面色 */
--text-primary: #000000;       /* 主文本 */
--text-secondary: #8E8E93;     /* 次要文本 */
--border-color: #C6C6C8;       /* 边框色 */
```

### 深色主题

```css
--primary-color: #0A84FF;      /* 主色（更亮） */
--success-color: #30D158;      /* 成功色 */
--warning-color: #FF9F0A;      /* 警告色 */
--danger-color: #FF453A;       /* 危险色 */
--bg-color: #000000;           /* 背景色（纯黑） */
--surface-color: #1C1C1E;      /* 表面色 */
--text-primary: #FFFFFF;       /* 主文本 */
--text-secondary: #98989D;     /* 次要文本 */
--border-color: #38383A;       /* 边框色 */
```

## 组件优化清单

### 已优化的组件

- ✅ 顶部导航栏（毛玻璃效果）
- ✅ 底部导航栏（毛玻璃效果）
- ✅ 按钮（主要/次要/危险）
- ✅ 卡片和列表项
- ✅ 消息气泡
- ✅ 输入框和表单
- ✅ 抽屉（项目/会话操作）
- ✅ 底部弹出菜单
- ✅ Toast 提示
- ✅ 模态框
- ✅ Agent 表单
- ✅ VFS 文件管理器
- ✅ 工具调用卡片
- ✅ 时间线项目
- ✅ 代码编辑器

### 交互增强

- ✅ 悬停效果（桌面端）
- ✅ 点击反馈
- ✅ 焦点状态
- ✅ 加载动画
- ✅ 过渡动画
- ✅ 变换效果（scale, translateY）

## 自定义主题

### 添加新的颜色变量

在 `css/styles.css` 的 `:root` 和 `[data-theme="dark"]` 中添加：

```css
:root {
    --my-custom-color: #FF6B6B;
}

[data-theme="dark"] {
    --my-custom-color: #FF8787;
}
```

### 使用颜色变量

```css
.my-element {
    background: var(--my-custom-color);
    transition: background-color var(--transition-speed) ease;
}
```

### 添加过渡效果

```css
.my-element {
    transition: all var(--transition-speed) ease;
}

.my-element:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow);
}
```

## 性能优化

### 已实现的优化

1. **CSS 变量**：使用 CSS 自定义属性，主题切换无需重新加载
2. **硬件加速**：使用 `transform` 和 `opacity` 进行动画
3. **减少重绘**：使用 `will-change` 提示浏览器
4. **条件动画**：尊重 `prefers-reduced-motion` 偏好

### 最佳实践

```css
/* 好 - 使用 transform */
.element:hover {
    transform: translateY(-2px);
}

/* 避免 - 使用 top/left */
.element:hover {
    top: -2px; /* 会触发重排 */
}
```

## React Native 迁移建议

### 主题实现

```javascript
// 使用 React Context
const ThemeContext = React.createContext();

// 主题 Provider
function ThemeProvider({ children }) {
    const [theme, setTheme] = useState('light');
    
    const toggleTheme = () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        AsyncStorage.setItem('theme', newTheme);
    };
    
    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}
```

### 样式定义

```javascript
const styles = (theme) => StyleSheet.create({
    container: {
        backgroundColor: theme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    },
    text: {
        color: theme === 'dark' ? '#FFFFFF' : '#000000',
    },
});
```

### 推荐库

- **react-native-appearance**：系统主题检测
- **@react-navigation/native**：导航栏主题
- **react-native-reanimated**：流畅动画

## 浏览器兼容性

- ✅ Chrome/Edge 88+
- ✅ Safari 14+
- ✅ Firefox 85+
- ✅ iOS Safari 14+
- ✅ Chrome Android 88+

### CSS 特性支持

- CSS 自定义属性（变量）
- backdrop-filter（毛玻璃）
- CSS 过渡和动画
- CSS Grid 和 Flexbox

## 故障排除

### 主题不切换

1. 检查 localStorage 是否可用
2. 检查浏览器控制台是否有错误
3. 清除浏览器缓存

### 动画卡顿

1. 检查是否启用了硬件加速
2. 减少同时进行的动画数量
3. 使用 Chrome DevTools 的 Performance 面板分析

### 颜色不正确

1. 确保使用了 CSS 变量而非硬编码颜色
2. 检查 `data-theme` 属性是否正确设置
3. 清除浏览器缓存

## 未来改进

- [ ] 自动跟随系统主题
- [ ] 更多主题选项（如高对比度主题）
- [ ] 主题编辑器
- [ ] 导出/导入主题配置
- [ ] 主题预览功能

## 参考资源

- [iOS Human Interface Guidelines - Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Material Design - Dark Theme](https://material.io/design/color/dark-theme.html)
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
- [Web Accessibility](https://www.w3.org/WAI/WCAG21/quickref/)

---

**版本**: 1.0.0  
**最后更新**: 2024
