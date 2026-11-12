# Plassô — Gestão, CRM, Financeiro e Crescimento

São sistemas separados, conectados pelo mesmo banco de dados privado (Supabase).

| Sistema | Páginas | O que faz |
|---------|---------|-----------|
| **Gestão** | `index`, `tasks`, `clients`, `calendar`, `criacao`, `portal` | Clientes, kanban, calendário, agente de criação (IA) e portal de aprovação do cliente |
| **CRM** | `crm` | Funil de leads. Ao fechar contrato, cria o cliente na Gestão e os recebimentos no Financeiro |
| **Financeiro** | `finance`, `lancar` | Entradas e saídas, contas a conferir, parcelas, contas fixas, previsão de 6 meses e lançamento rápido pelo iPhone |
| **Crescimento** | `pessoal` | Hábitos (água, treino, leitura, estudos), tarefas da casa, Modo Trabalho com cronômetro e médias de tempo |

## Conexões

```
CRM ──(fechou contrato)──► Clientes (Gestão) ──► Agente de Criação ──► Kanban/Calendário ──► Portal (WhatsApp)
   └────────────────────► Financeiro: N recebimentos "a conferir" (um por mês de contrato)
Clientes ──(encerrar / renovar)──► Financeiro: cancela ou cria recebimentos
Kanban + Casa ──► Modo Trabalho (Crescimento) ──► tempo gasto volta para a tarefa
Carteira do iPhone (Apple Pay) ──► lancar.html ──► Financeiro
```

## Primeiros passos

1. [`docs/CONFIGURAR-BANCO.md`](docs/CONFIGURAR-BANCO.md): criar o banco gratuito e ligar o site a ele.
2. [`docs/ATALHO-IPHONE.md`](docs/ATALHO-IPHONE.md): lançar compras do Apple Pay automaticamente.
3. [`docs/AGENTE-CRIACAO.md`](docs/AGENTE-CRIACAO.md): publicar a função de IA que cria os conteúdos.

Sem o banco configurado, o sistema funciona em **modo local**: os dados ficam só neste navegador, como antes.

## Estrutura

```
assets/config.js       URL e chave pública do Supabase
assets/core.js         login, sincronização com o banco, menu, backup
assets/integracao.js   CRM → Gestão → Financeiro
assets/financas.js     regras do financeiro (parcelas, previsão, categorias)
supabase/schema.sql    tabela + regras de segurança (RLS) + funções do portal
supabase/functions/    função de IA do agente de criação
```
