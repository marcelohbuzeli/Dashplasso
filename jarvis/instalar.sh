#!/bin/bash
# Instala o que o Jarvis precisa (uma vez). Leva alguns minutos: baixa ~1,6 GB do Whisper.
set -e
cd "$(dirname "$0")"
UV="$(command -v uv || echo "$HOME/Library/Python/3.9/bin/uv")"
if [ ! -x "$UV" ]; then python3 -m pip install --user -q uv; UV="$HOME/Library/Python/3.9/bin/uv"; fi
"$UV" venv --python 3.12 .venv
"$UV" pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -c "from openwakeword import utils; utils.download_models(['hey_jarvis'])"
.venv/bin/python -c "import numpy as np, mlx_whisper; mlx_whisper.transcribe(np.zeros(8000, dtype=np.float32), path_or_hf_repo='mlx-community/whisper-large-v3-turbo', language='pt')"
echo "Pronto. Agora: ./ligar.command"
