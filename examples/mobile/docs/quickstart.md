# 快速开始指南

## 🚀 5 分钟上手

### 1. 打开应用

**Windows:**
```bash
cd d:\Dev\Js\novel-master\examples\mobile
start index.html
```

**Mac/Linux:**
```bash
cd /path/to/novel-master/examples/mobile
open index.html
```

### 2. 切换主题

点击右上角的 🌞/🌙 图标，立即体验浅色/深色主题切换！

### 3. 探索功能

#### 对话 Tab
- 查看会话列表
- 点击会话进入聊天界面
- 切换到"会话工作区"查看文件

#### Agent Tab
- 浏览 Agent 列表
- 点击 Agent 查看配置

#### 我的 Tab
- 管理服务商
- 配置全局设置

## 🎨 主题演示

想快速查看所有主题效果？打开主题演示页面：

```bash
start theme-demo.html
```

这个页面展示了：
- 所有颜色变量
- 各种按钮样式
- 卡片组件
- 表单元素
- 消息气泡
- 更多...

## 💡 常见操作

### 切换项目
1. 点击左上角的菜单图标（三条横线）
2. 在抽屉中选择项目

### 查看会话操作
1. 进入任意会话的聊天界面
2. 点击右上角的菜单图标
3. 选择"切换模型"、"真实提示词"或"会话日志"

### 管理文件
1. 在聊天界面切换到"会话工作区" Tab
2. 浏览文件列表
3. 点击文件右侧的 ⋮ 查看操作菜单

### 编辑 Agent
1. 进入 Agent Tab
2. 点击任意 Agent
3. 修改配置并保存

## 🔧 开发者模式

### 查看主题变量

打开浏览器开发者工具（F12），在 Console 中输入：

```javascript
// 查看当前主题
document.documentElement.getAttribute('data-theme')

// 查看所有 CSS 变量
getComputedStyle(document.documentElement).getPropertyValue('--primary-color')
```

### 实时修改样式

在开发者工具的 Elements 面板中：
1. 选择任意元素
2. 在 Styles 面板中修改 CSS
3. 实时查看效果

### 测试响应式

1. 打开开发者工具（F12）
2. 点击设备工具栏图标（Ctrl+Shift+M）
3. 选择设备：iPhone 12 Pro, Pixel 5 等

## 📱 推荐测试设备

### 浏览器
- Chrome DevTools（推荐）
- Safari 响应式设计模式
- Firefox 响应式设计模式

### 真机测试
1. 启动本地服务器：
   ```bash
   python -m http.server 8000
   ```
2. 在手机浏览器访问：
   ```
   http://你的电脑IP:8000/index.html
   ```

## 🎯 下一步

- 📖 阅读 [README.md](../README.md) 了解完整功能
- 🎨 查看 [theme-guide.md](./theme-guide.md) 学习主题系统
- 🔍 浏览 [feature-inventory.md](./feature-inventory.md) 了解功能清单

## ❓ 常见问题

### Q: 主题切换后没有变化？
A: 刷新页面（F5）或清除浏览器缓存。

### Q: 样式显示不正常？
A: 确保 `css/styles.css` 和 `css/theme-enhancements.css` 都已加载。

### Q: 如何重置主题？
A: 打开浏览器控制台，输入：
```javascript
localStorage.removeItem('nm-mobile-theme');
location.reload();
```

### Q: 动画太快/太慢？
A: 在 `css/styles.css` 中修改 `--transition-speed` 变量：
```css
:root {
    --transition-speed: 0.3s; /* 默认 0.2s */
}
```

## 🐛 遇到问题？

1. 检查浏览器控制台是否有错误
2. 确认浏览器版本（需要 Chrome 88+, Safari 14+）
3. 尝试在隐私/无痕模式下打开
4. 清除浏览器缓存和 localStorage

## 🎉 开始探索吧！

现在你已经准备好探索这个移动端 UI 原型了。尽情体验主题切换和各种交互效果！
