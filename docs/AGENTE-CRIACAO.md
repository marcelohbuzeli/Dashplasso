# Agente de Criação: publicar a função de IA

O agente usa o Claude (Anthropic) para escrever os conteúdos a partir do briefing do cliente.
A chamada à IA roda numa **função do Supabase** (`supabase/functions/gerar-conteudos`). Assim, a chave da API **nunca** aparece no site.

## Fluxo

1. **CRM → cliente.** O briefing, o objetivo, o produto e a quantidade de conteúdos por mês ficam na ficha do cliente.
2. **Criação (IA) → Gerar conteúdos.** A IA cria em lotes de 3: roteiro, gancho, legenda, CTA e orientações de gravação ou design.
3. **Você confere e ajusta.** Tudo é editável, e as alterações salvam sozinhas.
4. **Aprovar e pôr no calendário.** Cria a tarefa no kanban (A fazer) e no calendário, na data escolhida.
5. **Grava e cola o link da pasta do Drive → Enviar para edição / design.** Manda os dados para o seu agente de edição pelo webhook configurado em *Integrações*.
6. **Clientes → Enviar no WhatsApp.** O cliente abre o portal, aprova ou pede ajuste. Se pedir ajuste, o conteúdo volta como urgente no kanban.
7. **Postagem automática (API da Meta).** Fica para a última etapa, como combinado.

## Publicar a função (uma vez)

Pré-requisitos: o banco já configurado (veja `CONFIGURAR-BANCO.md`) e uma chave da API da Anthropic, criada em console.anthropic.com → API Keys.

No Terminal do Mac:

```bash
brew install supabase/tap/supabase
```

```bash
supabase login
```

Dentro da pasta do projeto (a que contém `supabase/`):

```bash
supabase link --project-ref SEU_PROJECT_REF
```

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

```bash
supabase functions deploy gerar-conteudos
```

`SEU_PROJECT_REF` é o código que aparece na URL do projeto: `https://SEU_PROJECT_REF.supabase.co`.

## Custos

- Modelo usado: Claude Opus 5.5, com esforço médio.
- Cada lote de 3 conteúdos consome alguns milhares de tokens: centavos de dólar por lote.
- Acompanhe o gasto em console.anthropic.com → Usage. Lá você também pode definir um limite mensal.

## Integração com o agente de edição

Em **Criação → Integrações**, cole a URL do webhook que recebe os pedidos (n8n, Make, Zapier ou um servidor próprio).
O botão envia um `POST` em JSON com estes campos:

```json
{ "tipo": "edicao", "cliente": "…", "formato": "Reels", "data": "2026-11-20", "titulo": "…",
  "gancho": "…", "roteiro": "…", "cta": "…", "legenda": "…", "orientacoes": "…",
  "drive": "https://drive.google.com/…", "criacaoId": "…", "taskId": "…" }
```

Sem webhook configurado, o botão marca o conteúdo como "na fila" e copia o briefing para você colar onde quiser.
