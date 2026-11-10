-- 在迁移之后运行。全部包在事务里，结束时回滚，不留下测试数据。
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_created jsonb;
  v_slug text;
  v_poll jsonb;
  v_first uuid;
  v_second uuid;
  v_token text := '11111111-1111-4111-8111-111111111111';
  v_other text := '22222222-2222-4222-8222-222222222222';
  v_list jsonb;
begin
  begin
    perform public.create_poll(
      '过期议题',
      false,
      now() - interval '1 minute',
      jsonb_build_array(jsonb_build_object('kind', 'text', 'label', '甲')),
      null
    );
    raise exception 'past end accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'ends_at_past' then
        raise exception 'unexpected ends_at error: %', sqlerrm;
      end if;
  end;

  begin
    perform public.create_poll(
      '坏链接',
      false,
      null,
      jsonb_build_array(jsonb_build_object('kind', 'link', 'label', '脚本', 'url', 'javascript:alert(1)')),
      null
    );
    raise exception 'bad url accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'invalid_input' then
        raise exception 'unexpected url error: %', sqlerrm;
      end if;
  end;

  v_created := public.create_poll(
    '今晚吃什么？',
    false,
    now() + interval '2 days',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'link',
        'label', '面馆',
        'url', 'https://example.com/noodles',
        'description', '附近',
        'favicon_url', 'https://example.com/favicon.ico'
      ),
      jsonb_build_object('kind', 'text', 'label', '自己做')
    ),
    null
  );
  v_slug := v_created ->> 'slug';
  if v_slug is null or char_length(v_slug) < 6 then
    raise exception 'slug missing: %', v_created;
  end if;

  v_poll := public.get_poll(v_slug, v_token);
  if v_poll ->> 'question' <> '今晚吃什么？' then
    raise exception 'question mismatch';
  end if;
  if jsonb_array_length(v_poll -> 'options') <> 2 then
    raise exception 'option count';
  end if;
  if (v_poll ->> 'total_voters')::integer <> 0 then
    raise exception 'unexpected voters';
  end if;
  if (v_poll ->> 'ended')::boolean then
    raise exception 'should still be open';
  end if;

  v_first := (v_poll -> 'options' -> 0 ->> 'id')::uuid;
  v_second := (v_poll -> 'options' -> 1 ->> 'id')::uuid;

  v_poll := public.cast_vote(v_slug, v_token, array[v_first]);
  if (v_poll ->> 'total_voters')::integer <> 1 then
    raise exception 'count after vote %', v_poll ->> 'total_voters';
  end if;
  if (v_poll -> 'options' -> 0 ->> 'votes')::integer <> 1 then
    raise exception 'option votes';
  end if;
  if jsonb_array_length(v_poll -> 'voted_option_ids') <> 1 then
    raise exception 'voted ids';
  end if;

  begin
    perform public.cast_vote(v_slug, v_token, array[v_second]);
    raise exception 'duplicate vote was accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'already_voted' then
        raise exception 'unexpected vote error: %', sqlerrm;
      end if;
  end;

  v_poll := public.cast_vote(v_slug, v_other, array[v_second]);
  if (v_poll ->> 'total_voters')::integer <> 2 then
    raise exception 'second voter';
  end if;
  if (v_poll -> 'options' -> 0 ->> 'votes')::integer <> 1
     or (v_poll -> 'options' -> 1 ->> 'votes')::integer <> 1 then
    raise exception 'split votes';
  end if;

  begin
    perform public.cast_vote(
      v_slug,
      '33333333-3333-4333-8333-333333333333',
      array[v_first, v_second]
    );
    raise exception 'multi on single accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'invalid_options' then
        raise exception 'unexpected multi error: %', sqlerrm;
      end if;
  end;

  update public.polls
  set ends_at = now() - interval '1 minute'
  where slug = v_slug;

  v_poll := public.get_poll(v_slug, null);
  if not (v_poll ->> 'ended')::boolean then
    raise exception 'should be ended';
  end if;

  begin
    perform public.cast_vote(v_slug, '44444444-4444-4444-8444-444444444444', array[v_first]);
    raise exception 'ended poll accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'poll_ended' then
        raise exception 'unexpected ended error: %', sqlerrm;
      end if;
  end;

  if public.creation_requires_password() then
    raise exception 'password should be off';
  end if;

  perform private.set_owner_password('correct-horse');
  if not public.creation_requires_password() then
    raise exception 'password should be on';
  end if;

  begin
    perform public.create_poll(
      '不该成功',
      false,
      null,
      jsonb_build_array(jsonb_build_object('kind', 'text', 'label', '甲')),
      'wrong-password'
    );
    raise exception 'bad password accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'invalid_password' then
        raise exception 'unexpected password error: %', sqlerrm;
      end if;
  end;

  perform public.create_poll(
    '口令通过',
    true,
    null,
    jsonb_build_array(
      jsonb_build_object('kind', 'text', 'label', '甲'),
      jsonb_build_object('kind', 'text', 'label', '乙')
    ),
    'correct-horse'
  );

  perform private.clear_owner_password();
  if public.creation_requires_password() then
    raise exception 'password should be cleared';
  end if;

  v_list := public.list_polls();
  if not (v_list @> '[{"question":"今晚吃什么？"}]'::jsonb) then
    raise exception 'list missing poll';
  end if;
  if not (v_list @> '[{"question":"口令通过"}]'::jsonb) then
    raise exception 'list missing locked poll';
  end if;
end $$;

set local role anon;

do $$
declare
  v_slug text;
  v_poll jsonb;
  v_option uuid;
begin
  v_slug := (
    public.create_poll(
      '匿名创建',
      true,
      null,
      jsonb_build_array(
        jsonb_build_object('kind', 'text', 'label', '可以'),
        jsonb_build_object('kind', 'text', 'label', '也行')
      ),
      null
    )
  ) ->> 'slug';

  v_poll := public.get_poll(v_slug, null);
  v_option := (v_poll -> 'options' -> 0 ->> 'id')::uuid;
  v_poll := public.cast_vote(
    v_slug,
    '55555555-5555-4555-8555-555555555555',
    array[
      (v_poll -> 'options' -> 0 ->> 'id')::uuid,
      (v_poll -> 'options' -> 1 ->> 'id')::uuid
    ]
  );
  if (v_poll ->> 'total_voters')::integer <> 1 then
    raise exception 'anon multi vote';
  end if;
  if (v_poll -> 'options' -> 0 ->> 'votes')::integer <> 1
     or (v_poll -> 'options' -> 1 ->> 'votes')::integer <> 1 then
    raise exception 'anon choice counts';
  end if;
  if v_option is null then
    raise exception 'option id';
  end if;
end $$;

do $$
begin
  begin
    perform count(*) from public.ballots;
    raise exception 'anon read ballots';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform private.set_owner_password('should-fail-now');
    raise exception 'anon set password';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into public.polls (slug, question, allow_multiple)
    values ('direct1234', '直接写入', false);
    raise exception 'anon insert poll';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;

rollback;
