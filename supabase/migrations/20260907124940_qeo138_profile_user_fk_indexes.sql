-- QEO-138 — cover direct auth.users foreign keys reported by the Supabase performance advisor.
create index portfolio_risk_profile_attempts_user_id_idx
  on public.portfolio_risk_profile_attempts(user_id);

create index portfolio_discipline_profile_attempts_user_id_idx
  on public.portfolio_discipline_profile_attempts(user_id);

create index portfolio_money_management_plans_user_id_idx
  on public.portfolio_money_management_plans(user_id);
