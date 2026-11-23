-- =====================================================================
-- Plassô — notificações (rodar UMA vez no Supabase > SQL Editor; pode rodar de novo)
-- Avisa o Marcelo (sininho no Dashplasso + push no celular) quando um cliente,
-- pelo link do portal, APROVA um conteúdo ou PEDE AJUSTE.
--
-- 1) notificacoes: histórico do sininho (só o dono lê / marca como lida).
-- 2) push_inscricoes: aparelhos que ativaram as notificações (só o dono mexe).
-- 3) push_config: chaves VAPID, criadas pela própria função "notificar" na 1ª vez.
--    Sem política nenhuma: só a chave de serviço (dentro da função) lê.
-- 4) portal_update passa a registrar a notificação, e um gatilho chama a função
--    "notificar" (pg_net) para mandar o push.
-- =====================================================================

create table if not exists public.notificacoes (
  id          bigserial   primary key,
  owner       uuid        not null references auth.users(id) on delete cascade,
  tipo        text        not null check (tipo in ('aprovado', 'ajuste')),
  cliente     text,
  task_id     text,
  titulo      text,
  comentario  text,
  criado_em   timestamptz not null default now(),
  lida        boolean     not null default false,
  enviada_em  timestamptz
);
create index if not exists notificacoes_owner_idx on public.notificacoes (owner, criado_em desc);
alter table public.notificacoes enable row level security;
drop policy if exists "notificacoes dono le" on public.notificacoes;
create policy "notificacoes dono le" on public.notificacoes
  for select to authenticated using (owner = auth.uid());
drop policy if exists "notificacoes dono marca" on public.notificacoes;
create policy "notificacoes dono marca" on public.notificacoes
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "notificacoes dono apaga" on public.notificacoes;
create policy "notificacoes dono apaga" on public.notificacoes
  for delete to authenticated using (owner = auth.uid());
revoke all on public.notificacoes from anon;
grant select, update, delete on public.notificacoes to authenticated;
grant usage, select on sequence public.notificacoes_id_seq to authenticated;

create table if not exists public.push_inscricoes (
  endpoint    text        primary key,
  owner       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh      text        not null,
  auth        text        not null,
  aparelho    text,
  criado_em   timestamptz not null default now()
);
alter table public.push_inscricoes enable row level security;
drop policy if exists "push dono" on public.push_inscricoes;
create policy "push dono" on public.push_inscricoes
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
revoke all on public.push_inscricoes from anon;
grant select, insert, update, delete on public.push_inscricoes to authenticated;

create table if not exists public.push_config (
  id          int  primary key default 1 check (id = 1),
  vapid_pub   text not null,
  vapid_priv  text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- sininho em tempo real
do $$ begin
  alter publication supabase_realtime add table public.notificacoes;
exception when others then null; end $$;

-- 4) portal_update: igual ao de antes + registra a notificação
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

  -- O cliente só pode APROVAR ou PEDIR AJUSTE. Não altera título, legenda, link do Drive etc.
  for k in select jsonb_object_keys(p_patch) loop
    if k = 'status' and (p_patch->>'status') in ('aprovadas', 'urgent') then
      allowed := allowed || jsonb_build_object('status', p_patch->'status');
    elsif k = 'isRejected' and jsonb_typeof(p_patch->'isRejected') = 'boolean' then
      allowed := allowed || jsonb_build_object('isRejected', p_patch->'isRejected');
    elsif k in ('notes', 'clientFeedback') and jsonb_typeof(p_patch->k) = 'string'
          and (p_patch->>k) like 'Reprovado pelo cliente:%' and length(p_patch->>k) <= 2000 then
      allowed := allowed || jsonb_build_object(k, p_patch->k);
    end if;
  end loop;

  if allowed = '{}'::jsonb then
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

  update public.records
     set data = data || allowed, updated_at = now()
   where owner = t.owner and collection = 'tasks' and id = t.id;

  -- notificação: aprovou ou pediu ajuste (só quando muda de fato)
  if allowed->>'status' = 'aprovadas' and coalesce(t.data->>'status', '') <> 'aprovadas' then
    v_tipo := 'aprovado';
  elsif (allowed->>'status' = 'urgent' or (allowed->>'isRejected')::boolean is true)
        and not (coalesce(t.data->>'status', '') = 'urgent' and coalesce((t.data->>'isRejected')::boolean, false)) then
    v_tipo := 'ajuste';
  end if;

  if v_tipo is not null then
    -- evita duplicar quando o portal manda status e observação em chamadas separadas
    if not exists (select 1 from public.notificacoes
                    where owner = c.owner and task_id = t.id and tipo = v_tipo
                      and criado_em > now() - interval '2 minutes') then
      insert into public.notificacoes (owner, tipo, cliente, task_id, titulo, comentario)
      values (c.owner, v_tipo, c.data->>'name', t.id,
              coalesce(nullif(t.data->>'headline', ''), nullif(t.data->>'title', ''), 'Conteúdo'),
              nullif(btrim(regexp_replace(coalesce(allowed->>'notes', allowed->>'clientFeedback', ''), '^Reprovado pelo cliente:\s*', '')), ''));
    end if;
  elsif allowed ? 'notes' or allowed ? 'clientFeedback' then
    -- o comentário do ajuste chegou depois do status: completa a notificação recente
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

revoke all on function public.portal_update(text, text, jsonb) from public;
grant execute on function public.portal_update(text, text, jsonb) to anon, authenticated;

-- gatilho: nova notificação -> função "notificar" manda o push
create extension if not exists pg_net;

create or replace function public.notificacao_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://icarqnbtxrntogfsyavv.supabase.co/functions/v1/notificar',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 20000);
  return new;
exception when others then
  return new; -- sem push, a notificação continua no sininho
end;
$$;

drop trigger if exists notificacoes_push on public.notificacoes;
create trigger notificacoes_push after insert on public.notificacoes
  for each row execute function public.notificacao_push();

-- Métricas do Instagram a cada ~6 horas (antes: 1x por dia às 6h).
-- O relógio confere a cada 2 h; a função só chama a Meta se a conta tiver mais de 6 h sem atualizar.
select cron.unschedule('instagram-metricas') where exists (select 1 from cron.job where jobname = 'instagram-metricas');
select cron.schedule(
  'instagram-metricas',
  '0 */2 * * *',
  $$ select net.http_post(
       url := 'https://icarqnbtxrntogfsyavv.supabase.co/functions/v1/instagram-metricas',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"modo": "cron"}'::jsonb,
       timeout_milliseconds := 150000
     ) $$
);
