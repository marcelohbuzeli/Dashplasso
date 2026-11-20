-- Ajustes de segurança de 20/11/2026 (já aplicados no projeto "plasso").
-- Pode rodar de novo sem problema.

-- rls_auto_enable() é a função do gatilho "ensure_rls", que liga o RLS sozinha em toda
-- tabela nova do schema public. Ela continua funcionando como gatilho; só deixa de
-- aparecer como algo que visitantes ou usuários logados poderiam chamar pela API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
