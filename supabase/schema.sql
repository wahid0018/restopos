-- RestoPOS — Supabase schema (multi-restaurant).  Run this whole file once in Supabase → SQL Editor.
-- One shared table holds every restaurant's records; row-level security keeps each restaurant to its own rows,
-- using the `client_id` stored in the user's app_metadata (see "Adding a restaurant" at the bottom).

create extension if not exists pgcrypto;

create table if not exists public.records (
  client_id  text        not null,
  coll       text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (client_id, coll, id)
);
create index if not exists records_pull_idx on public.records (client_id, updated_at);

-- Provider (licence / feature flag) password hash.  Holds ONE row; the app never reads this table.
create table if not exists public.provider_secret (
  id   int primary key default 1 check (id = 1),
  hash text not null
);
alter table public.provider_secret enable row level security;   -- no policies = nobody can read it through the API
alter table public.records enable row level security;

-- helper: which restaurant does the signed-in user belong to?
create or replace function public.my_client() returns text
language sql stable as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'client_id', '') $$;

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated
  using (client_id = public.my_client());
-- writes only through the RPCs below (they are security definer); no insert/update/delete policies on purpose.

-- ───────────────────────────────────────────────────────────────────────────
-- apply_patches: merge field-level changes into records.  p_rows = [{c, id, patch:{...}}]
-- Field-level merge means two tablets editing different fields of one order never overwrite each other.
-- The 'provider' collection is refused here — only set_provider_flags may write it.
create or replace function public.apply_patches(p_rows jsonb)
returns table (coll text, id text, data jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  cid text := public.my_client();
  r jsonb;
begin
  if cid is null then raise exception 'no restaurant assigned to this account'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when r ->> 'c' is null or r ->> 'id' is null or (r ->> 'c') = 'provider';
    insert into public.records as t (client_id, coll, id, data, updated_at)
    values (cid, r ->> 'c', r ->> 'id', coalesce(r -> 'patch', '{}'::jsonb), now())
    on conflict (client_id, coll, id)
    do update set data = t.data || coalesce(r -> 'patch', '{}'::jsonb), updated_at = now();
    coll := r ->> 'c'; id := r ->> 'id';
    select x.data, x.updated_at into data, updated_at from public.records x where x.client_id = cid and x.coll = coll and x.id = id;
    return next;
  end loop;
end $$;
grant execute on function public.apply_patches(jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- set_provider_flags: used by the Provider panel in online mode.  p_key is the provider password;
-- it is checked against the hash stored in provider_secret.  Hash = sha256('restopos-provider:' || password).
create or replace function public.set_provider_flags(p_key text, p_data jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  cid text := public.my_client();
  ok boolean;
begin
  if cid is null then raise exception 'no restaurant assigned to this account'; end if;
  select hash = encode(digest('restopos-provider:' || coalesce(p_key, ''), 'sha256'), 'hex') into ok from public.provider_secret where id = 1;
  if not coalesce(ok, false) then raise exception 'wrong provider password'; end if;
  insert into public.records as t (client_id, coll, id, data, updated_at)
  values (cid, 'provider', 'flags', p_data, now())
  on conflict (client_id, coll, id) do update set data = p_data, updated_at = now();
end $$;
grant execute on function public.set_provider_flags(text, jsonb) to authenticated;

-- Provider password: default hash below is for the password shipped with this copy.
-- To change it run:  node tools/set-provider-password.js "NewPassword"  and paste the SQL line it prints.
insert into public.provider_secret (id, hash) values (1, 'cd4d7d98675373c2d739ec601361c90ab691605a3f964cdf14bf9ba98aac0eaf')
on conflict (id) do update set hash = excluded.hash;

-- ───────────────────────────────────────────────────────────────────────────
-- ADDING A RESTAURANT (one login per restaurant account, shared by its staff devices)
--   1. Supabase → Authentication → Users → "Add user" (email + password, tick "Auto confirm").
--   2. Give the user a restaurant id by running (change the email and id):
--        update auth.users
--           set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"client_id":"sharma-restaurant"}'
--         where email = 'owner@sharma.example';
--      The id can be any short text; every user with the same client_id sees the same data.
--   3. Sign out / sign in again in the app so the new token carries the client_id.
-- Realtime is not required: the app polls every few seconds and works fully offline in between.
-- Turn OFF "Confirm email" or add users manually; turn off public sign-ups (Authentication → Providers → Email).
