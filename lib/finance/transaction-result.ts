export type CreateTransactionWarning = "cooling_link" | "revalidate";

export type CreateTransactionResult = {
  ok: true;
  transactionId: string;
  warnings?: CreateTransactionWarning[];
};
