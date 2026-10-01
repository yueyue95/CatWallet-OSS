# CatWallet MCP（Stage 10B）

本目录提供 CatWallet 的正式 MCP 接口。MCP 层只负责输入 schema、认证上下文、调用现有 finance/read model/transaction service 和稳定响应，不重新实现财务计算。

## 启动

先准备当前本地 Supabase 的登录 access token，并通过进程环境变量提供：

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
CATWALLET_MCP_ACCESS_TOKEN=...
```

然后从项目根目录运行：

```text
pnpm mcp:start
```

The stdio entrypoint is a separate server-side Node process. It uses Node's
`react-server` condition so the existing `server-only` marker resolves to its
empty server runtime implementation. The existing finance module's unused
Next navigation import is loaded only on the unauthenticated redirect path;
the MCP process never enters that path after authentication succeeds.

access token 只从进程环境读取，不写入源码、README、日志或 MCP tool 参数。不要把它提交到 Git。当前 local adapter 用该 token 调用 Supabase `auth.getUser`，并把同一个 Bearer token 放在 Supabase 请求上下文中，使数据库 RLS 继续执行。未来生产环境应替换为 remote bearer/OAuth adapter，而不是允许调用方传入 `userId`。

## Local Streamable HTTP contract

Stage 10B 增加了无状态 HTTP endpoint：

```text
POST http://localhost:3000/api/mcp
GET  http://localhost:3000/.well-known/oauth-protected-resource/api/mcp
```

HTTP 请求使用 request-scoped `Authorization: Bearer <Supabase access token>`。
每个请求都会用 Supabase publishable key 验证该 token，并把同一个 token 传给
Supabase client，因此 RLS 仍是数据隔离边界；MCP 参数没有 `userId`，也不使用
service-role key。HTTP handler 不保存 session 或 token。stdio transport 继续保留，
并仍使用独立进程环境变量 `CATWALLET_MCP_ACCESS_TOKEN`。

HTTP contract 默认只允许本机 host/origin，默认请求体上限为 1 MiB。可在本地
`.env.local` 中配置以下非敏感 contract 参数（不要在这里写 token）：

```text
CATWALLET_MCP_RESOURCE_URL=http://localhost:3000/api/mcp
CATWALLET_MCP_AUTHORIZATION_SERVER_URL=http://localhost:56431/auth/v1
CATWALLET_MCP_ALLOWED_HOSTS=localhost,127.0.0.1
CATWALLET_MCP_ALLOWED_ORIGINS=localhost,127.0.0.1
CATWALLET_MCP_BODY_LIMIT_BYTES=1048576
CATWALLET_MCP_TIME_ZONE=Asia/Kuala_Lumpur
```

未携带或无效 Bearer token 的请求返回 HTTP 401，并在 `WWW-Authenticate` 中提供
`resource_metadata` challenge。protected-resource metadata 不包含 secret。当前
local Supabase 可验证 bearer resource-server contract，但还不是面向 ChatGPT 的完整
OAuth authorization server：audience、scope、JWKS/issuer policy、PKCE/client
registration 和公网 HTTPS 互操作留给 Stage 10C。

## Cloud staging contract (Phase 10C)

云端必须使用独立的 Supabase Cloud staging project 和独立的 HTTPS hosting project；
不要把本地 `supabase/config.toml`、LAN URL 或本地 token 带到云端。第一版可使用托管
平台的免费 `.vercel.app` HTTPS URL 与 Supabase Free project，但 Free project 可能因
低活动暂停；需要长期不暂停时，应在创建或升级前确认 Supabase Pro 费用。

云端 server-only environment 至少包括：

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
FIELD_ENCRYPTION_KEY=<server-only-32-byte-key>
CATWALLET_MCP_RESOURCE_URL=https://<staging-host>/api/mcp
CATWALLET_MCP_AUTHORIZATION_SERVER_URL=https://<project-ref>.supabase.co/auth/v1
CATWALLET_MCP_EXPECTED_ISSUER=https://<project-ref>.supabase.co/auth/v1
CATWALLET_MCP_EXPECTED_AUDIENCE=authenticated
CATWALLET_MCP_REQUIRED_SCOPES=openid
CATWALLET_MCP_ALLOWED_HOSTS=<staging-host>
CATWALLET_MCP_ALLOWED_ORIGINS=<staging-host>
CATWALLET_MCP_TIME_ZONE=Asia/Kuala_Lumpur
```

`NEXT_PUBLIC_*` 变量会进入浏览器 bundle，只能放 Supabase URL 和 publishable key；
`FIELD_ENCRYPTION_KEY`、OAuth/issuer policy 和任何未来 server-only credential 只进入
hosting secret configuration。绝不把 service-role key 作为 MCP 用户身份，也不接受
tool 参数中的 `userId`。

Supabase Auth OAuth Server 的 authorization path 应配置为 `/oauth/consent`。本项目的
consent 页面读取 Supabase 返回的 authorization details，只展示 client、scope 和
redirect URI；批准/拒绝均调用 Supabase 官方 OAuth API，并只跳转到 Supabase 返回的
redirect URL。access token 由 Supabase Auth 签发，MCP 每个请求重新验证 issuer、audience、
expiry、scope 与 user subject，再通过 RLS 访问当前用户数据。

部署顺序是：先创建隔离 staging 项目并配置 OAuth client/redirect URI，再只用
`supabase db push` 或等价的 versioned migration 部署 schema，随后部署 Next.js，最后
用合成用户和假财务 fixture 做 cloud acceptance。不要执行 `db reset`，不要迁移真实
数据。ChatGPT 互操作、token expiry/revocation、rate-limit 和 staging RLS acceptance
在资源创建后执行；本地电脑和 Docker 停止不应影响云端运行。

## Stage 9A read-only tools

- `get_dashboard_summary`：可选 `month`，返回现有 dashboard、safe-to-spend 和快乐钱摘要。
- `get_safe_to_spend`：可选 `month`，返回现有 safe-to-spend 结果及其组成项。
- `list_transactions`：可选 `month` 或 `from`/`to`、`type`、`categoryId`、`paymentAccountId`、`limit`、`cursor`；默认最多 50 笔。
- `list_installments`：`status=active|completed|all`，返回进度、月供、剩余金额、退休分配。
- `get_installment_summary`：可选 `month`，返回进行中分期负担和本月/下月结束项目。
- `list_sinking_funds`：`active=true`（默认）只列出启用且未归档对象；`active=false` 列出停用及归档对象，使用 `lifecycleStatus=disabled|archived` 区分，另返回当前金额、月计划、目标和进度。
- `list_fixed_commitments`：可选 `month`；`active=true`（默认）只列出启用且未归档对象，`active=false` 列出停用及归档对象，使用 `lifecycleStatus=disabled|archived` 区分，另返回本月 occurrence、月金额和 `includeInSafeToSpend`。
- `list_goals`：`active=true`（默认）列出当前目标；`active=false` 列出已归档目标。`get_goal` 可按目标 ID 独立回读当前金额及 `lifecycleStatus=active|archived`，两者均限定为当前用户。软删除交易不进入活动列表或报表，其历史仅保留在持久化记录、导入批次与审计中。
- `get_monthly_report`：可选 `month`，直接复用 Stage 8 `getMonthlyReport`。
- `list_cooling_items`：`status=cooling|ready|abandoned|purchased|all`，返回动态状态和冷静截止时间。
- `list_categories`：无参数，返回当前用户可用分类的稳定 UUID、名称、分组、图标和默认标记。
- `list_payment_accounts`：无参数，返回当前用户可用支付账户的稳定 UUID、名称、类型、结账日和还款日，以及 `balanceTrackingEnabled`、`openingBalance`、`openingDate`、现金账户的 `currentBalance` 和信用卡的 `currentLiability`。信用卡不再把购买累计额伪装成现金余额；卡债来自信用卡购买、退款和关联账单还款的只读派生结果。

## 猫猫管家写工具

写工具均调用现有 finance service 或 owner-scoped RPC，不接受
`userId`，也不会猜测或创建 category/payment account。category 和 payment account
必须显式传当前用户自己的 UUID 或 `null`；不需要关联的字段传 `null`。

```text
create_transaction({
  amount: number,                    // 正数，沿用 CatWallet 的 RM major-unit 数值语义
  type: "expense" | "income" | "saving",
  date: "YYYY-MM-DD",
  description: string,
  categoryId: uuid | null,            // 必须显式传入；income 传 null
  paymentAccountId: uuid | null,      // 无关联时显式传 null
  countsTowardFunMoney?: boolean,    // 仅 expense，默认 false
  fixedCommitmentId?: uuid | null,   // 仅当前用户的有效固定承诺
  idempotencyKey: string              // 必填；调用方重试时原样复用
})
```

成功返回：

```text
{
  idempotencyResult: "created" | "replayed",
  transaction: {
    id: uuid,
    amount: number,                   // 正的、沿用现有 service 规范化的 RM 金额
    type: "expense" | "income" | "saving",
    date: "YYYY-MM-DD",
    description: string,
    category: { id: uuid, key: string } | null,
    paymentAccount: { id: uuid, key: string | null } | null,
    countsTowardFunMoney: boolean,
    fixedCommitmentId: uuid | null,
    coolingItemId: uuid | null
  },
  warnings?: string[]
}
```

`idempotencyKey` 会在服务端与认证用户 ID 一起派生为交易幂等 UUID；原始 key
只保存 SHA-256 哈希到 `mcp_mutation_audit`，不会保存 token、密码或 key 原文。
同一用户重复调用会返回 `idempotencyResult: "replayed"`，不同用户的相同 key
互不冲突。固定承诺关联会在当前用户归属验证后写入；冷静物品必须使用单独的购买关联工具。

当前写工具分组如下（所有工具都要求 `idempotencyKey`）：

- 账户：`create_payment_account`、`update_payment_account`、`set_opening_balance`、`add_balance_adjustment`、`delete_payment_account`。
- 交易：`create_transaction`、`update_transaction`、`delete_transaction`（软删除）、`restore_transaction`。
- 导入：`preview_transaction_import`（只读 dry-run）、`import_transactions`（最多 100 行、逐行幂等、单次原子插入）。
- 固定承诺：`create_fixed_commitment`、`update_fixed_commitment`、`disable_fixed_commitment`、`record_fixed_commitment_payment`。
- 分类：`create_category`、`update_category`、`archive_category`、`delete_category`（仅无历史引用时硬删除）。
- 分期：`create_installment`、`update_installment`（单期）、`record_installment_payment`、`complete_installment`。
- 储蓄罐与目标：`create_sinking_fund`、`update_sinking_fund`、`archive_sinking_fund`、`record_sinking_fund_entry`；`create_goal`、`update_goal`、`delete_goal`、`record_goal_fund_entry`。
- 冷静监狱：`create_cooling_item`、`update_cooling_item`、`set_cooling_item_status`、`delete_cooling_item`（仅无购买/放弃动作时删除）。
- 月度设置：`set_monthly_budget`、`clear_monthly_budget`、`set_fun_money_budget`、`clear_fun_money_budget`。

`get_account_balances({ date?: "YYYY-MM-DD" })` 是只读工具：不传日期返回当前现金余额或信用卡当前卡债，传日期返回该日以前的期初、调整和交易组成。它与 Dashboard、账户页面及 `list_payment_accounts` 复用同一账户余额服务。

`import_transactions.rows[].idempotencyKey` 必须是 UUID（MCP schema 声明
`format: "uuid"`），每行使用独立 UUID；`batchIdempotencyKey` 可使用普通非空字符串。
同一批次重试时原样复用批次键和行键，以获得 replay 结果而不重复写入。例如：

```json
{
  "batchIdempotencyKey": "bank-import-2026-09-26",
  "rows": [
    {
      "amount": 12.34,
      "categoryId": null,
      "date": "2026-09-26",
      "description": "Example expense",
      "idempotencyKey": "b7fc2bd2-3c63-4e89-99ef-4495201b41c3",
      "paymentAccountId": null,
      "type": "expense"
    }
  ]
}
```

`create_installment.amount` 是 RM 主单位金额，最多两位小数。`per_installment`
模式表示该金额是每一期的金额；`total` 模式表示分期总额，并且总额至少要为每期
RM0.01（例如 2 期至少 RM0.02）。字段验证错误返回 `INVALID_INPUT` 和字段路径；
拒绝发生在写入之前。

### Wire contracts

The tool arguments are JSON objects. `month` uses `YYYY-MM`; transaction dates use
`YYYY-MM-DD`. No tool accepts `userId`; the server derives it from the verified
authenticated context.

```text
get_dashboard_summary({ month?: string })
get_safe_to_spend({ month?: string })
list_transactions({
  month?: string,
  from?: string,
  to?: string,
  type?: "income" | "expense" | "saving",
  categoryId?: string,
  paymentAccountId?: string,
  limit?: integer,       // 1..100, default 50
  cursor?: string        // decimal offset, default "0"
})
list_installments({ status?: "active" | "completed" | "all" })
get_installment_summary({ month?: string })
list_sinking_funds({ active?: boolean })
list_fixed_commitments({ month?: string, active?: boolean })
get_monthly_report({ month?: string })
list_cooling_items({ status?: "cooling" | "ready" | "abandoned" | "purchased" | "all" })
preview_account_transfer({ sourceAccountId, destinationAccountId, amount, date, description, notes?, id?, expectedRevision? })
create_account_transfer({ sourceAccountId, destinationAccountId, amount, date, description, notes?, idempotencyKey })
update_account_transfer({ id, expectedRevision, sourceAccountId, destinationAccountId, amount, date, description, notes?, idempotencyKey })
delete_account_transfer({ id, expectedRevision, idempotencyKey })
restore_account_transfer({ id, expectedRevision, idempotencyKey })
create_reimbursement({ originalTransactionId, paymentAccountId, amount, date, description, notes?, idempotencyKey })
```

Account transfers are MYR same-currency movements between non-credit accounts.
They atomically maintain both ledger sides and do not count as income or expense.
Reimbursements are contra-expense receipts linked to an original owned expense;
they preserve the gross merchant charge and do not count as ordinary income.
`create_installment.fixedCommitmentId` may identify an equivalent owned fixed
commitment; successful plan creation disables that commitment in the same
transaction so future safe-to-spend reservations are not duplicated.

Successful calls return `{ ok: true, data: <tool-specific read model> }`.
Handler-level failures return `{ ok: false, error: { code, message } }` with one
of the documented error codes. The SDK also rejects malformed tool arguments at
the MCP protocol validation layer before a handler is entered.

Monetary values at the MCP boundary are numeric RM amounts in major units and
are never formatted UI strings. `create_transaction` passes the amount through
the existing CatWallet transaction service, including its existing positive
amount and signed-amount handling; MCP does not introduce a separate cents
contract or an additional rounding rule. The cooling service stores cents
internally, but `list_cooling_items` exposes its normalized major-unit `amount`
field.

所有成功工具都返回 MCP structured content：`{ ok: true, data: ... }`；错误返回 `{ ok: false, error: { code, message } }`，错误 code 固定为 `INVALID_INPUT`、`UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND` 或 `INTERNAL_ERROR`。

## Tool security metadata

HTTP `tools/list` 为每个 tool 同时提供标准顶层 `securitySchemes` 和
`_meta.securitySchemes` 兼容镜像，当前 local contract 的声明为
`[{ "type": "oauth2", "scopes": [] }]`。空 scope 是因为本地 Supabase session
目前没有 MCP-specific scope/audience contract；它不是生产 OAuth 授权声明，完整
scope/audience 设计留给 10C。stdio 不改变现有调用方式。

## 安全边界

所有 read 工具只绑定 read model；每个写工具的协议元数据为
`readOnlyHint=false`、`destructiveHint=false`、`idempotentHint=true`。每次认证 mutation 都写入 owner-scoped、只含非敏感元数据的
`mcp_mutation_audit`；表只允许当前用户 select/insert，不允许 update/delete。

以下能力永远不注册为财务 MCP 写工具：密码/登录方式、Auth 用户、Cookie/token/API key、RLS/数据库权限、Production reset/restore、删除用户或删除全部资料。

## Tests

```text
pnpm mcp:test
```

测试使用官方 MCP TypeScript SDK 的 `Client` 与
`StreamableHTTPClientTransport` 验证 initialize、tools/list、tool call、401
challenge、request-scoped user isolation、目录 UUID 传递、Origin/body limit、
timezone boundary 和现有 stdio/read/write contract。官方 MCP Inspector 可连接
`http://localhost:3000/api/mcp` 做本地人工探测；本阶段不配置公网 ChatGPT 连接。
