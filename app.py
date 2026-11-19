"""Macro Terminal — terminale personale per l'analisi macro-economica.

Backend minimale: Flask + un file data.json (dati curati a mano, mai pubblicati).
API REST generica:
    GET    /api/data
    POST   /api/<collezione>
    PUT    /api/<collezione>/<id>
    DELETE /api/<collezione>/<id>
"""
import json
import logging
import os
import socket
import sys
import tempfile
import threading
import uuid

from flask import Flask, cli, jsonify, render_template, request

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, "data.json")
COLLECTIONS = ("countries", "risks", "trades", "tools")
PORT = int(os.environ.get("MT_PORT", "5051"))

app = Flask(__name__)
_lock = threading.Lock()


def ind(v, f, p, impact="medio"):
    return {"v": v, "f": f, "p": p, "impact": impact}


def country(cid, name, code, flag, bias, mx, my, note, infl, unemp, rate, gdp):
    return {
        "id": cid, "name": name, "code": code, "flag": flag, "bias": bias,
        "mx": mx, "my": my, "note": note,
        "ind": {"inflation": infl, "unemployment": unemp, "rate": rate, "gdp": gdp},
    }


# Dati di ESEMPIO: servono solo a vedere il terminale in funzione.
# Sostituiscili con la tua analisi (dalla pagina "Macro per Paese").
SEED = {
    "countries": [
        country("c_usa", "Stati Uniti", "USD", "🇺🇸", "molto_long", 72, 24,
                "Economia resiliente, Fed prudente sui tagli.",
                ind(3.1, 3.0, 3.2, "alto"), ind(4.2, 4.1, 4.1, "alto"),
                ind(4.50, 4.50, 4.75, "alto"), ind(2.8, 2.5, 3.0, "alto")),
        country("c_eur", "Eurozona", "EUR", "🇪🇺", "neutro", 38, 52,
                "Crescita debole, BCE in fase di allentamento graduale.",
                ind(2.2, 2.3, 2.4, "alto"), ind(6.3, 6.3, 6.4, "medio"),
                ind(2.75, 2.75, 3.00, "alto"), ind(0.9, 1.0, 0.8, "medio")),
        country("c_gbp", "Regno Unito", "GBP", "🇬🇧", "long", 55, 40,
                "Inflazione dei servizi ancora alta, BoE cauta.",
                ind(3.4, 3.1, 3.0, "alto"), ind(4.4, 4.3, 4.3, "medio"),
                ind(4.50, 4.50, 4.75, "alto"), ind(1.1, 1.3, 1.0, "medio")),
        country("c_jpy", "Giappone", "JPY", "🇯🇵", "short", 33, 82,
                "BoJ molto graduale nella normalizzazione, yen debole.",
                ind(3.6, 3.4, 3.0, "alto"), ind(2.5, 2.5, 2.5, "basso"),
                ind(0.50, 0.50, 0.25, "alto"), ind(0.7, 0.9, 0.3, "medio")),
        country("c_chf", "Svizzera", "CHF", "🇨🇭", "neutro", 52, 75,
                "Inflazione contenuta, SNB vicina al tasso zero.",
                ind(0.4, 0.5, 0.6, "medio"), ind(2.8, 2.8, 2.7, "basso"),
                ind(0.25, 0.25, 0.50, "alto"), ind(1.4, 1.2, 1.1, "medio")),
        country("c_cad", "Canada", "CAD", "🇨🇦", "short", 26, 44,
                "Mercato del lavoro in rallentamento, BoC in taglio.",
                ind(2.0, 2.2, 2.3, "alto"), ind(6.8, 6.6, 6.7, "alto"),
                ind(3.00, 3.00, 3.25, "alto"), ind(1.5, 1.8, 2.0, "medio")),
        country("c_aud", "Australia", "AUD", "🇦🇺", "long", 62, 62,
                "RBA ferma, inflazione ancora sopra target.",
                ind(2.8, 2.6, 2.6, "alto"), ind(4.1, 4.2, 4.1, "medio"),
                ind(4.10, 4.10, 4.35, "alto"), ind(1.3, 1.4, 1.0, "medio")),
        country("c_nzd", "Nuova Zelanda", "NZD", "🇳🇿", "molto_short", 16, 20,
                "Recessione tecnica, RBNZ in taglio aggressivo.",
                ind(2.2, 2.4, 2.2, "medio"), ind(5.1, 4.9, 4.8, "alto"),
                ind(3.75, 3.75, 4.25, "alto"), ind(-0.5, -0.2, -0.9, "alto")),
    ],
    "risks": [
        {"id": "r_1", "title": "Tensioni commerciali USA–Cina", "region": "Asia / USA",
         "likelihood": "alto", "impact": "alto", "trend": "su", "status": "escalation",
         "ccy": "USD, CNH, AUD, NZD",
         "ccy_dir": {"USD": "pos", "CNH": "neg", "AUD": "neg", "NZD": "neg"},
         "note": "Possibili nuovi dazi e misure di ritorsione sulle catene del valore.",
         "scen_up": "Nuovi dazi e ritorsioni: pressione su AUD e NZD, flussi verso JPY e CHF.",
         "scen_down": "Tregua o accordo parziale: recupero delle valute legate alla crescita globale.",
         "triggers": "Annunci della Casa Bianca su dazi\nRisposta del Ministero del Commercio cinese\nUSD/CNH sopra i massimi recenti"},
        {"id": "r_2", "title": "Conflitto in Medio Oriente", "region": "Medio Oriente",
         "likelihood": "medio", "impact": "alto", "trend": "stabile", "status": "monitoraggio",
         "ccy": "CHF, JPY, USD",
         "ccy_dir": {"CHF": "pos", "JPY": "pos", "USD": "pos"},
         "note": "Rischio sull'offerta di petrolio e sui flussi verso le valute rifugio.",
         "scen_up": "Petrolio in forte rialzo, avversione al rischio: CHF e JPY in forza.",
         "scen_down": "Premio al rischio in calo, ritorno ai carry trade.",
         "triggers": "Attacchi su infrastrutture energetiche\nBrent sopra area di resistenza\nDichiarazioni OPEC+"},
        {"id": "r_3", "title": "Guerra in Ucraina", "region": "Europa orientale",
         "likelihood": "medio", "impact": "medio", "trend": "giu", "status": "monitoraggio",
         "ccy": "EUR, CHF",
         "ccy_dir": {"EUR": "neg", "CHF": "pos"},
         "note": "Impatto sull'energia europea e sul sentiment verso EUR.",
         "scen_up": "Nuovo shock sul gas: EUR sotto pressione.",
         "scen_down": "Negoziati: sollievo su energia e fiducia in Eurozona.",
         "triggers": "Colloqui diplomatici\nPrezzo del gas TTF"},
        {"id": "r_4", "title": "Instabilità politica in Francia", "region": "Europa",
         "likelihood": "medio", "impact": "medio", "trend": "su", "status": "monitoraggio",
         "ccy": "EUR",
         "ccy_dir": {"EUR": "neg"},
         "note": "Spread OAT–Bund da tenere sotto controllo.",
         "scen_up": "Spread in allargamento e EUR debole.",
         "scen_down": "Governo stabile e spread in calo.",
         "triggers": "Voto di fiducia in Parlamento\nSpread OAT–Bund sopra soglia"},
        {"id": "r_5", "title": "Tensione su Taiwan", "region": "Asia",
         "likelihood": "basso", "impact": "alto", "trend": "stabile", "status": "rientrato",
         "ccy": "JPY, AUD",
         "ccy_dir": {"JPY": "pos", "AUD": "neg"},
         "note": "Per ora solo retorica, nessuna escalation concreta.",
         "scen_up": "Blocco navale o esercitazioni estese: forte risk-off globale.",
         "scen_down": "Distensione diplomatica.",
         "triggers": "Esercitazioni militari nello Stretto\nSanzioni su aziende tecnologiche"},
    ],
    "trades": [
        {"id": "t_1", "instrument": "EUR/USD", "dir": "short", "status": "attiva", "horizon": "medio", "conv": 3,
         "entry": 1.0850, "stop": 1.0950, "target": 1.0650, "target2": 1.0550, "risk_pct": 1.0,
         "date_open": "2026-11-10", "date_close": "", "result": None,
         "thesis": "Divergenza di politica monetaria: BCE in allentamento, Fed prudente. Dollaro sostenuto dai dati.",
         "drivers": "Differenziale tassi USA–Eurozona\nSorprese macro USA sopra il previsto\nCrescita debole in Eurozona",
         "trigger": "Rimbalzo verso 1.0850 con rifiuto sulla resistenza",
         "invalid": "Chiusura giornaliera sopra 1.0950",
         "note": "Dimezzare a target 1, stop a pareggio."},
        {"id": "t_2", "instrument": "AUD/JPY", "dir": "long", "status": "watchlist", "horizon": "medio", "conv": 2,
         "entry": 99.50, "stop": 98.00, "target": 103.00, "target2": None, "risk_pct": 0.75,
         "date_open": "", "date_close": "", "result": None,
         "thesis": "RBA ferma mentre la BoJ resta molto graduale: carry positivo se il clima di rischio regge.",
         "drivers": "Differenziale tassi AUD–JPY\nClima di rischio globale",
         "trigger": "Pullback sul supporto con ripresa del risk-on",
         "invalid": "Risk-off con VIX in forte rialzo",
         "note": ""},
        {"id": "t_3", "instrument": "NZD/CAD", "dir": "short", "status": "watchlist", "horizon": "breve", "conv": 1,
         "entry": 0.8120, "stop": 0.8200, "target": 0.7950, "target2": None, "risk_pct": 0.5,
         "date_open": "", "date_close": "", "result": None,
         "thesis": "Recessione tecnica in Nuova Zelanda e RBNZ in taglio aggressivo.",
         "drivers": "PIL Nuova Zelanda negativo\nDecisione RBNZ",
         "trigger": "Dato di PIL/occupazione NZ sotto il previsto",
         "invalid": "Rimbalzo dei dati NZ e petrolio in forte calo (debole CAD)",
         "note": "Idea a bassa convinzione, valutare solo con conferma dal dato."},
        {"id": "t_4", "instrument": "GBP/CHF", "dir": "long", "status": "chiusa", "horizon": "breve", "conv": 2,
         "entry": 1.1120, "stop": 1.1050, "target": 1.1260, "target2": None, "risk_pct": 0.5,
         "date_open": "2026-10-28", "date_close": "2026-11-05", "result": 1.8,
         "thesis": "Inflazione dei servizi UK sopra il previsto, BoE cauta sui tagli.",
         "drivers": "CPI UK sopra il previsto",
         "trigger": "Rottura della resistenza dopo il dato",
         "invalid": "Rientro sotto 1.1050",
         "note": "Chiusa vicino al target 1."},
    ],
    # Link utili (pagina Tool): da qui puoi aggiungerne, cambiarli o eliminarli dall'app.
    "tools": [
        {"id": "tool_1", "name": "Trading Economics", "cat": "Dati",
         "d": "Calendario economico, indicatori e previsioni per ogni paese.", "u": "https://tradingeconomics.com/"},
        {"id": "tool_2", "name": "BlackRock Weekly Market Commentary", "cat": "Analisi",
         "d": "Il commento settimanale del BlackRock Investment Institute sui mercati.",
         "u": "https://www.blackrock.com/us/individual/insights/blackrock-investment-institute/weekly-commentary"},
        {"id": "tool_3", "name": "Federal Reserve (FED)", "cat": "Banche centrali", "code": "USD",
         "d": "Report, comunicati e verbali sulla politica monetaria USA.", "u": "https://www.federalreserve.gov/monetarypolicy.htm"},
        {"id": "tool_4", "name": "European Central Bank (BCE)", "cat": "Banche centrali", "code": "EUR",
         "d": "Bollettino economico, decisioni e report della BCE.", "u": "https://www.ecb.europa.eu/press/economic-bulletin/html/index.en.html"},
        {"id": "tool_5", "name": "Bank of Canada (BOC)", "cat": "Banche centrali", "code": "CAD",
         "d": "Monetary Policy Report e decisioni sui tassi del Canada.", "u": "https://www.bankofcanada.ca/publications/mpr/"},
        {"id": "tool_6", "name": "Bank of England (BOE)", "cat": "Banche centrali", "code": "GBP",
         "d": "Monetary Policy Report e verbali del MPC del Regno Unito.", "u": "https://www.bankofengland.co.uk/monetary-policy-report/monetary-policy-reports"},
    ],
}


def load():
    if not os.path.exists(DATA_FILE):
        save(SEED)
        return json.loads(json.dumps(SEED))
    with open(DATA_FILE, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    changed = False
    for c in COLLECTIONS:
        if c not in data:
            # una sola volta: i Tool partono con l'elenco di esempio, poi sono tuoi (anche vuoti)
            data[c] = json.loads(json.dumps(SEED.get(c, []))) if c == "tools" else []
            changed = True
    if changed:
        save(data)
    return data


def save(data):
    fd, tmp = tempfile.mkstemp(dir=BASE, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)  # scrittura atomica: niente file a metà


def check(collection):
    if collection not in COLLECTIONS:
        return jsonify({"error": "collezione sconosciuta"}), 404
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/data")
def get_data():
    with _lock:
        return jsonify(load())


@app.post("/api/<collection>")
def create(collection):
    bad = check(collection)
    if bad:
        return bad
    item = request.get_json(force=True) or {}
    item["id"] = item.get("id") or uuid.uuid4().hex[:10]
    with _lock:
        data = load()
        data[collection].append(item)
        save(data)
    return jsonify(item), 201


@app.put("/api/<collection>/<item_id>")
def update(collection, item_id):
    bad = check(collection)
    if bad:
        return bad
    patch = request.get_json(force=True) or {}
    patch.pop("id", None)
    with _lock:
        data = load()
        for it in data[collection]:
            if it["id"] == item_id:
                it.update(patch)
                save(data)
                return jsonify(it)
    return jsonify({"error": "non trovato"}), 404


@app.delete("/api/<collection>/<item_id>")
def delete(collection, item_id):
    bad = check(collection)
    if bad:
        return bad
    with _lock:
        data = load()
        before = len(data[collection])
        data[collection] = [i for i in data[collection] if i["id"] != item_id]
        if len(data[collection]) == before:
            return jsonify({"error": "non trovato"}), 404
        save(data)
    return jsonify({"ok": True})


def port_in_use():
    s = socket.socket()
    s.settimeout(0.5)
    try:
        return s.connect_ex(("127.0.0.1", PORT)) == 0
    finally:
        s.close()


if __name__ == "__main__":
    with _lock:
        load()  # crea data.json con i dati di esempio al primo avvio
    if port_in_use():
        print(f"Macro Terminal è già in esecuzione su http://localhost:{PORT}")
        sys.exit(0)
    print(f"Macro Terminal attivo su http://localhost:{PORT}")
    print("Chiudi questa finestra (o premi Ctrl+C) per fermarlo.")
    cli.show_server_banner = lambda *a, **k: None  # niente avvisi da server di sviluppo
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    app.run(host="127.0.0.1", port=PORT, debug=False)
