# CLI 验收：Message Visibility

- 日期: 2026-05-25
- 审查人: pending

## 场景 1：初始化测试环境

```bash
node apps/cli/dist/index.js project create --name "TestProject" --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
22b67371-bd37-46b9-aa0c-4f0cdd4689f2
```

---

```bash
node apps/cli/dist/index.js session create --title "TestSession" --project 22b67371-bd37-46b9-aa0c-4f0cdd4689f2 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
67b4eb5e-0ad6-43bb-92f6-ae47a27657b7
```

---

```bash
node apps/cli/dist/index.js message append --role user --content "Message 1" --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
e3ecabaf-ce27-43a8-8d62-4b41a78462c6
```

---

```bash
node apps/cli/dist/index.js message append --role assistant --content "Message 2" --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
9683f10f-d806-4c61-a439-5c31cf84102e
```

---

```bash
node apps/cli/dist/index.js message append --role user --content "Message 3" --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
754fcbe5-8ae1-4d1f-b578-2ef4e0664191
```

---

```bash
node apps/cli/dist/index.js message append --role assistant --content "Message 4" --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
89dd3a85-bca9-47c7-9269-2ad122ccdd79
```

备注: 临时数据库路径 C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db

## 场景 2：列出消息（初始状态）

```bash
node apps/cli/dist/index.js message list --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
e3ecabaf-ce27-43a8-8d62-4b41a78462c6    1       user            Message 1
9683f10f-d806-4c61-a439-5c31cf84102e    2       assistant               Message 2
754fcbe5-8ae1-4d1f-b578-2ef4e0664191    3       user            Message 3
89dd3a85-bca9-47c7-9269-2ad122ccdd79    4       assistant               Message 4
```

备注: 所有消息默认可见，无 [H] 标记

## 场景 3：隐藏单个消息

```bash
node apps/cli/dist/index.js message hide --message e3ecabaf-ce27-43a8-8d62-4b41a78462c6 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
(无输出)
```

---

```bash
node apps/cli/dist/index.js message list --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
e3ecabaf-ce27-43a8-8d62-4b41a78462c6    1       user    [H]     Message 1
9683f10f-d806-4c61-a439-5c31cf84102e    2       assistant               Message 2
754fcbe5-8ae1-4d1f-b578-2ef4e0664191    3       user            Message 3
89dd3a85-bca9-47c7-9269-2ad122ccdd79    4       assistant               Message 4
```

备注: Message 1 显示 [H] 标记

## 场景 4：批量隐藏消息（按 seq 范围）

```bash
node apps/cli/dist/index.js message hide --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --from-seq 2 --to-seq 3 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
Hidden 2 message(s)
```

---

```bash
node apps/cli/dist/index.js message list --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
e3ecabaf-ce27-43a8-8d62-4b41a78462c6    1       user    [H]     Message 1
9683f10f-d806-4c61-a439-5c31cf84102e    2       assistant       [H]     Message 2
754fcbe5-8ae1-4d1f-b578-2ef4e0664191    3       user    [H]     Message 3
89dd3a85-bca9-47c7-9269-2ad122ccdd79    4       assistant               Message 4
```

备注: Message 1, 2, 3 都显示 [H] 标记

## 场景 5：显示单个消息

```bash
node apps/cli/dist/index.js message show --message 9683f10f-d806-4c61-a439-5c31cf84102e --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
(无输出)
```

---

```bash
node apps/cli/dist/index.js message list --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
e3ecabaf-ce27-43a8-8d62-4b41a78462c6    1       user    [H]     Message 1
9683f10f-d806-4c61-a439-5c31cf84102e    2       assistant               Message 2
754fcbe5-8ae1-4d1f-b578-2ef4e0664191    3       user    [H]     Message 3
89dd3a85-bca9-47c7-9269-2ad122ccdd79    4       assistant               Message 4
```

备注: Message 2 的 [H] 标记已移除

## 场景 6：批量显示消息（按 seq 范围）

```bash
node apps/cli/dist/index.js message show --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --from-seq 1 --to-seq 4 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
Shown 4 message(s)
```

---

```bash
node apps/cli/dist/index.js message list --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
e3ecabaf-ce27-43a8-8d62-4b41a78462c6    1       user            Message 1
9683f10f-d806-4c61-a439-5c31cf84102e    2       assistant               Message 2
754fcbe5-8ae1-4d1f-b578-2ef4e0664191    3       user            Message 3
89dd3a85-bca9-47c7-9269-2ad122ccdd79    4       assistant               Message 4
```

备注: 所有消息的 [H] 标记已移除

## 场景 7：Prompt 渲染过滤隐藏消息

```bash
node apps/cli/dist/index.js prompt render --path C:\Users\BLOODY~1\AppData\Local\Temp\test-prompt.yaml --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
system: You are a helpful assistant.
user: Message 1
assistant: Message 2
user: Message 3
assistant: Message 4
```

---

```bash
node apps/cli/dist/index.js message hide --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --from-seq 1 --to-seq 2 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
Hidden 2 message(s)
```

---

```bash
node apps/cli/dist/index.js prompt render --path C:\Users\BLOODY~1\AppData\Local\Temp\test-prompt.yaml --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
system: You are a helpful assistant.
user: Message 3
assistant: Message 4
```

备注: Prompt 文件内容:
```yaml
blocks:
  - type: text
    role: system
    name: system
    content: You are a helpful assistant.
  - type: chat
    name: history
```
隐藏的 Message 1 和 Message 2 未出现在渲染结果中

## 场景 8：Fork 保留隐藏状态

```bash
node apps/cli/dist/index.js message fork --session 67b4eb5e-0ad6-43bb-92f6-ae47a27657b7 --up-to 89dd3a85-bca9-47c7-9269-2ad122ccdd79 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
e3f6d6fd-fade-429f-a0c2-8fa2bbcc8c45
```

---

```bash
node apps/cli/dist/index.js message list --session e3f6d6fd-fade-429f-a0c2-8fa2bbcc8c45 --db C:\Users\BLOODY~1\AppData\Local\Temp\nm-test-20260525-235155.db
```

标准输出:
```
5f25ef71-082c-461b-9144-c87d1c6cfe96    1       user    [H]     Message 1
341e1836-a056-4142-af37-ffbe0443bf09    2       assistant       [H]     Message 2
cd203959-f35c-45e4-8c9f-fd5f14a1f206    3       user            Message 3
f6a754e5-4fc6-471f-9d76-3b60aca122ad    4       assistant               Message 4
```

备注: Forked session 保留了原 session 的 hidden 状态（Message 1 和 2 仍然是隐藏的）
