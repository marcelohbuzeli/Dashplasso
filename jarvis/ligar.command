#!/bin/bash
# Dê dois cliques para ligar o Jarvis (ou rode no Terminal).
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then ./instalar.sh || exit 1; fi
exec .venv/bin/python -m jarvis "$@"
