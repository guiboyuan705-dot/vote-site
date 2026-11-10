-- 投票站的数据库结构。
-- 在 Supabase → SQL Editor 里整份运行一次。
-- 匿名访客可以创建投票、读取题目和投票，但不能直接看到选票表里的浏览器令牌。
-- 真正的写入都走 private 里的 security definer 函数，public 里只有安全的入口。

create schema if not exists extensions;

create extension if not exists pgcrypto;

do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if ext_schema is distinct from 'extensions' then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

create table private.app_settings (
  id integer primary key,
  owner_password_hash text,
  constraint app_settings_singleton check (id = 1)
);

insert into private.app_settings (id, owner_password_hash)
values (1, null);

alter table private.app_settings enable row level security;
alter table private.app_settings force row level security;
revoke all on table private.app_settings from public, anon, authenticated;

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  question text not null,
  allow_multiple boolean not null default false,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint polls_slug_format check (slug ~ '^[a-z0-9]{6,32}$'),
  constraint polls_question_length check (char_length(question) between 1 and 200)
);

create table public.options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  position integer not null,
  kind text not null,
  label text not null,
  url text,
  description text,
  favicon_url text,
  constraint options_position_nonnegative check (position >= 0),
  constraint options_kind_known check (kind in ('link', 'text')),
  constraint options_label_length check (char_length(label) between 1 and 300),
  constraint options_description_length check (description is null or char_length(description) <= 500),
  constraint options_url_shape check (
    (kind = 'text' and url is null)
    or (
      kind = 'link'
      and url is not null
      and url ~* '^https?://'
      and char_length(url) <= 2000
    )
  ),
  constraint options_favicon_shape check (
    favicon_url is null
    or (favicon_url ~* '^https?://' and char_length(favicon_url) <= 2000)
  )
);

create table public.ballots (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  voter_token text not null,
  created_at timestamptz not null default now(),
  constraint ballots_voter_token_format check (
    voter_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  constraint ballots_one_per_token unique (poll_id, voter_token)
);

create table public.ballot_choices (
  ballot_id uuid not null references public.ballots (id) on delete cascade,
  option_id uuid not null references public.options (id) on delete cascade,
  primary key (ballot_id, option_id)
);

create index options_poll_position_idx on public.options (poll_id, position);
create index ballots_poll_id_idx on public.ballots (poll_id);
create index ballot_choices_option_id_idx on public.ballot_choices (option_id);
create index polls_created_at_idx on public.polls (created_at desc);

alter table public.polls enable row level security;
alter table public.polls force row level security;
alter table public.options enable row level security;
alter table public.options force row level security;
alter table public.ballots enable row level security;
alter table public.ballots force row level security;
alter table public.ballot_choices enable row level security;
alter table public.ballot_choices force row level security;

revoke all on table public.polls from anon, authenticated;
revoke all on table public.options from anon, authenticated;
revoke all on table public.ballots from anon, authenticated;
revoke all on table public.ballot_choices from anon, authenticated;

grant select on table public.polls to anon, authenticated;
grant select on table public.options to anon, authenticated;

create policy polls_public_read
on public.polls
for select
to anon, authenticated
using (true);

create policy options_public_read
on public.options
for select
to anon, authenticated
using (true);

-- 明确拒绝直接读取选票。计票只通过下面的函数返回汇总数字。
create policy ballots_no_direct_read
on public.ballots
for select
to anon, authenticated
using (false);

create policy ballot_choices_no_direct_read
on public.ballot_choices
for select
to anon, authenticated
using (false);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete
      on table public.polls, public.options, public.ballots, public.ballot_choices
      to service_role;
  end if;
end $$;

create or replace function private.poll_payload(p_poll_id uuid, p_voter_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_poll public.polls%rowtype;
  v_options jsonb;
  v_total integer;
  v_voted jsonb;
begin
  select * into v_poll
  from public.polls
  where id = p_poll_id;

  if not found then
    return null;
  end if;

  select count(*)::integer into v_total
  from public.ballots
  where poll_id = p_poll_id;

  select coalesce(jsonb_agg(bc.option_id order by o.position), '[]'::jsonb)
    into v_voted
  from public.ballot_choices bc
  join public.ballots b on b.id = bc.ballot_id
  join public.options o on o.id = bc.option_id
  where b.poll_id = p_poll_id
    and p_voter_token is not null
    and b.voter_token = p_voter_token;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'kind', o.kind,
        'label', o.label,
        'url', o.url,
        'description', o.description,
        'favicon_url', o.favicon_url,
        'votes', coalesce(c.votes, 0)
      )
      order by o.position
    ),
    '[]'::jsonb
  )
  into v_options
  from public.options o
  left join (
    select bc.option_id, count(*)::integer as votes
    from public.ballot_choices bc
    join public.ballots b on b.id = bc.ballot_id
    where b.poll_id = p_poll_id
    group by bc.option_id
  ) c on c.option_id = o.id
  where o.poll_id = p_poll_id;

  return jsonb_build_object(
    'slug', v_poll.slug,
    'question', v_poll.question,
    'allow_multiple', v_poll.allow_multiple,
    'ends_at', v_poll.ends_at,
    'created_at', v_poll.created_at,
    'ended', v_poll.ends_at is not null and v_poll.ends_at <= now(),
    'total_voters', v_total,
    'voted_option_ids', coalesce(v_voted, '[]'::jsonb),
    'options', v_options
  );
end;
$$;

create or replace function private.list_polls()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.created_at desc),
    '[]'::jsonb
  )
  from (
    select
      p.slug,
      p.question,
      p.allow_multiple,
      p.ends_at,
      p.created_at,
      (p.ends_at is not null and p.ends_at <= now()) as ended,
      (select count(*)::integer from public.options o where o.poll_id = p.id) as option_count,
      (select count(*)::integer from public.ballots b where b.poll_id = p.id) as total_voters
    from public.polls p
    order by p.created_at desc
    limit 100
  ) t;
$$;

create or replace function private.get_poll(p_slug text, p_voter_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_token text;
begin
  select id into v_id
  from public.polls
  where slug = p_slug;

  if not found then
    raise exception 'poll_not_found' using errcode = 'P0001';
  end if;

  v_token := null;
  if p_voter_token is not null
     and p_voter_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_token := lower(p_voter_token);
  end if;

  return private.poll_payload(v_id, v_token);
end;
$$;

create or replace function private.creation_requires_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select owner_password_hash is not null
  from private.app_settings
  where id = 1;
$$;

create or replace function private.create_poll(
  p_question text,
  p_allow_multiple boolean,
  p_ends_at timestamptz,
  p_options jsonb,
  p_password text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_slug text;
  v_poll_id uuid;
  v_item jsonb;
  v_index integer;
  v_kind text;
  v_label text;
  v_url text;
  v_description text;
  v_favicon text;
  v_attempt integer;
begin
  if p_question is null
     or char_length(btrim(p_question)) < 1
     or char_length(btrim(p_question)) > 200 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if p_allow_multiple is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'ends_at_past' using errcode = 'P0001';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_options) < 1 or jsonb_array_length(p_options) > 20 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select owner_password_hash into v_hash
  from private.app_settings
  where id = 1;

  if v_hash is not null then
    if p_password is null
       or extensions.crypt(p_password, v_hash) is distinct from v_hash then
      raise exception 'invalid_password' using errcode = 'P0001';
    end if;
  end if;

  v_poll_id := null;
  for v_attempt in 1..5 loop
    v_slug := substr(md5(gen_random_uuid()::text), 1, 10);
    begin
      insert into public.polls (slug, question, allow_multiple, ends_at)
      values (v_slug, btrim(p_question), p_allow_multiple, p_ends_at)
      returning id into v_poll_id;
      exit;
    exception
      when unique_violation then
        v_poll_id := null;
    end;
  end loop;

  if v_poll_id is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  for v_index in 0..jsonb_array_length(p_options) - 1 loop
    v_item := p_options -> v_index;
    v_kind := v_item ->> 'kind';
    v_label := btrim(coalesce(v_item ->> 'label', ''));
    v_url := nullif(btrim(coalesce(v_item ->> 'url', '')), '');
    v_description := nullif(btrim(coalesce(v_item ->> 'description', '')), '');
    v_favicon := nullif(btrim(coalesce(v_item ->> 'favicon_url', '')), '');

    if v_kind is null or v_kind not in ('link', 'text') then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;

    if char_length(v_label) < 1 or char_length(v_label) > 300 then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;

    if v_description is not null and char_length(v_description) > 500 then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;

    if v_kind = 'text' then
      v_url := null;
    elsif v_url is null or v_url !~* '^https?://' or char_length(v_url) > 2000 then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;

    if v_favicon is not null and (v_favicon !~* '^https?://' or char_length(v_favicon) > 2000) then
      v_favicon := null;
    end if;

    insert into public.options (poll_id, position, kind, label, url, description, favicon_url)
    values (v_poll_id, v_index, v_kind, v_label, v_url, v_description, v_favicon);
  end loop;

  return jsonb_build_object('slug', v_slug);
end;
$$;

create or replace function private.cast_vote(
  p_slug text,
  p_voter_token text,
  p_option_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_poll public.polls%rowtype;
  v_ids uuid[];
  v_count integer;
  v_ballot uuid;
begin
  if p_voter_token is null
     or p_voter_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_voter' using errcode = 'P0001';
  end if;

  select * into v_poll
  from public.polls
  where slug = p_slug;

  if not found then
    raise exception 'poll_not_found' using errcode = 'P0001';
  end if;

  if v_poll.ends_at is not null and v_poll.ends_at <= now() then
    raise exception 'poll_ended' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_ids
  from unnest(coalesce(p_option_ids, '{}'::uuid[])) as x
  where x is not null;

  v_count := coalesce(cardinality(v_ids), 0);

  if v_poll.allow_multiple then
    if v_count < 1 then
      raise exception 'invalid_options' using errcode = 'P0001';
    end if;
  elsif v_count <> 1 then
    raise exception 'invalid_options' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.options o
    where o.poll_id = v_poll.id
      and o.id = any (v_ids)
  ) <> v_count then
    raise exception 'invalid_options' using errcode = 'P0001';
  end if;

  begin
    insert into public.ballots (poll_id, voter_token)
    values (v_poll.id, lower(p_voter_token))
    returning id into v_ballot;
  exception
    when unique_violation then
      raise exception 'already_voted' using errcode = 'P0001';
  end;

  insert into public.ballot_choices (ballot_id, option_id)
  select v_ballot, unnest(v_ids);

  return private.poll_payload(v_poll.id, lower(p_voter_token));
end;
$$;

create or replace function private.set_owner_password(p_password text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_password is null
     or char_length(p_password) < 8
     or octet_length(p_password) > 72 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  update private.app_settings
  set owner_password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 8))
  where id = 1;
end;
$$;

create or replace function private.clear_owner_password()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update private.app_settings
  set owner_password_hash = null
  where id = 1;
$$;

create or replace function public.list_polls()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.list_polls();
$$;

create or replace function public.get_poll(slug text, voter_token text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_poll(slug, voter_token);
$$;

create or replace function public.creation_requires_password()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.creation_requires_password();
$$;

create or replace function public.create_poll(
  question text,
  allow_multiple boolean,
  ends_at timestamptz,
  options jsonb,
  password text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_poll(question, allow_multiple, ends_at, options, password);
$$;

create or replace function public.cast_vote(
  slug text,
  voter_token text,
  option_ids uuid[]
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.cast_vote(slug, voter_token, option_ids);
$$;

revoke all on function private.poll_payload(uuid, text) from public;
revoke all on function private.set_owner_password(text) from public;
revoke all on function private.clear_owner_password() from public;
revoke all on function private.list_polls() from public;
revoke all on function private.get_poll(text, text) from public;
revoke all on function private.creation_requires_password() from public;
revoke all on function private.create_poll(text, boolean, timestamptz, jsonb, text) from public;
revoke all on function private.cast_vote(text, text, uuid[]) from public;

revoke all on function public.list_polls() from public;
revoke all on function public.get_poll(text, text) from public;
revoke all on function public.creation_requires_password() from public;
revoke all on function public.create_poll(text, boolean, timestamptz, jsonb, text) from public;
revoke all on function public.cast_vote(text, text, uuid[]) from public;

grant execute on function private.list_polls() to anon, authenticated, service_role;
grant execute on function private.get_poll(text, text) to anon, authenticated, service_role;
grant execute on function private.creation_requires_password() to anon, authenticated, service_role;
grant execute on function private.create_poll(text, boolean, timestamptz, jsonb, text) to anon, authenticated, service_role;
grant execute on function private.cast_vote(text, text, uuid[]) to anon, authenticated, service_role;

grant execute on function public.list_polls() to anon, authenticated, service_role;
grant execute on function public.get_poll(text, text) to anon, authenticated, service_role;
grant execute on function public.creation_requires_password() to anon, authenticated, service_role;
grant execute on function public.create_poll(text, boolean, timestamptz, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.cast_vote(text, text, uuid[]) to anon, authenticated, service_role;

comment on function public.create_poll(text, boolean, timestamptz, jsonb, text) is
  '创建投票。未设置管理口令时任何人可调用；设置后必须带对口令。';
comment on function public.cast_vote(text, text, uuid[]) is
  '提交一票。同一个 voter_token 对同一张票只能成功一次。';
comment on function private.set_owner_password(text) is
  '只在 SQL Editor 里由项目管理员调用，用来给“新建投票”加上口令。';
