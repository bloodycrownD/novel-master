# SqlTemplateParser PRD

## 背景

`@novel-master/core` 需要一套与 MyBatis 动态 SQL 语法相近的**通用**模板解析能力：开发者编写带 `<if>`、`<where>` 等标签的 SQL 模板字符串，运行时传入参数对象，得到可交给数据库驱动的 SQL 与参数列表。首期不连接数据库、不在 CLI 暴露，仅作为 core 库基础能力。

示例输入形态（示意）：

```sql
SELECT * FROM user WHERE 1=1
<if test="name != null and name != ''">
  AND name = #{name}
</if>
```

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 动态 SQL 拼装 | 根据参数对象求值条件表达式，输出最终 SQL 文本与分离的参数列表（PreparedStatement 风格） |
| 安全占位 | `#{name}` 进入参数列表；`${name}` 做字符串替换（调用方承担注入风险） |
| 可维护 | 五种常用标签行为清晰；未知动态标签**报错** |
| 可验证 | **成功指标**：`if` / `where` / `foreach` / `trim` / `choose`（含 `when` / `otherwise`）及占位符、表达式的主要分支有单元测试，CI 通过 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| core / 上层模块开发者 | 在业务或数据访问层定义动态 SQL 模板，避免手写大量字符串拼接 |
| 维护者 | 通过类型化错误与测试用例定位模板语法或表达式问题 |

典型流程：准备模板字符串 → 传入 `params` 对象 → 调用解析 API → 获得 `{ sql, parameters }` → 交给具体 DB 驱动执行（本期不在 core 内执行）。

## 范围

### 包含范围

- **输入**：单段 SQL 模板字符串（可含静态 SQL 与 XML 风格动态标签，大小写按 MyBatis 惯例处理标签名）
- **动态标签（首期）**：
  - `<if test="...">...</if>`
  - `<where>...</where>`
  - `<foreach collection="..." item="..." index="..." open="..." close="..." separator="...">...</foreach>`
  - `<trim prefix="..." prefixOverrides="..." suffix="..." suffixOverrides="...">...</trim>`
  - `<choose>` / `<when test="...">` / `<otherwise>`
- **条件表达式**：对传入参数对象求值的 **JavaScript 子集**（属性访问、`==` / `!=` / 比较、逻辑运算、`null` / `undefined` 判断等，具体支持范围在实现说明中列出，PRD 不展开技术方案）
- **占位符**：
  - `#{name}`：预编译占位，值进入 `parameters` 列表，SQL 中对应 `?` 或驱动约定占位
  - `${name}`：直接替换为字符串形式（文档需提示 SQL 注入风险）
- **输出**：`sql`（最终字符串）+ `parameters`（有序参数数组或具名结构，以实现阶段 API 设计为准，须满足「分离绑定」语义）
- **错误**：语法错误、未知标签、表达式求值失败等抛出**带位置信息**的**可区分错误类型**（如片段偏移、标签名）
- **交付位置**：`packages/core`（`@novel-master/core`）导出公共 API

### 不包含范围

- 不执行 SQL、不连接数据库、不封装具体驱动
- 不支持 `<sql>` 片段定义与 `<include refid="...">` 引用
- 不支持 `<bind>`、`<set>` 标签（后续迭代）
- 不在 `apps/cli` 暴露命令
- 不做模板解析结果缓存（若后续需要单独立项）
- 不承诺与 MyBatis/OGNL **完全**一致；以本 PRD 验收标准与测试用例为准

## 核心需求（6 条）

1. **解析入口**：提供 `SqlTemplateParser`（或等价命名）类/函数，接受模板字符串与参数对象，返回 `{ sql, parameters }`。
2. **`<if>`**：`test` 为 JS 子集表达式，为真时保留标签体内 SQL（含嵌套标签），为假时移除该段。
3. **`<where>`**：仅当内部动态内容非空时输出 `WHERE`，并正确处理首部多余 `AND` / `OR`（行为与 MyBatis `where` 标签一致，以验收用例为准）。
4. **`<foreach>`**：按 `collection` 遍历（数组或可迭代对象），支持 `item` / `index` / `open` / `close` / `separator`；体内可使用 `#{item}`、`${item}` 等。
5. **`<trim>` / `<choose>`**：支持前缀后缀裁剪与多分支择一；`choose` 仅第一个为真的 `when` 生效，否则 `otherwise`。
6. **占位与错误**：`#{...}` 与 `${...}` 行为符合上文；遇到无法识别的动态标签名时**失败**并抛出带位置的类型化错误。

## 验收标准

### 解析结果

- **Given** 模板仅含静态 SQL、无标签  
  **When** 传入任意 `params`  
  **Then** 返回的 `sql` 与输入静态部分一致（空白规范化若有，须在测试中固定约定），`parameters` 为空数组。

- **Given** 模板含 `AND col = #{col}` 且 `params.col = 10`  
  **When** 解析  
  **Then** `sql` 含预编译占位（如 `?`），`parameters` 按出现顺序包含 `10`。

- **Given** 模板含 `ORDER BY ${orderBy}` 且 `params.orderBy = 'id DESC'`  
  **When** 解析  
  **Then** `sql` 中直接出现 `id DESC`，且**不**将 `${orderBy}` 的值放入 `parameters` 列表。

### `<if>`

- **Given** `<if test="enabled">AND status = 1</if>` 且 `params.enabled` 为 truthy  
  **When** 解析  
  **Then** 输出含 `AND status = 1`。

- **Given** 同上且 `params.enabled` 为 falsy  
  **When** 解析  
  **Then** 输出不含 `AND status = 1`。

- **Given** `test` 表达式引用不存在的属性且按 JS 子集规则为 falsy/抛错  
  **When** 解析  
  **Then** 行为与测试用例文档一致（抛错或视为 falsy，须在测试中统一一种策略）。

### `<where>`

- **Given** `<where><if test="id">AND id = #{id}</if></where>` 且 `params.id` 有值  
  **When** 解析  
  **Then** `sql` 含 `WHERE id = ?`（或等价），无重复 `WHERE`，无多余前导 `AND`。

- **Given** 所有内部 `<if>` 均为假  
  **When** 解析  
  **Then** 不输出 `WHERE` 关键字。

### `<foreach>`

- **Given** `ids` 为 `[1,2,3]`，模板 `WHERE id IN <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>`  
  **When** 解析  
  **Then** `sql` 形如 `WHERE id IN (?,?,?)`，`parameters` 为 `[1,2,3]`。

- **Given** `ids` 为空数组  
  **When** 解析  
  **Then** 行为与 MyBatis 常见实践一致（测试用例锁定：如生成 `WHERE id IN ()` 或省略该段，须在测试中明确）。

### `<trim>` / `<choose>`

- **Given** `trim` 的 `prefixOverrides` 含 `AND` 且体内以 `AND col = 1` 开头  
  **When** 解析  
  **Then** 输出按 `prefix` / `suffix` 规则裁剪后的 SQL（用例覆盖）。

- **Given** `<choose>` 含两个 `when`，仅第二个 `test` 为真  
  **When** 解析  
  **Then** 仅输出第二个 `when` 体内 SQL。

- **Given** 所有 `when` 为假且存在 `<otherwise>`  
  **When** 解析  
  **Then** 输出 `otherwise` 体内 SQL。

### 错误处理

- **Given** 模板含 `<unknown>...</unknown>`  
  **When** 解析  
  **Then** 抛出类型化错误，且错误信息包含可定位信息（如偏移或标签名）。

- **Given** 标签未闭合或 `test` 表达式语法非法  
  **When** 解析  
  **Then** 抛出类型化错误，不返回部分结果。

### 质量门禁

- 上述标签与占位符、表达式的主要分支均有单元测试；仓库 `npm run test`（或 core 包 test 脚本）通过。

---

**文档路径**：`.apm/kb/docs/Iterations/SqlTemplateParser/prd.md`  
**范围边界**：本文档仅描述产品需求与验收标准，不包含解析器实现方案、AST 设计、接口签名细节或任务拆分。
