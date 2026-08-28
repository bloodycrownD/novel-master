# fetch-tool 迭代升级为 curl（实现记忆）

- 日期：2026-08-29
- 分支：feat/fetch-tool（worktree .woktree/fetch-tool）
- 主题：fetch 工具改名 curl + 完整 HTTP 功能升级（用户拍板"简单搞、参考 curl"）

## 决策记录

- 用户拍板：不做确认门 / 域名白名单 / SSRF 私网拦截（curl 对齐定位，known limitation，已写入 spec 偏离记录）。原 spec §5 的私网拦截建议不采纳。
- 工具注册名 fetch → curl，fetch 名字彻底不存在；文件 fetch-tool.ts → curl-tool.ts。
- 回流正文截断预算 50KB → 256KB（API JSON 响应常见更大）；响应体下载预检 10MB 沿用。

## 实现要点

- 参数 schema（zod v4，record 两参数写法）：method 枚举默认 GET；headers ≤16 条、名称正则 /^[A-Za-z0-9_-]{1,64}$/（防 CRLF 注入）、值禁 \r\n、单条 ≤8KB；body ≤1MB（UTF-8 字节口径）且 GET/HEAD 拒 body（对象级 superRefine）；timeout 整数秒默认 30 上限 120。
- 输出对象新增 method 字段（回显实际方法）；isCurlOutput 守卫不含 method（兼容无 method 的历史形状），formatCurlOutput 缺省 GET，请求行 `curl METHOD url[ → finalUrl]`。
- P1 修复语义保留：AbortController + setTimeout 包住 fetch + text() 整体，超时秒数改由参数驱动（错误文案含实际毫秒），finally clearTimeout。
- content-type：显式 headers 尊重；有 body 且未给时默认 application/json。
- 常量改名：CURL_MAX_BODY_BYTES(256KB) / CURL_MAX_RESPONSE_BYTES(10MB) / CURL_DEFAULT_TIMEOUT_SECONDS / CURL_MAX_TIMEOUT_SECONDS 等；build-tool-result-block 的摘要分支同步用 CURL_MAX_BODY_BYTES（截断摘要 `truncated · 256KB/1.2MB`）。
- agent-tool-catalog 条目与双端三处 hint（desktop AgentEditorView/AgentDefinitionEditorForm、mobile AgentEditorForm）改为 10 个含 curl；注意：原 fetch 迭代只改了 catalog（10 条），三处 hint 在 head f832ae0 仍是 9 个旧清单，本次升级一并补齐为 10 个。
- mobile agent-editor-form-tool-count.test.ts 源码正则锁同步（10 个 + 名单含 curl）。

## 验证口径

- core 全量 test:fast：2188 pass。
- 双端 typecheck：desktop npm run typecheck、mobile npx tsc --noEmit -p tsconfig.build.json 均过。
- 注意 test:fast 传目录需带通配符（test/tool/*.test.ts），传裸目录会按 index.json 解析报 ERR_MODULE_NOT_FOUND，不是真实测试失败。
- packages/core/dist/ 里有旧 fetch-tool.d.ts 构建残留（tsc --build 增量不删旧产物，dist 不入库，无影响）。
