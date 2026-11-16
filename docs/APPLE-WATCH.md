# Apple Watch e iPhone: Modo Trabalho e Apple Pay pelos Atalhos

Tudo passa por uma função do Supabase chamada **atalho** (`supabase/functions/atalho`).
O Atalho não faz login: ele manda um **token** pessoal, criado dentro do sistema.

---

## 1. Publicar a função (uma vez, pelo navegador)

1. Abra o painel do Supabase → projeto **plasso** → **Edge Functions**.
2. **Deploy a new function** → **Via Editor**. Nome: `atalho`.
3. Apague o exemplo, cole o conteúdo de `supabase/functions/atalho/index.ts` e clique em **Deploy**.
4. Abra a função → **Details** → desligue **Enforce JWT Verification** → **Save**.
   (O Atalho não tem login. Quem protege é o token.)

## 2. Gerar o token

No sistema: **Menu (•••) → Apple Watch e iPhone → Gerar token → Copiar**.
O token só aparece uma vez. Se perder, gere outro (o antigo para de funcionar).

O endereço da função também aparece nessa tela:
`https://icarqnbtxrntogfsyavv.supabase.co/functions/v1/atalho`

---

## 3. Atalho "Trabalho" (Apple Watch)

Um atalho só faz tudo: escolher a tarefa, iniciar, pausar, concluir e encerrar.
A cada vez que você abre, ele mostra as opções do momento:

| Situação | O relógio mostra |
|----------|------------------|
| Fora do modo trabalho | As demandas por prioridade (▶️) e "Só iniciar o modo trabalho" |
| Tarefa rodando | ✅ Concluir · ⏸️ Pausar · 🔁 trocar para outra tarefa · ⏹️ Fim do trabalho |
| Sem tarefa rodando | ▶️ próxima tarefa · ⏹️ Fim do trabalho |

No app **Atalhos** do iPhone → **+** → nome **Trabalho**. Adicione as ações:

| # | Ação | Configuração |
|---|------|--------------|
| 1 | **Texto** | cole o token. Toque no resultado e renomeie a variável para **Token** |
| 2 | **Obter Conteúdo do URL** | URL: o endereço da função. Toque em **Mostrar Mais**: Método **POST**, Corpo da Solicitação **JSON**, adicione o campo `token` (Texto) = variável **Token** |
| 3 | **Obter Valor do Dicionário** | Obter **Valor** da chave `pergunta` em *Conteúdo do URL* |
| 4 | **Definir Variável** | Nome **Pergunta** = *Valor do Dicionário* |
| 5 | **Obter Valor do Dicionário** | Obter **Valor** da chave `opcoes` em *Conteúdo do URL* (o da ação 2) |
| 6 | **Escolher da Lista** | Lista: *Valor do Dicionário*. Toque em **Mostrar Mais** → Pedido: variável **Pergunta** |
| 7 | **Obter Conteúdo do URL** | mesmo endereço. POST, JSON, campos `token` = **Token** e `escolha` = *Item Escolhido* |
| 8 | **Obter Valor do Dicionário** | chave `mensagem` em *Conteúdo do URL* (o da ação 7) |
| 9 | **Mostrar Resultado** | *Valor do Dicionário* |

Depois, nos detalhes do atalho (ícone ⓘ), ligue **Mostrar no Apple Watch**.

**No relógio:** abra o app Atalhos, ou ponha o atalho numa **complicação** do mostrador
(editar mostrador → complicação → Atalhos → Trabalho), ou diga *"E aí Siri, trabalho"*.

**O que acontece no sistema:** o mesmo Modo Trabalho da Home. A página aberta no Mac ou iPhone
confere o banco a cada 15 segundos e quando você volta para ela: se você iniciou pelo relógio,
a tela muda para o Modo Trabalho sozinha; se encerrou, a sessão vai para o Relatório de tempo.
Concluir uma demanda da empresa pelo relógio também a move para **Pronto** e soma o tempo gasto.

---

## 4. Apple Pay: lançar sem abrir nada (recomendado)

Esta versão substitui a antiga, que abria `lancar.html` com o link.
**Por que a antiga não preenchia:** o valor chega como `R$ 23,50`, com espaço. Sem a ação
*Codificar URL* em cada variável, o iPhone corta o link no primeiro espaço e os campos se perdem.
Mandando os dados em JSON, esse problema deixa de existir.

App **Atalhos** → **Automação** → abra a automação **Transação** que você já criou (ou crie: cartões, **Executar Imediatamente**).
Apague as ações antigas e adicione:

| # | Ação | Configuração |
|---|------|--------------|
| 1 | **Obter Conteúdo do URL** | URL: o endereço da função. POST, JSON, com os campos abaixo |
| 2 | **Obter Valor do Dicionário** | chave `mensagem` |
| 3 | **Mostrar Notificação** | *Valor do Dicionário* |

Campos do JSON da ação 1:

| Campo | Tipo | Valor |
|-------|------|-------|
| `token` | Texto | o token |
| `acao` | Texto | `lancar` |
| `empresa` | Texto | variável **Entrada do Atalho**, toque nela e escolha **Comerciante** |
| `valor` | Texto | **Entrada do Atalho → Valor** |
| `cartao` | Texto | **Entrada do Atalho → Cartão ou Passe** (ou **Nome**) |
| `conta` | Texto | `Pessoal` ou `Empresa` (opcional; padrão Pessoal) |

Ao pagar, chega a notificação *"Lançado: Padaria Central · R$ 23,50 · Alimentação"*.
A categoria vem da última compra na mesma empresa. Se vier "sem categoria", ajuste no Financeiro.

### Prefere conferir antes de salvar?
Use a versão que abre a tela de lançamento (em `ATALHO-IPHONE.md`), mas passe **todas** as variáveis
por **Codificar URL** (Comerciante, Valor e Cartão), não só o Comerciante.
