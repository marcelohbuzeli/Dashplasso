# Chaves, segredos e custos (Dashplassô, Jarvis e Meu Editor)

Atualizado em 23/11/2026. Regra geral: **chave nunca vai no site**. Ela fica nos segredos das Edge Functions do Supabase, e quem cola é sempre o Marcelo.

## O que precisa da chave da Anthropic

| Onde | Para quê | Hoje, sem a chave | Custo estimado com a chave* |
|---|---|---|---|
| Dashplassô · `extrair-briefing` | Organizar com IA as anotações da reunião em briefing | Botão mostra "falta a chave" | ~US$ 0,02–0,05 por briefing |
| Dashplassô · `gerar-conteudos` | Criação IA: lote de roteiros, carrosséis e legendas | Mensagem clara de que falta a chave | ~US$ 0,10–0,30 por lote de 5–10 conteúdos |
| Meu Editor · `editar-ia` (Supabase do Editor) | Botão "Editar com IA" para os compradores | "IA em configuração" | ~US$ 0,02–0,06 por vídeo de 1 min (o custo é coberto pelos créditos do comprador) |
| Opcional · análise do orçamento na nuvem | Hoje o Jarvis faz no Mac | Funciona pelo Jarvis | ~US$ 0,15 por análise, se migrar |

\* Claude Opus 5.5: US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de saída; leitura de cache US$ 0,20. As estimativas valem com o prompt de sistema em cache.

**Onde colar:** Supabase → Edge Functions → Secrets → `ANTHROPIC_API_KEY`. Um segredo serve para todas as funções do Dashplassô. O Meu Editor tem o próprio Supabase e precisa do segredo lá também; dá para usar a mesma chave ou uma separada, que facilita ver o custo do produto à parte.

**Dica para começar barato:** em console.anthropic.com → Limits, defina um teto mensal de gasto (ex.: US$ 20). Assim nenhum erro gera conta alta.

## O que NÃO precisa da chave (roda pelo seu plano do Claude, no Mac, via Jarvis)
- Análise do Instagram de quem pede orçamento pelo site (CRM).
- Análise do mês do Instagram de cada cliente (Empresa → Instagram).
- Agentes Design e Editor de vídeo ("Chamar Design / Editor").
- Limite: só funciona com o Mac ligado e o Jarvis rodando.

## Outros segredos e chaves
| Segredo | Onde fica | Serve para | Custo |
|---|---|---|---|
| `META_IG_TOKEN` | Supabase (Dashplassô) → Secrets | Agendar posts, métricas e análises dos clientes | Grátis. Falta regenerar com as permissões de insights e de páginas (veja `docs/META-CLIENTES.md`) |
| Chave da Groq (`gsk_…`) | No aparelho de cada usuário do Meu Editor | Transcrição rápida (opcional; sem ela, roda o Whisper no aparelho) | Grátis com limite |
| Kit da Adobe Fonts `whw1itf` | Público no site da bio (permitido) | Fonte manuscrita Handsome Pro | Incluído no Creative Cloud |
| Chave publicável do Supabase | `assets/config.js` (pública, protegida pelo RLS) | Login e banco do Dashplassô | Plano grátis |
| Webhook da Kiwify (token) | Supabase do Editor → Secrets | Liberar e bloquear acesso dos compradores | Só a taxa por venda |

## Para gastar menos (já aplicado ou recomendado)
1. **Prompt de sistema em cache** nas funções de IA: a parte fixa (regras e marca) é cobrada a 5% depois da primeira chamada.
2. **Effort "medium"** em briefing e criação, e "low" em pesquisas simples, já configurado.
3. **A IA nunca recebe o vídeo** no Meu Editor: só a transcrição e o formulário, por isso custa centavos.
4. **Tarefas internas pelo Jarvis**: análises que não têm pressa rodam no plano do Claude, sem custo de API.
5. **Se quiser economizar mais**: trocar `extrair-briefing` para o Claude Haiku 5.5 (cerca de 40 vezes mais barato). Para extrair dados de um texto, a qualidade costuma se manter. É decisão sua; hoje está no Opus 5.5.
