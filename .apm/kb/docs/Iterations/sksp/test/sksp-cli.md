# CLI 验收：Windows SKSP（provider apiKey）

- 日期: 2026-05-24
- 审查人: pending

## P1a — 写入 apiKey（DPAPI + sksp_secrets）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js provider edit --providerId openai --apiKey sk-test-cli-key-12345
```

标准输出:
```

```

标准错误:(不存在则隐藏)

备注: `NOVEL_MASTER_DB=C:\Users\BloodyCrown\AppData\Local\Temp\nm-sksp-provider-20260524-235811\novel.db`（与 provider-cli 同次会话）

---

## P1b — list 仅显示 set/not set，不泄露 key

```bash
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

## P1c — 库内为密文（非明文 key）

```bash
node -e "const Database=require('better-sqlite3'); const db=new Database(process.env.NOVEL_MASTER_DB); console.log(db.prepare('SELECT ref, length(ciphertext) as clen, algo FROM sksp_secrets').all());"
```

标准输出:
```
[ { ref: 'provider/openai/apiKey', clen: 246, algo: 'dpapi-v1' } ]
```

备注: `clen` 为 DPAPI 密文长度；`algo=dpapi-v1`，`iv` 为 NULL（Windows）
