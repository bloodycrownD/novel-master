---
date: 2026-08-20 00:10
title: skill 引用 UI 打磨与回滚护栏修复（feat/skills-integration 后续轮）
keywords: 引用胶囊, tag 水化, 回滚护栏, S-13, 文档选择器, agent 编辑页, webview 产物链
abstract: feat/skills-integration 交付后的打磨轮：agent 编辑页 UI 统一、文档选择器取消归一封装、@路径/$技能 tag 圆角胶囊（composer 水化恢复 + 气泡渲染）、回滚 S-13 护栏精准化（无文件会话放行）。最大教训：气泡胶囊「隐形」是蓝底撞蓝字的颜色问题而非语法错误，两轮错判后靠日志实锤。
---

user:
agent 配置 mobile 的 UI 几个区不一样，有的有阴影有的没有，帮我统一一下。

assistant:
agent 编辑页混了三种卡片样式。按用户拍板的方向收敛：先拆蓝色小徽章（技能/会话/工作区/文本类型），所有内层区块卡片统一白底+1px 边框+左侧 3px 主题色粗边（c1733b4→1a7441a→0065003）；再把技能/工作区/会话区的开关从卡片内上提到区小标题行，与系统区/常驻区一致（ba5efed）；常驻工作区/技能索引的提示文案拆开关态——开启讲可配置项、关闭讲影响范围，「手动引用 skill 不受影响」（a69aa7b、404f53a）。

user:
"user cancel document picker" 这个报错很常见吧？导入 zip/skill 能不能做个通用封装，报错后出中文 toast？

assistant:
根因是平台差异：iOS 用户取消时 pick() 直接 reject（英文错误冒到 toast），Android 才返回空数组。新建 services/document-pick.ts 统一归一为 null 并弹「已取消」；service 层用不了 hook，抽了零 RN 依赖的 app-toast.ts 桥让 ToastHost 挂载时注册。四个导入入口（zip/角色卡/YAML/数据库备份）全部接入（6995d60）。第一版 service 直接 import 组件把纯 service 测试拖挂——桥必须零 react-native 依赖。

user:
@引用和 $引用的 tag 太素了；另外退出会话再进入，tag 特效会消失变普通文字。

assistant:
水化丢失根因：tag 效果活在组件内部 mention 标记里，草稿只存纯文本，重挂载时完整 token 没被提升回 mention。加 promotePlainMentions() 在初次挂载和水化两条路径全篇提升（72e8b00）。样式上 Android 行内嵌套 Text 不支持圆角背景（系统限制，borderRadius 被忽略），iOS 可以——composer 里按平台区分过又被用户否了（不许擅自降级，revert 00327e0），最终方案 A：气泡内做真胶囊。

user:
气泡里的 tag 怎么还没效果？文字还直接消失了？是不是透明的？

assistant:
两轮误判：先怪 lookbehind 正则炸了老 WebView（Android 12 其实支持，改掉也没用 0940da2）；再发现是 APK 时间差（编译落在资产拷贝前）。最后按纪律埋日志（bridge 协议里本就有 log 通道，两端接上即可），日志实锤渲染链路一直正常（spans 正确切出）——真凶是用户气泡本身蓝底白字，胶囊蓝字蓝底撞色隐形。修复：.row.user .ref-token 反色为白色系（43ea5c7），拆日志。教训：视觉「消失」先查颜色叠加，别急着怪语法。

user:
回滚失败，缺少 baseline 是什么情况？我只是引用了 skill。另外我记得回滚不可禁止的，没有 baseline 也该弹窗让用户选「仅清理消息」吧？

assistant:
根因两层：① checkpoint 只在会话有文件时才写快照，纯引用会话（@文件/$技能一样）零快照，undo_send 撞 S-13 护栏被硬拒；② 护栏错误 UNDO_SEND_EMPTY_TARGET 没归入 isRollbackVfsDegradableError，双端 UI 直接报失败不给降级弹窗（用户记忆的行为是对的，分类器漏了）。修复 f9b28bf：空 targetTree 仅在 live 树非空时才拦（无文件会话删无可删直接放行仅截断）；错误归入可降级，双端弹「仅删除后续对话」。文件引用与 skill 引用在回滚链路上是同一条（都只是 attach 附件，回滚只看 checkpoint 与附件种类无关）；分叉只在提示词 hydrate（文件走读盘+file_cache，技能走 SkillService）。

user:
为什么重复引用 skill 是 alreadyReferenced？我记得文件不是这样，是中文提示。

assistant:
两口径其实一致：中文提示「该文件前文已引用」是旧版文件写法，v1.4.21 起文件也改成了 alreadyReferenced JSON 短标记（PROMPT_FILE_SEEN_SHORT_TIP 只是遗留导出）。skill 是新写的，直接对齐现行口径，差别仅 action 名与键名（userAttach/path vs skillAttach/name）。
