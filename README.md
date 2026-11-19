# Macro Terminal

Terminale personale per l'analisi macro-economica, in stile Pip-Boy. Si usa in locale, nel browser.
**I dati li inserisci e li curi tu, a mano**: restano solo sul tuo computer (`data.json`) e non vengono mai pubblicati.

## Cosa c'è

- **Home**: KPI, mappa delle valute (forza economica × politica monetaria, colore = bias), tassi di interesse, sorprese macro e idee di trade attive.
- **Macro per Paese**: inflazione, disoccupazione, tassi e PIL con **attuale, previsto, precedente**. La sorpresa (attuale − previsto) si calcola da sola.
- **Idee di Trade**: livelli (ingresso, stop, target), R:R automatico, tesi, driver macro, trigger e invalidazione. Un segnale dice se la direzione è in linea con i bias scelti sulle valute.
- **Rischi Geopolitici**: matrice probabilità × impatto, trend, scenari, trigger e direzione per valuta.
- **Tool**: i link che usi ogni giorno (es. BlackRock Weekly Market Commentary), modificabili dall'app: aggiungi, cambia o elimina quelli che non funzionano.
- **Temi**: Pip-Boy (predefinito), scuro, chiaro, automatico (Impostazioni).

## Avvio

Serve **Python 3**. Al primo avvio il terminale prepara da solo l'ambiente (serve internet, una volta sola).

- **Mac**: doppio clic su `Avvia Macro Terminal.command`
  (se il Mac lo blocca: tasto destro → Apri; se non parte, da Terminale: `chmod +x "Avvia Macro Terminal.command" run.sh`)
- **Windows**: doppio clic su `Avvia Macro Terminal.bat`
- **Terminale (Mac/Linux)**: `./run.sh`

Si apre il browser su http://localhost:5051. Per fermarlo, chiudi la finestra del terminale.

Avvio manuale, senza i lanciatori:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

## I tuoi dati

- Al primo avvio viene creato `data.json` con **dati di esempio** (inventati): sostituiscili con la tua analisi.
- `data.json` è nel `.gitignore`: chi scarica il codice non riceve i tuoi dati.
- Da Impostazioni puoi esportare un backup in JSON.
- Le preferenze (tema, grandezza delle bolle, ecc.) sono nel `localStorage` del browser.

## Note

- Stack: Flask (un solo `app.py`), JavaScript e CSS senza framework né build.
- I font si caricano da Google Fonts; senza internet si usa un monospazio di sistema.
- Strumento di appoggio personale: non è un servizio, non fornisce dati di mercato né consigli di investimento.

## Licenza

MIT, vedi `LICENSE`.
