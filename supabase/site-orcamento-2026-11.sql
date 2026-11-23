-- =====================================================================
-- Site do link da bio (bio/index.html) → CRM, etapa "Orçamento (site)"
-- Rodar UMA vez em: Supabase > SQL Editor > New query (pode rodar de novo).
--
-- O visitante NÃO faz login e continua sem acesso à tabela records.
-- Ele só consegue chamar esta função, que:
--   • aceita apenas os campos do formulário, com tamanho limitado;
--   • grava um lead novo na coleção "crm" do dono do Dashplassô, na etapa "orcamento";
--   • não devolve nenhum dado do banco;
--   • recusa enxurrada (mais de 30 pedidos do site na última hora).
-- =====================================================================

create extension if not exists pg_net;

create or replace function public.site_orcamento(p jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner    uuid;
  v_nome     text := left(btrim(coalesce(p->>'nome', '')), 80);
  v_whats    text := left(regexp_replace(coalesce(p->>'whatsapp', ''), '[^0-9+() -]', '', 'g'), 25);
  v_negocio  text := left(btrim(coalesce(p->>'negocio', '')), 100);
  v_insta    text := left(btrim(coalesce(p->>'instagram', '')), 60);
  v_cidade   text := left(btrim(coalesce(p->>'cidade', '')), 60);
  v_servico  text := left(btrim(coalesce(p->>'servico', '')), 120);
  v_msg      text := left(btrim(coalesce(p->>'mensagem', '')), 1000);
  v_id       text;
  v_agora    timestamptz := now();
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if length(v_nome) < 2 or length(regexp_replace(v_whats, '[^0-9]', '', 'g')) < 10 then return false; end if;
  -- campo-isca: robôs preenchem, gente não vê
  if coalesce(p->>'site', '') <> '' then return true; end if;

  -- Dono do Dashplassô (sistema de um usuário só: o primeiro cadastrado).
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then return false; end if;

  if (select count(*) from public.records
       where owner = v_owner and collection = 'crm'
         and data->>'origem' = 'Site · link da bio'
         and updated_at > v_agora - interval '1 hour') >= 30 then
    return false;
  end if;

  v_id := 'site_' || to_char(v_agora, 'YYMMDDHH24MISS') || '_' || substr(md5(random()::text), 1, 6);

  insert into public.records (owner, collection, id, data, updated_at)
  values (v_owner, 'crm', v_id, jsonb_strip_nulls(jsonb_build_object(
      'id', v_id,
      'col', 'orcamento',
      'name', coalesce(nullif(v_negocio, ''), v_nome),
      'nomeCompleto', v_nome,
      'telefone', v_whats,
      'mobile', true,
      'insta', nullif(v_insta, ''),
      'bairro', nullif(v_cidade, ''),
      'product', nullif(v_servico, ''),
      'notas', nullif(v_msg, ''),
      'origem', 'Site · link da bio',
      'site', true,
      'criadoEm', to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'atualizadoEm', to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'historyArray', jsonb_build_array(
         to_char(v_agora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ' — Pediu orçamento pelo site (link da bio)')
  )), v_agora);

  -- análise automática do Instagram do cliente (Edge Function analisar-orcamento)
  begin
    perform net.http_post(
      url := 'https://icarqnbtxrntogfsyavv.supabase.co/functions/v1/analisar-orcamento',
      body := jsonb_build_object('id', v_id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then null; -- se falhar, o CRM pede a análise ao abrir
  end;

  return true;
end;
$$;

revoke all on function public.site_orcamento(jsonb) from public;
grant execute on function public.site_orcamento(jsonb) to anon, authenticated;
