-- =====================================================================
-- Plassô — aba "Resultados" do portal do cliente (rodar UMA vez no Supabase > SQL Editor)
-- Entrega ao cliente, pelo link exclusivo dele, só as métricas da conta dele já salvas no banco.
-- Nenhum token da Meta sai do servidor. Não expõe anotações internas nem dados de outros clientes.
-- =====================================================================

create or replace function public.portal_metricas(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.records;
  l public.ig_contas;
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

  select * into l from public.ig_contas
   where owner = c.owner and lower(cliente_nome) = lower(c.data->>'name')
   limit 1;
  if not found then
    return jsonb_build_object('conectado', false);
  end if;

  return jsonb_build_object(
    'conectado', true,
    'username', l.username,
    'inicio', c.data->>'inicio',
    'atualizado', (select max(d.atualizado) from public.ig_metricas_dia d
                    where d.owner = c.owner and d.ig_id = l.ig_id),
    -- 2 anos de métricas diárias: dá para ver o acumulado desde o início do contrato
    'dias', coalesce((
        select jsonb_agg(jsonb_build_object('dia', d.dia, 'seguidores', d.seguidores, 'dados', d.dados) order by d.dia)
          from public.ig_metricas_dia d
         where d.owner = c.owner and d.ig_id = l.ig_id and d.dia >= current_date - 730
    ), '[]'::jsonb),
    'posts', coalesce((
        select jsonb_agg(jsonb_build_object('publicado', p.publicado, 'tipo', p.tipo, 'legenda', p.legenda,
                                            'link', p.link, 'capa', p.capa, 'dados', p.dados)
                         order by p.publicado desc)
          from (select * from public.ig_metricas_posts
                 where owner = c.owner and ig_id = l.ig_id
                 order by publicado desc limit 60) p
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.portal_metricas(text) from public;
grant execute on function public.portal_metricas(text) to anon, authenticated;
