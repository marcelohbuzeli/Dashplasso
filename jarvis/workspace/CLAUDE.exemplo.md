# Contexto do Jarvis (Plassô)

Esta pasta é a "mesa de trabalho" do Jarvis. Ele roda o Claude Code aqui dentro, então tudo
o que estiver neste arquivo vale como contexto em todo pedido de voz.

## Quem é o Marcelo e a Plassô
- Marcelo H Buzeli, dono da Plassô: agência de conteúdo para Instagram (roteiro, gravação,
  edição de reels, carrosséis e design) para clientes.
- Clientes conhecidos: <seus clientes>,
  e o próprio perfil Marcelo H Buzeli.

## Onde estão as coisas
- Google Drive (Drive para desktop): `~/Google Drive/Meu Drive/`
  - Clientes: `Meu Drive/CLIENTES/<CLIENTE>/<ANO>/<MM - Mês>/BRUTE/` → pasta do dia com o
    número entre colchetes, ex.: `[16] ...`.
  - Identidade de cada cliente: `Meu Drive/CLIENTES/<CLIENTE>/IDENTIDADE VISUAL/perfil.md`.
  - Marcelo: `Meu Drive/MARCELO H BUZELI/`.
- Desktop também tem `~/Desktop/CLIENTES`.

## Skills que você deve usar (já instaladas)
- Editar reels de cliente: `editor-plasso` (editor web do Marcelo) — padrão.
  Só use `premiere-video-cliente` se ele pedir Premiere.
- Design (carrossel, post, story, capa): `design-padrao` (sempre no Canva). Carla: `carrossel-carla`.
- Estudar um cliente novo: `perfil-cliente`.

## Dashplasso (sistema de gestão)
- Site: https://marcelohbuzeli.github.io/Dashplasso — código em github.com/marcelohbuzeli/Dashplasso.
- Banco Supabase com uma tabela `records` (owner, collection, id, data jsonb). Coleções:
  `clients`, `tasks` (kanban/calendário/conteúdos), `crm`, `fin_lancamentos`, `life_*`...
- Você tem acesso a TODOS os dados do Dashplasso pelas ferramentas `dash_*` (conector dashplasso).
  Agenda/compromissos do dia: sempre `dash_agenda` (traz a agenda do Google conectada no Calendário
  do Dashplasso, eventos, reuniões do CRM e conteúdos). Nunca diga que não vê a agenda sem chamar essa ferramenta.

## Regras
- Nunca enviar nada a cliente sem o Marcelo confirmar.
- Nunca sobrescrever arquivos de cliente no Drive.

> Copie este arquivo para `CLAUDE.md` (que não vai para o GitHub) e ajuste com seus clientes e pastas.
