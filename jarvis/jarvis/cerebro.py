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
