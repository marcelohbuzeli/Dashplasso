# Configurar o banco de dados (Supabase, plano gratuito)

O **Supabase** é um banco Postgres na nuvem com login. No sistema:

- **Ninguém lê nada sem estar logado.** As regras RLS do banco só liberam os dados para o dono da conta.
- Os clientes acessam **apenas** o link de aprovação, que tem um código aleatório de 32 caracteres. Por ele só aparecem os conteúdos daquele cliente. Finanças, CRM e outros clientes nunca aparecem.
- O código do site pode continuar público no GitHub. **Os dados não ficam no código**, ficam no banco.

**Plano gratuito:**
- 500 MB de banco, mais do que suficiente.
- O projeto **pausa depois de 7 dias sem nenhum acesso**. É só entrar no painel e reativar.
- O plano gratuito não tem backup automático para baixar. Use o botão **Backup (JSON)** no menu uma vez por semana.

---

## Passo a passo (cerca de 10 minutos)

### 1. Criar o projeto
1. Acesse **supabase.com** e crie sua conta. Pode usar o login do GitHub.
2. Clique em **New project**:
   - Nome: `plasso`
   - Database password: uma senha forte. Guarde no seu gerenciador de senhas.
   - Region: **South America (São Paulo)**
3. Espere 1 a 2 minutos até o projeto ficar pronto.

### 2. Criar as tabelas e as regras de segurança
1. No menu lateral, abra **SQL Editor** e clique em **New query**.
2. Copie **todo** o conteúdo de [`supabase/schema.sql`](../supabase/schema.sql), cole e clique em **Run**.
3. Deve aparecer "Success. No rows returned".

### 3. Criar o seu usuário e bloquear novos cadastros
1. Vá em **Authentication → Users → Add user → Create new user**.
2. Informe seu e-mail e uma senha, e marque **Auto Confirm User**.
3. Vá em **Authentication → Sign In / Providers** (em algumas versões: *Providers → Email*).
4. **Desligue "Allow new users to sign up".** Assim ninguém mais consegue criar conta no seu sistema.

### 4. Ligar o site ao banco
1. Abra **Project Settings → API**, ou o botão **Connect** no topo do painel.
2. Copie o **Project URL** e a chave **anon public**.
3. Cole os dois em [`assets/config.js`](../assets/config.js):
   ```js
   window.PLASSO_CONFIG = {
     SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...'
   };
   ```
   A chave *anon* é pública por design. O que protege os dados são as regras do passo 2.
   **Nunca** use a chave `service_role` no site.
4. Em **Authentication → URL Configuration**, coloque em **Site URL** o endereço do seu site (por exemplo, `https://marcelohbuzeli.github.io/Dashplasso`).

### 5. Trazer os dados que estão hoje no navegador
1. Abra o sistema **no mesmo navegador e computador onde você usa o Dashplasso hoje**. Os dados antigos estão guardados nesse navegador.
2. Faça login.
3. O sistema pergunta: *"Encontrei dados antigos salvos neste navegador… Quer enviar tudo para o banco?"*. Responda **OK**.
4. Pronto. A partir daqui, tudo o que você fizer em qualquer aparelho é salvo no banco.

---

## Como fica a estrutura

Uma tabela única, `records`. Cada sistema guarda suas listas nela, separadas por coleção:

| Coleção | Sistema | Conteúdo |
|---------|---------|----------|
| `crm`, `crm_ganhos` | CRM | leads e leads convertidos |
| `clients` | Gestão | clientes, contrato, briefing, token do portal |
| `tasks` | Gestão | conteúdos / demandas (kanban e calendário) |
| `criacao_*` | Criação | roteiros gerados pelo agente |
| `fin_lancamentos` | Financeiro | entradas, saídas, parcelas, recorrentes |
| `monthly_goals` | Financeiro | metas mensais |
| `life_*` | Crescimento pessoal | hábitos, tarefas de casa, sessões do Modo Trabalho |
