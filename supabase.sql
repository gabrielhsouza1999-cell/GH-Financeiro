create table if not exists public.gh_settings (
  id text primary key default 'default',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.gh_entries (
  id uuid primary key,
  collection text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.gh_monthly_snapshots (
  id uuid primary key,
  month text not null,
  company text,
  summary jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.gh_settings enable row level security;
alter table public.gh_entries enable row level security;
alter table public.gh_monthly_snapshots enable row level security;

drop policy if exists "Managers can read settings" on public.gh_settings;
drop policy if exists "Managers can write settings" on public.gh_settings;
drop policy if exists "Operators can insert entries" on public.gh_entries;
drop policy if exists "Managers can read entries" on public.gh_entries;
drop policy if exists "Managers can write entries" on public.gh_entries;
drop policy if exists "Managers can read monthly snapshots" on public.gh_monthly_snapshots;
drop policy if exists "Managers can write monthly snapshots" on public.gh_monthly_snapshots;

create policy "Managers can read settings"
on public.gh_settings for select
to authenticated
using (true);

create policy "Managers can write settings"
on public.gh_settings for all
to authenticated
using (true)
with check (true);

create policy "Operators can insert entries"
on public.gh_entries for insert
to anon, authenticated
with check (true);

create policy "Managers can read entries"
on public.gh_entries for select
to authenticated
using (true);

create policy "Managers can write entries"
on public.gh_entries for all
to authenticated
using (true)
with check (true);

create policy "Managers can read monthly snapshots"
on public.gh_monthly_snapshots for select
to authenticated
using (true);

create policy "Managers can write monthly snapshots"
on public.gh_monthly_snapshots for all
to authenticated
using (true)
with check (true);

insert into public.gh_settings (id, data)
values ('default', '{}'::jsonb)
on conflict (id) do nothing;
