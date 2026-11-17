"""Microfone, palavra de ativação ("Ei, Jarvis"), duas palmas e gravação do comando."""
from __future__ import annotations

import collections
import queue
import time

import numpy as np
import sounddevice as sd

from .config import Config


def rms(x: np.ndarray) -> float:
    if x.size == 0:
        return 0.0
    f = x.astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(f * f)))


class Microfone:
    """Captura contínua em 16 kHz mono; entrega blocos int16 de 80 ms numa fila."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.fila: "queue.Queue[np.ndarray]" = queue.Queue(maxsize=400)
        self.stream = None

    def _dispositivo(self):
        if not self.cfg.microfone:
            return None
        alvo = self.cfg.microfone.lower()
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] > 0 and alvo in d["name"].lower():
                return i
        print(f"[mic] '{self.cfg.microfone}' não encontrado; usando o padrão.")
        return None

    def _cb(self, indata, frames, t, status):
        bloco = indata[:, 0].copy()
        try:
            self.fila.put_nowait(bloco)
        except queue.Full:  # se atrasar, descarta o mais antigo
            try:
                self.fila.get_nowait()
                self.fila.put_nowait(bloco)
            except queue.Empty:
                pass

    def abrir(self):
        self.stream = sd.InputStream(samplerate=self.cfg.taxa, channels=1, dtype="int16",
                                     blocksize=self.cfg.bloco, device=self._dispositivo(),
                                     callback=self._cb)
        self.stream.start()
        nome = sd.query_devices(self.stream.device)["name"]
        print(f"[mic] ouvindo em: {nome}")

    def ler(self, timeout: float = 1.0):
        try:
            return self.fila.get(timeout=timeout)
        except queue.Empty:
            return None

    def esvaziar(self):
        while not self.fila.empty():
            try:
                self.fila.get_nowait()
            except queue.Empty:
                break

    def fechar(self):
        if self.stream:
            self.stream.stop()
            self.stream.close()


class Wake:
    """Palavra de ativação com openWakeWord (roda local, sem internet)."""

    def __init__(self, cfg: Config):
        from openwakeword import utils
        from openwakeword.model import Model
        utils.download_models([cfg.wake_modelo])
        self.modelo = Model(wakeword_models=[cfg.wake_modelo], inference_framework="onnx")
        self.limiar = cfg.wake_limiar
        self.ultimo = 0.0

    def pontuar(self, bloco: np.ndarray) -> float:
        pred = self.modelo.predict(bloco)
        return max(pred.values()) if pred else 0.0

    def detectou(self, bloco: np.ndarray) -> bool:
        s = self.pontuar(bloco)
        if s >= self.limiar and time.time() - self.ultimo > 2.0:
            self.ultimo = time.time()
            self.modelo.reset()
            return True
        return False

    def reset(self):
        self.modelo.reset()


class Palmas:
    """Detecta duas palmas: dois estalos curtos e fortes, de 0,15 s a 0,8 s de distância.

    Analisa em janelas de 10 ms. Um estalo é um salto brusco de volume (bem acima do
    ruído de fundo) que some rápido; fala e música sobem devagar e duram mais.
    """

    def __init__(self, cfg: Config):
        s = min(max(cfg.palmas_sensibilidade, 0.0), 1.0)
        self.min_nivel = 0.30 - 0.22 * s        # pico mínimo (0..1)
        self.fator = 12.0 - 7.0 * s             # quantas vezes acima do fundo
        self.janela = cfg.taxa // 100           # 10 ms
        self.fundo = 0.01
        self.ativo_ms = 0
        self.em_estalo = False
        self.estalos: collections.deque = collections.deque(maxlen=4)
        self.t = 0.0                            # relógio de áudio (s)
        self.ultimo_disparo = -10.0
        self.debug_pico = 0.0

    def detectou(self, bloco: np.ndarray) -> bool:
        f = bloco.astype(np.float32) / 32768.0
        disparou = False
        for i in range(0, len(f) - self.janela + 1, self.janela):
            w = f[i:i + self.janela]
            pico = float(np.max(np.abs(w)))
            nivel = float(np.sqrt(np.mean(w * w)))
            self.debug_pico = max(self.debug_pico, pico)
            self.t += 0.01
            forte = pico >= self.min_nivel and nivel >= self.fundo * self.fator
            if forte:
                if not self.em_estalo:
                    self.em_estalo = True
                    self.ativo_ms = 0
                    self._inicio = self.t
                self.ativo_ms += 10
            else:
                if self.em_estalo:
                    self.em_estalo = False
                    if self.ativo_ms <= 120:      # estalo curto = palma
                        self.estalos.append(self._inicio)
                        if self._dupla():
                            disparou = True
                # ruído de fundo acompanha devagar (só quando não há estalo)
                self.fundo = 0.995 * self.fundo + 0.005 * max(nivel, 0.002)
            if self.em_estalo and self.ativo_ms > 400:  # som longo: não é palma
                self.estalos.clear()
        return disparou

    def _dupla(self) -> bool:
        if len(self.estalos) < 2 or self.t - self.ultimo_disparo < 2.0:
            return False
        a, b = self.estalos[-2], self.estalos[-1]
        if 0.15 <= b - a <= 0.8:
            # uma terceira palma logo antes estraga (aplauso, batucada)
            if len(self.estalos) >= 3 and a - self.estalos[-3] < 0.8:
                return False
            self.estalos.clear()
            self.ultimo_disparo = self.t
            return True
        return False


class Gravador:
    """Grava o comando falado até você parar de falar (detector de voz simples por volume)."""

    def __init__(self, cfg: Config, mic: Microfone):
        self.cfg = cfg
        self.mic = mic
        self.niveis = collections.deque(maxlen=60)  # ~5 s de ruído de fundo
        self.ao_nivel = None                         # callback(0..1) para animar a tela

    def observar(self, bloco: np.ndarray):
        """Chamado o tempo todo em repouso, para aprender o ruído da sala."""
        self.niveis.append(rms(bloco))

    def limiar(self) -> float:
        fundo = float(np.median(self.niveis)) if self.niveis else 0.005
        return max(fundo * 3.0, 0.012)

    def gravar(self, espera_s: float | None = None) -> np.ndarray | None:
        cfg = self.cfg
        espera_s = cfg.espera_fala_s if espera_s is None else espera_s
        lim = self.limiar()
        dur = cfg.bloco / cfg.taxa
        blocos, falou_s, silencio_s, total_s = [], 0.0, 0.0, 0.0
        inicio = time.time()
        while True:
            b = self.mic.ler(timeout=1.0)
            if b is None:
                continue
            total_s += dur
            nivel = rms(b)
            alto = nivel >= lim
            if self.ao_nivel:
                self.ao_nivel(min(1.0, nivel * 6.0))
            if total_s < 0.25:          # ignora o "plim" de ativação
                continue
            if falou_s == 0.0:
                blocos = (blocos + [b])[-4:]   # guarda um pouquinho antes da fala
                if alto:
                    falou_s = dur
                elif time.time() - inicio > espera_s:
                    return None
                continue
            blocos.append(b)
            if alto:
                falou_s += dur
                silencio_s = 0.0
            else:
                silencio_s += dur
            if silencio_s >= cfg.silencio_fim_s or total_s >= cfg.fala_max_s:
                break
        if falou_s < 0.3:
            return None
        return np.concatenate(blocos)
