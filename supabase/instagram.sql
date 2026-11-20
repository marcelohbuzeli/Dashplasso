-- =====================================================================
-- Plassô — publicação no Instagram (API oficial)
-- Rode UMA vez em: Supabase > SQL Editor > New query. É idempotente.
-- O token fica no segredo META_IG_TOKEN das Edge Functions (nunca aqui).
-- =====================================================================

-- 1) Agendamentos
create table if not exists public.ig_agendamentos (
  id            uuid        primary key default gen_random_uuid(),
  owner         uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  task_id       text,
  tipo          text        not null check (tipo in ('REELS','IMAGE','CAROUSEL')),
  legenda       text        not null default '',
  midias        text[]      not null,              -- caminhos no bucket "postagens", na ordem
  publicar_em   timestamptz not null,
  status        text        not null default 'agendado'
                check (status in ('agendado','processando','publicado','erro','cancelado')),
  containers    text[],
  container_id  text,
  media_id      text,
  permalink     text,
  erro          text,
  tentativas    int         not null default 0,
  trava_ate     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ig_agendamentos_fila_idx on public.ig_agendamentos (status, publicar_em);

alter table public.ig_agendamentos enable row level security;
drop policy if exists "ig dono" on public.ig_agendamentos;
create policy "ig dono" on public.ig_agendamentos
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
revoke all on public.ig_agendamentos from anon;
grant select, insert, update, delete on public.ig_agendamentos to authenticated;

-- 2) Mídias para postar (privado; cada usuário só mexe na própria pasta <id do usuário>/...)
--    Plano gratuito do Supabase: no máximo 50 MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('postagens', 'postagens', false, 52428800, array['video/mp4', 'video/quicktime', 'image/jpeg'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "postagens do dono" on storage.objects;
create policy "postagens do dono" on storage.objects
  for all to authenticated
  using (bucket_id = 'postagens' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'postagens' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Relógio: a cada 5 minutos chama a função que publica o que já está na hora.
--    A função só processa o que já está agendado no banco, então a chamada não precisa de segredo.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('instagram-publicar') where exists (select 1 from cron.job where jobname = 'instagram-publicar');
select cron.schedule(
  'instagram-publicar',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://icarqnbtxrntogfsyavv.supabase.co/functions/v1/instagram-publicar',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"modo": "cron"}'::jsonb,
       timeout_milliseconds := 120000
     ) $$
);
