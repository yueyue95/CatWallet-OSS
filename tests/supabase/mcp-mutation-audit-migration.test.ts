import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/20260918153755_m_20260917150000_mcp_mutation_audit.sql";

describe("MCP mutation audit migration", () => {
  it("defines an owner-scoped append-only audit table without credential fields", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/create table public\.mcp_mutation_audit/i);
    expect(sql).toMatch(/user_id uuid not null references auth\.users/i);
    expect(sql).toMatch(/idempotency_key_hash text not null/i);
    expect(sql).toMatch(/request_fingerprint text not null/i);
    expect(sql).toMatch(
      /alter table public\.mcp_mutation_audit enable row level security/i,
    );
    expect(sql).toMatch(/force row level security/i);
    expect(sql).toMatch(/auth\.uid\(\) = user_id/i);
    expect(sql).toMatch(
      /grant insert, select on table public\.mcp_mutation_audit to authenticated/i,
    );
    expect(sql).not.toMatch(
      /access_token|refresh_token|password|service_role/i,
    );
  });

  it("expands the audit contract without weakening owner isolation", () => {
    const sql = readFileSync(
      "supabase/migrations/20260921110000_mcp_butler_mutation_contract.sql",
      "utf8",
    );

    expect(sql).toMatch(/begin\s*;/i);
    expect(sql).toMatch(/commit\s*;/i);
    expect(sql).toMatch(/create table public\.mcp_mutation_idempotency/i);
    expect(sql).toMatch(/payload_hash text not null/i);
    expect(sql).toMatch(/status text not null/i);
    expect(sql).toMatch(/result_entity_id uuid/i);
    expect(sql).toMatch(
      /unique\s*\(\s*user_id\s*,\s*tool_name\s*,\s*idempotency_key_hash\s*\)/i,
    );
    expect(sql).toMatch(/mcp_mutation_audit_tool_name_check_new/i);
    expect(sql).toMatch(
      /validate constraint mcp_mutation_audit_tool_name_check_new/i,
    );
    expect(sql).toMatch(
      /drop constraint mcp_mutation_audit_tool_name_check\s*;/i,
    );
    expect(sql).toMatch(
      /rename constraint mcp_mutation_audit_tool_name_check_new/i,
    );
    expect(sql).toMatch(/mcp_mutation_audit_action_check_new/i);
    expect(sql).toMatch(
      /validate constraint mcp_mutation_audit_action_check_new/i,
    );
    expect(sql).toMatch(/drop constraint mcp_mutation_audit_action_check\s*;/i);
    expect(sql).toMatch(
      /rename constraint mcp_mutation_audit_action_check_new/i,
    );
    expect(sql).toMatch(/tool_name.*\^\[a-z\]/is);
    expect(sql).not.toMatch(/mcp_mutation_audit_success_idempotency_idx/i);
    expect(sql).not.toMatch(/create unique index.*mcp_mutation_audit/is);
    expect(sql).not.toMatch(/delete\s+from\s+public\./i);
    expect(sql).not.toMatch(/update\s+public\./i);
  });

  it("creates owner-scoped immutable fund ledgers with invoker-only RPCs", () => {
    const sql = readFileSync(
      "supabase/migrations/20260921113000_fund_entry_ledgers.sql",
      "utf8",
    );

    expect(sql).toMatch(
      /create table if not exists public\.sinking_fund_entries/i,
    );
    expect(sql).toMatch(
      /create table if not exists public\.goal_fund_entries/i,
    );
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/existing_amount.*existing_entry_type/is);
    expect(sql).toMatch(/existing_goal_id.*p_goal_id/is);
    expect(sql).toMatch(/existing_sinking_fund_id.*p_sinking_fund_id/is);
    expect(sql).toMatch(/insufficient (?:goal|sinking fund) balance/i);
    expect(sql).toMatch(/current_amount\s*=\s*current_value\s*\+\s*p_amount/i);
    expect(sql).not.toMatch(/greatest\s*\(/i);
    expect(sql).not.toMatch(/drop policy if exists/i);
    expect(sql).toMatch(/revoke execute on function .* from public/i);
    expect(sql).toMatch(/revoke execute on function .* from anon/i);
    expect(sql).toMatch(
      /revoke all on public\.sinking_fund_entries from authenticated/i,
    );
    expect(sql).toMatch(
      /revoke all on public\.goal_fund_entries from authenticated/i,
    );
    expect(sql).toMatch(/grant execute on function .* to authenticated/i);
    expect(sql).not.toMatch(
      /service_role|password|access_token|refresh_token/i,
    );
  });

  it("adds installment completion state without rewriting business data", () => {
    const sql = readFileSync(
      "supabase/migrations/20260921120000_installment_lifecycle.sql",
      "utf8",
    );

    expect(sql).toMatch(/add column if not exists installment_completed_at/i);
    expect(sql).toMatch(/create index if not exists/i);
    expect(sql).toMatch(/begin\s*;/i);
    expect(sql).toMatch(/set local lock_timeout/i);
    expect(sql).toMatch(/commit\s*;/i);
    expect(sql).not.toMatch(
      /insert into|update public\.|delete from public\./i,
    );
  });
});
