// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

describe.skipIf(process.env.CATWALLET_LOCAL_RETIREMENT_TEST !== "1")(
  "local retirement allocation RPC",
  () => {
    it("C/D/E/F/G: persists multiple destinations atomically with limits, retries and RLS", async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      if (!/^(127\.0\.0\.1|localhost|192\.168\.)/.test(new URL(url).hostname))
        throw new Error("Local only");
      const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
      const ids: string[] = [];
      const clients: SupabaseClient[] = [];
      async function user() {
        const email = `retirement-${randomUUID()}@example.test`;
        const password = randomBytes(24).toString("base64url") + "Aa1!";
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (!created.data.user || created.error)
          throw new Error("Provisioning failed");
        ids.push(created.data.user.id);
        const client = createClient(
          url,
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false } },
        );
        clients.push(client);
        const login = await client.auth.signInWithPassword({ email, password });
        expect(login.error).toBeNull();
        return client;
      }
      try {
        const a = await user();
        const b = await user();
        const group = randomUUID();
        const rows = await a.from("transactions").insert(
          [1, 2, 3, 4, 5, 6].map((n) => ({
            date: `2027-0${n}-16`,
            amount: 500,
            description: `Local period ${n}`,
            kind: "expense",
            installment_group_id: group,
            installment_amount: 500,
            installment_amount_mode: "per_installment",
            installment_current_number: 5,
            installment_number: n,
            installment_total: 6,
          })),
        );
        expect(rows.error).toBeNull();
        const category = await a
          .from("categories")
          .select("id")
          .eq("group_type", "wants")
          .limit(1)
          .single();
        const fund = await a
          .from("sinking_funds")
          .insert({ name: "Local car fund", emoji: "🚗", monthly_target: 100 })
          .select("id")
          .single();
        expect(fund.error).toBeNull();
        const args = {
          p_group_id: group,
          p_starts_month: "2027-07-01",
          p_allocations: [
            { target_type: "savings", target_id: null, monthly_amount: 350 },
            {
              target_type: "sinking_fund",
              target_id: fund.data!.id,
              monthly_amount: 100,
            },
            {
              target_type: "category",
              target_id: category.data!.id,
              monthly_amount: 50,
            },
          ],
        };
        const one = await a.rpc("save_installment_retirement_allocations", {
          ...args,
          p_allocations: args.p_allocations.slice(0, 1),
        });
        expect(one.error).toBeNull();
        expect(one.data).toHaveLength(1);
        const many = await Promise.all([
          a.rpc("save_installment_retirement_allocations", args),
          a.rpc("save_installment_retirement_allocations", args),
        ]);
        for (const result of many) expect(result.error).toBeNull();
        const persisted = await a
          .from("installment_retirement_allocations")
          .select("*")
          .eq("installment_group_id", group);
        expect(persisted.data).toHaveLength(3);
        expect(
          persisted.data!.reduce(
            (sum, row) => sum + Number(row.monthly_amount),
            0,
          ),
        ).toBe(500);
        for (const row of persisted.data!) {
          expect(row.user_id).toBe(ids[0]);
          expect(row.starts_month).toBe("2027-07-01");
          expect(row.installment_group_id).toBe(group);
          expect(args.p_allocations).toContainEqual({
            target_type: row.target_type,
            target_id: row.target_id,
            monthly_amount: Number(row.monthly_amount),
          });
        }
        const over = await a.rpc("save_installment_retirement_allocations", {
          ...args,
          p_allocations: [
            { target_type: "savings", target_id: null, monthly_amount: 501 },
          ],
        });
        expect(over.error).not.toBeNull();
        const invalidMonth = await a.rpc(
          "save_installment_retirement_allocations",
          { ...args, p_starts_month: "2027-06-01" },
        );
        expect(invalidMonth.error).not.toBeNull();
        const crossUser = await b.rpc(
          "save_installment_retirement_allocations",
          args,
        );
        expect(crossUser.error).not.toBeNull();
        const hidden = await b
          .from("installment_retirement_allocations")
          .select("id")
          .eq("installment_group_id", group);
        expect(hidden.data).toHaveLength(0);
        const updateOther = await b
          .from("installment_retirement_allocations")
          .update({ monthly_amount: 1 })
          .eq("id", persisted.data![0].id)
          .select("id");
        expect(updateOther.data).toHaveLength(0);
        const unchanged = await a
          .from("installment_retirement_allocations")
          .select("monthly_amount")
          .eq("installment_group_id", group);
        expect(
          unchanged.data!.reduce(
            (sum, row) => sum + Number(row.monthly_amount),
            0,
          ),
        ).toBe(500);
        const deleted = await a.rpc("save_installment_retirement_allocations", {
          ...args,
          p_allocations: [],
        });
        expect(deleted.error).toBeNull();
        expect(deleted.data).toHaveLength(0);
      } finally {
        for (const client of clients) await client.auth.signOut();
        for (const id of ids) {
          const result = await admin.auth.admin.deleteUser(id);
          if (result.error) throw new Error("Cleanup failed");
        }
      }
    }, 60000);
  },
);
