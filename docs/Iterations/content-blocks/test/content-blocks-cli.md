# CLI 验收：Content Blocks

- 日期: 2026-05-26
- 审查人: pending

备注: 临时数据库 `C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db`；JSON 样例目录 `C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-json`。CLI 入口 `node d:\Dev\Js\novel-master\apps\cli\dist\index.js`（下文命令均以此为准）。Project `5cccb281-ef85-4290-ab09-b8ea4fe737c0`，Session `988653a6-ee84-423a-883f-01fae2271615`。

## 场景 1：初始化

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js project create --name "BlocksTest" --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
5cccb281-ef85-4290-ab09-b8ea4fe737c0
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js session create --title "BlocksSession" --project 5cccb281-ef85-4290-ab09-b8ea4fe737c0 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
988653a6-ee84-423a-883f-01fae2271615
```

---

## 场景 2：`message append --content`（text block 简写）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role user --content "Hello from text block" --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
19918985-881f-42ca-ae11-8a87cef29bfa
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role assistant --content "Reply as plain text" --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
a457b952-1170-4868-b389-b7643056f332
```

---

## 场景 3：`message list`（可读展示，非 JSON）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message list --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
19918985-881f-42ca-ae11-8a87cef29bfa	1	user		Hello from text block
a457b952-1170-4868-b389-b7643056f332	2	assistant		Reply as plain text
```

---

## 场景 4：`message append --blocks`（tool_use / tool_result / 多类型）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role assistant --blocks C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-json\tool_use.json --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
ef3d406f-98da-439f-be53-e32b595adf20
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role user --blocks C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-json\tool_result.json --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
949a8832-f4ba-4d0f-b6fb-3f68ea002808
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role assistant --blocks C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-json\multi.json --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
7bc49141-6475-4567-a4d7-4ff94b491b05
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message list --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
19918985-881f-42ca-ae11-8a87cef29bfa	1	user		Hello from text block
a457b952-1170-4868-b389-b7643056f332	2	assistant		Reply as plain text
ef3d406f-98da-439f-be53-e32b595adf20	3	assistant		[tool_use] grep (tu_demo)
949a8832-f4ba-4d0f-b6fb-3f68ea002808	4	user		[tool_result] tu_demo: found 3 matches
7bc49141-6475-4567-a4d7-4ff94b491b05	5	assistant		See screenshot⏎[image url=https://example.com/a.png]⏎[thinking] internal reasoning trace
```

备注: `⏎` 为 list 输出中对换行符的替换；`thinking` 在 list 中可见，在 prompt 中默认省略（见场景 6）。

---

## 场景 5：拒绝旧格式 `{ content }`

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role user --blocks C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-json\legacy.json --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
(无)
```

标准错误:
```
Legacy message content shape is not supported; use { blocks: [...] }
```

备注: 退出码 2。

---

## 场景 6：`message hide` + `prompt render`（与 content blocks 组合）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message hide --session 988653a6-ee84-423a-883f-01fae2271615 --from-seq 3 --to-seq 3 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
Hidden 1 message(s)
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message list --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
19918985-881f-42ca-ae11-8a87cef29bfa	1	user		Hello from text block
a457b952-1170-4868-b389-b7643056f332	2	assistant		Reply as plain text
ef3d406f-98da-439f-be53-e32b595adf20	3	assistant	[H]	[tool_use] grep (tu_demo)
949a8832-f4ba-4d0f-b6fb-3f68ea002808	4	user		[tool_result] tu_demo: found 3 matches
7bc49141-6475-4567-a4d7-4ff94b491b05	5	assistant		See screenshot⏎[image url=https://example.com/a.png]⏎[thinking] internal reasoning trace
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message show --session 988653a6-ee84-423a-883f-01fae2271615 --from-seq 3 --to-seq 3 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
Shown 1 message(s)
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js prompt render --path C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-json\prompt.yaml --session 988653a6-ee84-423a-883f-01fae2271615 --project 5cccb281-ef85-4290-ab09-b8ea4fe737c0 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
system: You are helpful.
user: Hello from text block
assistant: Reply as plain text
assistant: [tool_use name=grep id=tu_demo]
user: [tool_result id=tu_demo]
found 3 matches
assistant: See screenshot

[image]
```

备注: prompt 中无 `JSON.stringify` 整包；`thinking` 块未出现；`[image]` 为 image block 占位。隐藏 seq 3 后再 render 时，不含 `tool_use` 行（与 message-visibility 一致）。

---

## 场景 7：`message append --file`

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role user --file C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-json\user-note.txt --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
447aa0f4-9e10-4d6f-9917-2d334fdadd37
```

备注: list 时正文带 UTF-8 BOM 字符 `﻿`（PowerShell `Set-Content -Encoding UTF8` 所致），内容为单 text block。

---

## 场景 8：`nm model request`（未配置模型 / API Key）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js model request --content "ping" --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
(无)
```

标准错误:
```
Missing --modelId <id> (or run: nm model use --modelId <provider>/<vendor>)
```

---

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js model request --content "Say hi" --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
(无)
```

标准错误:
```
Missing --modelId <id> (or run: nm model use --modelId <provider>/<vendor>)
```

备注: 本机测试库内 provider `apiKey: not set`，未执行真实 LLM 调用。配置 `nm model use` + API Key 后可验收 `--session` 落库 assistant blocks。

---

## 场景 9：`--blocks-json`（PowerShell 引号）

```bash
node d:\Dev\Js\novel-master\apps\cli\dist\index.js message append --role user --blocks-json "{\"blocks\":[{\"type\":\"text\",\"text\":\"inline\"}]}" --session 988653a6-ee84-423a-883f-01fae2271615 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-content-blocks-cli-20260526.db
```

标准输出:
```
Invalid JSON in message content
```

备注: Windows PowerShell 下内联 JSON 易被拆参；推荐使用 `--blocks <文件路径>`（场景 4 已验证）。
