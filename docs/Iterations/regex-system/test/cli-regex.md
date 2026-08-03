# CLI 验收：正则（regex-group / regex）

- 日期: 2026-05-30
- 审查人: pending

备注: 工作目录 `C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc`。主库 `novel.db`；C6 `novel-c6.db`；C5 `novel-c5.db`；删除指针 `novel-del.db`；`prompt.yaml` 同目录。命令为已 link 的 `nm`。

## 创建项目与会话

```bash
nm project create --name RegexCliTest --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
11c2e27f-a942-4991-81d1-b6f46067bd61
```

```bash
nm project use --project 11c2e27f-a942-4991-81d1-b6f46067bd61 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```

```

```bash
nm session create --project 11c2e27f-a942-4991-81d1-b6f46067bd61 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
406d819b-5e11-4761-876a-bf4293c0185d
```

```bash
nm session use --session 406d819b-5e11-4761-876a-bf4293c0185d --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```

```

---

## 正则组 CRUD 与当前指针

```bash
nm regex-group create strict-filter --displayName strict-mask --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
strict-filter
```

```bash
nm regex-group use strict-filter --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```

```

```bash
nm regex-group current --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
strict-filter	strict-mask
```

---

## 创建规则（llm + display，user + assistant）

```bash
nm regex create --regexGroup strict-filter --regexId mask-email --name mask-email --pattern "[\w.-]+@[\w.-]+\.[A-Za-z]{2,}" --llmReplace "[redacted]" --displayReplace "***" --minDepth 1 --maxDepth 99 --user --assistant --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
mask-email
```

```bash
nm regex list --regexGroup strict-filter --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
1	mask-email	1	mask-email	[\w.-]+@[\w.-]+\.[A-Za-z]{2,}
```

---

## 追加消息并验证双通道

```bash
nm message append --session 406d819b-5e11-4761-876a-bf4293c0185d --role user --content "contact: mysecret@email.com today" --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
e7b91792-ddc9-4e81-8f95-b9907808c937
```

```bash
nm message list --session 406d819b-5e11-4761-876a-bf4293c0185d --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
e7b91792-ddc9-4e81-8f95-b9907808c937	1	user		contact: *** today
```

```bash
nm prompt render --path C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\prompt.yaml --project 11c2e27f-a942-4991-81d1-b6f46067bd61 --session 406d819b-5e11-4761-876a-bf4293c0185d --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
user: contact: [redacted] today
```

---

## regex test（单规则、分通道）

```bash
nm regex test --regexGroup strict-filter --regexId mask-email --text mysecret@email.com --floor 1 --role user --channel display --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
***
```

```bash
nm regex test --regexGroup strict-filter --regexId mask-email --text mysecret@email.com --floor 1 --role user --channel llm --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```
[redacted]
```

---

## 非法 pattern（应失败，exit 2）

```bash
nm regex create --regexGroup strict-filter --regexId bad --name bad --pattern "[" --minDepth 1 --maxDepth 2 --user --displayReplace x --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```

```

标准错误:
```
Invalid regular expression: Invalid regular expression: /[/: Unterminated character class
```

---

## regex test 缺少 --channel（应失败，exit 2）

```bash
nm regex test --regexGroup strict-filter --regexId mask-email --text hello --floor 1 --role user --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel.db
```

标准输出:
```

```

标准错误:
```
--channel is required: llm or display
```

---

## C6：仅 displayReplace（列表脱敏，prompt 不脱敏）

```bash
nm message list --session 9821be1e-f6f3-4e95-9763-6f26cb48a22a --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel-c6.db
```

标准输出:
```
f222a90e-44b5-4c3e-9358-3bbb3e9cb392	1	user		my***@email.com
```

```bash
nm prompt render --path C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\prompt.yaml --project f971ce20-b19c-4c84-8336-f21e7c7fe954 --session 9821be1e-f6f3-4e95-9763-6f26cb48a22a --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel-c6.db
```

标准输出:
```
user: mysecret@email.com
```

---

## C5：仅 llmReplace（列表不脱敏，prompt 脱敏）

```bash
nm message list --session 74f570e6-2485-4cee-aa59-86884eebf89f --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel-c5.db
```

标准输出:
```
24da052a-0e80-47bc-ba03-58e20f2e17d4	1	user		mysecret word
```

```bash
nm prompt render --path C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\prompt.yaml --project ccc042f7-4859-4895-b04c-5250c3e321bf --session 74f570e6-2485-4cee-aa59-86884eebf89f --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel-c5.db
```

标准输出:
```
user: my[redacted] word
```

---

## 删除当前组后指针清空（exit 2）

```bash
nm regex-group delete g1 --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel-del.db
```

标准输出:
```

```

```bash
nm regex-group current --db C:\Users\BloodyCrown\AppData\Local\Temp\nm-regex-cli-doc\novel-del.db
```

标准输出:
```

```

标准错误:
```
No current regex group (run: nm regex-group use <groupId>)
```
