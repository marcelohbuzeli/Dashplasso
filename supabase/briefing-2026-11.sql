-- =====================================================================
-- Plassô — Briefing do cliente pelo link (briefing.html?t=<token do portal>)
-- Rodar UMA vez em: Supabase > SQL Editor > New query (pode rodar de novo).
--
-- O cliente NÃO faz login. Ele usa o mesmo token do portal de aprovação e só consegue:
--   • ler o nome dele e as respostas das perguntas do cliente (nada interno, nada de finanças);
--   • gravar respostas nessas perguntas (lista fixa abaixo, texto de até 5.000 caracteres).
-- A lista de perguntas tem que bater com as de cli:true em assets/briefing.js.
-- =====================================================================

create or replace function public.briefing_campos_cliente()
returns jsonb
language sql
immutable
as $$
  select '{
    "oQueFaz": ["O negócio", "O que a empresa faz"],
    "modelo": ["O negócio", "Modelo de negócio"],
    "cidade": ["O negócio", "Cidade e abrangência"],
    "produtos": ["O negócio", "Produtos e serviços, com preço aproximado"],
    "carroChefe": ["O negócio", "Carro-chefe (o que mais vende)"],
    "venderMais": ["O negócio", "O que você quer vender mais"],
    "ticket": ["O negócio", "Ticket médio por venda"],
    "diferencial": ["O negócio", "Diferenciais em relação aos concorrentes"],
    "historia": ["O negócio", "História: como e por que começou"],
    "meta30": ["Objetivos e datas", "Meta para os primeiros 30 dias"],
    "meta90": ["Objetivos e datas", "Meta para os próximos 60 a 90 dias"],
    "expectativa": ["Objetivos e datas", "O que você espera das redes sociais"],
    "sazonalidade": ["Objetivos e datas", "Datas comerciais e meses fortes e fracos"],
    "datasEmpresa": ["Objetivos e datas", "Campanhas que já fazem e datas da empresa"],
    "clienteIdeal": ["Público", "Como é o seu cliente ideal"],
    "dores": ["Público", "Problemas que levam a pessoa a procurar você"],
    "desejos": ["Público", "O que ela deseja e como a vida muda depois"],
    "objecoes": ["Público", "O que faz a pessoa hesitar antes de comprar"],
    "perguntas": ["Público", "Perguntas que os clientes sempre fazem"],
    "tom": ["Marca e tom de voz", "Tom de voz e personalidade da marca"],
    "evitar": ["Marca e tom de voz", "Palavras e assuntos que devemos evitar"],
    "restricoes": ["Marca e tom de voz", "Restrições: o que não pode ser dito ou mostrado"],
    "provas": ["Marca e tom de voz", "Provas: resultados, depoimentos, números"],
    "quemAparece": ["Produção", "Quem aparece nos conteúdos"],
    "disponibilidade": ["Produção", "Disponibilidade para gravar"],
    "locais": ["Produção", "Locais e recursos para gravar"],
    "formatos": ["Produção", "Formatos que você gosta ou não gosta"],
    "concorrentes": ["Mercado e referências", "Principais concorrentes (com @)"],
    "referencias": ["Mercado e referências", "Perfis que você admira e o que gosta em cada um (com @)"],
    "jaFez": ["Mercado e referências", "O que já fez de marketing: o que funcionou e o que não"],
    "agenciaAnterior": ["Mercado e referências", "Já teve social media ou agência? Por que encerrou?"],
    "destinoLead": ["Vendas", "Para onde a pessoa vai depois de ver o post"],
    "processoVendas": ["Vendas", "Como funciona a venda, do primeiro contato ao fechamento"],
    "origemClientes": ["Vendas", "De onde vêm os clientes hoje"]
  }'::jsonb
$$;

create or replace function public.briefing_load(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.records;
  mapa jsonb := public.briefing_campos_cliente();
  campos jsonb := '{}'::jsonb;
  k text;
begin
  if p_token is null or length(p_token) < 24 then return null; end if;
  select * into c from public.records
   where collection = 'clients' and data->>'portalToken' = p_token
   limit 1;
  if not found then return null; end if;

  for k in select jsonb_object_keys(mapa) loop
    if coalesce(c.data #>> array['briefingV2','campos',k,'v'], '') <> '' then
      campos := campos || jsonb_build_object(k, c.data #>> array['briefingV2','campos',k,'v']);
    end if;
  end loop;

  return jsonb_build_object(
    'name', c.data->>'name',
    'campos', campos,
    'respondidoEm', c.data #>> '{briefingV2,respondidoEm}');
end;
$$;

create or replace function public.briefing_save(p_token text, p_campos jsonb, p_finalizar boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.records;
  mapa jsonb := public.briefing_campos_cliente();
  b jsonb;
  campos jsonb;
  k text;
  v text;
  agora text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if p_token is null or length(p_token) < 24 or p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    return false;
  end if;
  select * into c from public.records
   where collection = 'clients' and data->>'portalToken' = p_token
   limit 1;
  if not found then return false; end if;

  b := coalesce(c.data->'briefingV2', '{}'::jsonb);
  if jsonb_typeof(b) <> 'object' then b := '{}'::jsonb; end if;
  campos := coalesce(b->'campos', '{}'::jsonb);
  if jsonb_typeof(campos) <> 'object' then campos := '{}'::jsonb; end if;

  for k in select jsonb_object_keys(p_campos) loop
    continue when not (mapa ? k) or jsonb_typeof(p_campos->k) <> 'string';
    v := left(btrim(p_campos->>k), 5000);
    if v = '' then
      campos := campos - k;
    elsif coalesce(campos #>> array[k,'v'], '') <> v then
      campos := campos || jsonb_build_object(k, jsonb_build_object(
        'v', v, 'o', 'cliente', 'em', agora, 's', mapa->k->>0, 'l', mapa->k->>1));
    end if;
  end loop;

  b := b || jsonb_build_object('campos', campos, 'atualizadoEm', agora);
  if p_finalizar then b := b || jsonb_build_object('respondidoEm', agora); end if;

  update public.records
     set data = jsonb_set(data, '{briefingV2}', b), updated_at = now()
   where owner = c.owner and collection = 'clients' and id = c.id;
  return found;
end;
$$;

revoke all on function public.briefing_load(text) from public;
revoke all on function public.briefing_save(text, jsonb, boolean) from public;
grant execute on function public.briefing_load(text) to anon, authenticated;
grant execute on function public.briefing_save(text, jsonb, boolean) to anon, authenticated;
