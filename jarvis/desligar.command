#!/bin/bash
# Desliga o Jarvis que está rodando em segundo plano.
if pkill -INT -f '[.]venv/bin/python -m jarvis$'; then
  sleep 2
  pkill -f '[.]venv/bin/python -m jarvis$' 2>/dev/null
  echo "Jarvis desligado."
else
  echo "O Jarvis não estava ligado."
fi
