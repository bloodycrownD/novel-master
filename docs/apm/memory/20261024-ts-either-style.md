---
date: 2026-10-24 18:19
title: TS 支持 Either 风格吗——概念问答
keywords: TypeScript, Either, Result, 判别联合, neverthrow, 函数式错误处理
abstract: 用户问 TS 是否支持 Either 风格、以及 TS 一般偏好什么错误处理风格。结论：语言层没有内置 Either，判别联合 + 类型收窄可完整表达；TS 社区主流是分层混用——可空用 `T | undefined` + `?.`，预期失败用判别联合（Zod safeParse 形态），真异常才 throw；完整 monad 链（andThen 嵌套）在社区反而不常见。
---

user:
ts 支持 either 风格吗？

assistant:
支持，但不是内置的。TypeScript 语言层没有自带 Either/Result，靠两件事补齐：

1. 原生路径是判别联合（discriminated union）：`type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }`，用 `if (r.ok)` 触发类型收窄，switch 加 `never` 可以做穷尽检查。这是 TS 生态里最地道的 Either 形态。
2. 库路径：neverthrow（`andThen` / `mapErr` / `safeTry` 生成器模拟 do-notation）、ts-results（经典 Ok/Err）、Effect（完整的 effect 系统，`Effect.gen` 提供生成器 do 风格）。

短板：没有 Rust `?` 那样的传播语法，嵌套链写起来啰嗦（safeTry/生成器可缓解）；`await` 只解 Promise 不解 Result，异步边界要自己组合；第三方库全部抛异常，边界处得手动包装。因为 TS 的异常不进函数签名，Either 风格正好补上「错误进类型」这一块。

user:
那 ts 一般比较喜欢什么风格？

assistant:
TS 社区主流不是单一 Either，而是按失败性质分层混用：

1. 「可能没有」→ `T | undefined` + 可选链 `?.`、`??`。strictNullChecks 把 null/undefined 纳入类型系统，这就是 TS 的内置 Option，且语法糖只认它们，社区不爱为此再引入 Option 类型。
2. 「预期内、调用方必须处理的失败」（解析/校验/查找）→ 判别联合 `{ ok/success: boolean, ... }`。标杆是 Zod 的 `safeParse` 返回 `{ success: true; data } | { success: false; error }`；fetch 的 `response.ok` 也是同款思想。很多团队自建轻量 Result，neverthrow 只在部分项目用。
3. 「真异常/程序 bug」→ throw Error（抛 Error 对象别抛字符串；catch 到的是 unknown，要收窄再用）。async 里 reject 即 throw，await 模型天然异常向，所以异步代码里 Either 更难推广，常见做法是让错误冒泡到边界统一 catch。

完整 monad 链（andThen 层层嵌套）在社区反而不常见——大家嫌啰嗦，宁可在边界直接 if/else 收窄。

