# CatWallet 猫猫管家 capability matrix

基准：`3a216f9ff38544ac9b2587b97bd32702e0bea8dd`（独立于旧备份工作区）。

| 领域          | 当前已有能力                                                       | MCP 当前状态                                                    | 验证状态                                  |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| 支付账户/余额 | UI、opening balance、adjustment、余额 read model、RLS              | `list_payment_accounts`、`get_account_balances`；账户 CRUD 工具 | 契约已实现；待 Preview/integration        |
| 交易          | UI/service create/update/delete、历史日期、fun money、固定承诺关联 | create/update/soft-delete/restore；dry-run/import               | 契约已实现；待 Preview/integration        |
| 固定承诺      | UI CRUD、发生月份计算、实际付款 service                            | CRUD、停用、幂等付款                                            | 契约已实现；待 Preview/integration        |
| 分类          | UI CRUD、历史引用保护                                              | create/update/archive；无引用安全硬删除                         | 契约已实现；待 Preview/integration        |
| 分期          | UI 建立/付款/退休 read model                                       | create/update occurrence/record payment/complete                | 契约已实现；分期编辑仍为单期范围          |
| 储蓄罐        | UI/read model；当前金额 service                                    | CRUD/archive/entry ledger                                       | additive ledger migration；待 integration |
| 目标          | UI CRUD、既有 funds RPC                                            | CRUD/entry ledger                                               | additive ledger migration；待 integration |
| 冷静监狱      | UI 新增/放弃/购买关联、动态 ready                                  | create/update/status；空项目删除                                | 契约已实现；待 Preview/integration        |
| 预算/快乐钱   | UI 与现有 finance read model                                       | set/clear monthly and fun-money                                 | 契约已实现；待 Preview/integration        |
| 报告/核对     | Dashboard、safe-to-spend、monthly report、账户余额                 | 只读工具和 `get_capabilities`                                   | 复用服务；待写入后回归                    |
| Auth/安全设置 | OAuth/session/RLS/request-scoped context                           | 永不开放 auth/password/token/RLS 写入                           | 约束已存在                                |

## 当前已注册 MCP 工具

`get_capabilities`、`get_dashboard_summary`、`get_safe_to_spend`、`list_categories`、`list_payment_accounts`、`get_account_balances`、`list_transactions`、`list_installments`、`get_installment_summary`、`list_sinking_funds`、`list_fixed_commitments`、`get_monthly_report`、`list_cooling_items`、`create_installment`、`update_installment`、`record_installment_payment`、`complete_installment`、`create_transaction`、`create_payment_account`、`update_payment_account`、`set_opening_balance`、`add_balance_adjustment`、`delete_payment_account`、`update_transaction`、`delete_transaction`、`restore_transaction`、`create_category`、`update_category`、`archive_category`、`delete_category`、`create_fixed_commitment`、`update_fixed_commitment`、`disable_fixed_commitment`、`record_fixed_commitment_payment`、`create_goal`、`update_goal`、`record_goal_fund_entry`、`delete_goal`、`create_sinking_fund`、`update_sinking_fund`、`archive_sinking_fund`、`record_sinking_fund_entry`、`create_cooling_item`、`update_cooling_item`、`set_cooling_item_status`、`delete_cooling_item`、`set_monthly_budget`、`clear_monthly_budget`、`clear_fun_money_budget`、`set_fun_money_budget`、`preview_transaction_import`、`import_transactions`。

## 统一写入规则

- 身份只取 request-scoped OAuth/session context；工具参数不接受 `userId`。
- 所有对象 ID 在当前用户上下文下重新查询；不存在时返回统一 `NOT_FOUND`，不泄露其他用户记录。
- 金额沿用 CatWallet 的 major-unit API contract，service 内继续使用 cents/decimal-safe 计算。
- 每个 mutation 都要求 `idempotencyKey`；同一用户同 key + 同 payload 重放不重复写入，同 key + 不同 payload 返回稳定冲突错误。
- 需要跨表关联时使用数据库事务/RPC；单表操作不得由客户端伪造所有者字段。
- 删除优先 soft delete/archive；硬删除只允许明确无引用且由服务端重新检查。
- audit 只存 user、tool/action、entity、时间、hash、成功/失败，不存 token、密码、原始 key 或完整财务敏感文本。

## 验收状态

当前分支尚未部署本项目 Preview，也未写入 Production 或正式账号。

截至本地验证：

- 非 integration suite：73 个测试文件、785 passed、17 skipped。
- MCP、迁移契约与交易 CRUD 定向回归：177 passed。
- local Supabase 财务 integration：6/6；只使用合成用户并由测试 harness 清理。
- TypeScript：通过。
- changed-file lint：0 errors；44 warnings，均为既有复杂度/函数规模规则。
- staged secret/file scan：通过；未包含 env、加密包、数据库 dump 或财务数据。
- Production build：本机 Node/Next 构建在 Turbopack 的进程绑定限制处失败；父基线同样复现，尚未取得 Preview/Vercel 验证。
- 完整 suite 的 password-reset integration 仍受本地 verify origin 配置影响，未将其计入 Butler 通过项。

下一步必须在可用 pnpm hook 与 Preview 构建环境中完成提交、Preview 合成用户全生命周期验收，再考虑 Production；本分支当前没有任何 Cloud 或正式账号写入。

## 2026-09-23 life-ledger parent/feature 差异验收

父提交 `265597f838f417e3789189e0035087b97a6ebb88` 与功能提交
`f1a930d17deda4b910922c256b1664a7e4640d7f` 使用相同 Node `v24.20.0`、
pnpm `v11.22.0`、单 worker 命令
`pnpm test -- --maxWorkers=1 --no-file-parallelism`，并分别在各自完整
migration 状态下使用同一组本地 Supabase 环境变量运行。

| 分支    | 测试文件 | 通过 | 失败 | skipped 文件 / 测试 |
| ------- | -------: | ---: | ---: | ------------------: |
| parent  |       82 |   75 |    2 |              6 / 22 |
| feature |       85 |   78 |    2 |              6 / 22 |

两边失败完全相同：`tests/integration/password-reset-pkce.test.ts` 的两个
测试，在 `tests/integration/password-reset-pkce.test.ts:251` 和 `:369`
都期望 `/auth/update-password`，实际收到 `/`。堆栈、测试名称和 expected/actual
一致；单 worker 运行没有 feature-only timeout、Unhandled Error 或新增失败。
功能分支多出的三个测试文件均为本次新增并实际执行。该 password-reset 结果归类为
既有本地 verify-origin 限制，不是 life-ledger 回归；生活记账代码可进入 Preview
验收，但必须先完成数据环境隔离。

Dashboard 固定开销 fixture 的输入是：实际收入 RM5,000、月度预算收入 RM5,000
（安心可花只采用实际收入，不重复相加）、普通消费 RM500、月租 RM1,000、
sinking fund 月目标 RM200、monthly budget savings limit RM300、到期承诺 RM0。
支付前日常未预扣 RM500，支付后总消费从 RM500
变成 RM1,500，但固定支付 RM1,000 被排除，因此日常未预扣仍为 RM500；两种状态
的 safe-to-spend 都是 RM3,000。另有独立 RM3,000 收入/RM1,000 房租 fixture，
支付前后均为 RM2,000。

Preview 隔离核查发现：Vercel `cat-wallet` 的
`NEXT_PUBLIC_SUPABASE_URL`、`FIELD_ENCRYPTION_KEY` 和 Auth/MCP 配置记录同时
绑定 `Production, Preview`。变量值未读取，但这表示 Preview 没有独立的 Supabase
project/environment 绑定；在创建独立 Preview Supabase project 或等效隔离环境前，
不得部署 Preview、运行 Preview migration 或执行合成账号验收。
