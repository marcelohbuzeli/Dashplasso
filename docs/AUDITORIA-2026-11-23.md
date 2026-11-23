# Auditoria de segurança, velocidade e custo (23/11/2026)

Escopo: Dashplassô (site, Supabase `icarqnbtxrntogfsyavv`, Edge Functions, Jarvis) e Meu Editor (site, Supabase `ebtyzwsujufkdgxkbiho`, Edge Functions).

## Resultado
Nenhuma falha grave encontrada. Um risco de abuso de custo foi corrigido. A velocidade melhorou cerca de 18% no carregamento das páginas do Dashplassô.

## Dashplassô

| Item | Situação |
|---|---|
| Tabelas (`records`, `ig_*`) | RLS ligado em todas, só o dono acessa. O visitante anônimo não lê nem grava nada. ✅ |
| Arquivos (`postagens`, `projetos`, `referencias`) | Buckets privados, pasta por usuário. ✅ |
| Cadastro de contas | Desligado. Ninguém de fora cria login. ✅ |
| Funções liberadas sem login (`portal_*`, `briefing_*`, `site_orcamento`) | Exigem token de 32 caracteres aleatórios (criptográficos), só aceitam campos permitidos e têm limite de tamanho. ✅ |
| Edge Functions públicas | `atalho` (token com hash), `agenda-ics` e `drive-midia` (exigem login), `portfolio` (só lê a pasta pública do Drive), crons do Instagram (só processam a fila; métricas com trava de 6 h). ✅ |
| Chaves no código | Nenhuma. `config.js` só tem a chave publicável. A senha do Jarvis (`config.json`) fica fora do GitHub. ✅ |
| Textos de cliente e visitante na tela (XSS) | Passam por `esc()`; os avisos usam texto puro. ✅ |
| **Corrigido:** orçamento do site como porta de abuso | Antes: 30 pedidos por hora, e cada um abria uma análise no Jarvis (plano do Claude e abas no Chrome). Agora: 15 por hora, WhatsApp repetido em 24 h não cria lead novo e no máximo 20 análises automáticas por dia. |
| **Melhorado:** peso das páginas | Cada página baixava 1,4 MB. Agora `crm_perdidos` e `backup` só carregam no CRM e no backup: −250 KB por página. |

Observações (sem urgência):
- O cron das funções do Instagram pode ser chamado por qualquer um. Isso não vaza dados nem publica nada fora da fila, mas gasta chamadas da Meta. Já tem trava.
- `crm` (338 leads, 780 KB) ainda é carregado em quase todas as páginas, porque a lista de nomes de clientes usa os leads. Se o CRM crescer muito, vale buscar só os nomes.

## Meu Editor

| Item | Situação |
|---|---|
| `perfis` | O comprador só lê o próprio perfil e só altera `kit` e `nome` (permissão por coluna). Créditos, plano e status são intocáveis pelo app. ✅ |
| `projetos` e Storage | Só o dono, e só com acesso ativo (`tem_acesso()`): reembolso ou chargeback corta leitura e gravação na hora. ✅ |
| `gastar_creditos` | Atômica, recusa valor negativo ou acima de 100 e só funciona com acesso ativo. ✅ |
| `kiwify-webhook` | Confere a assinatura HMAC em tempo constante; sem assinatura válida responde 401. ✅ |
| `editar-ia` | Exige login e acesso ativo, confere os créditos antes, debita só se a receita voltar, limita o tamanho da transcrição e da imagem e usa cache no prompt de sistema. ✅ |
| Cadastro aberto | Desligado: conta só nasce pela compra ou pelo Marcelo. ✅ |
| Chaves no código | Nenhuma. ✅ |

Observações:
- O webhook também aceita `?token=` na URL (útil para teste). Depois de ligar na Kiwify, use só a assinatura.
- Não há cota de armazenamento por comprador (cada arquivo é limitado a 50 MB). O app só guarda o JSON do projeto e a miniatura, então o risco é baixo. Se aparecer abuso, dá para limitar por usuário.
- Antes de vender: SMTP próprio (sem ele o comprador não recebe o convite) e o token definitivo da Kiwify.

## Custo
Detalhes em `docs/CHAVES-E-CUSTOS.md`. Em resumo:
- tarefas internas (análises) rodam pelo Jarvis, no plano do Claude;
- as funções de IA usam cache e effort médio;
- a IA do Editor recebe só o texto, nunca o vídeo, e o custo sai dos créditos do comprador.
