"""Cérebro: o Claude Code rodando em segundo plano.

Cada pedido vira um `claude -p` com saída em streaming. O texto é falado frase a
frase enquanto chega. A conversa continua (--resume) até ficar parada por um tempo.
Como é o mesmo Claude Code, ele herda suas skills, conectores (Premiere, Canva,
Drive...) e o CLAUDE.md da pasta workspace/.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .config import RAIZ, Config

PERSONA = (RAIZ / "jarvis" / "persona.md").read_text(encoding="utf-8")
SINAL_COMPLETO = "[[COMPLETO]]"
FERRAMENTAS_ESCRITA = ("dash_atualizar", "dash_criar", "dash_concluir_envio")
RAPIDO = PERSONA + """

## MODO RÁPIDO (vale mais que qualquer regra acima)
Agora você é a camada rápida do Jarvis. Você só tem as ferramentas do Dashplasso (mcp__dashplasso__*) e
a tela do Jarvis (jarvis_mostrar). Responda em uma ou duas frases curtas, sem rodeios.
- Cada pedido pode vir com o PAINEL DO DIA (agenda de hoje e amanhã, conteúdos, casa, extras). Responda
  perguntas sobre o dia DIRETO pelo painel, sem chamar ferramentas. Só consulte o banco para o que não
  estiver lá (outro dia, outro cliente, detalhes de um conteúdo, financeiro, CRM...).
- Pode alterar o Dashplasso quando ele pedir: marcar tarefa da casa como feita (life_casa: ultimaVez =
  data de hoje AAAA-MM-DD), marcar extra como feita (life_extras: feitaEm = data de hoje), criar extra
  (dash_criar em life_extras com {nome, criadaEm: data e hora ISO de agora, feitaEm: null}), mudar status
  de conteúdo, criar tarefa. Confirme em poucas palavras ("Feito.", "Anotado.").
- Se o pedido precisar de QUALQUER coisa que você não tem aqui — editar vídeo, criar design, Canva,
  Premiere, Google Drive, navegador, internet, arquivos do Mac, skills, WhatsApp, e-mail, agenda do Google
  para criar evento, ou uma tarefa longa de várias etapas — responda SOMENTE com [[COMPLETO]] e nada mais
  (sem frase antes ou depois). Isso passa o pedido para o Jarvis completo, que tem tudo.
- Se ele responder "pode", "manda", "sim" a algo que só o Jarvis completo faz, também responda [[COMPLETO]].
"""


@dataclass
class Tarefa:
    pedido: str
    proc: subprocess.Popen | None = None
    sessao: str | None = None
    resposta: str = ""
    erro: str = ""
    inicio: float = field(default_factory=time.time)
    fim: float | None = None
    cancelada: bool = False
    escalar: bool = False      # modo rápido: o pedido precisa do Jarvis completo
    escreveu: bool = False     # alterou algo no Dashplasso


class Cerebro:
    def __init__(self, cfg: Config, log: Callable[[str], None] = print):
        self.cfg = cfg
        self.log = log
        self.bin = cfg.achar_claude()
        self.sessao: str | None = None
        self.ultimo_uso = 0.0
        self.tarefas: list[Tarefa] = []
        self._trava = threading.Lock()
        Path(cfg.workspace).mkdir(parents=True, exist_ok=True)
        self.log(f"[cérebro] Claude Code: {self.bin}")

    # ---------- estado ----------
    def ocupado(self) -> bool:
        return any(t.fim is None for t in self.tarefas)

    def nova_conversa(self):
        self.sessao = None

    def cancelar_tudo(self) -> int:
        n = 0
        for t in self.tarefas:
            if t.fim is None and t.proc and t.proc.poll() is None:
                t.cancelada = True
                t.proc.terminate()
                n += 1
        return n

    # ---------- execução ----------
    def _ambiente(self) -> dict:
        env = dict(os.environ)
        # Se o Jarvis for aberto de dentro de outra sessão do Claude, não herdar o vínculo dela.
        for k in list(env):
            if k == "CLAUDECODE" or k.startswith("CLAUDE_CODE_") or k == "CLAUDE_PID":
                env.pop(k)
        return env

    def _mcp_config(self) -> str:
        """Conectores próprios do Jarvis (por enquanto: Dashplasso)."""
        import sys
        arq = Path(self.cfg.logs) / "mcp-jarvis.json"
        conf = {"mcpServers": {"dashplasso": {
            "command": sys.executable, "args": ["-m", "jarvis.mcp_dashplasso"],
            "env": {"PYTHONPATH": str(RAIZ)}},
            "jarvis_tela": {
            "command": sys.executable, "args": ["-m", "jarvis.mcp_jarvis"],
            "env": {"PYTHONPATH": str(RAIZ)}}}}
        arq.write_text(json.dumps(conf, indent=2))
        return str(arq)

    def _settings(self) -> str:
        """Regras extras: o cérebro não pode ler os segredos e registros do próprio Jarvis."""
        arq = Path(self.cfg.logs) / "settings-jarvis.json"
        r = str(RAIZ)
        conf = {"permissions": {"deny": [
            f"Read(/{r}/config.json)", f"Edit(/{r}/config.json)",
            f"Read(/{r}/logs/**)", f"Edit(/{r}/logs/**)",
            "Bash(security:*)", "Bash(cat:*config.json*)", "Bash(*/.dash_sessao*)", "Bash(*/.painel_token*)",
        ]}}
        arq.write_text(json.dumps(conf, indent=2))
        return str(arq)

    def _comando(self, pedido: str, continuar: str | None) -> list[str]:
        cmd = [self.bin, "-p", pedido,
               "--settings", self._settings(),
               "--mcp-config", self._mcp_config(),
               "--allowedTools", "mcp__dashplasso__*", "mcp__jarvis_tela__*",
               "--output-format", "stream-json", "--verbose", "--include-partial-messages",
               "--permission-mode", self.cfg.permissao,
               "--append-system-prompt", PERSONA]
        if self.cfg.modelo:
            cmd += ["--model", self.cfg.modelo]
        if continuar:
            cmd += ["--resume", continuar]
        return cmd

    def perguntar(self, pedido: str, ao_texto: Callable[[str], None],
                  ao_terminar: Callable[[Tarefa], None], paralela: bool = False) -> Tarefa:
        """Roda em segundo plano. `ao_texto` recebe pedaços de texto para falar."""
        with self._trava:
            if time.time() - self.ultimo_uso > self.cfg.nova_conversa_min * 60:
                self.sessao = None
            continuar = None if paralela else self.sessao
            self.ultimo_uso = time.time()
        t = Tarefa(pedido)
        self.tarefas = [x for x in self.tarefas if x.fim is None or time.time() - x.fim < 3600]
        self.tarefas.append(t)
        threading.Thread(target=self._rodar, args=(t, continuar, paralela, ao_texto, ao_terminar),
                         daemon=True).start()
        return t

    def _rodar(self, t: Tarefa, continuar, paralela, ao_texto, ao_terminar):
        cmd = self._comando(t.pedido, continuar)
        log_arq = Path(self.cfg.logs) / f"claude-{time.strftime('%Y%m%d')}.jsonl"
        try:
            t.proc = subprocess.Popen(cmd, cwd=self.cfg.workspace, env=self._ambiente(),
                                      stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, bufsize=1)
        except Exception as e:  # noqa: BLE001
            t.erro = str(e)
            t.fim = time.time()
            ao_terminar(t)
            return

        teve_parcial = False
        with open(log_arq, "a", encoding="utf-8") as log:
            log.write(json.dumps({"pedido": t.pedido, "hora": time.strftime("%H:%M:%S")},
                                 ensure_ascii=False) + "\n")
            for linha in t.proc.stdout:
                log.write(linha)
                try:
                    ev = json.loads(linha)
                except json.JSONDecodeError:
                    continue
                tipo = ev.get("type")
                if tipo == "system" and ev.get("subtype") == "init":
                    t.sessao = ev.get("session_id")
                elif tipo == "stream_event":
                    e = ev.get("event", {})
                    if (ev.get("parent_tool_use_id") is None and e.get("type") == "content_block_delta"
                            and e.get("delta", {}).get("type") == "text_delta"):
                        teve_parcial = True
                        ao_texto(e["delta"]["text"])
                    elif e.get("type") == "message_stop" and teve_parcial:
                        ao_texto("\n")
                elif tipo == "assistant" and not teve_parcial and ev.get("parent_tool_use_id") is None:
                    # versões sem streaming parcial: fala o texto da mensagem inteira
                    for bloco in ev.get("message", {}).get("content", []):
                        if bloco.get("type") == "text":
                            ao_texto(bloco["text"] + "\n")
                elif tipo == "result":
                    t.resposta = ev.get("result") or ""
                    t.sessao = ev.get("session_id") or t.sessao
                    if ev.get("is_error"):
                        t.erro = t.resposta or ev.get("subtype", "erro")
        t.proc.wait()
        if t.proc.returncode and not t.erro and not t.cancelada:
            t.erro = (t.proc.stderr.read() or f"código {t.proc.returncode}").strip()[-500:]
        t.fim = time.time()
        if t.sessao and not paralela and not t.cancelada:
            self.sessao = t.sessao
        ao_terminar(t)


class CerebroRapido:
    """Camada rápida: um Claude Code que fica sempre aberto (sem tempo de inicialização), com modelo leve
    e só as ferramentas do Dashplasso e da tela. Responde o dia a dia em ~1 s; o que for pesado ele
    devolve com [[COMPLETO]] e o Jarvis passa para o Cerebro completo."""

    MAX_TURNOS = 40

    def __init__(self, cfg: Config, base: Cerebro, log: Callable[[str], None] = print):
        self.cfg, self.base, self.log = cfg, base, log
        self.proc: subprocess.Popen | None = None
        self.turnos = 0
        self.ultimo_uso = 0.0
        self.atual: Tarefa | None = None
        self._trava = threading.Lock()
        self._painel_enviado = ""

    # ---------- processo ----------
    def _comando(self) -> list[str]:
        return [self.base.bin, "-p", "--input-format", "stream-json",
                "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                "--model", self.cfg.modelo_rapido,
                "--strict-mcp-config", "--mcp-config", self.base._mcp_config(),
                "--settings", self.base._settings(),
                "--allowedTools", "mcp__dashplasso__*", "mcp__jarvis_tela__*",
                "--permission-mode", self.cfg.permissao,
                "--append-system-prompt", RAPIDO]

    def _parar_proc(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            try:
                p.stdin.close()
            except Exception:  # noqa: BLE001
                pass
            p.terminate()

    def _garantir_proc(self):
        velho = time.time() - self.ultimo_uso > self.cfg.nova_conversa_min * 60
        if self.proc and (self.proc.poll() is not None or self.turnos >= self.MAX_TURNOS or (velho and self.turnos)):
            self._parar_proc()
        if not self.proc:
            self.proc = subprocess.Popen(self._comando(), cwd=self.cfg.workspace, env=self.base._ambiente(),
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.DEVNULL, text=True, bufsize=1)
            self.turnos = 0
            self._painel_enviado = ""

    def ocupado(self) -> bool:
        return self.atual is not None and self.atual.fim is None

    def nova_conversa(self):
        with self._trava:
            self._parar_proc()
        self.aquecer()

    def cancelar(self) -> int:
        t = self.atual
        if t and t.fim is None:
            t.cancelada = True
            self._parar_proc()   # o laço de leitura termina; o próximo pedido abre outro processo
            return 1
        return 0

    def aquecer(self):
        """Abre o processo e faz uma pergunta boba, para o primeiro pedido de verdade já sair rápido."""
        def rodar():
            t = Tarefa("(aquecimento)")
            with self._trava:
                self._executar(t, "Aquecimento do sistema: responda só ok.", lambda _x: None, "")
            self.log(f"[rápido] pronto ({self.cfg.modelo_rapido}, {(t.fim or time.time()) - t.inicio:.1f}s)"
                     if not t.erro else f"[rápido] falhou ao aquecer: {t.erro}")
        threading.Thread(target=rodar, daemon=True).start()

    # ---------- pedido ----------
    def perguntar(self, pedido: str, painel: str, ao_texto: Callable[[str], None],
                  ao_terminar: Callable[[Tarefa], None]) -> Tarefa:
        t = Tarefa(pedido)
        self.atual = t

        def rodar():
            with self._trava:
                if t.cancelada:
                    t.fim = time.time()
                else:
                    self._executar(t, pedido, ao_texto, painel)
            ao_terminar(t)
        threading.Thread(target=rodar, daemon=True).start()
        return t

    def _executar(self, t: Tarefa, pedido: str, ao_texto: Callable[[str], None], painel: str):
        try:
            self._garantir_proc()
            msg = pedido
            if painel:   # o painel só vai de novo quando muda (ou num processo novo)
                if painel != self._painel_enviado:
                    msg = f"{painel}\n\nPEDIDO DO MARCELO: {pedido}"
                    self._painel_enviado = painel
                else:
                    msg = f"[painel do dia: igual ao último enviado]\nPEDIDO DO MARCELO: {pedido}"
            self.proc.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": msg}},
                                             ensure_ascii=False) + "\n")
            self.proc.stdin.flush()
        except Exception as e:  # noqa: BLE001
            self._parar_proc()
            t.erro = f"modo rápido: {e}"
            t.fim = time.time()
            return
        self.turnos += 1
        self.ultimo_uso = time.time()
        buf, decidido = "", False
        log_arq = Path(self.cfg.logs) / f"claude-{time.strftime('%Y%m%d')}.jsonl"
        with open(log_arq, "a", encoding="utf-8") as log:
            log.write(json.dumps({"pedido": t.pedido, "modo": "rapido", "hora": time.strftime("%H:%M:%S")},
                                 ensure_ascii=False) + "\n")
            proc = self.proc
            for linha in proc.stdout:
                log.write(linha)
                try:
                    ev = json.loads(linha)
                except json.JSONDecodeError:
                    continue
                tipo = ev.get("type")
                if tipo == "stream_event" and ev.get("parent_tool_use_id") is None:
                    e = ev.get("event", {})
                    if e.get("type") == "content_block_delta" and e.get("delta", {}).get("type") == "text_delta":
                        pedaco = e["delta"]["text"]
                        if decidido:
                            if not t.escalar:
                                ao_texto(pedaco)
                            continue
                        buf += pedaco
                        b = buf.lstrip()
                        if b.startswith(SINAL_COMPLETO):
                            t.escalar = decidido = True
                        elif b and not SINAL_COMPLETO.startswith(b[:len(SINAL_COMPLETO)]):
                            decidido = True
                            ao_texto(buf)
                    elif e.get("type") == "message_stop" and decidido and not t.escalar:
                        ao_texto("\n")
                elif tipo == "assistant":
                    for bloco in ev.get("message", {}).get("content", []):
                        if bloco.get("type") == "tool_use" and str(bloco.get("name", "")).endswith(FERRAMENTAS_ESCRITA):
                            t.escreveu = True
                elif tipo == "result":
                    t.resposta = (ev.get("result") or "").strip()
                    if SINAL_COMPLETO in t.resposta:
                        t.escalar = True
                    elif not decidido and buf.strip():
                        ao_texto(buf)
                    if ev.get("is_error"):
                        t.erro = t.resposta or ev.get("subtype", "erro")
                    break
            else:
                if not t.cancelada:
                    t.erro = t.erro or "o modo rápido fechou sem responder"
                self._parar_proc()
        t.fim = time.time()
