import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Novel Master',
  description: '专注长篇小说创作的 AI Agent 工作台',
  base: '/novel-master/',
  appearance: 'dark',
  head: [['link', { rel: 'icon', type: 'image/webp', href: '/icon.webp' }]],
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '使用指南', link: '/docs/guide/quickstart' },
      { text: '关于', link: '/docs/about' }
    ],
    sidebar: [
      {
        text: '开始',
        items: [
          { text: '快速上手', link: '/docs/guide/quickstart' },
          { text: '连接模型与服务商', link: '/docs/guide/providers' }
        ]
      },
      {
        text: '创作',
        items: [
          { text: '上下文管理', link: '/docs/guide/context' },
          { text: '工作区与文件', link: '/docs/guide/workspace' },
          { text: '智能体', link: '/docs/guide/agents' },
          { text: '技能', link: '/docs/guide/skills' }
        ]
      },
      {
        text: '数据',
        items: [
          { text: '数据管理', link: '/docs/guide/misc' },
          { text: '关于', link: '/docs/about' }
        ]
      }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/bloodycrownD/novel-master' }],
    outline: { level: [2, 3] }
  }
})
