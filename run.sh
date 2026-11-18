#!/bin/bash
# Avvia Macro Terminal (Mac / Linux). Apre il browser su http://localhost:5051
cd "$(dirname "$0")" || exit 1
PORT="${MT_PORT:-5051}"

pausa() { printf '\nPremi Invio per chiudere...'; read -r _; }

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 non trovato."
  echo "Installalo da https://www.python.org/downloads/ e rilancia questo comando."
  pausa; exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "Primo avvio: preparo l'ambiente (serve internet, una volta sola)..."
  if ! python3 -m venv .venv || ! .venv/bin/python -m pip install --quiet flask; then
    echo "Impossibile preparare l'ambiente. Controlla la connessione e riprova."
    rm -rf .venv; pausa; exit 1
  fi
fi

if [ -z "$MT_NO_OPEN" ]; then
  ( sleep 1.5
    if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT" >/dev/null 2>&1; fi ) &
fi

MT_PORT="$PORT" .venv/bin/python app.py
code=$?
[ $code -ne 0 ] && { echo "Il server si è fermato con errore ($code)."; pausa; }
exit $code
