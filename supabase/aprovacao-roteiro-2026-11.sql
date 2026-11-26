-- =====================================================================
-- Plassô — aprovação em 2 etapas no portal do cliente (rodar UMA vez no Supabase > SQL Editor; pode rodar de novo)
--
-- Etapa 1 (antes de gravar): o cliente lê o ROTEIRO/COPY e a LEGENDA e aprova ou pede ajuste.
--   Campos no conteúdo (coleção tasks):
--     aprovRoteiro     'enviado' (o Marcelo mandou) | 'aprovado' | 'ajuste'
--     roteiroFeedback  o que o cliente pediu para mudar
--     aprovRoteiroEm   quando o cliente respondeu
-- Etapa 2 (depois de editar): igual a antes (status "pronto" + link/mídia final → "Para aprovar").
--
-- portal_load passa a mandar o roteiro (só dos conteúdos enviados para aprovação de roteiro).
-- portal_update passa a aceitar a resposta do roteiro e avisa o Marcelo (sininho + push),
-- com o título começando por "Roteiro:".
-- =====================================================================

create or replace function public.portal_load(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.records;
begin
  if p_token is null or length(p_token) < 24 then
    return null;
  end if;

  select * into c from public.records
   where collection = 'clients' and data->>'portalToken' = p_token
   limit 1;

  if not found then
    return null;
  end if;

  -- O cliente recebe SÓ os campos que o portal mostra (nada de anotações internas,
  -- tempo gasto, envios para edição etc.). Observação só quando é o pedido de ajuste dele.
  return jsonb_build_object(
    'client', jsonb_build_object(
        'id', c.data->>'id',
        'name', c.data->>'name',
        'portalToken', c.data->>'portalToken'),
    'tasks', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'id', r.data->'id', 'client', r.data->'client', 'kind', r.data->'kind',
                 'headline', r.data->'headline', 'title', r.data->'title', 'type', r.data->'type',
                 'date', r.data->'date', 'time', r.data->'time', 'status', r.data->'status',
                 'isRejected', r.data->'isRejected', 'manuallyMovedToPronto', r.data->'manuallyMovedToPronto',
                 'drive', r.data->'drive', 'midias', r.data->'midias',
                 'legenda', r.data->'legenda', 'caption', r.data->'caption',
                 'roteiro', case when r.data->>'aprovRoteiro' is not null then r.data->'roteiro' end,
                 'aprovRoteiro', r.data->'aprovRoteiro',
                 'roteiroFeedback', r.data->'roteiroFeedback',
                 'aprovRoteiroEm', r.data->'aprovRoteiroEm',
                 'notes', case when r.data->>'notes' like 'Reprovado pelo cliente:%' then r.data->'notes' end)))
          from public.records r
         where r.owner = c.owner
           and r.collection = 'tasks'
           and lower(r.data->>'client') = lower(c.data->>'name')
           and coalesce(r.data->>'notes', '') not like 'crm\_%'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.portal_update(p_token text, p_task_id text, p_patch jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.records;
  t public.records;
  allowed jsonb := '{}'::jsonb;
  k text;
  v_tipo text;
  v_titulo text;
  v_coment text;
begin
  if p_token is null or length(p_token) < 24 or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return false;
  end if;

  select * into c from public.records
   where collection = 'clients' and data->>'portalToken' = p_token
   limit 1;
  if not found then
    return false;
  end if;

  select * into t from public.records
   where owner = c.owner
     and collection = 'tasks'
     and id = p_task_id
     and lower(data->>'client') = lower(c.data->>'name')
     and coalesce(data->>'notes', '') not like 'crm\_%';
  if not found then
    return false;
  end if;

  -- O cliente só pode APROVAR ou PEDIR AJUSTE. Não altera título, roteiro, legenda, link do Drive etc.
  for k in select jsonb_object_keys(p_patch) loop
    if k = 'status' and (p_patch->>'status') in ('aprovadas', 'urgent') then
      allowed := allowed || jsonb_build_object('status', p_patch->'status');
    elsif k = 'isRejected' and jsonb_typeof(p_patch->'isRejected') = 'boolean' then
      allowed := allowed || jsonb_build_object('isRejected', p_patch->'isRejected');
    elsif k in ('notes', 'clientFeedback') and jsonb_typeof(p_patch->k) = 'string'
          and (p_patch->>k) like 'Reprovado pelo cliente:%' and length(p_patch->>k) <= 2000 then
      allowed := allowed || jsonb_build_object(k, p_patch->k);
    -- etapa 1: só responde roteiro que o Marcelo enviou
    elsif k = 'aprovRoteiro' and (p_patch->>'aprovRoteiro') in ('aprovado', 'ajuste')
          and t.data->>'aprovRoteiro' is not null then
      allowed := allowed || jsonb_build_object('aprovRoteiro', p_patch->'aprovRoteiro');
    elsif k = 'roteiroFeedback' and jsonb_typeof(p_patch->k) = 'string' and length(p_patch->>k) <= 2000
          and t.data->>'aprovRoteiro' is not null then
      allowed := allowed || jsonb_build_object('roteiroFeedback', p_patch->k);
    elsif k = 'aprovRoteiroEm' and jsonb_typeof(p_patch->k) = 'string' and length(p_patch->>k) <= 40 then
      allowed := allowed || jsonb_build_object('aprovRoteiroEm', p_patch->k);
    end if;
  end loop;

  if allowed = '{}'::jsonb then
    return false;
  end if;

  update public.records
     set data = data || allowed, updated_at = now()
   where owner = t.owner and collection = 'tasks' and id = t.id;

  v_titulo := coalesce(nullif(t.data->>'headline', ''), nullif(t.data->>'title', ''), 'Conteúdo');

  -- notificação da etapa 1 (roteiro)
  if allowed ? 'aprovRoteiro' and allowed->>'aprovRoteiro' is distinct from t.data->>'aprovRoteiro' then
    v_tipo := case when allowed->>'aprovRoteiro' = 'aprovado' then 'aprovado' else 'ajuste' end;
    v_coment := case when v_tipo = 'ajuste' then nullif(btrim(coalesce(allowed->>'roteiroFeedback', '')), '') end;
    if not exists (select 1 from public.notificacoes
                    where owner = c.owner and task_id = t.id and tipo = v_tipo and titulo like 'Roteiro:%'
                      and criado_em > now() - interval '2 minutes') then
      insert into public.notificacoes (owner, tipo, cliente, task_id, titulo, comentario)
      values (c.owner, v_tipo, c.data->>'name', t.id, 'Roteiro: ' || v_titulo, v_coment);
    end if;
    return true;
  end if;

  -- notificação da etapa 2 (conteúdo final): aprovou ou pediu ajuste (só quando muda de fato)
  v_tipo := null;
  if allowed->>'status' = 'aprovadas' and coalesce(t.data->>'status', '') <> 'aprovadas' then
    v_tipo := 'aprovado';
  elsif (allowed->>'status' = 'urgent' or (allowed->>'isRejected')::boolean is true)
        and not (coalesce(t.data->>'status', '') = 'urgent' and coalesce((t.data->>'isRejected')::boolean, false)) then
    v_tipo := 'ajuste';
  end if;

  if v_tipo is not null then
    if not exists (select 1 from public.notificacoes
                    where owner = c.owner and task_id = t.id and tipo = v_tipo and titulo not like 'Roteiro:%'
                      and criado_em > now() - interval '2 minutes') then
      insert into public.notificacoes (owner, tipo, cliente, task_id, titulo, comentario)
      values (c.owner, v_tipo, c.data->>'name', t.id, v_titulo,
              nullif(btrim(regexp_replace(coalesce(allowed->>'notes', allowed->>'clientFeedback', ''), '^Reprovado pelo cliente:\s*', '')), ''));
    end if;
  elsif allowed ? 'notes' or allowed ? 'clientFeedback' then
    update public.notificacoes
       set comentario = nullif(btrim(regexp_replace(coalesce(allowed->>'notes', allowed->>'clientFeedback'), '^Reprovado pelo cliente:\s*', '')), '')
     where id = (select id from public.notificacoes
                  where owner = c.owner and task_id = t.id and tipo = 'ajuste'
                    and criado_em > now() - interval '2 minutes'
                  order by id desc limit 1);
  end if;

  return true;
end;
$$;

revoke all on function public.portal_load(text) from public;
revoke all on function public.portal_update(text, text, jsonb) from public;
grant execute on function public.portal_load(text) to anon, authenticated;
grant execute on function public.portal_update(text, text, jsonb) to anon, authenticated;
