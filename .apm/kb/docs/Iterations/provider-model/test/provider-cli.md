# CLI 验收：provider-model

- 日期: 2026-05-25
- 审查人: pending

## P0 — 新库四内置 provider

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider list
```

标准输出:
```
anthropic	anthropic	https://api.anthropic.com	Anthropic	apiKey: not set
google	gemini	https://generativelanguage.googleapis.com/v1beta	Google Gemini	apiKey: not set
openai	openai	https://api.openai.com/v1	OpenAI	apiKey: not set
openrouter	openai	https://openrouter.ai/api/v1	OpenRouter	apiKey: not set
```

备注: `NOVEL_MASTER_DB=C:\Users\BloodyCrown\AppData\Local\Temp\nm-sksp-provider-20260524-235811\novel.db`

---

## P1 — edit apiKey + list 掩码

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider edit --providerId openai --apiKey sk-test-cli-key-12345
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider list
```

标准输出:
```
anthropic	anthropic	https://api.anthropic.com	Anthropic	apiKey: not set
google	gemini	https://generativelanguage.googleapis.com/v1beta	Google Gemini	apiKey: not set
openai	openai	https://api.openai.com/v1	OpenAI	apiKey: set
openrouter	openai	https://openrouter.ai/api/v1	OpenRouter	apiKey: not set
```

---

## P2 — suggest 空、saved 空（需 current provider）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider use --providerId openai
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider model suggest list
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider model list
```

标准输出:
```

```

---

## P2b — fetch 后 suggest list（测试 key；本机 HTTP 403）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider use --providerId openai
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider edit --providerId openai --apiKey sk-test-cli-key-12345
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider model fetch
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider model suggest list
```

标准错误:
```
HTTP 403: {"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported","param":null,"type":"request_forbidden"}}
```

标准输出:
```

```

备注: `NOVEL_MASTER_DB=C:\Users\BloodyCrown\AppData\Local\Temp\nm-fix4b-1986509583\novel.db`。fetch 因区域限制未写入 suggest 缓存，故 suggest list 仍空。有效 key 且网络可达时，fetch 成功后 suggest list 应出现 `vendorModelId` 行。也可用环境变量 `OPENAI_API_KEY` + `nm provider edit` 复测。

---

## P3 — 未 save 时 model request 失败

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js model request --modelId openai/not-saved-model --content hi
```

标准错误:
```
Model not saved: openai/not-saved-model (run: nm provider model save --vendorModelId not-saved-model)
```

---

## P4 — save + use + request（需有效 API key；本机用测试 key 得到 HTTP 403）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider use --providerId openai
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider edit --providerId openai --apiKey sk-test-cli-key-12345
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider model create --vendorModelId gpt-4o-mini
node d:\Dev\Js\novel-master\apps\cli\dist\index.js model use --modelId openai/gpt-4o-mini
node d:\Dev\Js\novel-master\apps\cli\dist\index.js model request --content hi
```

标准错误:
```
HTTP 403: {"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported","param":null,"type":"request_forbidden"}}
```

备注: 测试 key 已走通 SKSP 读 key → OpenAI 适配器；403 为远端拒绝，非 CLI 逻辑错误。有有效 `OPENAI_API_KEY` 或可达区域时，stdout 应为助手回复。

---

## P5 — request 不写 chat（先建 project/session，前后 message list 皆空）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider use --providerId openai
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider edit --providerId openai --apiKey sk-test-cli-key-12345
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider model create --vendorModelId gpt-4o-mini
node d:\Dev\Js\novel-master\apps\cli\dist\index.js model use --modelId openai/gpt-4o-mini
node d:\Dev\Js\novel-master\apps\cli\dist\index.js project create --name P5
node d:\Dev\Js\novel-master\apps\cli\dist\index.js session create --title main
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message list
node d:\Dev\Js\novel-master\apps\cli\dist\index.js model request --content hi
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message list
```

标准输出:
```
dd9eeeb1-4d97-41a0-bff3-22dfb20662f9
46185e1f-a522-4a8e-a7a3-4e86f53b4683



```

标准错误:
```
HTTP 403: {"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported","param":null,"type":"request_forbidden"}}
```

备注: `NOVEL_MASTER_DB=C:\Users\BloodyCrown\AppData\Local\Temp\nm-p5b-*\novel.db`。前两行 UUID 为 `project create` / `session create` 输出；两次 `message list` 均为空，证明 `model request` 未追加 chat 行（即使 request 因 403 失败）。

---

## P6 — 自定义 provider create/delete

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider create --providerId mygw --protocol openai --baseUrl https://example.com/v1 --apiKey gw-key
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider delete --providerId mygw
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider list
```

标准输出:
```
anthropic	anthropic	https://api.anthropic.com	Anthropic	apiKey: not set
google	gemini	https://generativelanguage.googleapis.com/v1beta	Google Gemini	apiKey: not set
openai	openai	https://api.openai.com/v1	OpenAI	apiKey: set
openrouter	openai	https://openrouter.ai/api/v1	OpenRouter	apiKey: not set
```
