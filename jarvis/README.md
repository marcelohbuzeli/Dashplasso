# Jarvis — assistente de voz da Plassô

Você chama, ele ouve, faz e responde por voz. O "cérebro" é o Claude Code, então ele usa as
mesmas skills e conectores que você já tem (editor-plasso, Premiere, Canva, Drive, navegador...).

```
"Ei, Jarvis"  ou  👏👏   →  plim  →  você fala  →  Whisper (no Mac)  →  Claude Code  →  voz
```

## Ligar pela primeira vez

1. **Instale o Claude Code no Terminal e faça login** (uma vez):

   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```

   ```bash
   claude
   ```

   Na primeira abertura ele pede login no navegador. Depois de logado, digite `/exit`.

2. **Configure:** crie `config.json` nesta pasta com `{"dash_email": "...", "dash_senha": "...", "elevenlabs_chave": "..."}`
   (as duas últimas vão para o Keychain sozinhas) e copie `workspace/CLAUDE.exemplo.md` para `workspace/CLAUDE.md`.

3. **Ligue o Jarvis:** dois cliques em `ligar.command` (ou rode `./ligar.command` no Terminal).
   Na primeira vez o Mac pede permissão de **microfone** para o Terminal: aceite.
   Ele diz "Online, Marcelo." quando estiver pronto (uns 20 segundos).

## Segurança

- **Senhas e chaves** (Dashplasso, ElevenLabs) ficam no **Porta-chaves do Mac** (Keychain), criptografadas.
  Se você colar uma no `config.json`, o Jarvis move para o Keychain e apaga do arquivo na próxima vez que ligar.
- `config.json`, `logs/` e `workspace/CLAUDE.md` **nunca vão para o GitHub** (veja `.gitignore`).
- A ponte com a aba Jarvis só escuta neste Mac (127.0.0.1) e só aceita a página do Dashplasso **logada com a sua
  conta** (o Jarvis confere o login no Supabase).
- O Jarvis **não altera** financeiro, tokens nem configurações (só lê). Antes de enviar mensagem, postar ou apagar,
  ele pergunta "Posso?". Textos de clientes, páginas e documentos são tratados como dados, nunca como ordens.
- O cérebro não tem permissão para ler `config.json`, `logs/` nem o Keychain.

## Rápido e completo

O Jarvis tem dois "cérebros":

- **Rápido** (padrão para tudo): um Claude Code que fica sempre aberto, com modelo leve (`haiku`) e só as
  ferramentas do Dashplasso. Ele já tem na ponta da língua a agenda de hoje e amanhã, os conteúdos
  (atrasados, de hoje, urgentes, próximos dias, com o cliente), as tarefas da casa e as extras, atualizados
  a cada 3 minutos. Perguntas como "o que eu tenho pra hoje?" saem em 1 a 3 segundos.
- **Completo**: quando o pedido precisa de mais (editar vídeo, design, Canva, Drive, navegador, internet),
  o rápido passa sozinho para o completo, que tem todas as skills e conectores (mais lento, e tudo bem).

Ajustes no `config.json`: `"modelo_rapido": "sonnet"` (um pouco mais esperto, um pouco mais lento),
`"modo_rapido": false` (desliga o rápido), `"modelo": "..."` (modelo do completo).

## Como falar com ele

| Você | O que acontece |
|---|---|
| **"Ei, Jarvis"** ou **duas palmas** | Toca um "plim" e ele espera seu pedido |
| Fala o pedido e para | Toca um "pop", ele entende e começa |
| Depois que ele responde | Toca outro "plim": por 6 s dá para continuar sem chamar de novo (ex.: "pode", "manda") |
| Chamar no meio da fala dele | Ele para de falar e ouve você |
| "Para" / "cancela" | Para de falar e cancela a tarefa em andamento |
| "Nova conversa" | Esquece o contexto e começa do zero |

- Links e respostas completas aparecem na **notificação** do Mac e em `logs/ultima-resposta.txt`.
- Tarefas longas (editar um reels) rodam em segundo plano: você pode pedir outra coisa enquanto isso.
- Antes de enviar mensagem, postar, apagar ou mandar algo a cliente, ele **pergunta "Posso?"**.

## Dashplasso

O Jarvis entra no Dashplasso com o seu login (`dash_email` e `dash_senha` no `config.json`).
Exemplos do que pedir:

- "Como estamos?" / "O que tem pra hoje?": atrasados, próximos 7 dias, com o cliente, reprovados, financeiro do mês.
- "Acha o reels da Carla sobre bioestimulador." / "O que tem da Rosa Pink pra sexta?"
- "Passa o conteúdo da Carla de amanhã pra Pronto." / "Cria uma tarefa de carrossel pra Rosa Pink dia 25."
- **Enviar para edição / design** (no site ou no iPhone): em até 1 minuto ele avisa por voz e pergunta se
  pode começar. Respondendo "pode", ele edita (skill editor-plasso) ou cria o design (design-padrao), coloca o
  link final na tarefa e move para "Pronto".
- Métricas: quando a aba existir (coleção `metric...` no banco), "como foram os posts da Carla esse mês?".

Toda alteração fica em `logs/dashplasso-alteracoes.jsonl` com o valor anterior. Financeiro: só altera depois
de você confirmar.

## Tela do Jarvis (aba Jarvis do Dashplasso)

`https://marcelohbuzeli.github.io/Dashplasso/jarvis.html` (ou o botão **Jarvis** no menu de baixo).

- O círculo é o Jarvis: parado em repouso, ondas quando ouve, um arco girando quando pensa e o contorno
  mexendo com a voz quando fala.
- Tudo o que ele precisar te mostrar (links, vídeos, pastas do Drive, designs do Canva, relatórios, tabelas)
  aparece na tela da direita. Se a aba não estiver aberta, ele abre sozinho.
- Dá para digitar pedidos lá também.
- A conexão é direta com o Mac (`ws://127.0.0.1:8765`), então a parte ao vivo funciona no navegador deste Mac.
  Se o Chrome perguntar sobre "acessar dispositivos da rede local", permita. No iPhone ou com o Mac desligado,
  a aba mostra as últimas telas guardadas no Dashplasso.

## Ajustes (`config.json`)

Crie `config.json` nesta pasta só com o que quiser mudar:

```json
{
  "voz": "Luciana",
  "wake_limiar": 0.35,
  "palmas_sensibilidade": 0.6,
  "microfone": "MacBook Air"
}
```

- **Não está ouvindo o "Ei, Jarvis"?** Rode `./ligar.command --calibrar`, fale algumas vezes e veja a
  pontuação da "palavra". Coloque `wake_limiar` um pouco abaixo do que aparece quando você fala.
  Fale "Ei, Jarvis" com o "Ei" bem claro: o modelo foi treinado com "Hey, Jarvis".
- **Palmas disparando sozinhas / não disparando?** Ajuste `palmas_sensibilidade` (0 a 1).
- **Voz da ElevenLabs:** a chave fica em `elevenlabs_chave`. Troque a voz com `"elevenlabs_voz"`
  (nome de uma voz pronta — Daniel, Adam, Brian, George, Liam — ou o ID de qualquer voz da sua
  biblioteca). `"elevenlabs_modelo": "eleven_multilingual_v2"` deixa a voz mais caprichada, mas um
  pouco mais lenta. Sem internet ou sem chave, ele usa a voz do Mac.
- **Vozes em português no Mac (reserva):** Reed, Eddy, Luciana, Flo, Rocko... (`say -v '?' | grep pt_BR`).
  Vozes melhores: Ajustes do Sistema → Acessibilidade → Conteúdo Falado → Gerenciar Vozes.
- **Permissões do cérebro:** `"permissao": "auto"` (padrão) deixa o Claude decidir sozinho o que é
  seguro e bloquear o que é arriscado.

## Testes rápidos

```bash
./ligar.command --voz "Teste de voz do Jarvis"
```

```bash
./ligar.command --texto "Quais clientes eu tenho na pasta do Drive?"
```

## Botão "Ligar Jarvis no Mac" (aba Jarvis)

Quando o Jarvis está desligado, a aba Jarvis mostra o botão **Ligar Jarvis no Mac**. Para ele funcionar,
instale uma vez neste Mac o app que o botão chama:

```bash
./instalar-botao.sh
```

Isso cria `~/Applications/Ligar Jarvis.app` (também dá para abrir pelo Spotlight). Na primeira vez o Chrome pergunta
se pode abrir o app: marque "sempre permitir". Se ele já estiver ligado, o app só avisa e não abre outro.
Mudou a pasta do Jarvis de lugar? Rode `./instalar-botao.sh` de novo.

## Ligar sozinho quando o Mac iniciar

Ajustes do Sistema → Geral → Itens de Início → **+** → escolha `ligar.command`.

## Arquivos

```
jarvis/__main__.py   laço principal (chamado → ouvir → pedir → falar)
jarvis/audio.py      microfone, "Ei, Jarvis", duas palmas, gravação do pedido
jarvis/voz.py        fala (say do macOS) e transcrição (Whisper MLX)
jarvis/cerebro.py    Claude Code em segundo plano, com conversa contínua
jarvis/dashplasso.py login e leitura/escrita no banco do Dashplasso (Supabase)
jarvis/mcp_dashplasso.py ferramentas do Dashplasso que o Claude usa
jarvis/painel.py     ponte ao vivo com a aba Jarvis (estado, voz, telas)
jarvis/mcp_jarvis.py ferramenta "mostrar na tela" que o Claude usa
jarvis/persona.md    como ele fala e quando pede confirmação
workspace/CLAUDE.md  contexto da Plassô (clientes, Drive, skills, Dashplasso)
logs/                registro das conversas
```

## Próximas fases
2. ~~Dashplasso~~ (feito)
3. WhatsApp.
4. Postagem no Instagram e leitura da aba de métricas.
