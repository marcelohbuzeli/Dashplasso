-- =====================================================================
-- Plassô — banco de dados (Supabase / Postgres)
-- Rode este arquivo inteiro UMA vez em: Supabase > SQL Editor > New query
-- Pode rodar de novo sem problema (é idempotente).
-- =====================================================================

-- 1) Tabela única de registros.
--    Cada "coleção" (clients, tasks, crm, fin_lancamentos, life_tarefas...)
--    guarda seus itens como JSON. Todo registro pertence a um usuário (owner).
create table if not exists public.records (
  owner       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  collection  text        not null,
  id          text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (owner, collection, id)
);

create index if not exists records_collection_idx on public.records (owner, collection);
create index if not exists records_portal_token_idx on public.records ((data->>'portalToken')) where collection = 'clients';

-- 2) Segurança: Row Level Security.
--    Só o dono logado lê/escreve os próprios dados. Visitantes (anon) não acessam nada.
alter table public.records enable row level security;

drop policy if exists "dono le e escreve" on public.records;
create policy "dono le e escreve" on public.records
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- 3) Portal do cliente (link de aprovação enviado no WhatsApp).
--    O cliente NÃO faz login. Ele recebe um link com um token aleatório e longo.
--    Estas funções devolvem SOMENTE os conteúdos daquele cliente e só deixam
--    alterar campos de aprovação. Nada de finanças, CRM ou outros clientes.

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
  allowed jsonb := '{}'::jsonb;
  k text;
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

  update public.records
     set data = data || allowed, updated_at = now()
   where owner = c.owner
     and collection = 'tasks'
     and id = p_task_id
     and lower(data->>'client') = lower(c.data->>'name')
     and coalesce(data->>'notes', '') not like 'crm\_%';

  return found;
end;
$$;

revoke all on function public.portal_load(text) from public;
revoke all on function public.portal_update(text, text, jsonb) from public;
grant execute on function public.portal_load(text) to anon, authenticated;
grant execute on function public.portal_update(text, text, jsonb) to anon, authenticated;

-- 4) Referências visuais dos conteúdos (imagens enviadas no card, para o Design/Editor).
--    Espaço privado "referencias". Cada usuário só mexe na própria pasta (<id do usuário>/...).
--    O site gera links temporários (1 h) para mostrar e para o agente baixar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('referencias', 'referencias', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "referencias do dono" on storage.objects;
create policy "referencias do dono" on storage.objects
  for all to authenticated
  using (bucket_id = 'referencias' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'referencias' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5) Projetos do Meu Editor (galeria). Espaço privado "projetos": <id do usuário>/<id do projeto>.json e .jpg.
--    A lista leve fica em records (coleção editor_projetos); o projeto inteiro fica aqui, fora do Dashplasso.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projetos', 'projetos', false, 20971520, array['application/json', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "projetos do dono" on storage.objects;
create policy "projetos do dono" on storage.objects
  for all to authenticated
  using (bucket_id = 'projetos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'projetos' and (storage.foldername(name))[1] = auth.uid()::text);
