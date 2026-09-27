# CatWallet 生活记账首版

本分支按购买发生月份归属信用卡消费，并在购买月份计入实际支出、从安心可花扣除一次。信用卡账单 outstanding/currentLiability 只用于卡债显示、账单提醒、nextDue 和还款进度，不再参与安心可花计算。真实还款只减少现金付款账户余额与卡债/outstanding，不记收入或新增消费，也不改变安心可花。分期继续只按当月应计金额计入，不提前扣除未来分期。

## 合成验收 fixture

fixture 只在本地 Supabase 中运行，使用隔离用户和随机交易前缀：

| 场景                                                                    | 预期变更                                                                                                                                                                             | 实测结果                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 2026-09-10 信用卡购鞋 RM120；2026-10-01 偿还 RM40；2026-10-02 偿还 RM80 | 9 月实际支出 RM120、银行 RM1,000、卡债 RM120，安心可花仅减 RM120；10 月支出 RM0，银行 RM1,000 → RM960 → RM880、卡债/outstanding RM120 → RM80 → RM0，安心可花在还款前及两次还款后相同 | TDD 回归 PASS；定向 11 文件、114 测试 PASS；本轮未写数据库 |
| 相同还款幂等键重试                                                      | 不新增还款、不重复减少余额                                                                                                                                                           | PASS；数据库唯一约束拒绝重复写入                           |
| 导入 RM12 + RM18 两笔                                                   | 预览合计 RM30；首次建立 2 笔；相同批次重试新增 0 笔；撤销后活动笔数 0；恢复后活动笔数 2                                                                                              | PASS                                                       |
| 余额不足还款                                                            | 返回冲突，银行余额、卡账和 ledger 不做部分写入                                                                                                                                       | PASS                                                       |
| 跨用户查询                                                              | 用户 B 看不到用户 A 的交易、导入批次或影响明细                                                                                                                                       | PASS；RLS 验证通过                                         |

安全可花金额的首版计算明细为：

`预计净收入 + 明确带入结余 - 未支付固定开销 - 本月到期且未预留的承诺 - 月度留用额 - 未预扣日常花费`。

例如 RM4,000 + RM300 - RM600 - RM200 - RM100 - RM500 = RM2,900。信用卡购买已在购买月份作为实际支出扣除一次，账单 outstanding 不属于待扣承诺；已支付固定账、已有预留和实际还款不会再次扣除。资料不完整时页面显示“需要核对”，不把 RM0 当成已核实结果。

## 旧记录与迁移边界

- 迁移只新增导入批次和交易语义字段；既有交易行不复制、不改写，既有 `import_batch_id` 保持为空。
- 新增 `entry_kind` 默认是 `purchase`，因此旧的普通交易继续按原始交易日参与消费统计。
- 应用层仍识别旧的 `invoice_advance:` 加密备注，以免历史还款被当作新消费；无法在 SQL 中解密并可靠回填的历史记录保持待核对，不凭账单月份推断其原始购买日、期初卡债或性质。
- 7 月账单行合计 RM791.63 的原始购买、分期入账或其他结算性质目前没有足够凭据确认，保持 `UNVERIFIED`，不自动改写。

## 验收范围

本次实现覆盖批量导入预览、批次影响、撤销与恢复、重复请求保护、信用卡跨月还款、部分/全额还款、退款语义、安全可花金额保守展示、首页首屏简化、报告导出字段和交易中心快捷入口。报表保留购买月、账单期间和到期日；还款作为账户结算单独标识，不并入消费。

## 首版当前状态

- Dashboard、Reports 和 MCP 月报复用同一 Dashboard 财务 read model；信用卡消费归购买月，账单 outstanding 只保留在卡债/提醒路径。
- 本轮 finance、Dashboard、Reports 和 MCP 定向回归 11 个文件、114 项通过；TypeScript、production build、changed-file ESLint（0 errors）、Prettier 与 `git diff --check` 通过。未运行完整测试、integration/RLS、OAuth/PKCE 或数据库写入验收。
- 本轮无 migration、无数据库结构变更、无 Production 数据/Auth/OAuth 操作；Preview 浏览器验收留待下一轮。
- 7 月账单行合计 RM791.63 仍为 `UNVERIFIED`，未自动改写。

## 2026-09-24 Dashboard 与全局 UI 收口

本轮从已上线的 Production commit `6134aecc0b8da71c7fd3593d312807db6e082d68` 建立独立功能分支 `feat/catwallet-dashboard-ui-v2`。本节记录后续增量；上文的 11 文件、114 项测试及旧状态是历史验收记录。正式 master list 位于 ChatGPT 文件库 `/catwallet/`，本仓库不复制它。

### Dashboard 信息与财务口径

- 首屏依次展示本月安心可花、现金与存款总额、信用卡待还总额、扣除卡债后的净资金、安心可花计入收入／实际支出／月度留用／数据更新时间、下一笔到期提醒及“记一笔”。计算明细保留在可折叠区域；趋势、分类排行和完整交易列表仍在 Reports、Transactions。
- `monthly_budgets.income` 表示用户计划或手动设置的**本月可用收入**。计算安心可花时，若本月存在实际收入交易，则只采用实际收入；若没有实际收入交易，才使用此预算值作为回退，两者绝不相加。该字段不是上月结余或额外带入资金；本轮没有新增独立的结余／带入字段。账户总余额不会自动转作收入或本月可用金额。既未设置预算值、也没有实际收入交易时显示“尚未设置”和“设置本月可用收入”；明确设置为零与未设置不同。只有收入依据明确且资产型账户余额均已跟踪时显示“已核对”，否则提示核对。
- Dashboard、月报和 MCP 共用安心可花计算。月报的 `core.income` 仍表示实际收入交易合计；`core.safeToSpend` 与 Dashboard／MCP 的安心可花值使用同一收入选择规则，预算回退不会伪装成实际收入。
- 现金与存款总额汇总现金、银行、电子钱包等非信用卡账户当前余额；信用卡待还总额汇总信用卡 `currentLiability`；净资金为前两者相减。卡额度和信用卡账户余额不算资产，净资金也不自动带入安心可花。合成聚合 fixture：RM 12,073.02 − RM 3,391.03 = RM 8,681.99。
- 本月实际支出沿用购买发生月口径，信用卡还款仍是结算。`nextDue` 保留项目、金额和日期，并标明“账单提醒，不重复计入本月消费”；信用卡 outstanding 不再次从安心可花扣除。

### 导航与展示

- 桌面侧栏与移动导航保留既有路由，“记一笔”作为主要操作；“更多”按日常规划、账户与规则、查看与系统分组。用户可见的“冷静监狱”统一为“想买清单”，内部路由保持原样。
- 月份选择器和页面布局在窄桌面、平板及手机宽度下不横向溢出；金额统一显示为 `RM 1,234.56`。空状态、未配置、核对中及错误重试分别呈现。
- Reports 保留既有图表与数据结构，仅把交易流量名称改为“储蓄投入”／“本月储蓄投入”，把历史收入减支出名称改为“累计收支结余”；不把交易流量称为真实存款或净资产。MCP 协议未变。

### 本轮修改文件与验证

- Dashboard：`app/dashboard/actions.ts`、`app/dashboard/error.tsx`、`components/dashboard/catwallet-summary.tsx`、`components/dashboard/header.tsx`、`components/dashboard/month-wheel-picker.tsx`。
- 导航：`components/dashboard/sidebar.tsx`、`components/dashboard/mobile-nav.tsx`。
- 计算与文案：`lib/finance/account-balances.ts`、`lib/finance/catwallet.ts`、`lib/i18n.tsx`、`lib/i18n/zh-CN.ts`、`lib/i18n/currency.ts`。
- 回归：`tests/dashboard/catwallet-summary.test.tsx`、`tests/dashboard/cooling-screen.test.tsx`、`tests/dashboard/navigation.test.tsx`、`tests/dashboard/dashboard-error.test.tsx`、`tests/lib/finance/account-balances.test.ts`、`tests/lib/finance/catwallet.test.ts`、`tests/lib/i18n/dashboard-labels.test.ts`；本文档 `docs/life-ledger-v1.md`。
- 定向回归 15 个文件、132 项通过；TypeScript、changed-file ESLint（0 errors）、Prettier、Production build、`git diff --check` 与定向 secret scan 通过。合成页面在 390×844、768×1024、1440×900 三种视口下无横向溢出，菜单键盘 Escape／点击外部关闭正常，检查时未发现 console 或 page error。
- 本轮没有 migration、数据库结构变更或 Production 数据操作；未重新运行完整测试、信用卡生命周期或数据库写入验收。RM791.63 历史记录继续为 `UNVERIFIED`。

### 交付状态

最终功能 commit SHA、自动生成的 Preview deployment ID、不可变 URL 与 READY 状态以本轮交付回报为准：Git commit 无法在自身的文档内容中记录其最终 SHA，Preview ID 也须在推送后才能取得。本分支不合并、不部署 Production；正式 master list 由文件库维护方在收到交付回报后另行更新。
