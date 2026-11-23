-- =====================================================================
-- Plassô — Instagram dos CLIENTES (API oficial da Meta)
-- Rodar UMA vez em: Supabase > SQL Editor > New query (pode rodar de novo).
--
-- 1) ig_contas: qual conta do Instagram é de qual cliente. Substitui a lista fixa
--    CONTAS_POR_CLIENTE da função instagram-publicar. A publicação continua travada:
--    um conteúdo só sai na conta ligada ao cliente dele.
-- 2) ig_metricas_dia / ig_metricas_posts: números puxados todo dia pela função
--    instagram-metricas (pg_cron, 6h da manhã de Brasília).
-- O token fica no segredo META_IG_TOKEN das Edge Functions (nunca aqui).
-- =====================================================================

-- 1) Conta do Instagram de cada cliente
create table if not exists public.ig_contas (
  owner        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  cliente      text        not null,            -- nome do cliente normalizado (sem acento, minúsculo)
  cliente_nome text        not null,            -- nome como aparece no Dashplasso
  ig_id        text        not null,
  username     text,
  conectado_em timestamptz not null default now(),
  primary key (owner, cliente)
);
alter table public.ig_contas enable row level security;
drop policy if exists "ig contas dono" on public.ig_contas;
create policy "ig contas dono" on public.ig_contas
  for select to authenticated using (owner = auth.uid());
revoke all on public.ig_contas from anon;
grant select on public.ig_contas to authenticated;   -- conectar/desconectar só pela função (confere o token)

-- a conta do Marcelo, que já publicava
insert into public.ig_contas (owner, cliente, cliente_nome, ig_id, username)
select id, 'marcelo h buzeli', 'Marcelo H Buzeli', '17841454339423114', 'marcelohbuzeli'
from auth.users order by created_at limit 1
on conflict do nothing;

-- 2) Métricas da conta, um registro por dia
create table if not exists public.ig_metricas_dia (
  owner      uuid not null references auth.users(id) on delete cascade,
  ig_id      text not null,
  dia        date not null,
  seguidores int,
  dados      jsonb not null default '{}'::jsonb,  -- reach, views, accounts_engaged, total_interactions, likes, comments, shares, saves, profile_links_taps, follows_and_unfollows
  atualizado timestamptz not null default now(),
  primary key (owner, ig_id, dia)
);
alter table public.ig_metricas_dia enable row level security;
drop policy if exists "ig metricas dia dono" on public.ig_metricas_dia;
create policy "ig metricas dia dono" on public.ig_metricas_dia
  for select to authenticated using (owner = auth.uid());
revoke all on public.ig_metricas_dia from anon;
grant select on public.ig_metricas_dia to authenticated;

-- 3) Métricas de cada post (últimos 30 dias, atualizadas todo dia)
create table if not exists public.ig_metricas_posts (
  owner      uuid not null references auth.users(id) on delete cascade,
  ig_id      text not null,
  media_id   text not null,
  publicado  timestamptz,
  tipo       text,
  legenda    text,
  link       text,
  capa       text,
  dados      jsonb not null default '{}'::jsonb,  -- reach, views, likes, comments, shares, saved, total_interactions
  atualizado timestamptz not null default now(),
  primary key (owner, media_id)
);
create index if not exists ig_metricas_posts_conta_idx on public.ig_metricas_posts (owner, ig_id, publicado desc);
alter table public.ig_metricas_posts enable row level security;
drop policy if exists "ig metricas posts dono" on public.ig_metricas_posts;
create policy "ig metricas posts dono" on public.ig_metricas_posts
  for select to authenticated using (owner = auth.uid());
revoke all on public.ig_metricas_posts from anon;
grant select on public.ig_metricas_posts to authenticated;

-- 4) Relógio: todo dia às 6h (Brasília) puxa as métricas de todas as contas conectadas
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('instagram-metricas') where exists (select 1 from cron.job where jobname = 'instagram-metricas');
select cron.schedule(
  'instagram-metricas',
  '0 9 * * *',
  $$ select net.http_post(
       url := 'https://icarqnbtxrntogfsyavv.supabase.co/functions/v1/instagram-metricas',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"modo": "cron"}'::jsonb,
       timeout_milliseconds := 150000
     ) $$
);
