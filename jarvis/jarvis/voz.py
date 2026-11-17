"""Fala (texto → voz) e transcrição (voz → texto)."""
from __future__ import annotations

import queue
import re
import subprocess
import threading

import numpy as np

from .config import Config

SONS = "/System/Library/Sounds"

# Frases que o Whisper "inventa" quando só ouve ruído.
ALUCINACOES = ("legendas pela comunidade", "amara.org", "obrigado por assistir",
               "inscreva-se", "legendado por", "transcrição de", "...")


def limpar_para_fala(t: str) -> str:
    t = re.sub(r"```.*?```", " ", t, flags=re.S)        # blocos de código
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)     # [texto](link) → texto
    t = re.sub(r"https?://\S+", "o link", t)
    t = re.sub(r"[*#>|~]+", "", t)
    t = re.sub(r"^\s*[-•]\s+", "", t, flags=re.M)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


class Fala:
    """Fila de frases faladas. Usa ElevenLabs (se houver chave) ou o `say` do macOS.

    Enquanto uma frase toca, a próxima já está sendo gerada, para não ter pausas.
    Pode ser interrompida a qualquer momento (calar).
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.eleven = ElevenLabs(cfg) if cfg.elevenlabs_chave else None
        self.textos: "queue.Queue[tuple[int, str]]" = queue.Queue()
        self.audios: "queue.Queue[tuple[int, object]]" = queue.Queue(maxsize=3)
        self.proc: subprocess.Popen | None = None
        self.falando = threading.Event()
        self._trava = threading.Lock()
        self._geracao = 0
        self._pendentes = 0
        self.ao_nivel = None        # callback(0..1) com o volume da voz, para animar a tela
        threading.Thread(target=self._sintetizar, daemon=True).start()
        threading.Thread(target=self._tocar, daemon=True).start()

    def dizer(self, texto: str):
        texto = limpar_para_fala(texto)
        if texto:
            with self._trava:
                self._pendentes += 1
                self.falando.set()
                g = self._geracao
            self.textos.put((g, texto))

    def _sintetizar(self):
        while True:
            g, texto = self.textos.get()
            if g != self._geracao:
                continue
            item: object = ("say", texto)
            if self.eleven:
                try:
                    item = ("pcm", self.eleven.gerar(texto))
                except Exception as e:  # noqa: BLE001 — sem internet/chave: voz do Mac
                    print(f"[voz] ElevenLabs falhou ({e}); usando a voz do Mac")
            self.audios.put((g, item))

    def _tocar(self):
        import sounddevice as sd
        while True:
            g, (tipo, dado) = self.audios.get()
            if g == self._geracao:
                if tipo == "pcm":
                    pcm = np.frombuffer(dado, dtype=np.int16)
                    with sd.OutputStream(samplerate=self.eleven.taxa, channels=1, dtype="int16") as out:
                        passo = self.eleven.taxa // 20  # 50 ms: dá para interromper rápido
                        for i in range(0, len(pcm), passo):
                            if g != self._geracao:
                                break
                            bloco = pcm[i:i + passo]
                            if self.ao_nivel and len(bloco):
                                v = float(np.sqrt(np.mean((bloco.astype(np.float32) / 32768.0) ** 2)))
                                self.ao_nivel(min(1.0, v * 4.0))
                            out.write(bloco)
                else:
                    with self._trava:
                        self.proc = subprocess.Popen(
                            ["say", "-v", self.cfg.voz, "-r", str(self.cfg.velocidade), dado],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    import random
                    import time as _t
                    while self.proc.poll() is None:      # voz do Mac: animação aproximada
                        if self.ao_nivel:
                            self.ao_nivel(0.25 + random.random() * 0.45)
                        _t.sleep(0.06)
                    with self._trava:
                        self.proc = None
            if self.ao_nivel:
                self.ao_nivel(0.0)
            with self._trava:
                if g == self._geracao:
                    self._pendentes = max(0, self._pendentes - 1)
                    if self._pendentes == 0:
                        self.falando.clear()

    def calar(self):
        with self._trava:
            self._geracao += 1
            self._pendentes = 0
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
            self.falando.clear()
        for fila in (self.textos, self.audios):
            while not fila.empty():
                try:
                    fila.get_nowait()
                except queue.Empty:
                    break

    def esperar(self, timeout: float = 120):
        import time
        fim = time.time() + timeout
        while self.falando.is_set() and time.time() < fim:
            time.sleep(0.05)

    @staticmethod
    def som(nome: str):
        subprocess.Popen(["afplay", f"{SONS}/{nome}.aiff"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class ElevenLabs:
    """Voz da ElevenLabs (API). Devolve áudio PCM 16 bits mono."""

    API = "https://api.elevenlabs.io/v1"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.chave = cfg.elevenlabs_chave
        self.taxa = 24000
        self.voz_id = self._resolver_voz(cfg.elevenlabs_voz)

    def _req(self, caminho: str, corpo: dict | None = None, timeout: float = 30):
        import json
        import urllib.request
        req = urllib.request.Request(
            self.API + caminho, method="POST" if corpo is not None else "GET",
            data=json.dumps(corpo).encode() if corpo is not None else None,
            headers={"xi-api-key": self.chave, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()

    def vozes(self) -> list[dict]:
        import json
        return json.loads(self._req("/voices"))["voices"]

    def _resolver_voz(self, voz: str) -> str:
        """Aceita o ID da voz ou o nome dela (como aparece na sua conta)."""
        if re.fullmatch(r"[A-Za-z0-9]{20}", voz or ""):
            return voz
        prontas = {"daniel": "onwK4e9ZLuTAKqWW03F9", "adam": "pNInz6obpgDQGcFmaJgB",
                   "brian": "nPczCjzI2devNBz1zQrb", "antoni": "ErXwobaYiN019PkySvjV",
                   "george": "JBFqnCBsd6RMkjVDRZzb", "liam": "TX3LPaxmHKxFdv7VdkXH"}
        if (voz or "").lower() in prontas:
            return prontas[voz.lower()]
        try:
            for v in self.vozes():
                if v["name"].lower().startswith((voz or "").lower()):
                    return v["voice_id"]
        except Exception as e:  # noqa: BLE001
            print(f"[voz] não achei a voz '{voz}' (a chave precisa da permissão voices_read para buscar por nome; ou use o ID): {e}")
        return "onwK4e9ZLuTAKqWW03F9"  # Daniel

    def gerar(self, texto: str) -> bytes:
        corpo = {
            "text": texto,
            "model_id": self.cfg.elevenlabs_modelo,
            "language_code": "pt",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "speed": self.cfg.elevenlabs_velocidade},
        }
        return self._req(f"/text-to-speech/{self.voz_id}?output_format=pcm_{self.taxa}", corpo)


class Frases:
    """Junta pedaços de texto em streaming e solta frase por frase para falar logo."""

    def __init__(self, fala: Fala):
        self.fala = fala
        self.buf = ""
        self.tudo = ""

    def adicionar(self, pedaco: str):
        self.buf += pedaco
        self.tudo += pedaco
        while True:
            m = re.search(r"[.!?…;:](?=\s)|\n", self.buf)
            if not m:
                break
            frase, self.buf = self.buf[:m.end()], self.buf[m.end():].lstrip()
            if len(frase.strip()) > 1:
                self.fala.dizer(frase)

    def terminar(self):
        if self.buf.strip():
            self.fala.dizer(self.buf)
        self.buf = ""


class Ouvido:
    """Transcrição local com Whisper (MLX, roda no chip M2)."""

    def __init__(self, cfg: Config):
        import mlx_whisper
        self.cfg = cfg
        self.mw = mlx_whisper
        # aquece o modelo para a primeira resposta não demorar
        self.transcrever(np.zeros(cfg.taxa // 2, dtype=np.int16))

    def transcrever(self, audio: np.ndarray) -> str:
        f = audio.astype(np.float32) / 32768.0
        r = self.mw.transcribe(f, path_or_hf_repo=self.cfg.whisper_modelo, language="pt",
                               initial_prompt=self.cfg.vocabulario,
                               condition_on_previous_text=False, fp16=True)
        texto = (r.get("text") or "").strip()
        baixo = texto.lower()
        if len(baixo) < 2 or any(a in baixo for a in ALUCINACOES) and len(baixo) < 60:
            return ""
        return texto
