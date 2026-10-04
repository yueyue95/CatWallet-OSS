export type McpCapabilityStatus = "available" | "planned" | "restricted";

export type McpCapability = {
  appliesTo?: string[];
  confirmationRequired?: boolean;
  idempotencyRequired?: boolean;
  name: string;
  previewRequired?: boolean;
  purpose?: string;
  reversible?: boolean;
  scope?: "installment_group";
  status: McpCapabilityStatus;
  write: boolean;
};

export const CATWALLET_MCP_API_VERSION = "2026-09-21";

const capabilities: McpCapability[] = [
  { name: "get_dashboard_summary", status: "available", write: false },
  { name: "get_safe_to_spend", status: "available", write: false },
  { name: "list_categories", status: "available", write: false },
  { name: "list_payment_accounts", status: "available", write: false },
  {
    appliesTo: ["purchase", "repayment", "refund", "reimbursement", "transfer"],
    name: "list_transactions",
    purpose:
      "Read owner-scoped ledger entries, including linked reimbursements.",
    status: "available",
    write: false,
  },
  { name: "list_installments", status: "available", write: false },
  { name: "get_installment_summary", status: "available", write: false },
  { name: "list_sinking_funds", status: "available", write: false },
  { name: "list_fixed_commitments", status: "available", write: false },
  { name: "list_goals", status: "available", write: false },
  { name: "get_goal", status: "available", write: false },
  { name: "get_monthly_report", status: "available", write: false },
  { name: "list_cooling_items", status: "available", write: false },
  { name: "get_account_balances", status: "available", write: false },
  {
    name: "preview_delete_installment",
    previewRequired: false,
    purpose:
      "Preview blockers and affected occurrences before changing one complete installment group.",
    scope: "installment_group",
    status: "available",
    write: false,
  },
  { name: "preview_transaction_import", status: "available", write: false },
  { name: "preview_account_transfer", status: "available", write: false },
  {
    idempotencyRequired: true,
    name: "create_account_transfer",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_account_transfer",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "delete_account_transfer",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "restore_account_transfer",
    status: "available",
    write: true,
  },
  {
    appliesTo: ["reimbursement"],
    idempotencyRequired: true,
    name: "create_reimbursement",
    purpose:
      "Create an owner-scoped contra-expense receipt linked to an original expense.",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_transaction",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_payment_account",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_payment_account",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "set_opening_balance",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "add_balance_adjustment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "delete_payment_account",
    status: "available",
    write: true,
  },
  {
    appliesTo: ["purchase", "repayment", "refund", "reimbursement"],
    idempotencyRequired: true,
    name: "update_transaction",
    purpose:
      "Edit an owner-scoped ledger entry while preserving its reimbursement linkage and validation.",
    status: "available",
    write: true,
  },
  {
    appliesTo: ["purchase", "repayment", "refund", "reimbursement"],
    idempotencyRequired: true,
    name: "delete_transaction",
    purpose:
      "Soft-delete an owner-scoped ledger entry, including a reimbursement.",
    reversible: true,
    status: "available",
    write: true,
  },
  {
    appliesTo: ["purchase", "repayment", "refund", "reimbursement"],
    idempotencyRequired: true,
    name: "restore_transaction",
    purpose:
      "Restore an owner-scoped soft-deleted ledger entry, including a reimbursement.",
    reversible: true,
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_category",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_category",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "archive_category",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "delete_category",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_fixed_commitment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_fixed_commitment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "disable_fixed_commitment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "record_fixed_commitment_payment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_installment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_installment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "record_installment_payment",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "complete_installment",
    status: "available",
    write: true,
  },
  {
    confirmationRequired: true,
    idempotencyRequired: true,
    name: "delete_installment",
    previewRequired: true,
    purpose:
      "Soft-delete one eligible installment group, its occurrences, and linked posted transactions atomically.",
    reversible: true,
    scope: "installment_group",
    status: "available",
    write: true,
  },
  {
    confirmationRequired: true,
    idempotencyRequired: true,
    name: "restore_installment",
    purpose:
      "Restore one owned soft-deleted installment group, its occurrences, and eligible linked transactions atomically.",
    reversible: true,
    scope: "installment_group",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_goal",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_goal",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "record_goal_fund_entry",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "delete_goal",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_sinking_fund",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_sinking_fund",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "archive_sinking_fund",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "record_sinking_fund_entry",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "create_cooling_item",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "update_cooling_item",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "set_cooling_item_status",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "delete_cooling_item",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "set_monthly_budget",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "set_fun_money_budget",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "clear_monthly_budget",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "clear_fun_money_budget",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "import_transactions",
    status: "available",
    write: true,
  },
  { name: "get_transaction_import_batch", status: "available", write: false },
  {
    idempotencyRequired: true,
    name: "undo_transaction_import",
    status: "available",
    write: true,
  },
  {
    idempotencyRequired: true,
    name: "restore_transaction_import",
    status: "available",
    write: true,
  },
  {
    name: "password_or_auth_mutation",
    status: "restricted",
    write: true,
  },
];

export function getCapabilities() {
  return {
    apiVersion: CATWALLET_MCP_API_VERSION,
    authentication: "request_scoped_oauth_session" as const,
    moneyContract:
      "CatWallet major-unit amount; finance services use precise cents",
    userIdParameterAllowed: false as const,
    writes: capabilities.filter(
      (capability) => capability.write && capability.status === "available",
    ),
    reads: capabilities.filter((capability) => !capability.write),
    restricted: capabilities.filter(
      (capability) => capability.status === "restricted",
    ),
  };
}
