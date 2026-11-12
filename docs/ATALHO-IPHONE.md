# Atalho do iPhone: lançar compras automaticamente

O iPhone tem uma automação chamada **Transação**. Ela dispara quando você paga com **Apple Pay** usando um cartão da Carteira e entrega ao atalho o **nome do estabelecimento**, o **valor** e o **cartão**.

> **Limite:** só funciona com Apple Pay (aproximação no celular ou relógio, ou Apple Pay em sites e apps).
> Pix, cartão digitado em site e notificações de app de banco **não** disparam. Para esses casos, use o atalho manual (Parte 2).

O endereço do seu sistema aparece abaixo como `SEU-SITE`. Se ele estiver no GitHub Pages, é algo como `https://marcelohbuzeli.github.io/Dashplasso`.

---

## Antes de tudo: entre no sistema pelo Safari do iPhone

1. Abra `SEU-SITE/lancar.html` no Safari.
2. Faça login uma vez. O login fica salvo.
3. Opcional: toque em Compartilhar → **Adicionar à Tela de Início**. Isso cria um ícone "Lançar".

---

## Parte 1: automação da Carteira

1. Abra o app **Atalhos** e vá na aba **Automação**.
2. Toque em **Nova Automação** e escolha **Transação**.
3. Escolha os **cartões** que devem disparar a automação. Se quiser, filtre por categoria ou estabelecimento.
4. Marque **Executar Imediatamente** e toque em **Avançar**.
5. Escolha **Nova Automação em Branco** e adicione as ações nesta ordem:

| # | Ação | Configuração |
|---|------|--------------|
| 1 | **Codificar URL** | Entrada: variável **Entrada do Atalho → Comerciante** |
| 2 | **Texto** | `SEU-SITE/lancar.html?empresa=` + *(resultado da ação 1)* + `&valor=` + *(Entrada do Atalho → Valor)* + `&cartao=` + *(Entrada do Atalho → Cartão ou Nome)* |
| 3 | **Abrir URLs** | Entrada: o *Texto* da ação 2 |

**Como funciona:** ao pagar, abre a tela de lançamento já preenchida com empresa, valor e cartão. A categoria é sugerida automaticamente quando você já comprou naquela empresa antes. Confira e toque em **Lançar**.

### Quer que lance sozinho, sem abrir para conferir?
No final do texto da ação 2, acrescente `&auto=1`. O lançamento é salvo na hora e aparece a tela "Lançado!" com o botão **Desfazer**.

### Parâmetros aceitos pela página `lancar.html`

| Parâmetro | Exemplo | O que faz |
|-----------|---------|-----------|
| `empresa` | `Padaria%20Central` | Nome da empresa (pode ser editado na tela) |
| `valor` | `23,50` ou `R$ 23,50` | Valor |
| `cartao` | `Nubank` | Forma de pagamento |
| `tipo` | `entrada` | Padrão: `saida` |
| `conta` | `Empresa` | Padrão: `Pessoal` |
| `data` | `2026-11-11` | Padrão: hoje |
| `auto` | `1` | Salva sem precisar tocar em Lançar |

---

## Parte 2: atalho manual (Pix, boleto, compra online)

1. No app Atalhos, crie um **novo atalho** chamado "Lançar gasto".
2. Adicione a ação **Abrir URLs** com `SEU-SITE/lancar.html`.
3. Coloque o atalho na tela de início ou chame pelo Siri: *"E aí Siri, lançar gasto"*.

Também dá para pedir o valor por voz:
1. **Pedir Entrada** (Número): "Valor?"
2. **Pedir Entrada** (Texto): "Empresa?"
3. **Codificar URL** da empresa.
4. **Abrir URLs** com `SEU-SITE/lancar.html?empresa=…&valor=…`
