"""Configurações do Jarvis.

Os valores padrão ficam aqui. Para mudar algo sem mexer no código,
crie/edite o arquivo `config.json` na pasta do projeto, por exemplo:

    {"voz": "Luciana", "palmas_sensibilidade": 0.7}
"""
from __future__ import annotations

import glob
import json
import os
import shutil
from dataclasses import dataclass, field, fields
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


@dataclass
class Config:
    # --- microfone ---
    microfone: str = ""                 # parte do nome do microfone ("" = padrão do Mac)
    taxa: int = 16000                   # Hz (não mude: wake word e Whisper usam 16 kHz)
    bloco: int = 1280                   # amostras por bloco (80 ms)

    # --- ativação ---
    wake_ativo: bool = True
    wake_modelo: str = "hey_jarvis"     # diga "Ei, Jarvis" / "Hey, Jarvis"
    wake_limiar: float = 0.40           # 0..1 (menor = dispara mais fácil)
    palmas_ativo: bool = True
    palmas_sensibilidade: float = 0.5   # 0..1 (maior = dispara mais fácil)

    # --- escuta do comando ---
    espera_fala_s: float = 6.0          # quanto tempo espera você começar a falar
    silencio_fim_s: float = 1.2         # silêncio que encerra a frase
    fala_max_s: float = 45.0
    continuar_s: float = 6.0            # depois que ele responde, ouve sem precisar chamar de novo

    # --- transcrição ---
    whisper_modelo: str = "mlx-community/whisper-large-v3-turbo"
    vocabulario: str = ("Jarvis, Marcelo, Plassô, Dashplasso, Premiere, Canva, Reels, "
                        "carrossel, roteiro, WhatsApp, Drive, Instagram, Carla Marques, Rosa Pink Lingerie")

    # --- voz ---
    voz: str = "Reed (Português (Brasil))"
    velocidade: int = 200               # palavras por minuto (voz do Mac)
    elevenlabs_chave: str = ""          # sua API key da ElevenLabs (vazio = voz do Mac)
    elevenlabs_voz: str = "Daniel"      # nome ou ID da voz (veja: ./ligar.command --vozes)
    elevenlabs_modelo: str = "eleven_flash_v2_5"   # rápido; "eleven_multilingual_v2" = mais caprichado
    elevenlabs_velocidade: float = 1.0  # 0.7 a 1.2

    # --- cérebro (Claude Code) ---
    claude_bin: str = ""                # vazio = acha sozinho
    permissao: str = "auto"             # auto | acceptEdits | manual | bypassPermissions
    modelo: str = ""                    # tarefas pesadas (editar, design...). vazio = o padrão do seu Claude Code
    modo_rapido: bool = True            # perguntas do dia a dia num Claude sempre aberto, modelo leve
    modelo_rapido: str = "haiku"        # "haiku" (mais rápido) ou "sonnet"
    nova_conversa_min: float = 20.0     # depois de X min parado, começa conversa nova
    aviso_trabalhando_s: float = 12.0   # se demorar, avisa "só um instante"

    # --- pastas ---
    workspace: str = str(RAIZ / "workspace")
    logs: str = str(RAIZ / "logs")

    extras: dict = field(default_factory=dict)

    @classmethod
    def carregar(cls) -> "Config":
        cfg = cls()
        arq = RAIZ / "config.json"
        if arq.exists():
            dados = json.loads(arq.read_text(encoding="utf-8"))
            nomes = {f.name for f in fields(cls)}
            for k, v in dados.items():
                if k in nomes:
                    setattr(cfg, k, v)
                else:
                    cfg.extras[k] = v
        Path(cfg.logs).mkdir(parents=True, exist_ok=True)
        cfg._segredos(arq)
        cfg.elevenlabs_chave = cfg.elevenlabs_chave or os.environ.get("ELEVENLABS_API_KEY", "")
        return cfg

    # ---------- segredos no Porta-chaves (Keychain) do macOS ----------
    SEGREDOS = ("elevenlabs_chave", "dash_senha")
    SERVICO = "Jarvis Plasso"

    def _segredos(self, arq: Path):
        """Senhas e chaves ficam no Keychain (criptografado), nunca no config.json.
        Se alguém colar uma no config.json, ela é movida para o Keychain e apagada do arquivo."""
        try:
            import keyring
        except ImportError:
            return
        mudou = False
        dados = json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}
        for nome in self.SEGREDOS:
            valor = str(dados.get(nome) or "")
            if valor and not valor.upper().startswith(("COLE", "SEU", "SUA")) and valor != "(no Keychain)":
                keyring.set_password(self.SERVICO, nome, valor)
                dados[nome] = "(no Keychain)"
                mudou = True
            guardado = keyring.get_password(self.SERVICO, nome) or ""
            if nome == "elevenlabs_chave":
                self.elevenlabs_chave = guardado
            else:
                self.extras[nome] = guardado
        if mudou:
            arq.write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")
        if arq.exists():
            os.chmod(arq, 0o600)
        os.chmod(self.logs, 0o700)

    def achar_claude(self) -> str:
        """Usa o `claude` do Terminal; se não houver, o que vem com o app Claude."""
        if self.claude_bin and Path(self.claude_bin).exists():
            return self.claude_bin
        no_path = shutil.which("claude")
        if no_path:
            return no_path
        for cand in (Path.home() / ".local/bin/claude", Path.home() / ".claude/local/claude"):
            if cand.exists():
                return str(cand)
        app = sorted(glob.glob(os.path.expanduser(
            "~/Library/Application Support/Claude/claude-code/*/*/claude.app/Contents/MacOS/claude")))
        if app:
            return app[-1]
        raise FileNotFoundError(
            "Não achei o Claude Code. Instale com: curl -fsSL https://claude.ai/install.sh | bash")
