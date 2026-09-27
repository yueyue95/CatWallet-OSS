-- CatWallet defaults for Malaysian users. Existing rows are intentionally left
-- untouched; this only changes onboarding for users created after this migration.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, name, terms_accepted)
  values (
    new.id,
    null,
    null,
    coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false)
  );

  insert into public.categories (
    user_id,
    name,
    group_type,
    monthly_limit,
    is_default,
    icon
  )
  values
    (new.id, 'Housing', 'needs', 2000, true, '🏠'),
    (new.id, 'Food', 'needs', 400, true, '🛒'),
    (new.id, 'Transportation', 'needs', 300, true, '🚗'),
    (new.id, 'Health', 'needs', 200, true, '💡'),
    (new.id, 'Education', 'needs', 160, true, '📚'),
    (new.id, 'Important', 'needs', 180, true, '⚡'),
    (new.id, 'Debt', 'needs', 250, true, '🧾'),
    (new.id, 'Leisure', 'wants', 150, true, '📺'),
    (new.id, 'Subscriptions', 'wants', 200, true, '🎬'),
    (new.id, 'Shopping', 'wants', 300, true, '🛍️'),
    (new.id, 'Others', 'wants', 120, true, '🏷️'),
    (new.id, 'Investments', 'savings', 500, true, '📈'),
    (new.id, 'Reserve', 'savings', 200, true, '🛟'),
    (new.id, 'Income', 'income', null, true, '💼');

  insert into public.payment_methods (
    user_id,
    name,
    type,
    credit_limit
  )
  values
    (new.id, 'Cash', 'cash', null),
    (new.id, 'Bank', 'bank', null),
    (new.id, 'Credit Card', 'credit', 0),
    (new.id, 'Debit Card', 'debit', null);

  return new;
end;
$$;
;
