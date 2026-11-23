# Instagram dos clientes: o que fazer na Meta

O Dashplassô já agenda posts, puxa métricas e pede a análise do mês para **qualquer cliente cuja conta esteja ligada** (Empresa → Instagram). Para isso, o token da Meta precisa alcançar a conta do cliente e ter as permissões certas.

## Como está hoje (23/11/2026)
- Token conectado: usuário do sistema **"Dashplasso System User"**. É o tipo certo: não vence.
- Permissões que ele tem: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`.
- **Faltam:**
  - `instagram_manage_insights`: sem ela, as métricas diárias e as métricas de cada post ficam vazias;
  - `pages_show_list`, `pages_read_engagement` e `business_management`: sem elas, o Dashplassô não enxerga as contas dos clientes.

## 1. Gerar o token de novo, com as permissões que faltam (5 minutos)
1. Abra **business.facebook.com → Configurações do negócio → Usuários → Usuários do sistema**.
2. Clique em **Dashplasso System User → Gerar novo token**.
3. Escolha o app do Dashplassô e a validade **Nunca**.
4. Marque: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `business_management`.
5. Copie o token. Ele começa com `EAA`.
6. No Supabase, em **Edge Functions → Secrets**, troque o valor de `META_IG_TOKEN` pelo token novo e salve. Esse passo é seu: o token é uma senha.
7. Abra **Empresa → Instagram** no Dashplassô. O aviso de permissões faltando deve sumir.

## 2. Trazer cada cliente para o seu Business Manager (uma vez por cliente)
A conta do Instagram do cliente precisa ser **profissional** (Empresa ou Criador) e estar **ligada à Página do Facebook** dele.

**Caminho A (recomendado): o cliente compartilha com você como parceiro**
1. Você envia ao cliente o ID do seu Business Manager (fica em Configurações do negócio → Informações do negócio).
2. O cliente abre o Business Manager **dele** → Configurações → **Parceiros → Adicionar → Dar a um parceiro acesso aos seus ativos**, cola o seu ID e compartilha a **Página** e a **conta do Instagram** com permissão total, ou pelo menos de conteúdo e insights.
3. Do seu lado, em **Usuários do sistema → Dashplasso System User → Atribuir ativos**, marque a Página e a conta do Instagram do cliente.

**Caminho B: o cliente não tem Business Manager**
O cliente adiciona você como **administrador da Página** dele (Configurações da Página → Acesso à Página). Depois, no seu Business Manager, você solicita acesso à Página e atribui ao usuário do sistema, como no passo 3 acima.

## 3. Ligar a conta ao cliente no Dashplassô
**Empresa → Instagram**, escolha o cliente, selecione a conta (aparece sozinha quando o acesso estiver certo) → **Ligar**. Na hora, o Dashplassô busca os últimos 30 dias de métricas.

Daí em diante:
- **Agendar no Instagram** aparece nos conteúdos desse cliente, e o post só sai na conta dele (trava no servidor).
- As **métricas** são atualizadas todo dia às 6h.
- **Pedir análise do mês ao Jarvis** gera o relatório com recomendações e uma mensagem pronta para o cliente. Roda no seu Mac, com o seu plano do Claude, sem custo de API.

## Custos
API da Meta (publicação, métricas, mensagens): grátis para contas que você gerencia. Não precisa de App Review para ativos atribuídos ao seu próprio Business Manager.
