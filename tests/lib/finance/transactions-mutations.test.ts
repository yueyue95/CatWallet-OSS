import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/crypto/field-encryption", () => ({
  decryptDescription: (value: string | null | undefined) => value ?? null,
  decryptField: (value: string | null | undefined) => value ?? null,
  encryptDescription: (value: string) => value,
  encryptField: (value: string | null | undefined) => value ?? null,
  isAlreadyEncrypted: () => false,
}));

import { createClient } from "@/lib/supabase/server";
import {
  advanceInstallments,
  createAccountTransferWithResult,
  createInvoiceAdvancePayment,
  createReimbursementWithResult,
  createTransaction,
  deleteInstallment,
  deleteAccountTransfer,
  deleteInstallments,
  deleteTransaction,
  previewDeleteInstallment,
  previewAccountTransfer,
  previewInstallmentCommitmentConversion,
  restoreInstallment,
  restoreAccountTransfer,
  restoreTransaction,
  previewInstallmentPrepayment,
  updateTransaction,
  updateAccountTransfer,
} from "@/lib/finance/transactions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const PAYMENT_METHOD_ID = "33333333-3333-4333-8333-333333333333";
const DESTINATION_PAYMENT_METHOD_ID = "44444444-4444-4444-8444-444444444444";
const TRANSACTION_ID = "88888888-8888-4888-8888-888888888888";
const INSTALLMENT_ANCHOR_ID = "99999999-9999-4999-9999-999999999999";
const LAST_INSTALLMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVOICE_CREDIT_CARD_ID = "77777777-7777-4777-8777-777777777777";

// Same chainable fake query builder pattern as transactions-crud.test.ts, with
// optional onInsert/onUpdate hooks so we can assert on the exact payload sent
// to Supabase for the multi-row installment insert path.
function qb(
  response: { data?: unknown; error?: unknown },
  hooks: {
    onInsert?: (rows: unknown) => void;
    onUpdate?: (payload: unknown) => void;
  } = {},
) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    delete: chain,
    eq: chain,
    gt: chain,
    gte: chain,
    in: chain,
    insert: (rows: unknown) => {
      hooks.onInsert?.(rows);
      return builder;
    },
    is: chain,
    like: chain,
    limit: chain,
    lte: chain,
    maybeSingle: chain,
    neq: chain,
    not: chain,
    order: chain,
    range: chain,
    select: chain,
    single: chain,
    update: (payload: unknown) => {
      hooks.onUpdate?.(payload);
      return builder;
    },
    then: (
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve(response).then(resolve, reject),
  });
  return builder;
}

function makeSupabase(
  fromResponses: unknown[],
  opts: { createdAt?: string | null } = {},
) {
  const queue = [...fromResponses];
  return {
    auth: {
      getClaims: vi
        .fn()
        .mockResolvedValue({ data: { claims: { sub: USER_ID } } }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID, created_at: opts.createdAt ?? null } },
      }),
    },
    from: vi.fn(() => {
      if (!queue.length) {
        throw new Error("No more mocked supabase.from() responses queued");
      }
      return queue.shift();
    }),
    rpc: vi.fn(),
  };
}

function setup(
  fromResponses: unknown[] = [],
  opts: { createdAt?: string | null } = {},
) {
  const supabase = makeSupabase(fromResponses, opts);
  vi.mocked(createClient).mockResolvedValue(supabase as never);
  return supabase;
}

function setupInstallmentRpc() {
  const supabase = setup([
    qb({ data: { id: CATEGORY_ID }, error: null }),
    qb({ data: { id: PAYMENT_METHOD_ID }, error: null }),
  ]);
  supabase.rpc.mockResolvedValue({
    data: [
      {
        created_plan_id: INSTALLMENT_ANCHOR_ID,
        created_transaction_id: TRANSACTION_ID,
        replayed: false,
      },
    ],
    error: null,
  });
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTransaction", () => {
  const validInput = {
    type: "expense" as const,
    date: "2030-01-15",
    amount: 100,
    category: "none",
    paymentMethod: "none",
    installmentCount: 1,
    description: "Groceries",
  };

  it("uses the request id as the inserted primary key and returns it", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })]);
    await expect(
      createTransaction({ ...validInput, idempotencyKey: TRANSACTION_ID }),
    ).resolves.toBe(TRANSACTION_ID);
    expect(Array.isArray(captured) && (captured[0] as { id: string }).id).toBe(
      TRANSACTION_ID,
    );
  });

  it("stores the fun money flag only on expense rows", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })]);
    await createTransaction({
      ...validInput,
      countsTowardFunMoney: true,
    });
    expect(
      (captured as Array<{ counts_toward_fun_money: boolean }>)[0],
    ).toEqual(expect.objectContaining({ counts_toward_fun_money: true }));

    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })]);
    await createTransaction({
      ...validInput,
      type: "income",
      countsTowardFunMoney: true,
    });
    expect(
      (captured as Array<{ counts_toward_fun_money: boolean }>)[0],
    ).toEqual(expect.objectContaining({ counts_toward_fun_money: false }));
  });

  it("confirms an owned committed request instead of inserting a duplicate on retry", async () => {
    setup([
      qb({ error: { code: "23505", message: "duplicate key" } }),
      qb({ data: { id: TRANSACTION_ID }, error: null }),
    ]);
    await expect(
      createTransaction({ ...validInput, idempotencyKey: TRANSACTION_ID }),
    ).resolves.toBe(TRANSACTION_ID);
  });

  it("does not treat a conflicting id owned by someone else as success", async () => {
    setup([
      qb({ error: { code: "23505", message: "duplicate key" } }),
      qb({ data: null, error: null }),
    ]);
    await expect(
      createTransaction({ ...validInput, idempotencyKey: TRANSACTION_ID }),
    ).rejects.toThrow("Unable to save transaction");
  });

  it("throws for an empty description", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, description: "  " }),
    ).rejects.toThrow("Description is required.");
  });

  it("throws for a too-long description", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, description: "a".repeat(161) }),
    ).rejects.toThrow("Description is too long.");
  });

  it("throws for a too-long notes field", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, notes: "a".repeat(501) }),
    ).rejects.toThrow("Text field is too long.");
  });

  it("throws for a non-positive amount", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, amount: 0 }),
    ).rejects.toThrow("Amount must be greater than zero.");
  });

  it("throws for an invalid transaction type", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, type: "bogus" as never }),
    ).rejects.toThrow("Transaction type is invalid.");
  });

  it("throws for an invalid category id", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, category: "not-a-uuid" }),
    ).rejects.toThrow("Category is invalid.");
  });

  it("throws for an invalid payment method id", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, paymentMethod: "not-a-uuid" }),
    ).rejects.toThrow("Payment method is invalid.");
  });

  it("throws for an invalid date", async () => {
    setup([]);
    await expect(
      createTransaction({ ...validInput, date: "not-a-date" }),
    ).rejects.toThrow("Transaction date is invalid.");
  });

  it("throws when the category does not belong to the user", async () => {
    setup([qb({ data: null, error: null })]);
    await expect(
      createTransaction({ ...validInput, category: CATEGORY_ID }),
    ).rejects.toThrow("Category is invalid.");
  });

  it("throws when the payment method does not belong to the user", async () => {
    setup([qb({ data: null, error: null })]);
    await expect(
      createTransaction({ ...validInput, paymentMethod: PAYMENT_METHOD_ID }),
    ).rejects.toThrow("Payment method is invalid.");
  });

  it("throws when validating the category errors", async () => {
    setup([qb({ data: null, error: { message: "category boom" } })]);
    await expect(
      createTransaction({ ...validInput, category: CATEGORY_ID }),
    ).rejects.toThrow("Unable to validate category: category boom");
  });

  it("throws when validating the payment method errors", async () => {
    setup([qb({ data: null, error: { message: "pm boom" } })]);
    await expect(
      createTransaction({ ...validInput, paymentMethod: PAYMENT_METHOD_ID }),
    ).rejects.toThrow("Unable to validate payment method: pm boom");
  });

  it.each([
    ["a non-integer", 2.5],
    ["below 1", 0],
    ["above 120", 121],
  ])(
    "throws for an installment count that is %s",
    async (_label, installmentCount) => {
      setup([]);
      await expect(
        createTransaction({ ...validInput, installmentCount }),
      ).rejects.toThrow("Installment count is invalid.");
    },
  );

  it("converts a dd/MM/yyyy date to ISO before saving", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })]);
    await expect(
      createTransaction({ ...validInput, date: "15/01/2030" }),
    ).resolves.toEqual(expect.any(String));
    expect(
      Array.isArray(captured) && (captured[0] as { date: string }).date,
    ).toBe("2030-01-15");
  });

  it("creates a single income transaction (category forced null)", async () => {
    const supabase = setup([qb({ error: null })]);
    await expect(
      createTransaction({ ...validInput, type: "income" }),
    ).resolves.toEqual(expect.any(String));
    expect(supabase.from).toHaveBeenCalledWith("transactions");
  });

  it("trims and stores a non-empty notes field", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })]);
    await expect(
      createTransaction({ ...validInput, notes: "  Buy milk  " }),
    ).resolves.toEqual(expect.any(String));
    expect(
      Array.isArray(captured) && (captured[0] as { notes: string }).notes,
    ).toBe("Buy milk");
  });

  it("creates a single saving transaction even with installmentCount > 1", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })]);
    await expect(
      createTransaction({
        ...validInput,
        type: "saving",
        installmentCount: 5,
      }),
    ).resolves.toEqual(expect.any(String));
    expect(Array.isArray(captured) && captured.length).toBe(1);
  });

  it("creates an installment plan through one atomic RPC", async () => {
    const supabase = setupInstallmentRpc();
    await expect(
      createTransaction({
        ...validInput,
        type: "expense",
        amount: 300,
        category: CATEGORY_ID,
        currentInstallment: 2,
        idempotencyKey: TRANSACTION_ID,
        installmentCount: 3,
        paymentMethod: PAYMENT_METHOD_ID,
      }),
    ).resolves.toBe(TRANSACTION_ID);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_installment_plan",
      expect.objectContaining({
        p_current_installment: 2,
        p_idempotency_key: TRANSACTION_ID,
        p_occurrences: [
          expect.objectContaining({ installmentNumber: 2, status: "posted" }),
          expect.objectContaining({ installmentNumber: 3, status: "planned" }),
        ],
      }),
    );
  });

  it("passes one idempotency key to the installment RPC", async () => {
    const supabase = setupInstallmentRpc();
    await createTransaction({
      ...validInput,
      amount: 0.01,
      category: CATEGORY_ID,
      currentInstallment: 1,
      date: "2030-01-15",
      idempotencyKey: TRANSACTION_ID,
      installmentAmountMode: "per_installment",
      installmentCount: 2,
      paymentMethod: PAYMENT_METHOD_ID,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_installment_plan",
      expect.objectContaining({
        p_idempotency_key: TRANSACTION_ID,
        p_transaction_id: TRANSACTION_ID,
      }),
    );
  });

  it("creates the total amount mode with cent-safe planned occurrences", async () => {
    const supabase = setupInstallmentRpc();
    await createTransaction({
      ...validInput,
      amount: 1,
      category: CATEGORY_ID,
      currentInstallment: 1,
      date: "2030-01-15",
      idempotencyKey: TRANSACTION_ID,
      installmentAmountMode: "total",
      installmentCount: 2,
      paymentMethod: PAYMENT_METHOD_ID,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_installment_plan",
      expect.objectContaining({
        p_amount_mode: "total",
        p_occurrences: [
          expect.objectContaining({ amount: 0.5, status: "posted" }),
          expect.objectContaining({ amount: 0.5, status: "planned" }),
        ],
      }),
    );
  });

  it("rejects a total installment amount that cannot fund every row before writing", async () => {
    const supabase = setup([]);

    await expect(
      createTransaction({
        ...validInput,
        amount: 0.01,
        idempotencyKey: TRANSACTION_ID,
        installmentAmountMode: "total",
        installmentCount: 2,
      }),
    ).rejects.toThrow("Amount is below the minimum per installment.");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("throws when the insert fails", async () => {
    setup([qb({ error: { message: "insert failed" } })]);
    await expect(createTransaction(validInput)).rejects.toThrow(
      "Unable to save transaction: insert failed",
    );
  });

  it("does not filter any occurrence when the user's created_at is unparseable", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })], {
      createdAt: "not-a-real-date",
    });
    await expect(createTransaction(validInput)).resolves.toEqual(
      expect.any(String),
    );
    expect(Array.isArray(captured) && captured.length).toBe(1);
  });

  it("creates a historical expense before the user creation month", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })], {
      createdAt: "2030-03-01T00:00:00.000Z",
    });
    await expect(
      createTransaction({ ...validInput, date: "2030-01-15" }),
    ).resolves.toEqual(expect.any(String));
    expect((captured as Array<{ date: string }>)[0].date).toBe("2030-01-15");
  });

  it("does not backfill installment occurrences before the current one", async () => {
    const supabase = setupInstallmentRpc();
    await expect(
      createTransaction({
        ...validInput,
        type: "expense",
        amount: 300,
        category: CATEGORY_ID,
        currentInstallment: 2,
        idempotencyKey: TRANSACTION_ID,
        installmentCount: 3,
        date: "2030-01-15",
        paymentMethod: PAYMENT_METHOD_ID,
      }),
    ).resolves.toBe(TRANSACTION_ID);
    const args = supabase.rpc.mock.calls[0][1] as {
      p_occurrences: Array<{ installmentNumber: number }>;
    };
    expect(args.p_occurrences.map((row) => row.installmentNumber)).toEqual([
      2, 3,
    ]);
  });

  it("creates a historical income before the user creation month", async () => {
    let captured: unknown;
    setup([qb({ error: null }, { onInsert: (rows) => (captured = rows) })], {
      createdAt: "2030-03-01T00:00:00.000Z",
    });
    await expect(
      createTransaction({
        ...validInput,
        date: "2030-01-15",
        type: "income",
      }),
    ).resolves.toEqual(expect.any(String));
    expect((captured as Array<{ date: string; kind: string }>)[0]).toEqual(
      expect.objectContaining({ date: "2030-01-15", kind: "income" }),
    );
  });
});

describe("createReimbursementWithResult", () => {
  it("delegates an encrypted reimbursement to the atomic owner-scoped RPC", async () => {
    const supabase = setup([
      qb({ data: { id: PAYMENT_METHOD_ID }, error: null }),
    ]);
    supabase.rpc.mockResolvedValue({
      data: [{ created_transaction_id: TRANSACTION_ID, replayed: false }],
      error: null,
    });

    await expect(
      createReimbursementWithResult({
        amount: 11.2,
        date: "2030-01-15",
        description: "Synthetic reimbursement",
        idempotencyKey: TRANSACTION_ID,
        originalTransactionId: INSTALLMENT_ANCHOR_ID,
        paymentMethod: PAYMENT_METHOD_ID,
      }),
    ).resolves.toEqual({ replayed: false, transactionId: TRANSACTION_ID });
    expect(supabase.rpc).toHaveBeenCalledWith("create_reimbursement", {
      p_amount: 11.2,
      p_date: "2030-01-15",
      p_description: "Synthetic reimbursement",
      p_idempotency_key: TRANSACTION_ID,
      p_notes: null,
      p_original_transaction_id: INSTALLMENT_ANCHOR_ID,
      p_payment_method_id: PAYMENT_METHOD_ID,
      p_transaction_id: TRANSACTION_ID,
    });
  });
});

describe("account transfer lifecycle", () => {
  const input = {
    amount: 150,
    date: "2030-01-15",
    description: "Synthetic account transfer",
    destinationAccountId: DESTINATION_PAYMENT_METHOD_ID,
    idempotencyKey: TRANSACTION_ID,
    sourceAccountId: PAYMENT_METHOD_ID,
  };

  it("delegates creation to the atomic owner-scoped RPC", async () => {
    const supabase = setup();
    supabase.rpc.mockResolvedValue({
      data: [
        {
          created_transfer_id: TRANSACTION_ID,
          current_revision: 1,
          replayed: false,
        },
      ],
      error: null,
    });

    await expect(createAccountTransferWithResult(input)).resolves.toEqual({
      replayed: false,
      revision: 1,
      transferId: TRANSACTION_ID,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("create_account_transfer", {
      p_amount: 150,
      p_description: "Synthetic account transfer",
      p_destination_account_id: DESTINATION_PAYMENT_METHOD_ID,
      p_idempotency_key: TRANSACTION_ID,
      p_notes: null,
      p_source_account_id: PAYMENT_METHOD_ID,
      p_transfer_date: "2030-01-15",
      p_transfer_id: TRANSACTION_ID,
    });
  });

  it("previews, updates, deletes, and restores with a revision guard", async () => {
    const supabase = setup();
    supabase.rpc
      .mockResolvedValueOnce({
        data: {
          blockers: [],
          canApply: true,
          currentRevision: 1,
          transferDate: "2030-01-15",
          transferId: TRANSACTION_ID,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: 3, error: null })
      .mockResolvedValueOnce({ data: 4, error: null });

    await expect(
      previewAccountTransfer({
        ...input,
        expectedRevision: 1,
        id: TRANSACTION_ID,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ canApply: true, currentRevision: 1 }),
    );
    await expect(
      updateAccountTransfer({
        ...input,
        expectedRevision: 1,
        id: TRANSACTION_ID,
      }),
    ).resolves.toBe(2);
    await expect(deleteAccountTransfer(TRANSACTION_ID, 2)).resolves.toBe(3);
    await expect(restoreAccountTransfer(TRANSACTION_ID, 3)).resolves.toBe(4);
    expect(supabase.rpc).toHaveBeenNthCalledWith(3, "delete_account_transfer", {
      p_expected_revision: 2,
      p_transfer_id: TRANSACTION_ID,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      4,
      "restore_account_transfer",
      { p_expected_revision: 3, p_transfer_id: TRANSACTION_ID },
    );
  });
});

describe("installment group lifecycle", () => {
  it("previews blockers through the owner-scoped RPC", async () => {
    const supabase = setup();
    supabase.rpc.mockResolvedValue({
      data: {
        blockers: ["active_plan"],
        canDelete: false,
        occurrenceCount: 2,
        planId: INSTALLMENT_ANCHOR_ID,
      },
      error: null,
    });

    await expect(
      previewDeleteInstallment(INSTALLMENT_ANCHOR_ID),
    ).resolves.toEqual({
      blockers: ["active_plan"],
      canDelete: false,
      occurrenceCount: 2,
      planId: INSTALLMENT_ANCHOR_ID,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("preview_delete_installment", {
      p_plan_id: INSTALLMENT_ANCHOR_ID,
    });
  });

  it("uses dedicated group delete and restore RPCs", async () => {
    const supabase = setup();
    supabase.rpc.mockResolvedValue({
      data: INSTALLMENT_ANCHOR_ID,
      error: null,
    });

    await deleteInstallment(INSTALLMENT_ANCHOR_ID);
    await restoreInstallment(INSTALLMENT_ANCHOR_ID);
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "delete_installment", {
      p_plan_id: INSTALLMENT_ANCHOR_ID,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "restore_installment", {
      p_plan_id: INSTALLMENT_ANCHOR_ID,
    });
  });
});

describe("installment commitment conversion", () => {
  it("previews the exact monthly commitment mapping through the invoker RPC", async () => {
    const supabase = setup();
    supabase.rpc.mockResolvedValue({
      data: {
        blockers: [],
        canConvert: true,
        fixedCommitmentId: INSTALLMENT_ANCHOR_ID,
      },
      error: null,
    });

    await expect(
      previewInstallmentCommitmentConversion({
        categoryId: CATEGORY_ID,
        currentOccurrenceDate: "2030-01-15",
        fixedCommitmentId: INSTALLMENT_ANCHOR_ID,
        installmentAmount: 137,
        paymentMethodId: PAYMENT_METHOD_ID,
      }),
    ).resolves.toEqual({
      blockers: [],
      canConvert: true,
      fixedCommitmentId: INSTALLMENT_ANCHOR_ID,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "preview_installment_commitment_conversion",
      {
        p_category_id: CATEGORY_ID,
        p_current_occurrence_date: "2030-01-15",
        p_fixed_commitment_id: INSTALLMENT_ANCHOR_ID,
        p_installment_amount: 137,
        p_payment_method_id: PAYMENT_METHOD_ID,
      },
    );
  });
});

describe("createInvoiceAdvancePayment", () => {
  const invoiceMonth = "2030-08";
  const invoiceId = `credit-card-invoice:${INVOICE_CREDIT_CARD_ID}:${invoiceMonth}`;
  const validInput = {
    amount: 150,
    date: "2030-08-05",
    invoiceId,
    paymentMethod: "none",
  };
  const purchaseRow = {
    id: "purchase-1",
    amount: 200,
    date: "2030-07-15",
    description: "Purchase",
    kind: "expense" as const,
    notes: null,
    categories: null,
    category_id: null,
    payment_method_id: INVOICE_CREDIT_CARD_ID,
    payment_methods: {
      id: INVOICE_CREDIT_CARD_ID,
      name: "Nubank",
      type: "credit" as const,
      closing_day: 3,
      due_day: 10,
      credit_limit: 1000,
    },
  };

  it("throws for a non-positive amount", async () => {
    setup([]);
    await expect(
      createInvoiceAdvancePayment({ ...validInput, amount: 0 }),
    ).rejects.toThrow("Amount must be greater than zero.");
  });

  it("throws for an invalid date", async () => {
    setup([]);
    await expect(
      createInvoiceAdvancePayment({ ...validInput, date: "not-a-date" }),
    ).rejects.toThrow("Transaction date is invalid.");
  });

  it("throws when the date is before the user's creation month", async () => {
    setup([], { createdAt: "2030-09-01T00:00:00.000Z" });
    await expect(
      createInvoiceAdvancePayment({ ...validInput, date: "2030-01-01" }),
    ).rejects.toThrow(
      "Transaction date cannot be earlier than the user creation month.",
    );
  });

  it("throws for an invalid invoice id format", async () => {
    setup([]);
    await expect(
      createInvoiceAdvancePayment({ ...validInput, invoiceId: "bad-invoice" }),
    ).rejects.toThrow("Invoice is invalid.");
  });

  it("throws when validating the invoice payment method errors", async () => {
    setup([qb({ data: null, error: { message: "pm lookup boom" } })]);
    await expect(createInvoiceAdvancePayment(validInput)).rejects.toThrow(
      "Unable to validate invoice: pm lookup boom",
    );
  });

  it("throws when the invoice payment method is missing", async () => {
    setup([qb({ data: null, error: null })]);
    await expect(createInvoiceAdvancePayment(validInput)).rejects.toThrow(
      "Invoice is invalid.",
    );
  });

  it("throws when the invoice payment method is not a credit card", async () => {
    setup([
      qb({ data: { id: INVOICE_CREDIT_CARD_ID, type: "debit" }, error: null }),
    ]);
    await expect(createInvoiceAdvancePayment(validInput)).rejects.toThrow(
      "Invoice is invalid.",
    );
  });

  it("throws when the invoice is not found", async () => {
    setup([
      qb({ data: { id: INVOICE_CREDIT_CARD_ID, type: "credit" }, error: null }),
      qb({ data: [], error: null }),
      qb({ data: [], error: null }),
      qb({ data: [], error: null }),
      qb({ data: null, error: null }),
    ]);
    await expect(createInvoiceAdvancePayment(validInput)).rejects.toThrow(
      "Invoice is already paid or unavailable.",
    );
  });

  it("replays a full repayment after the invoice is already closed", async () => {
    setup([
      qb({ data: { id: INVOICE_CREDIT_CARD_ID, type: "credit" }, error: null }),
      qb({ data: [], error: null }),
      qb({ data: [], error: null }),
      qb({ data: [], error: null }),
      qb({ data: { id: "repayment-1" }, error: null }),
    ]);

    await expect(
      createInvoiceAdvancePayment(validInput),
    ).resolves.toBeUndefined();
  });

  it("throws when the amount exceeds the remaining invoice", async () => {
    setup([
      qb({ data: { id: INVOICE_CREDIT_CARD_ID, type: "credit" }, error: null }),
      qb({ data: [purchaseRow], error: null }),
      qb({ data: [], error: null }),
      qb({ data: [], error: null }),
    ]);
    await expect(
      createInvoiceAdvancePayment({ ...validInput, amount: 300 }),
    ).rejects.toThrow("Advance payment cannot exceed the remaining invoice.");
  });

  it("creates the advance payment on success", async () => {
    const supabase = setup([
      qb({ data: { id: INVOICE_CREDIT_CARD_ID, type: "credit" }, error: null }),
      qb({ data: [purchaseRow], error: null }),
      qb({ data: [], error: null }),
      qb({ data: [], error: null }),
      qb({ error: null }),
    ]);
    await expect(
      createInvoiceAdvancePayment(validInput),
    ).resolves.toBeUndefined();
    expect(supabase.from).toHaveBeenCalledWith("transactions");
  });

  it("throws when the insert fails", async () => {
    setup([
      qb({ data: { id: INVOICE_CREDIT_CARD_ID, type: "credit" }, error: null }),
      qb({ data: [purchaseRow], error: null }),
      qb({ data: [], error: null }),
      qb({ data: [], error: null }),
      qb({ error: { message: "insert failed" } }),
    ]);
    await expect(createInvoiceAdvancePayment(validInput)).rejects.toThrow(
      "Unable to save invoice advance payment: insert failed",
    );
  });
});

describe("updateTransaction", () => {
  const validInput = {
    id: TRANSACTION_ID,
    type: "expense" as const,
    date: "2030-01-15",
    amount: 100,
    category: "none",
    paymentMethod: "none",
    description: "Groceries",
  };

  it("throws for an invalid id", async () => {
    setup([]);
    await expect(
      updateTransaction({ ...validInput, id: "bad-id" }),
    ).rejects.toThrow("Transaction is invalid.");
  });

  it("throws for an empty description", async () => {
    setup([]);
    await expect(
      updateTransaction({ ...validInput, description: "" }),
    ).rejects.toThrow("Description is required.");
  });

  it("throws for a non-positive amount", async () => {
    setup([]);
    await expect(
      updateTransaction({ ...validInput, amount: 0 }),
    ).rejects.toThrow("Amount must be greater than zero.");
  });

  it("throws for an invalid date", async () => {
    setup([]);
    await expect(
      updateTransaction({ ...validInput, date: "not-a-date" }),
    ).rejects.toThrow("Transaction date is invalid.");
  });

  it("updates a transaction to a date before the user's creation month", async () => {
    setup([qb({ error: null })], { createdAt: "2030-06-01T00:00:00.000Z" });
    await expect(
      updateTransaction({ ...validInput, date: "2030-01-01" }),
    ).resolves.toBeUndefined();
  });

  it("throws for an invalid transaction type", async () => {
    setup([]);
    await expect(
      updateTransaction({ ...validInput, type: "bogus" as never }),
    ).rejects.toThrow("Transaction type is invalid.");
  });

  it("throws when the category does not belong to the user", async () => {
    setup([qb({ data: null, error: null })]);
    await expect(
      updateTransaction({ ...validInput, category: CATEGORY_ID }),
    ).rejects.toThrow("Category is invalid.");
  });

  it("throws when the payment method does not belong to the user", async () => {
    setup([qb({ data: null, error: null })]);
    await expect(
      updateTransaction({ ...validInput, paymentMethod: PAYMENT_METHOD_ID }),
    ).rejects.toThrow("Payment method is invalid.");
  });

  it("updates a transaction with type income (category forced null)", async () => {
    const supabase = setup([qb({ error: null })]);
    await expect(
      updateTransaction({ ...validInput, type: "income" }),
    ).resolves.toBeUndefined();
    expect(supabase.from).toHaveBeenCalledWith("transactions");
  });

  it("updates a transaction with a real category and payment method", async () => {
    let capturedPayload: unknown;
    setup([
      qb({ data: { id: CATEGORY_ID }, error: null }),
      qb({ data: { id: PAYMENT_METHOD_ID }, error: null }),
      qb(
        { error: null },
        { onUpdate: (payload) => (capturedPayload = payload) },
      ),
    ]);
    await expect(
      updateTransaction({
        ...validInput,
        category: CATEGORY_ID,
        paymentMethod: PAYMENT_METHOD_ID,
        notes: "  some note  ",
      }),
    ).resolves.toBeUndefined();
    expect((capturedPayload as { notes: string }).notes).toBe("some note");
  });

  it("updates the fun money flag and clears it when the type is not expense", async () => {
    let capturedPayload: unknown;
    setup([
      qb(
        { error: null },
        { onUpdate: (payload) => (capturedPayload = payload) },
      ),
    ]);
    await updateTransaction({
      ...validInput,
      countsTowardFunMoney: true,
    });
    expect(capturedPayload).toEqual(
      expect.objectContaining({ counts_toward_fun_money: true }),
    );

    setup([
      qb(
        { error: null },
        { onUpdate: (payload) => (capturedPayload = payload) },
      ),
    ]);
    await updateTransaction({
      ...validInput,
      countsTowardFunMoney: true,
      type: "saving",
    });
    expect(capturedPayload).toEqual(
      expect.objectContaining({ counts_toward_fun_money: false }),
    );
  });

  it("throws when the update fails", async () => {
    setup([qb({ error: { message: "update failed" } })]);
    await expect(updateTransaction(validInput)).rejects.toThrow(
      "Unable to update transaction: update failed",
    );
  });
});

describe("deleteTransaction", () => {
  it("throws for an invalid id", async () => {
    setup([]);
    await expect(deleteTransaction("bad-id")).rejects.toThrow(
      "Transaction is invalid.",
    );
  });

  it("retains the row and toggles its soft-delete state idempotently", async () => {
    let deletedAt: string | null = null;
    let writes = 0;
    let physicalDeletes = 0;
    const rows = () => [{ id: TRANSACTION_ID, deleted_at: deletedAt }];
    const client = {
      from: vi.fn(() => {
        let operation: "read" | "update" = "read";
        let payload: { deleted_at: string | null } | null = null;
        let onlyActive = false;
        let onlyDeleted = false;
        const query = {
          delete: vi.fn(() => {
            physicalDeletes++;
            return query;
          }),
          eq: vi.fn(() => query),
          is: vi.fn(() => {
            onlyActive = true;
            return query;
          }),
          not: vi.fn(() => {
            onlyDeleted = true;
            return query;
          }),
          select: vi.fn(() => query),
          update: vi.fn((value: { deleted_at: string | null }) => {
            operation = "update";
            payload = value;
            return query;
          }),
          maybeSingle: vi.fn(async () => {
            if (operation === "update") {
              if (
                (onlyActive && deletedAt !== null) ||
                (onlyDeleted && deletedAt === null)
              ) {
                return { data: null, error: null };
              }
              deletedAt = payload?.deleted_at ?? null;
              writes++;
            }
            return { data: rows()[0], error: null };
          }),
        };
        return query;
      }),
    };
    const context = { supabase: client, userId: USER_ID } as never;

    await deleteTransaction(TRANSACTION_ID, context);
    expect(rows()).toHaveLength(1);
    expect(deletedAt).toEqual(expect.any(String));
    expect(physicalDeletes).toBe(0);
    await deleteTransaction(TRANSACTION_ID, context);
    expect(writes).toBe(1);
    await restoreTransaction(TRANSACTION_ID, context);
    expect(rows()[0].deleted_at).toBeNull();
    await restoreTransaction(TRANSACTION_ID, context);
    expect(writes).toBe(2);
    expect(physicalDeletes).toBe(0);
  });
});

const GROUP_ID = "grp-installments-1";
const installmentGroupRows = [
  {
    id: "inst-1",
    amount: 100,
    date: "2030-01-01",
    description: "Purchase (1/4)",
    kind: "expense" as const,
    notes: "1/4",
    categories: null,
    category_id: null,
    payment_method_id: null,
    payment_methods: null,
    installment_group_id: GROUP_ID,
    installment_number: 1,
    installment_total: 4,
  },
  {
    id: INSTALLMENT_ANCHOR_ID,
    amount: 100,
    date: "2030-02-01",
    description: "Purchase (2/4)",
    kind: "expense" as const,
    notes: "2/4",
    categories: null,
    category_id: null,
    payment_method_id: null,
    payment_methods: null,
    installment_group_id: GROUP_ID,
    installment_number: 2,
    installment_total: 4,
  },
  {
    id: "inst-3",
    amount: 100,
    date: "2030-03-01",
    description: "Purchase (3/4)",
    kind: "expense" as const,
    notes: "3/4",
    categories: null,
    category_id: null,
    payment_method_id: null,
    payment_methods: null,
    installment_group_id: GROUP_ID,
    installment_number: 3,
    installment_total: 4,
  },
  {
    id: LAST_INSTALLMENT_ID,
    amount: 100,
    date: "2030-04-01",
    description: "Purchase (4/4)",
    kind: "expense" as const,
    notes: "4/4",
    categories: null,
    category_id: null,
    payment_method_id: null,
    payment_methods: null,
    installment_group_id: GROUP_ID,
    installment_number: 4,
    installment_total: 4,
  },
];
const anchorRow = installmentGroupRows[1];
const lastInstallmentRow = installmentGroupRows[3];
const nonInstallmentRow = {
  ...anchorRow,
  installment_group_id: null,
  installment_number: null,
  installment_total: null,
};

describe("deleteInstallments", () => {
  it("throws for an invalid transaction id", async () => {
    setup([]);
    await expect(
      deleteInstallments({ scope: "all", transactionId: "bad-id" }),
    ).rejects.toThrow("Transaction is invalid.");
  });

  it("delegates to deleteTransaction for scope 'single'", async () => {
    setup([
      qb({ data: { id: INSTALLMENT_ANCHOR_ID }, error: null }),
      qb({
        data: { id: INSTALLMENT_ANCHOR_ID, deleted_at: "2030-01-01" },
        error: null,
      }),
    ]);
    await expect(
      deleteInstallments({
        scope: "single",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when loading the selected transaction errors", async () => {
    setup([qb({ data: null, error: { message: "boom" } })]);
    await expect(
      deleteInstallments({
        scope: "all",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Unable to load transaction: boom");
  });

  it("throws when the selected transaction is not found", async () => {
    setup([qb({ data: null, error: null })]);
    await expect(
      deleteInstallments({
        scope: "all",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Transaction not found.");
  });

  it("delegates to deleteTransaction when the transaction is not an installment", async () => {
    setup([
      qb({ data: nonInstallmentRow, error: null }),
      qb({ data: { id: INSTALLMENT_ANCHOR_ID }, error: null }),
      qb({
        data: { id: INSTALLMENT_ANCHOR_ID, deleted_at: "2030-01-01" },
        error: null,
      }),
    ]);
    await expect(
      deleteInstallments({
        scope: "all",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when loading the installment group errors", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: null, error: { message: "group failed" } }),
    ]);
    await expect(
      deleteInstallments({
        scope: "all",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Unable to load installments: group failed");
  });

  it("resolves without deleting when no installments are selected", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: null, error: null }),
    ]);
    await expect(
      deleteInstallments({
        scope: "all",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("deletes this and following installments on success", async () => {
    const supabase = setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
      qb({ error: null }),
    ]);
    await expect(
      deleteInstallments({
        scope: "this_and_following",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
    expect(supabase.from).toHaveBeenCalledWith("transactions");
  });

  it("deletes all installments on success", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
      qb({ error: null }),
    ]);
    await expect(
      deleteInstallments({
        scope: "all",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when the delete fails", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
      qb({ error: { message: "delete failed" } }),
    ]);
    await expect(
      deleteInstallments({
        scope: "all",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Unable to delete installments: delete failed");
  });
});

describe("advanceInstallments", () => {
  it("throws for an invalid transaction id", async () => {
    setup([]);
    await expect(
      advanceInstallments({ targetMonth: "2030-01", transactionId: "bad-id" }),
    ).rejects.toThrow("Transaction is invalid.");
  });

  it("throws for an invalid target month", async () => {
    setup([]);
    await expect(
      advanceInstallments({
        targetMonth: "bad-month",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Target month is invalid.");
  });

  it("throws when loading the selected transaction errors", async () => {
    setup([qb({ data: null, error: { message: "boom" } })]);
    await expect(
      advanceInstallments({
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Unable to load transaction: boom");
  });

  it("throws when the selected transaction is not found", async () => {
    setup([qb({ data: null, error: null })]);
    await expect(
      advanceInstallments({
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Transaction not found.");
  });

  it("throws when the transaction is not an installment", async () => {
    setup([qb({ data: nonInstallmentRow, error: null })]);
    await expect(
      advanceInstallments({
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Transaction is not an installment.");
  });

  it("throws when there are no remaining future installments", async () => {
    setup([
      qb({ data: lastInstallmentRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
    ]);
    await expect(
      advanceInstallments({
        targetMonth: "2030-04",
        transactionId: LAST_INSTALLMENT_ID,
      }),
    ).rejects.toThrow("No remaining future installments to advance.");
  });

  it("advances every remaining installment by default", async () => {
    const supabase = setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
      qb({ error: null }),
    ]);
    await expect(
      advanceInstallments({
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
    expect(supabase.from).toHaveBeenCalledWith("transactions");
  });

  it("advances only the requested count of installments", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
      qb({ error: null }),
    ]);
    await expect(
      advanceInstallments({
        count: 1,
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("advances installments including the selected one for scope 'selected_and_remaining'", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
      qb({ error: null }),
    ]);
    await expect(
      advanceInstallments({
        scope: "selected_and_remaining",
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when the advance update fails", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
      qb({ error: { message: "advance failed" } }),
    ]);
    await expect(
      advanceInstallments({
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Unable to advance installments: advance failed");
  });
});

describe("previewInstallmentPrepayment", () => {
  it("throws for an invalid transaction id", async () => {
    setup([]);
    await expect(
      previewInstallmentPrepayment({
        targetMonth: "2030-01",
        transactionId: "bad-id",
      }),
    ).rejects.toThrow("Transaction is invalid.");
  });

  it("throws for an invalid target month", async () => {
    setup([]);
    await expect(
      previewInstallmentPrepayment({
        targetMonth: "bad-month",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Target month is invalid.");
  });

  it("throws when the transaction is not an installment", async () => {
    setup([qb({ data: nonInstallmentRow, error: null })]);
    await expect(
      previewInstallmentPrepayment({
        targetMonth: "2030-01",
        transactionId: INSTALLMENT_ANCHOR_ID,
      }),
    ).rejects.toThrow("Transaction is not an installment.");
  });

  it("returns an empty preview when there are no remaining installments", async () => {
    setup([
      qb({ data: lastInstallmentRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
    ]);
    await expect(
      previewInstallmentPrepayment({
        targetMonth: "2030-04",
        transactionId: LAST_INSTALLMENT_ID,
      }),
    ).resolves.toEqual({
      count: 0,
      installments: [],
      targetMonth: "2030-04",
      totalAmount: 0,
    });
  });

  it("returns a preview of the remaining installments", async () => {
    setup([
      qb({ data: anchorRow, error: null }),
      qb({ data: installmentGroupRows, error: null }),
    ]);
    const preview = await previewInstallmentPrepayment({
      targetMonth: "2030-01",
      transactionId: INSTALLMENT_ANCHOR_ID,
    });
    expect(preview.count).toBe(2);
    expect(preview.totalAmount).toBe(200);
    expect(preview.targetMonth).toBe("2030-01");
    expect(preview.installments.map((installment) => installment.id)).toEqual([
      "inst-3",
      LAST_INSTALLMENT_ID,
    ]);
  });
});
