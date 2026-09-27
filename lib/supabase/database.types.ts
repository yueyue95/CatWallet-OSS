export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      account_balance_entries: {
        Row: {
          amount: number;
          created_at: string;
          effective_date: string;
          entry_type: string;
          id: string;
          idempotency_key: string | null;
          note: string | null;
          payment_method_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          effective_date: string;
          entry_type: string;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          payment_method_id: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          effective_date?: string;
          entry_type?: string;
          id?: string;
          idempotency_key?: string | null;
          note?: string | null;
          payment_method_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_balance_entries_payment_method_id_fkey";
            columns: ["payment_method_id"];
            isOneToOne: false;
            referencedRelation: "payment_methods";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          group_type: string;
          icon: string;
          id: string;
          is_default: boolean;
          monthly_limit: number | null;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          group_type: string;
          icon?: string;
          id?: string;
          is_default?: boolean;
          monthly_limit?: number | null;
          name: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          group_type?: string;
          icon?: string;
          id?: string;
          is_default?: boolean;
          monthly_limit?: number | null;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      cooling_items: {
        Row: {
          added_at: string;
          amount_cents: number;
          cooling_days: number;
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          purchased_transaction_id: string | null;
          status: string;
          updated_at: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          added_at?: string;
          amount_cents: number;
          cooling_days?: number;
          created_at?: string;
          id?: string;
          name: string;
          notes?: string | null;
          purchased_transaction_id?: string | null;
          status?: string;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Update: {
          added_at?: string;
          amount_cents?: number;
          cooling_days?: number;
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          purchased_transaction_id?: string | null;
          status?: string;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cooling_items_purchased_transaction_fk";
            columns: ["purchased_transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      fixed_commitments: {
        Row: {
          amount: number;
          cadence: string;
          category_id: string | null;
          created_at: string;
          custom_interval_months: number | null;
          deleted_at: string | null;
          end_date: string | null;
          id: string;
          include_in_safe_to_spend: boolean;
          is_enabled: boolean;
          name: string;
          payment_method_id: string | null;
          start_date: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          cadence: string;
          category_id?: string | null;
          created_at?: string;
          custom_interval_months?: number | null;
          deleted_at?: string | null;
          end_date?: string | null;
          id?: string;
          include_in_safe_to_spend?: boolean;
          is_enabled?: boolean;
          name: string;
          payment_method_id?: string | null;
          start_date: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount?: number;
          cadence?: string;
          category_id?: string | null;
          created_at?: string;
          custom_interval_months?: number | null;
          deleted_at?: string | null;
          end_date?: string | null;
          id?: string;
          include_in_safe_to_spend?: boolean;
          is_enabled?: boolean;
          name?: string;
          payment_method_id?: string | null;
          start_date?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fixed_commitments_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fixed_commitments_payment_method_id_fkey";
            columns: ["payment_method_id"];
            isOneToOne: false;
            referencedRelation: "payment_methods";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: {
          color: string;
          created_at: string;
          current_amount: number;
          deadline: string;
          deleted_at: string | null;
          icon: string;
          id: string;
          name: string;
          target_amount: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          current_amount?: number;
          deadline: string;
          deleted_at?: string | null;
          icon?: string;
          id?: string;
          name: string;
          target_amount: number;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          current_amount?: number;
          deadline?: string;
          deleted_at?: string | null;
          icon?: string;
          id?: string;
          name?: string;
          target_amount?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      installment_retirement_allocations: {
        Row: {
          created_at: string;
          id: string;
          installment_group_id: string;
          is_enabled: boolean;
          monthly_amount: number;
          notes: string | null;
          starts_month: string;
          target_id: string | null;
          target_type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          installment_group_id: string;
          is_enabled?: boolean;
          monthly_amount: number;
          notes?: string | null;
          starts_month: string;
          target_id?: string | null;
          target_type: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          installment_group_id?: string;
          is_enabled?: boolean;
          monthly_amount?: number;
          notes?: string | null;
          starts_month?: string;
          target_id?: string | null;
          target_type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      monthly_budgets: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          income: number | null;
          month: string;
          needs_limit: number | null;
          savings_limit: number | null;
          updated_at: string;
          user_id: string;
          wants_limit: number | null;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          income?: number | null;
          month: string;
          needs_limit?: number | null;
          savings_limit?: number | null;
          updated_at?: string;
          user_id?: string;
          wants_limit?: number | null;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          income?: number | null;
          month?: string;
          needs_limit?: number | null;
          savings_limit?: number | null;
          updated_at?: string;
          user_id?: string;
          wants_limit?: number | null;
        };
        Relationships: [];
      };
      payment_methods: {
        Row: {
          balance_tracking_enabled: boolean;
          closing_day: number | null;
          created_at: string;
          credit_limit: number | null;
          deleted_at: string | null;
          due_day: number | null;
          id: string;
          name: string;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance_tracking_enabled?: boolean;
          closing_day?: number | null;
          created_at?: string;
          credit_limit?: number | null;
          deleted_at?: string | null;
          due_day?: number | null;
          id?: string;
          name: string;
          type: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          balance_tracking_enabled?: boolean;
          closing_day?: number | null;
          created_at?: string;
          credit_limit?: number | null;
          deleted_at?: string | null;
          due_day?: number | null;
          id?: string;
          name?: string;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      privacy_requests: {
        Row: {
          details: string | null;
          id: string;
          request_type: string;
          requested_at: string;
          resolved_at: string | null;
          response: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          details?: string | null;
          id?: string;
          request_type: string;
          requested_at?: string;
          resolved_at?: string | null;
          response?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          details?: string | null;
          id?: string;
          request_type?: string;
          requested_at?: string;
          resolved_at?: string | null;
          response?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          email: string | null;
          id: string;
          name: string | null;
          terms_accepted: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id: string;
          name?: string | null;
          terms_accepted?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          name?: string | null;
          terms_accepted?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      sinking_funds: {
        Row: {
          created_at: string;
          current_amount: number;
          deleted_at: string | null;
          emoji: string;
          expected_use_date: string | null;
          id: string;
          is_enabled: boolean;
          monthly_target: number;
          name: string;
          notes: string | null;
          target_amount: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_amount?: number;
          deleted_at?: string | null;
          emoji?: string;
          expected_use_date?: string | null;
          id?: string;
          is_enabled?: boolean;
          monthly_target?: number;
          name: string;
          notes?: string | null;
          target_amount?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          current_amount?: number;
          deleted_at?: string | null;
          emoji?: string;
          expected_use_date?: string | null;
          id?: string;
          is_enabled?: boolean;
          monthly_target?: number;
          name?: string;
          notes?: string | null;
          target_amount?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      mcp_mutation_audit: {
        Row: {
          action: string;
          entity_id: string | null;
          error_code: string | null;
          id: string;
          idempotency_key_hash: string;
          occurred_at: string;
          request_fingerprint: string;
          success: boolean;
          tool_name: string;
          user_id: string;
        };
        Insert: {
          action: string;
          entity_id?: string | null;
          error_code?: string | null;
          id?: string;
          idempotency_key_hash: string;
          occurred_at?: string;
          request_fingerprint: string;
          success: boolean;
          tool_name: string;
          user_id: string;
        };
        Update: {
          action?: string;
          entity_id?: string | null;
          error_code?: string | null;
          id?: string;
          idempotency_key_hash?: string;
          occurred_at?: string;
          request_fingerprint?: string;
          success?: boolean;
          tool_name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      mcp_mutation_idempotency: {
        Row: {
          created_at: string;
          id: string;
          idempotency_key_hash: string;
          payload_hash: string;
          result_entity_id: string | null;
          status: string;
          tool_name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          idempotency_key_hash: string;
          payload_hash: string;
          result_entity_id?: string | null;
          status: string;
          tool_name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          idempotency_key_hash?: string;
          payload_hash?: string;
          result_entity_id?: string | null;
          status?: string;
          tool_name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          advanced_at: string | null;
          advanced_to_month: string | null;
          amount: number;
          category_id: string | null;
          counts_toward_fun_money: boolean;
          created_at: string;
          date: string;
          deleted_at: string | null;
          description: string;
          entry_idempotency_key: string | null;
          entry_kind: string;
          fixed_commitment_id: string | null;
          id: string;
          import_batch_id: string | null;
          installment_amount: number | null;
          installment_amount_mode: string | null;
          installment_completed_at: string | null;
          installment_current_number: number | null;
          installment_group_id: string | null;
          installment_number: number | null;
          installment_total: number | null;
          kind: string;
          notes: string | null;
          payment_method_id: string | null;
          related_invoice_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          advanced_at?: string | null;
          advanced_to_month?: string | null;
          amount: number;
          category_id?: string | null;
          counts_toward_fun_money?: boolean;
          created_at?: string;
          date: string;
          deleted_at?: string | null;
          description: string;
          entry_idempotency_key?: string | null;
          entry_kind?: string;
          fixed_commitment_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          installment_amount?: number | null;
          installment_amount_mode?: string | null;
          installment_completed_at?: string | null;
          installment_current_number?: number | null;
          installment_group_id?: string | null;
          installment_number?: number | null;
          installment_total?: number | null;
          kind: string;
          notes?: string | null;
          payment_method_id?: string | null;
          related_invoice_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          advanced_at?: string | null;
          advanced_to_month?: string | null;
          amount?: number;
          category_id?: string | null;
          counts_toward_fun_money?: boolean;
          created_at?: string;
          date?: string;
          deleted_at?: string | null;
          description?: string;
          entry_idempotency_key?: string | null;
          entry_kind?: string;
          fixed_commitment_id?: string | null;
          id?: string;
          import_batch_id?: string | null;
          installment_amount?: number | null;
          installment_amount_mode?: string | null;
          installment_completed_at?: string | null;
          installment_current_number?: number | null;
          installment_group_id?: string | null;
          installment_number?: number | null;
          installment_total?: number | null;
          kind?: string;
          notes?: string | null;
          payment_method_id?: string | null;
          related_invoice_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_fixed_commitment_fk";
            columns: ["fixed_commitment_id"];
            isOneToOne: false;
            referencedRelation: "fixed_commitments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_payment_method_id_fkey";
            columns: ["payment_method_id"];
            isOneToOne: false;
            referencedRelation: "payment_methods";
            referencedColumns: ["id"];
          },
        ];
      };
      transaction_import_batches: {
        Row: {
          created_at: string;
          id: string;
          idempotency_key: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          idempotency_key: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      sinking_fund_entries: {
        Row: {
          amount: number;
          created_at: string;
          entry_type: string;
          id: string;
          idempotency_key: string;
          note: string | null;
          sinking_fund_id: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          entry_type: string;
          id?: string;
          idempotency_key: string;
          note?: string | null;
          sinking_fund_id: string;
          user_id?: string;
        };
        Update: never;
        Relationships: [];
      };
      goal_fund_entries: {
        Row: {
          amount: number;
          created_at: string;
          entry_type: string;
          goal_id: string;
          id: string;
          idempotency_key: string;
          note: string | null;
          user_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          entry_type: string;
          goal_id: string;
          id?: string;
          idempotency_key: string;
          note?: string | null;
          user_id?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_goal_funds: {
        Args: { p_amount: number; p_goal_id: string; p_user_id: string };
        Returns: boolean;
      };
      calculate_total_saved: {
        Args: { p_selected_month: string };
        Returns: number;
      };
      delete_payment_method_if_empty: {
        Args: { p_payment_method_id: string };
        Returns: boolean;
      };
      record_goal_fund_entry: {
        Args: {
          p_amount: number;
          p_entry_type: string;
          p_goal_id: string;
          p_idempotency_key: string;
          p_note: string | null;
        };
        Returns: number;
      };
      record_sinking_fund_entry: {
        Args: {
          p_amount: number;
          p_entry_type: string;
          p_idempotency_key: string;
          p_note: string | null;
          p_sinking_fund_id: string;
        };
        Returns: number;
      };
      save_installment_retirement_allocations: {
        Args: {
          p_allocations: Json;
          p_group_id: string;
          p_starts_month: string;
        };
        Returns: {
          created_at: string;
          id: string;
          installment_group_id: string;
          is_enabled: boolean;
          monthly_amount: number;
          notes: string | null;
          starts_month: string;
          target_id: string | null;
          target_type: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "installment_retirement_allocations";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
