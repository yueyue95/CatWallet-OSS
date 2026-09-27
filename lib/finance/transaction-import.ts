export type TransactionImportRow = {
  amount: number;
  categoryId: string | null;
  date: string;
  description: string;
  idempotencyKey: string;
  notes?: string | null;
  paymentAccountId: string | null;
  type: "expense" | "income" | "saving";
};

export type ExistingTransactionForImport = Omit<
  TransactionImportRow,
  "idempotencyKey"
> & {
  idempotencyKey?: string | null;
};

type TransactionImportPayload = Omit<TransactionImportRow, "idempotencyKey">;

type PreviewAction = "create" | "reject" | "skip";
type PreviewReason =
  | "category_not_found"
  | "duplicate_in_batch"
  | "payment_account_not_found"
  | "possible_duplicate"
  | "row_idempotency_replay"
  | "row_idempotency_conflict"
  | null;

export type TransactionImportPreviewRow = TransactionImportRow & {
  action: PreviewAction;
  reason: PreviewReason;
};

export type TransactionImportPreview = {
  counts: {
    create: number;
    reject: number;
    skip: number;
  };
  impact: {
    byPaymentAccount: Array<{
      count: number;
      paymentAccountId: string | null;
      total: number;
    }>;
    count: number;
    total: number;
  };
  rows: TransactionImportPreviewRow[];
};

export function importDuplicateKey(row: TransactionImportPayload) {
  return JSON.stringify([
    Number(row.amount).toFixed(2),
    row.categoryId,
    row.date,
    row.description.trim(),
    row.paymentAccountId,
    row.type,
  ]);
}

function rowPayloadKey(row: TransactionImportPayload) {
  return JSON.stringify({
    amount: Number(row.amount).toFixed(2),
    categoryId: row.categoryId,
    date: row.date,
    description: row.description.trim(),
    notes: row.notes ?? null,
    paymentAccountId: row.paymentAccountId,
    type: row.type,
  });
}

export function buildTransactionImportPreview(
  inputRows: TransactionImportRow[],
  existingRows: ExistingTransactionForImport[],
  categoryIds: ReadonlySet<string>,
  paymentAccountIds: ReadonlySet<string>,
): TransactionImportPreview {
  const existingKeys = new Set(existingRows.map(importDuplicateKey));
  const existingIdempotencyPayloads = new Map(
    existingRows
      .filter((row) => row.idempotencyKey)
      .map((row) => [row.idempotencyKey!, rowPayloadKey(row)]),
  );
  const seenIdempotencyKeys = new Map<string, string>();
  const rows = inputRows.map((row): TransactionImportPreviewRow => {
    const existingPayload = seenIdempotencyKeys.get(row.idempotencyKey);
    const payload = rowPayloadKey(row);
    seenIdempotencyKeys.set(row.idempotencyKey, payload);

    const persistedPayload = existingIdempotencyPayloads.get(
      row.idempotencyKey,
    );
    if (persistedPayload) {
      return {
        ...row,
        action: persistedPayload === payload ? "skip" : "reject",
        reason:
          persistedPayload === payload
            ? "row_idempotency_replay"
            : "row_idempotency_conflict",
      };
    }

    if (existingPayload && existingPayload !== payload) {
      return {
        ...row,
        action: "reject",
        reason: "row_idempotency_conflict",
      };
    }
    if (row.categoryId && !categoryIds.has(row.categoryId)) {
      return { ...row, action: "reject", reason: "category_not_found" };
    }
    if (row.paymentAccountId && !paymentAccountIds.has(row.paymentAccountId)) {
      return {
        ...row,
        action: "reject",
        reason: "payment_account_not_found",
      };
    }
    if (existingPayload) {
      return { ...row, action: "skip", reason: "duplicate_in_batch" };
    }

    const duplicateKey = importDuplicateKey(row);
    if (existingKeys.has(duplicateKey)) {
      return { ...row, action: "skip", reason: "possible_duplicate" };
    }
    existingKeys.add(duplicateKey);
    return { ...row, action: "create", reason: null };
  });

  const createRows = rows.filter((row) => row.action === "create");
  const byPaymentAccount = new Map<
    string | null,
    { count: number; total: number }
  >();
  for (const row of createRows) {
    const previous = byPaymentAccount.get(row.paymentAccountId) ?? {
      count: 0,
      total: 0,
    };
    previous.count += 1;
    previous.total += Math.abs(Number(row.amount));
    byPaymentAccount.set(row.paymentAccountId, previous);
  }

  return {
    counts: {
      create: createRows.length,
      reject: rows.filter((row) => row.action === "reject").length,
      skip: rows.filter((row) => row.action === "skip").length,
    },
    impact: {
      byPaymentAccount: [...byPaymentAccount.entries()]
        .map(([paymentAccountId, value]) => ({
          count: value.count,
          paymentAccountId,
          total: Number(value.total.toFixed(2)),
        }))
        .sort((left, right) =>
          String(left.paymentAccountId).localeCompare(
            String(right.paymentAccountId),
          ),
        ),
      count: createRows.length,
      total: Number(
        createRows
          .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0)
          .toFixed(2),
      ),
    },
    rows,
  };
}
