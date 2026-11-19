/* Macro Terminal — frontend vanilla JS. Dati in data.json (via API), preferenze in localStorage. */
'use strict';

/* ───────── lingua (i18n) ───────── */
// Le stringhe nel codice sono in italiano e fanno da chiave; il dizionario EN (static/i18n.js) le traduce.
const LANGS = { it: 'Italiano', en: 'English' };
const LANG = (() => { try { const l = localStorage.getItem('mt_lang'); if (LANGS[l]) return l; } catch (e) {} return (navigator.language || 'it').toLowerCase().startsWith('it') ? 'it' : 'en'; })();
const LOCALE = LANG === 'en' ? 'en-US' : 'it-IT';
const tx = (s, v) => {
  let r = (LANG === 'en' && window.EN && window.EN[s]) || s;
  if (v) for (const k in v) r = r.split('{' + k + '}').join(v[k]);
  return r;
};

/* ───────── configurazione ───────── */
const BIAS = {
  molto_short: { label: tx('Molto short'), short: tx('Molto short') },
  short:       { label: 'Short',            short: 'Short' },
  neutro:      { label: tx('Neutrale'),     short: tx('Neutrale') },
  long:        { label: 'Long',             short: 'Long' },
  molto_long:  { label: tx('Molto long'),   short: tx('Molto long') },
};
const BIAS_KEYS = Object.keys(BIAS);
const bcol = k => `var(--b-${BIAS[k] ? k : 'neutro'})`;

// sign: +1 = un dato sopra il previsto è favorevole alla valuta; -1 = sfavorevole
const INDS = [
  { k: 'inflation',    label: tx('Inflazione'),     short: 'CPI',   sign: +1, hint: tx('sopra il previsto = più hawkish (favorevole alla valuta)') },
  { k: 'unemployment', label: tx('Disoccupazione'), short: 'UNEMP', sign: -1, hint: tx('sopra il previsto = mercato del lavoro più debole (sfavorevole)') },
  { k: 'rate',         label: tx('Tassi'),          short: 'RATE',  sign: +1, hint: tx('sopra il previsto = più restrittivo (favorevole alla valuta)') },
  { k: 'gdp',          label: tx('PIL'),            short: 'GDP',   sign: +1, hint: tx('sopra il previsto = crescita più forte (favorevole)') },
];
const IMPACT = { alto: 3, medio: 2, basso: 1 };
const SEV = {
  alto:  { label: tx('Alto'),  color: 'var(--b-molto_short)' },
  medio: { label: tx('Medio'), color: 'var(--warn)' },
  basso: { label: tx('Basso'), color: 'var(--b-long)' },
};
const STATUS = {
  monitoraggio: { label: tx('In monitoraggio'), color: 'var(--b-long)' },
  escalation:   { label: tx('In escalation'),   color: 'var(--b-molto_short)' },
  rientrato:    { label: tx('Rientrato'),       color: 'var(--text-3)' },
};
const BUBBLE_D = { small: 46, medium: 62, large: 80 };

/* ───────── stato e preferenze ───────── */
const S = { countries: [], risks: [], trades: [], tools: [] };
const pref = {
  get(k, d) { try { return localStorage.getItem('mt_' + k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mt_' + k, v); } catch (e) {} },
};

/* ───────── utility ───────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = x => { if (x === null || x === undefined || x === '') return null; const n = parseFloat(String(x).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmt = (v, k) => v == null ? '—' : (k === 'rate' ? v.toFixed(2) : (Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : String(Math.round(v * 100) / 100)));
const sgn = d => (d > 0 ? '+' : '') + String(Math.round(d * 100) / 100);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(method + ' ' + url + ' → ' + r.status);
  return r.json();
}
async function load() { const d = await api('GET', '/api/data'); S.countries = d.countries; S.risks = d.risks; S.trades = d.trades || []; S.tools = d.tools || []; }

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900); }

/* ───────── logica macro: sorpresa e punteggio ───────── */
function surprise(c, k) {
  const i = c.ind?.[k]; const cfg = INDS.find(x => x.k === k);
  if (!i || i.v == null || i.f == null) return null;
  const d = Math.round((i.v - i.f) * 100) / 100;
  return { d, sig: d === 0 ? 0 : Math.sign(d) * cfg.sign, w: IMPACT[i.impact] || 2 };
}
function netScore(c) { return INDS.reduce((a, x) => { const s = surprise(c, x.k); return a + (s ? s.sig * s.w : 0); }, 0); }
function allSurprises() {
  const out = [];
  S.countries.forEach(c => INDS.forEach(x => { const s = surprise(c, x.k); if (s) out.push({ c, x, i: c.ind[x.k], s }); }));
  return out;
}

const ARROW = { up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>', down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>', flat: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>' };
function surpriseChip(s, cfg) {
  if (!s) return `<span class="chip flat">${tx('n/d')}</span>`;
  const cls = s.sig > 0 ? 'pos' : s.sig < 0 ? 'neg' : 'flat';
  const ar = s.d > 0 ? ARROW.up : s.d < 0 ? ARROW.down : ARROW.flat;
  return `<span class="chip ${cls}" title="${esc(cfg.hint)}">${ar}${s.d === 0 ? tx('in linea') : sgn(s.d)}</span>`;
}
const impactBars = lv => `<span class="imp ${esc(lv)}" title="${tx('Impatto ' + lv)}"><i></i><i></i><i></i></span>`;
const flagOf = c => `<span class="fl">${esc(c.flag || '🏳️')}</span>`;

/* ───────── router ───────── */
const PAGES = { home: renderHome, macro: renderMacro, risks: renderRisks, trades: renderTrades, tools: renderTools, settings: renderSettings };
function route() {
  const p = (location.hash || '#home').slice(1);
  const page = PAGES[p] ? p : 'home';
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  if (page !== 'home') stopSonar();
  PAGES[page]();
  pipbar();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
const rerender = () => { const y = window.scrollY; route(); window.scrollTo(0, y); };

/* ───────── HOME ───────── */
function renderHome() {
  const cs = S.countries;
  const sur = allSurprises();
  const pos = sur.filter(x => x.s.sig > 0).length;
  const neg = sur.filter(x => x.s.sig < 0).length;
  const hot = sur.filter(x => x.s.sig !== 0 && x.i.impact === 'alto').length;
  const riskHigh = S.risks.filter(r => rActive(r) && rLevel(r) === 'alto').length;
  const riskUp = S.risks.filter(r => rActive(r) && rTrend(r) === 'su').length;
  const today = new Date().toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const counts = BIAS_KEYS.map(k => ({ k, n: cs.filter(c => c.bias === k).length }));
  const showSample = pref.get('hide_sample', '0') !== '1';

  $('#main').innerHTML = `<div class="fade-in">
    <section class="hero">
      <div class="eyebrow">${esc(today)}</div>
      <h1>${tx('Il quadro macro,')}<br><em>${tx("a colpo d'occhio.")}</em></h1>
      <p>${tx("Il tuo terminale personale per l'analisi macro-economica: inflazione, disoccupazione, tassi e PIL per ogni paese. I dati li inserisci e li curi tu, qui sono salvati solo in locale.")}</p>
      <div class="hero-meta">
        <span class="pill"><i></i>${cs.length} ${tx('paesi seguiti')}</span>
        <span class="pill" style="--c:var(--b-long)"><i></i>${S.risks.length} ${tx('rischi geopolitici')}</span>
        ${showSample ? `<span class="pill" style="--c:var(--warn)"><i></i>${tx('Dati di esempio: sostituiscili dalla pagina Macro')} <b id="hide-sample" style="cursor:pointer;margin-left:4px" title="${tx('Nascondi')}">✕</b></span>` : ''}
      </div>
    </section>

    <div class="kpis">
      <div class="kpi" style="--c:var(--accent)"><div class="kpi-label">${tx('Paesi seguiti')}</div><div class="kpi-value">${cs.length}</div><div class="kpi-sub">${counts.filter(x => x.n).length} ${tx('bias diversi in uso')}</div></div>
      <div class="kpi" style="--c:var(--pos)"><div class="kpi-label">${tx('Sorprese positive')}</div><div class="kpi-value">${pos}</div><div class="kpi-sub">${tx('su {n} indicatori con previsto', { n: sur.length })}</div></div>
      <div class="kpi" style="--c:var(--neg)"><div class="kpi-label">${tx('Sorprese negative')}</div><div class="kpi-value">${neg}</div><div class="kpi-sub">${tx('dati peggiori del previsto')}</div></div>
      <div class="kpi" style="--c:var(--warn)"><div class="kpi-label">${tx('Sorprese ad alto impatto')}</div><div class="kpi-value">${hot}</div><div class="kpi-sub">${tx('da leggere per prime')}</div></div>
      <div class="kpi" style="--c:var(--b-molto_short)"><div class="kpi-label">${tx('Rischi alti attivi')}</div><div class="kpi-value">${riskHigh}</div><div class="kpi-sub">${riskUp} ${tx('in salita')} · <a href="#risks" style="color:inherit;white-space:nowrap">${tx('vedi →')}</a></div></div>
    </div>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">${tx('Distribuzione')}</div><h2 class="section-title">${tx('Bias sulle valute')}</h2></div></div>
      <div class="panel">
        ${cs.length ? `<div class="biasbar">${counts.filter(x => x.n).map(x => `<span style="--n:${x.n};--c:${bcol(x.k)}" title="${BIAS[x.k].label}: ${x.n}"></span>`).join('')}</div>
        <div class="biaslegend">${counts.map(x => `<div style="--c:${bcol(x.k)}"><i></i>${BIAS[x.k].label} <b>${x.n}</b></div>`).join('')}</div>` : `<div class="empty">${tx('Nessun paese ancora.')}</div>`}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div><div class="eyebrow">${tx('Mappa')}</div><h2 class="section-title">${tx('Mappa delle Valute')}</h2></div>
        <div class="map-hint"><span>${tx('Trascina le bolle · clic per aprire la scheda')}</span>
          <button class="btn snd" id="snd" aria-pressed="false"></button></div>
      </div>
      <div class="map-wrap">
        <div class="map" id="map">
          <div class="map-bg">
            <div class="map-band band-hawk"><b>${tx('Hawkish')}</b><span>${tx('Economia forte · banca centrale verso rialzo dei tassi')}</span></div>
            <div class="map-band band-dove"><b>${tx('Dovish')}</b><span>${tx('Economia debole · banca centrale verso taglio dei tassi')}</span></div>
            <div class="map-grid"></div><div class="map-axis-x"></div>
            <span class="axis-lbl al-hawk" title="${tx('Politica monetaria restrittiva')}">↑ ${tx('Economia forte')}</span>
            <span class="axis-lbl al-dove" title="${tx('Politica monetaria accomodante')}">↓ ${tx('Economia debole')}</span>
          </div>
        </div>
        <div class="map-hint">${BIAS_KEYS.map(k => `<span class="legend-chip" style="--c:${bcol(k)}"><i></i>${BIAS[k].label}</span>`).join('')}<span>${tx('· il colore della bolla è il bias scelto per il paese')}</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">${tx('Banche centrali')}</div><h2 class="section-title">${tx('Tassi di interesse')}</h2></div>
        <div class="map-hint"><span>${tx('La tacca indica il tasso precedente')}</span></div></div>
      <div class="panel"><div class="rates" id="rates"></div></div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">${tx('Segnali automatici')}</div><h2 class="section-title">${tx('Sorprese macro')}</h2></div>
        <a class="btn" href="#macro">${tx('Tutti i dati →')}</a></div>
      <div class="table-wrap"><table>
        <thead><tr><th>${tx('Paese')}</th><th>${tx('Indicatore')}</th><th class="num">${tx('Attuale')}</th><th class="num">${tx('Previsto')}</th><th class="num">${tx('Precedente')}</th><th>${tx('Sorpresa')}</th><th>${tx('Impatto')}</th></tr></thead>
        <tbody id="sur-body"></tbody></table></div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">${tx('Operatività')}</div><h2 class="section-title">${tx('Idee di trade')}</h2></div>
        <a class="btn" href="#trades">${tx('Tutte le idee →')}</a></div>
      <div class="table-wrap"><table>
        <thead><tr><th>${tx('Strumento')}</th><th>${tx('Direzione')}</th><th>${tx('Stato')}</th><th class="num">${tx('Ingresso')}</th><th class="num">${tx('Stop')}</th><th class="num">${tx('Target')}</th><th class="num">${tx('R:R')}</th><th>${tx('Bias')}</th></tr></thead>
        <tbody id="home-trades"></tbody></table></div>
    </section>
  </div>`;

  const hs = $('#hide-sample'); if (hs) hs.onclick = () => { pref.set('hide_sample', '1'); renderHome(); };
  initMap(); initSound(); renderRates(); renderSurTable(); renderHomeTrades();
}

function renderRates() {
  const rows = S.countries.filter(c => c.ind?.rate?.v != null).sort((a, b) => b.ind.rate.v - a.ind.rate.v);
  const max = Math.max(1, ...rows.map(c => Math.max(c.ind.rate.v, c.ind.rate.p ?? 0)));
  $('#rates').innerHTML = rows.length ? rows.map(c => {
    const r = c.ind.rate; const d = r.p != null ? Math.round((r.v - r.p) * 100) / 100 : null;
    return `<div class="rate-row" style="--c:${bcol(c.bias)}">
      <div class="rate-name">${flagOf(c)}<span>${esc(c.code)}</span></div>
      <div class="rate-track"><div class="rate-fill" data-w="${(r.v / max) * 100}"></div>${r.p != null ? `<div class="rate-prev" style="left:${(r.p / max) * 100}%" title="Precedente ${fmt(r.p, 'rate')}%"></div>` : ''}</div>
      <div class="rate-val"><b>${fmt(r.v, 'rate')}%</b><small style="color:${d < 0 ? 'var(--neg)' : 'var(--pos)'}">${d ? (d < 0 ? '▼ ' : '▲ ') + Math.abs(d).toFixed(2) : ''}</small></div>
    </div>`;
  }).join('') : `<div class="empty">${tx('Inserisci i tassi dalla pagina Macro per Paese.')}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.rate-fill').forEach(el => el.style.width = el.dataset.w + '%')));
}

function renderSurTable() {
  const rows = allSurprises().sort((a, b) => (b.s.w - a.s.w) || (Math.abs(b.s.d) - Math.abs(a.s.d))).slice(0, 12);
  $('#sur-body').innerHTML = rows.length ? rows.map(x => `<tr class="clickable" data-id="${esc(x.c.id)}">
    <td><div class="cc">${flagOf(x.c)}${esc(x.c.name)}<small>${esc(x.c.code)}</small></div></td>
    <td>${esc(x.x.label)}</td>
    <td class="num">${fmt(x.i.v, x.x.k)}%</td><td class="num">${fmt(x.i.f, x.x.k)}%</td><td class="num">${fmt(x.i.p, x.x.k)}%</td>
    <td>${surpriseChip(x.s, x.x)}</td><td>${impactBars(x.i.impact)}</td></tr>`).join('')
    : `<tr><td colspan="7"><div class="empty" style="border:0">${tx('Inserisci attuale e previsto per vedere le sorprese.')}</div></td></tr>`;
  $$('#sur-body tr.clickable').forEach(tr => tr.onclick = () => openCountryModal(tr.dataset.id));
}

/* ───────── MAPPA: bolle, trascinamento, collisioni ───────── */
function initMap() {
  const map = $('#map'); if (!map) return;
  const D = BUBBLE_D[pref.get('bubble', 'medium')] || 62, R = D / 2, GAP = 3;
  const tip = $('#tip');

  S.countries.forEach(c => {
    const b = document.createElement('div');
    b.className = 'bubble'; b.dataset.id = c.id;
    b.style.cssText = `--d:${D}px;--c:${bcol(c.bias)};left:${c.mx ?? 50}%;top:${c.my ?? 50}%`;
    const ex = riskExposure(c.code);
    b.innerHTML = `<span class="fl">${esc(c.flag || '🏳️')}</span><span class="cd">${esc(c.code)}</span>${ex.length ? `<span class="rbadge" style="--rc:${rColor(ex[0])}">${ex.length}</span>` : ''}`;
    map.appendChild(b);

    b.addEventListener('mouseenter', () => {
      const r = c.ind?.rate;
      tip.innerHTML = `<b>${esc(c.name)}</b><div class="row"><span>${tx('Bias')}</span><span style="color:${bcol(c.bias)}">${BIAS[c.bias]?.label || '—'}</span></div>
        <div class="row"><span>${tx('Tasso')}</span><span>${r?.v != null ? fmt(r.v, 'rate') + '%' : '—'}</span></div>
        <div class="row"><span>${tx('Sorpresa netta')}</span><span>${sgn(netScore(c))}</span></div>
        ${ex.length ? `<div class="row" style="display:block;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><span style="display:block;margin-bottom:4px">${tx('Rischi attivi')}</span>${ex.map(r => `<div style="color:var(--text);font-family:var(--font);display:flex;gap:6px;align-items:center"><i style="width:6px;height:6px;border-radius:50%;background:${rColor(r)};flex:none"></i>${esc(r.title)}<b style="margin-left:auto;padding-left:8px;font-size:10px;color:${DIR[dirOf(r, c.code)].color}" title="${DIR[dirOf(r, c.code)].label}">${DIR[dirOf(r, c.code)].icon}</b></div>`).join('')}</div>` : ''}`;
      tip.classList.add('show');
    });
    b.addEventListener('mousemove', e => { tip.style.left = Math.min(e.clientX + 16, innerWidth - 220) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; });
    b.addEventListener('mouseleave', () => tip.classList.remove('show'));

    b.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) {} tip.classList.remove('show');
      const rect = map.getBoundingClientRect(), W = rect.width, H = rect.height;
      const ids = S.countries.map(x => x.id);
      const start = {}; ids.forEach(id => { const x = S.countries.find(q => q.id === id); start[id] = { x: (x.mx ?? 50) / 100 * W, y: (x.my ?? 50) / 100 * H }; });
      // sovrapposizioni già esistenti: non vengono toccate
      const pre = new Set();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
        if (Math.hypot(start[ids[i]].x - start[ids[j]].x, start[ids[i]].y - start[ids[j]].y) < 2 * R) pre.add(ids[i] + '|' + ids[j]);
      const key = (a, b2) => a < b2 ? a + '|' + b2 : b2 + '|' + a;
      const off = { x: e.clientX - rect.left - start[c.id].x, y: e.clientY - rect.top - start[c.id].y };
      const sx = e.clientX, sy = e.clientY;
      let cur = clonePos(start), dragged = false;

      const bound = p => { p.x = clamp(p.x, R, W - R); p.y = clamp(p.y, R, H - R); };
      function resolve(pos, movedId) {
        const q = [movedId]; let guard = 0;
        while (q.length && guard++ < 600) {
          const a = q.shift();
          for (const id of ids) {
            if (id === a || pre.has(key(a, id))) continue;
            let dx = pos[id].x - pos[a].x, dy = pos[id].y - pos[a].y, d = Math.hypot(dx, dy);
            const min = 2 * R + GAP;
            if (d < min) {
              if (d < 0.01) { dx = 1; dy = 0; d = 1; }
              const push = min - d;
              pos[id].x += dx / d * push; pos[id].y += dy / d * push; bound(pos[id]); q.push(id);
            }
          }
        }
      }
      function valid(pos) {
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
          if (pre.has(key(ids[i], ids[j]))) continue;
          if (Math.hypot(pos[ids[i]].x - pos[ids[j]].x, pos[ids[i]].y - pos[ids[j]].y) < 2 * R - 0.5) return false;
        }
        return true;
      }
      function attempt(tx, ty) {
        // prova la posizione richiesta; se le bolle sono incastrate sul bordo, ripiega verso l'ultima valida
        for (const t of [1, .6, .35, .15, .05]) {
          const cand = clonePos(cur);
          cand[c.id] = { x: cur[c.id].x + (tx - cur[c.id].x) * t, y: cur[c.id].y + (ty - cur[c.id].y) * t }; bound(cand[c.id]);
          resolve(cand, c.id);
          if (valid(cand)) return cand;
        }
        return null;
      }
      const paint = () => ids.forEach(id => { const el = map.querySelector(`.bubble[data-id="${id}"]`); if (el) { el.style.left = cur[id].x / W * 100 + '%'; el.style.top = cur[id].y / H * 100 + '%'; } });

      const move = ev => {
        if (!dragged && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        if (!dragged) { dragged = true; b.classList.add('dragging'); }
        const next = attempt(ev.clientX - rect.left - off.x, ev.clientY - rect.top - off.y);
        if (next) { cur = next; paint(); }
      };
      const up = async () => {
        b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up);
        b.classList.remove('dragging');
        if (!dragged) { openCountryModal(c.id); return; }
        const jobs = [];
        ids.forEach(id => {
          if (Math.hypot(cur[id].x - start[id].x, cur[id].y - start[id].y) < 0.2) return;
          const it = S.countries.find(x => x.id === id);
          it.mx = Math.round(cur[id].x / W * 10000) / 100; it.my = Math.round(cur[id].y / H * 10000) / 100;
          jobs.push(api('PUT', `/api/countries/${id}`, { mx: it.mx, my: it.my }));
        });
        try { await Promise.all(jobs); } catch (err) { toast(tx('Errore nel salvataggio delle posizioni')); }
      };
      b.addEventListener('pointermove', move); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    });
  });
}
const clonePos = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { x: v.x, y: v.y }]));

/* ───────── suono del radar (sonar da sottomarino, sintetizzato con Web Audio) ───────── */
let audioCtx = null;
// Il ping del sonar viene dalla traccia static/sonar.wav: ne uso il primo ping, riprodotto solo quando il fascio colpisce una valuta.
// Se il file manca, ripiega su un ping sintetizzato (1050 Hz). L'unico suono continuo è il mare.
const PING_START = 0.65, PING_DUR = 0.9;   // dove si trova il primo ping dentro sonar.wav (secondi)
let sonarBuf = null, sonarTried = false;
async function loadSonarFile() {
  if (sonarTried || !audioCtx) return; sonarTried = true;
  try {
    const r = await fetch('/static/sonar.wav'); if (!r.ok) return;
    sonarBuf = await audioCtx.decodeAudioData(await r.arrayBuffer());
  } catch (e) {}
}
const soundOn = () => pref.get('sound', '0') === '1';
function stopSonar() {
  stopSea(); cancelAnimationFrame(sweepRAF); sweepRAF = 0; lastAng = null;
}

/* — mare di fondo: rumore bruno filtrato, con un lentissimo "respiro" del volume. Generato qui: nessun file, loop senza stacchi. — */
const SEA_VOL = 0.03;      // volume del mare (molto basso)
let sea = null;
function startSea() {
  if (sea || !audioCtx) return;
  const sr = audioCtx.sampleRate, len = Math.floor(sr * 6), f = Math.floor(sr * 0.5);
  const buf = audioCtx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[len - f + i] * (1 - k); }   // la coda sfuma nell'inizio: il loop non ha stacchi
  const src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopEnd = (len - f) / sr;
  const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
  const g = audioCtx.createGain(); g.gain.value = SEA_VOL;
  const lfo = audioCtx.createOscillator(), lg = audioCtx.createGain(); lfo.frequency.value = 0.1; lg.gain.value = SEA_VOL * 0.45;
  lfo.connect(lg); lg.connect(g.gain); src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
  src.start(); lfo.start(); sea = { src, lfo, g };
}
function stopSea() {
  if (!sea) return;
  try { sea.src.stop(); sea.lfo.stop(); sea.g.disconnect(); } catch (e) {}
  sea = null;
}

/* — ping del sonar quando il fascio passa su una valuta lontana dalla linea centrale (Hawkish/Dovish) — */
const BAL = 0.12;          // "bilanciate" = entro il 12% dell'altezza della mappa sopra/sotto la linea centrale
const SWEEP_MS = 8000;     // durata di un giro del radar (deve coincidere con l'animazione "sweep" nel CSS)
const LEAD_MS = 60;        // anticipo: compensa la latenza dell'audio, così il suono cade quando il fascio tocca la bolla
let sweepRAF = 0, sweepAnim = null, lastAng = null, lastT = 0;
function blip() {   // il ping del sonar sul bersaglio
  if (!audioCtx || audioCtx.state !== 'running') return;
  if (!sonarBuf) { sonarPing(); return; }
  const src = audioCtx.createBufferSource(), g = audioCtx.createGain();
  src.buffer = sonarBuf; g.gain.value = 0.9;
  src.connect(g); g.connect(audioCtx.destination);
  src.start(audioCtx.currentTime, PING_START, PING_DUR);
}
function tickSweep() {
  sweepRAF = requestAnimationFrame(tickSweep);
  const map = $('#map');
  if (!map || !soundOn() || !audioCtx || audioCtx.state !== 'running') { lastAng = null; return; }
  if (!sweepAnim || sweepAnim.playState === 'idle' || sweepAnim.playState === 'finished') sweepAnim = document.getAnimations().find(a => a.animationName === 'sweep') || null;
  if (!sweepAnim || sweepAnim.currentTime == null) { lastAng = null; return; }
  const ang = ((Number(sweepAnim.currentTime) + LEAD_MS) % SWEEP_MS) / SWEEP_MS * 360;   // 0° = in alto, in senso orario: come il fascio
  if (lastAng != null) {
    let delta = ang - lastAng; if (delta < 0) delta += 360;
    const now = performance.now(), gap = now - lastT; lastT = now;
    // un frame in ritardo (anche 1 s) non fa perdere i bersagli; si scarta solo il ritorno da una scheda rimasta in background
    if (delta > 0 && delta < 150 && gap < 1500) {
      const mr = map.getBoundingClientRect(), cx = mr.width / 2, cy = mr.height / 2;
      $$('.bubble', map).forEach(b => {
        const r = b.getBoundingClientRect(), x = r.left + r.width / 2 - mr.left - cx, y = r.top + r.height / 2 - mr.top - cy;
        if (Math.abs(y) / mr.height <= BAL) return;                     // bolla bilanciata: silenzio
        let a = Math.atan2(x, -y) * 180 / Math.PI; if (a < 0) a += 360;  // angolo della bolla visto dal centro
        const crossed = lastAng <= ang ? (a > lastAng && a <= ang) : (a > lastAng || a <= ang);
        if (crossed) blip();
      });
    }
  }
  lastAng = ang; lastT = performance.now();
}
async function startSound() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  await Promise.race([audioCtx.resume(), new Promise(r => setTimeout(r, 400))]);
  if (audioCtx.state !== 'running') throw new Error('audio bloccato');
  await loadSonarFile();
  startSea();
  cancelAnimationFrame(sweepRAF); lastAng = null; sweepRAF = requestAnimationFrame(tickSweep);
}
function sonarPing() {   // ping sintetizzato (solo se manca il file)
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t0 = audioCtx.currentTime;
  const out = audioCtx.createGain(); out.gain.value = 0.5; out.connect(audioCtx.destination);
  [[0, 1], [0.55, 0.28]].forEach(([d, amp]) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(1050, t0 + d); o.frequency.exponentialRampToValueAtTime(1020, t0 + d + 1.8);
    g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(amp * 0.6, t0 + d + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 1.8);
    o.connect(g); g.connect(out); o.start(t0 + d); o.stop(t0 + d + 1.9);
  });
}
async function initSound() {
  const btn = $('#snd'), bg = $('.map-bg'); if (!btn || !bg) return;
  const paint = () => {
    const on = soundOn();
    btn.setAttribute('aria-pressed', on);
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/>${on ? '<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>' : '<path d="M17 9l5 6M22 9l-5 6"/>'}</svg>${on ? tx('Suono radar: acceso') : tx('Suono radar: spento')}`;
    btn.classList.toggle('on', on);
  };
  btn.onclick = () => {
    const on = !soundOn();
    pref.set('sound', on ? '1' : '0');
    if (on) startSound().catch(() => { pref.set('sound', '0'); paint(); }); else stopSonar();
    paint();
  };
  // tornando sulla Home con il suono acceso riparte; se il browser lo blocca (nessun clic ancora fatto) resta spento
  if (soundOn()) startSound().catch(() => { pref.set('sound', '0'); paint(); });
  paint();
}

/* ───────── pagina MACRO PER PAESE ───────── */
function renderMacro() {
  const view = pref.get('macro_view', 'cards');
  const cs = S.countries;
  $('#main').innerHTML = `<div class="fade-in ${pref.get('cardcolor', '1') === '1' ? '' : 'nocolor'}">
    <div class="page-head">
      <div><div class="eyebrow">${tx('Analisi per paese')}</div><h1 class="page-title">${tx('Macro per Paese')}</h1>
        <p class="page-sub">${tx('Inflazione, disoccupazione, tassi e PIL per ogni paese che segui. Clicca una scheda per modificarla, o aggiungi un nuovo paese.')}</p></div>
      <div class="actions">
        <div class="seg"><button data-v="cards" class="${view === 'cards' ? 'on' : ''}">${tx('Schede')}</button><button data-v="matrix" class="${view === 'matrix' ? 'on' : ''}">${tx('Matrice')}</button></div>
        <button class="btn primary" id="add-country"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>${tx('Nuovo paese')}</button>
      </div>
    </div>
    ${cs.length ? (view === 'cards' ? `<div class="cards">${cs.map(countryCard).join('')}</div>` : matrixTable()) : `<div class="empty">${tx('Nessun paese. Aggiungi il primo con “Nuovo paese”.')}</div>`}
  </div>`;
  $$('.seg button').forEach(b => b.onclick = () => { pref.set('macro_view', b.dataset.v); renderMacro(); });
  $('#add-country').onclick = () => openCountryModal(null);
  $$('.ccard, .matrix tbody tr').forEach(el => el.onclick = () => openCountryModal(el.dataset.id));
  $$('.bias-sel').forEach(sel => {
    sel.onclick = e => e.stopPropagation();
    sel.onchange = async () => { const c = S.countries.find(x => x.id === sel.dataset.id); c.bias = sel.value; await api('PUT', `/api/countries/${c.id}`, { bias: c.bias }); rerender(); toast(tx('Bias aggiornato')); };
  });
}

const biasSelect = c => `<select class="bias-sel chip bias-chip" data-id="${esc(c.id)}" style="--cc:${bcol(c.bias)};appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:12px;background-color:color-mix(in srgb, ${bcol(c.bias)} 14%, transparent)">
  ${BIAS_KEYS.map(k => `<option value="${k}" ${c.bias === k ? 'selected' : ''}>${BIAS[k].label}</option>`).join('')}</select>`;

function countryCard(c, idx) {
  const net = netScore(c);
  return `<article class="ccard" data-id="${esc(c.id)}" style="--c:${bcol(c.bias)};animation-delay:${Math.min(idx, 12) * 45}ms">
    <div class="ccard-top"><div class="ccard-flag">${esc(c.flag || '🏳️')}</div>
      <div><div class="ccard-name">${esc(c.name)}</div><div class="ccard-code">${esc(c.code)}</div></div>
      <div class="ccard-bias">${biasSelect(c)}</div></div>
    <div class="itable">
      <div class="irow ihead"><span>${tx('Indicatore')}</span><span>${tx('Attuale')}</span><span>${tx('Previsto')}</span><span>${tx('Precedente')}</span><span>${tx('Sorpresa')}</span></div>
      ${INDS.map(x => {
        const i = c.ind?.[x.k] || {}; const s = surprise(c, x.k);
        const u = v => v == null ? '' : '%';
        return `<div class="irow"><span class="iname">${x.label}${impactBars(i.impact || 'medio')}</span>
          <b class="iv">${fmt(i.v ?? null, x.k)}<small>${u(i.v)}</small></b>
          <span class="ip">${fmt(i.f ?? null, x.k)}<small>${u(i.f)}</small></span>
          <span class="ip">${fmt(i.p ?? null, x.k)}<small>${u(i.p)}</small></span>
          <span>${surpriseChip(s, x)}</span></div>`;
      }).join('')}
    </div>
    ${c.note ? `<div class="ccard-note">${esc(c.note)}</div>` : ''}
    <div class="ccard-foot"><span>${tx('Sorpresa netta')} <span class="net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${sgn(net)}</span></span>
      ${(() => { const ex = riskExposure(c.code); return ex.length ? `<a href="#risks" class="rtag" style="--rc:${rColor(ex[0])}" title="${esc(ex.map(r => DIR[dirOf(r, c.code)].icon + ' ' + r.title).join(' · '))}" onclick="event.stopPropagation()">${ex.length} ${ex.length === 1 ? tx('rischio attivo') : tx('rischi attivi')}</a>` : ''; })()}
      <span>${tx('Modifica →')}</span></div>
  </article>`;
}

function matrixTable() {
  return `<div class="table-wrap"><table class="matrix"><thead><tr><th>${tx('Paese')}</th>${INDS.map(x => `<th>${x.label}</th>`).join('')}<th>${tx('Bias')}</th><th>${tx('Sorpresa netta')}</th></tr></thead><tbody>
  ${S.countries.map(c => {
    const net = netScore(c);
    return `<tr class="clickable" data-id="${esc(c.id)}"><td><div class="cc">${flagOf(c)}${esc(c.name)}<small>${esc(c.code)}</small></div></td>
      ${INDS.map(x => { const i = c.ind?.[x.k] || {}; const s = surprise(c, x.k); const cls = !s ? '' : s.sig > 0 ? 'pos' : s.sig < 0 ? 'neg' : '';
        return `<td><span class="mcell ${cls}"><b>${fmt(i.v ?? null, x.k)}${i.v != null ? '%' : ''}</b><small>${s ? (s.d === 0 ? tx('in linea') : (s.d > 0 ? '▲ ' : '▼ ') + sgn(s.d)) : tx('n/d')}</small><em>${tx('prev')} ${fmt(i.f ?? null, x.k)} · ${tx('prec')} ${fmt(i.p ?? null, x.k)}</em></span></td>`; }).join('')}
      <td>${biasSelect(c)}</td>
      <td><span class="net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}" style="font-size:15px">${sgn(net)}</span></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/* ───────── modale paese ───────── */
function openModal(html) { $('#modal').innerHTML = html; $('#modal-back').classList.add('open'); }
function closeModal() { $('#modal-back').classList.remove('open'); }
$('#modal-back').addEventListener('mousedown', e => { if (e.target.id === 'modal-back') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function findFreeSpot() {
  const D = BUBBLE_D[pref.get('bubble', 'medium')] || 62, W = 1000, H = 560;
  let best = { x: 50, y: 50 }, bestD = -1;
  for (let i = 0; i < 300; i++) {
    const x = D / 2 + Math.random() * (W - D), y = D / 2 + Math.random() * (H - D);
    const m = Math.min(1e9, ...S.countries.map(c => Math.hypot((c.mx ?? 50) / 100 * W - x, (c.my ?? 50) / 100 * H - y)));
    if (m > bestD) { bestD = m; best = { x: x / W * 100, y: y / H * 100 }; }
  }
  return { mx: Math.round(best.x * 100) / 100, my: Math.round(best.y * 100) / 100 };
}

function openCountryModal(id) {
  const c = id ? S.countries.find(x => x.id === id) : { name: '', code: '', flag: '', bias: 'neutro', note: '', ind: {} };
  openModal(`<h3>${id ? tx('Modifica paese') : tx('Nuovo paese')}</h3><div class="sub">${tx('Inserisci a mano attuale, previsto e precedente. Lascia vuoto ciò che non hai.')}</div>
    <div class="form-grid">
      <div class="field s4"><label>${tx('Paese')}</label><input id="f-name" value="${esc(c.name)}" placeholder="${tx('es. Stati Uniti')}"></div>
      <div class="field s2"><label>${tx('Valuta')}</label><input id="f-code" value="${esc(c.code)}" placeholder="USD" maxlength="5"></div>
      <div class="field s2"><label>${tx('Bandiera (emoji)')}</label><input id="f-flag" value="${esc(c.flag)}" placeholder="🇺🇸"></div>
      <div class="field s4"><label>${tx('Bias sulla valuta')}</label><select id="f-bias">${BIAS_KEYS.map(k => `<option value="${k}" ${c.bias === k ? 'selected' : ''}>${BIAS[k].label}</option>`).join('')}</select></div>
      <div class="ind-head">${tx('Indicatori (in %)')}</div>
      ${INDS.map(x => { const i = c.ind?.[x.k] || {}; return `<div class="ind-edit" data-k="${x.k}">
        <div class="nm">${x.label}<small>${x.short}</small></div>
        <div class="field"><label>${tx('Attuale')}</label><input data-f="v" inputmode="decimal" value="${i.v ?? ''}"></div>
        <div class="field"><label>${tx('Previsto')}</label><input data-f="f" inputmode="decimal" value="${i.f ?? ''}"></div>
        <div class="field"><label>${tx('Precedente')}</label><input data-f="p" inputmode="decimal" value="${i.p ?? ''}"></div>
        <div class="field"><label>${tx('Impatto')}</label><select data-f="impact">${['alto', 'medio', 'basso'].map(l => `<option value="${l}" ${(i.impact || 'medio') === l ? 'selected' : ''}>${tx(l[0].toUpperCase() + l.slice(1))}</option>`).join('')}</select></div></div>`; }).join('')}
      <div class="field"><label>${tx('Note')}</label><textarea id="f-note" placeholder="${tx('La tua lettura macro su questo paese…')}">${esc(c.note)}</textarea></div>
    </div>
    <div class="modal-foot"><div>${id ? `<button class="btn danger" id="m-del">${tx('Elimina')}</button>` : ''}</div>
      <div class="actions"><button class="btn" id="m-cancel">${tx('Annulla')}</button><button class="btn primary" id="m-save">${tx('Salva')}</button></div></div>`);
  $('#m-cancel').onclick = closeModal;
  if (id) $('#m-del').onclick = async () => {
    if (!confirm(tx('Eliminare {n}? L\'operazione non si può annullare.', { n: c.name }))) return;
    await api('DELETE', `/api/countries/${id}`); S.countries = S.countries.filter(x => x.id !== id); closeModal(); rerender(); toast(tx('Paese eliminato'));
  };
  $('#m-save').onclick = async () => {
    const name = $('#f-name').value.trim();
    if (!name) { $('#f-name').focus(); return; }
    const ind = {};
    $$('.ind-edit').forEach(row => { const o = {}; $$('[data-f]', row).forEach(el => o[el.dataset.f] = el.dataset.f === 'impact' ? el.value : num(el.value)); ind[row.dataset.k] = o; });
    const body = { name, code: ($('#f-code').value.trim() || name.slice(0, 3)).toUpperCase(), flag: $('#f-flag').value.trim(), bias: $('#f-bias').value, note: $('#f-note').value.trim(), ind };
    try {
      if (id) { Object.assign(c, await api('PUT', `/api/countries/${id}`, body)); }
      else { S.countries.push(await api('POST', '/api/countries', { ...body, ...findFreeSpot() })); }
      closeModal(); rerender(); toast(tx('Salvato'));
    } catch (e) { toast(tx('Errore nel salvataggio')); }
  };
}

/* ───────── pagina RISCHI GEOPOLITICI ───────── */
// Modello: probabilità × impatto (3 livelli ciascuno) + trend della probabilità, scenari e trigger.
// I record vecchi con il solo campo "severity" restano leggibili (fallback).
const LVL = { basso: 1, medio: 2, alto: 3 };
const LIK_LABEL = { basso: tx('Bassa'), medio: tx('Media'), alto: tx('Alta') };
const IMP_LABEL = { basso: tx('Basso'), medio: tx('Medio'), alto: tx('Alto') };
const TREND = {
  su:      { label: tx('Probabilità in salita'), short: tx('In salita'), icon: '▲', color: 'var(--neg)' },
  stabile: { label: tx('Probabilità stabile'),   short: tx('Stabile'),   icon: '■', color: 'var(--text-3)' },
  giu:     { label: tx('Probabilità in calo'),   short: tx('In calo'),   icon: '▼', color: 'var(--pos)' },
};
const rLik = r => LVL[r.likelihood] ? r.likelihood : (LVL[r.severity] ? r.severity : 'medio');
const rImp = r => LVL[r.impact] ? r.impact : (LVL[r.severity] ? r.severity : 'medio');
const rScore = r => LVL[rLik(r)] * LVL[rImp(r)];
const rLevel = r => { const s = rScore(r); return s >= 6 ? 'alto' : s >= 3 ? 'medio' : 'basso'; };
const rTrend = r => TREND[r.trend] ? r.trend : 'stabile';
const rActive = r => r.status !== 'rientrato';
const rColor = r => SEV[rLevel(r)].color;
const ccyList = r => String(r.ccy || '').split(',').map(s => s.trim()).filter(Boolean);
// direzione del rischio per valuta: favorita (rifugio), penalizzata, neutra
const DIR = {
  pos: { label: tx('Favorita'),    icon: '▲', color: 'var(--pos)' },
  neg: { label: tx('Penalizzata'), icon: '▼', color: 'var(--neg)' },
  neu: { label: tx('Neutra'),      icon: '●', color: 'var(--text-3)' },
};
const dirOf = (r, code) => { const d = (r.ccy_dir || {})[String(code).toUpperCase()]; return DIR[d] ? d : 'neu'; };
function riskExposure(code) {
  const c = String(code || '').toUpperCase();
  return S.risks.filter(r => rActive(r) && ccyList(r).some(x => x.toUpperCase() === c)).sort((a, b) => rScore(b) - rScore(a));
}
const meter = (lv, col) => `<span class="meter" style="--mc:${col}">${[1, 2, 3].map(n => `<i class="${n <= LVL[lv] ? 'on' : ''}"></i>`).join('')}</span>`;

function renderRisks() {
  const list = [...S.risks].sort((a, b) => (rActive(b) - rActive(a)) || (rScore(b) - rScore(a)) || String(a.title).localeCompare(b.title));
  const cellOf = (lik, imp) => {
    const sc = LVL[lik] * LVL[imp], lvl = sc >= 6 ? 'alto' : sc >= 3 ? 'medio' : 'basso';
    const items = list.filter(r => rLik(r) === lik && rImp(r) === imp);
    return `<div class="rcell" data-lik="${lik}" data-imp="${imp}" style="--c:${SEV[lvl].color}">
      ${items.map(r => `<div class="rchip ${rActive(r) ? '' : 'off'}" draggable="true" data-id="${esc(r.id)}" title="${esc(TREND[rTrend(r)].label)}">
        <span>${esc(r.title)}</span><b style="color:${TREND[rTrend(r)].color}">${TREND[rTrend(r)].icon}</b></div>`).join('')}</div>`;
  };
  const rows = ['alto', 'medio', 'basso'];
  const cols = ['basso', 'medio', 'alto'];
  const rising = S.risks.filter(r => rActive(r) && rTrend(r) === 'su').length;

  $('#main').innerHTML = `<div class="fade-in">
    <div class="page-head">
      <div><div class="eyebrow">${tx('Scenari di rischio')}</div><h1 class="page-title">${tx('Rischi Geopolitici')}</h1>
        <p class="page-sub">${tx('Un rischio per scenario: probabilità, impatto sul mercato e trend. Aggiorna probabilità e trend leggendo le tue fonti (es. BlackRock Geopolitical Risk Dashboard).')}</p></div>
      <div class="actions"><button class="btn primary" id="add-risk"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>${tx('Nuovo rischio')}</button></div>
    </div>

    <section class="section" style="margin-top:0">
      <div class="section-head"><div><div class="eyebrow">${tx('Matrice')}</div><h2 class="section-title">${tx('Probabilità × impatto')}</h2></div>
        <div class="map-hint"><span>${tx("Trascina uno scenario in un'altra cella per aggiornarlo")}</span><span>· ${rising} in salita</span></div></div>
      <div class="rmatrix">
        <div class="rm-grid">
          ${rows.map(imp => `<div class="rm-lbl">${IMP_LABEL[imp]}</div>${cols.map(lik => cellOf(lik, imp)).join('')}`).join('')}
          <div></div>${cols.map(l => `<div class="rm-lbl rm-x">${LIK_LABEL[l]}</div>`).join('')}
        </div>
        <div class="rm-cap"><span>${tx('↑ Impatto sul mercato')}</span><span>${tx('Probabilità →')}</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">${tx('Dettaglio')}</div><h2 class="section-title">${tx('Scenari e trigger')}</h2></div></div>
      ${list.length ? `<div class="rlist">${list.map(riskCard).join('')}</div>` : `<div class="empty">${tx('Nessun rischio. Aggiungine uno con “Nuovo rischio”.')}</div>`}
    </section>
  </div>`;

  $('#add-risk').onclick = () => openRiskModal(null);
  $$('.rc').forEach(el => el.onclick = () => openRiskModal(el.dataset.id));
  $$('.rchip').forEach(el => {
    el.onclick = () => openRiskModal(el.dataset.id);
    el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('drag'); };
    el.ondragend = () => el.classList.remove('drag');
  });
  $$('.rcell').forEach(cell => {
    cell.ondragover = e => { e.preventDefault(); cell.classList.add('over'); };
    cell.ondragleave = () => cell.classList.remove('over');
    cell.ondrop = async e => {
      e.preventDefault(); cell.classList.remove('over');
      const r = S.risks.find(x => x.id === e.dataTransfer.getData('text/plain')); if (!r) return;
      if (rLik(r) === cell.dataset.lik && rImp(r) === cell.dataset.imp) return;
      r.likelihood = cell.dataset.lik; r.impact = cell.dataset.imp;
      await api('PUT', `/api/risks/${r.id}`, { likelihood: r.likelihood, impact: r.impact }); rerender(); toast(tx('Scenario aggiornato'));
    };
  });
}

function riskCard(r) {
  const st = STATUS[r.status] || STATUS.monitoraggio, tr = TREND[rTrend(r)], lvl = rLevel(r);
  const trig = String(r.triggers || '').split('\n').map(s => s.trim()).filter(Boolean);
  return `<article class="rc ${rActive(r) ? '' : 'off'}" data-id="${esc(r.id)}" style="--c:${rColor(r)}">
    <div class="rc-head">
      <div><h4>${esc(r.title)}</h4><div class="region">${esc(r.region)}</div></div>
      <span class="chip" style="--cc:${rColor(r)}">${tx('Rischio ' + lvl)}</span>
    </div>
    <div class="rc-meters">
      <div><small>${tx('Probabilità')}</small>${meter(rLik(r), rColor(r))}<b>${LIK_LABEL[rLik(r)]}</b></div>
      <div><small>${tx('Impatto')}</small>${meter(rImp(r), rColor(r))}<b>${IMP_LABEL[rImp(r)]}</b></div>
      <div><small>${tx('Trend')}</small><b style="color:${tr.color}">${tr.icon} ${tr.short}</b></div>
    </div>
    ${r.note ? `<p class="rc-note">${esc(r.note)}</p>` : ''}
    ${(r.scen_up || r.scen_down) ? `<div class="rc-scen">
      ${r.scen_up ? `<div><span class="lbl" style="--lc:var(--neg)">${tx('Se escalation')}</span>${esc(r.scen_up)}</div>` : ''}
      ${r.scen_down ? `<div><span class="lbl" style="--lc:var(--pos)">${tx('Se rientra')}</span>${esc(r.scen_down)}</div>` : ''}</div>` : ''}
    ${trig.length ? `<div class="rc-trig"><span class="lbl" style="--lc:var(--warn)">${tx('Trigger da osservare')}</span><ul>${trig.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="rc-foot"><div class="tags">${ccyList(r).map(s => { const d = DIR[dirOf(r, s)]; return `<span class="tag dir" style="--dc:${d.color}" title="${esc(s)}: ${d.label.toLowerCase()}"><b>${d.icon}</b>${esc(s)}</span>`; }).join('')}</div>
      <span class="status" style="--sc:${st.color}"><i></i>${st.label}</span></div>
  </article>`;
}

function openRiskModal(id) {
  const r = id ? S.risks.find(x => x.id === id) : { title: '', region: '', status: 'monitoraggio', ccy: '', note: '', trend: 'stabile', scen_up: '', scen_down: '', triggers: '' };
  const lik = id ? rLik(r) : 'medio', imp = id ? rImp(r) : 'medio';
  const sel = (idn, opts, cur) => `<select id="${idn}">${Object.entries(opts).map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  openModal(`<h3>${id ? tx('Modifica rischio') : tx('Nuovo rischio')}</h3><div class="sub">${tx('Uno scenario geopolitico: quanto è probabile, quanto pesa sul mercato e cosa osservare.')}</div>
    <div class="form-grid">
      <div class="field"><label>${tx('Titolo dello scenario')}</label><input id="r-title" value="${esc(r.title)}" placeholder="${tx('es. Tensioni commerciali USA–Cina')}"></div>
      <div class="field s3"><label>${tx('Area / regione')}</label><input id="r-region" value="${esc(r.region)}"></div>
      <div class="field s3"><label>${tx('Valute coinvolte (separate da virgola)')}</label><input id="r-ccy" value="${esc(r.ccy)}" placeholder="USD, JPY"></div>
      <div class="field" id="r-dirwrap"><label>${tx('Direzione per valuta')}</label><div class="dirs" id="r-dirs"></div></div>
      <div class="field s2"><label>${tx('Probabilità')}</label>${sel('r-lik', LIK_LABEL, lik)}</div>
      <div class="field s2"><label>${tx('Impatto sul mercato')}</label>${sel('r-imp', IMP_LABEL, imp)}</div>
      <div class="field s2"><label>${tx('Trend probabilità')}</label>${sel('r-trend', Object.fromEntries(Object.entries(TREND).map(([k, v]) => [k, v.label])), rTrend(r))}</div>
      <div class="field"><label>${tx('Stato')}</label>${sel('r-status', Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label])), r.status || 'monitoraggio')}</div>
      <div class="field s3"><label>${tx('Se escalation')}</label><textarea id="r-up" placeholder="${tx('Cosa succede ai mercati e alle valute…')}">${esc(r.scen_up)}</textarea></div>
      <div class="field s3"><label>${tx('Se rientra')}</label><textarea id="r-down" placeholder="${tx('Cosa succede se la tensione cala…')}">${esc(r.scen_down)}</textarea></div>
      <div class="field"><label>${tx('Trigger da osservare (uno per riga)')}</label><textarea id="r-trig" placeholder="${tx('Annunci, scadenze, livelli di prezzo…')}">${esc(r.triggers)}</textarea></div>
      <div class="field"><label>${tx('Note')}</label><textarea id="r-note">${esc(r.note)}</textarea></div>
    </div>
    <div class="modal-foot"><div>${id ? `<button class="btn danger" id="m-del">${tx('Elimina')}</button>` : ''}</div>
      <div class="actions"><button class="btn" id="m-cancel">${tx('Annulla')}</button><button class="btn primary" id="m-save">${tx('Salva')}</button></div></div>`);
  // direzione per valuta: una riga per ogni valuta scritta nel campo, scelta tra favorita / neutra / penalizzata
  const dirs = { ...(r.ccy_dir || {}) };
  const drawDirs = () => {
    const codes = [...new Set($('#r-ccy').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
    $('#r-dirwrap').style.display = codes.length ? '' : 'none';
    $('#r-dirs').innerHTML = codes.map(code => `<div class="dir-row"><span class="mono">${esc(code)}</span>
      <div class="seg" data-code="${esc(code)}">${['pos', 'neu', 'neg'].map(k => `<button type="button" data-d="${k}" class="${(dirs[code] || 'neu') === k ? 'on ' + k : ''}">${DIR[k].icon} ${DIR[k].label}</button>`).join('')}</div></div>`).join('');
    $$('#r-dirs .seg button').forEach(b => b.onclick = () => { dirs[b.parentElement.dataset.code] = b.dataset.d; drawDirs(); });
  };
  $('#r-ccy').oninput = drawDirs; drawDirs();
  $('#m-cancel').onclick = closeModal;
  if (id) $('#m-del').onclick = async () => {
    if (!confirm(tx('Eliminare questo rischio? L\'operazione non si può annullare.'))) return;
    await api('DELETE', `/api/risks/${id}`); S.risks = S.risks.filter(x => x.id !== id); closeModal(); rerender();
  };
  $('#m-save').onclick = async () => {
    const title = $('#r-title').value.trim(); if (!title) { $('#r-title').focus(); return; }
    const body = {
      title, region: $('#r-region').value.trim(), ccy: $('#r-ccy').value.trim(),
      ccy_dir: Object.fromEntries($('#r-ccy').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).map(c => [c, dirs[c] || 'neu'])),
      likelihood: $('#r-lik').value, impact: $('#r-imp').value, trend: $('#r-trend').value, status: $('#r-status').value,
      scen_up: $('#r-up').value.trim(), scen_down: $('#r-down').value.trim(), triggers: $('#r-trig').value.trim(), note: $('#r-note').value.trim(),
    };
    try {
      if (id) Object.assign(r, await api('PUT', `/api/risks/${id}`, body)); else S.risks.push(await api('POST', '/api/risks', body));
      closeModal(); rerender(); toast(tx('Salvato'));
    } catch (e) { toast(tx('Errore nel salvataggio')); }
  };
}

/* ───────── pagina IDEE DI TRADE ───────── */
const TSTATUS = {
  watchlist: { label: tx('Watchlist'), color: 'var(--warn)' },
  attiva:    { label: tx('Attiva'),    color: 'var(--b-long)' },
  chiusa:    { label: tx('Chiusa'),    color: 'var(--text-3)' },
};
const TCONV = { 1: tx('Bassa'), 2: tx('Media'), 3: tx('Alta') };
const THORIZ = { breve: tx('Breve (giorni)'), medio: tx('Medio (settimane)'), lungo: tx('Lungo (mesi)') };
const BSCORE = { molto_short: -2, short: -1, neutro: 0, long: 1, molto_long: 2 };
const tDir = t => t.dir === 'short' ? 'short' : 'long';
const tColor = t => tDir(t) === 'long' ? 'var(--pos)' : 'var(--neg)';
const tStatus = t => TSTATUS[t.status] ? t.status : 'watchlist';
const fpx = v => v == null ? '—' : String(+Number(v).toFixed(5));
const fR = v => v == null ? '—' : (v > 0 ? '+' : '') + String(Math.round(v * 100) / 100) + 'R';
const fDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(LOCALE, { day: '2-digit', month: 'short' }) : '';

// R:R dai livelli inseriti + controllo di coerenza (long: stop < ingresso < target; short: il contrario)
function tCalc(t) {
  const e = num(t.entry), s = num(t.stop), t1 = num(t.target), t2 = num(t.target2);
  if (e == null || s == null || e === s) return { rr: null, rr2: null, ok: true };
  const risk = Math.abs(e - s), long = tDir(t) === 'long';
  const rr = t1 == null ? null : Math.round(Math.abs(t1 - e) / risk * 100) / 100;
  const rr2 = t2 == null ? null : Math.round(Math.abs(t2 - e) / risk * 100) / 100;
  const ok = long ? (s < e && (t1 == null || t1 > e)) : (s > e && (t1 == null || t1 < e));
  return { rr, rr2, ok };
}
// Segnale automatico: la direzione del trade è in linea con i bias scelti sulle due valute della coppia?
function parsePair(str) { const m = String(str || '').toUpperCase().replace(/[^A-Z]/g, ''); return m.length === 6 ? [m.slice(0, 3), m.slice(3)] : null; }
function tAlign(t) {
  const p = parsePair(t.instrument); if (!p) return null;
  const b = S.countries.find(c => c.code === p[0]), q = S.countries.find(c => c.code === p[1]);
  if (!b || !q) return null;
  const diff = (tDir(t) === 'short' ? -1 : 1) * (BSCORE[b.bias] - BSCORE[q.bias]);
  return { state: diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'flat', diff, b, q };
}
function alignChip(t) {
  const a = tAlign(t);
  if (!a) return `<span class="chip flat" title="${tx('Valute non trovate tra i paesi seguiti')}">${tx('bias n/d')}</span>`;
  const label = a.state === 'pos' ? tx('In linea coi bias') : a.state === 'neg' ? tx('Contro i bias') : tx('Bias neutri');
  return `<span class="chip ${a.state}" title="${esc(a.b.code)}: ${BIAS[a.b.bias].label} · ${esc(a.q.code)}: ${BIAS[a.q.bias].label}">${label}</span>`;
}
const dirChip = t => `<span class="chip" style="--cc:${tColor(t)}">${tDir(t) === 'long' ? '▲ Long' : '▼ Short'}</span>`;
const convMeter = n => `<span class="meter" style="--mc:var(--accent)" title="${tx('Convinzione')} ${TCONV[n] || '—'}">${[1, 2, 3].map(i => `<i class="${i <= (n || 0) ? 'on' : ''}"></i>`).join('')}</span>`;
const rrText = c => c.rr == null ? '—' : `1 : ${c.rr}`;

function renderTrades() {
  const view = pref.get('trade_view', 'board');
  const all = S.trades;
  const act = all.filter(t => tStatus(t) === 'attiva'), wl = all.filter(t => tStatus(t) === 'watchlist'), cl = all.filter(t => tStatus(t) === 'chiusa');
  const rrs = [...act, ...wl].map(t => tCalc(t).rr).filter(v => v != null);
  const avg = rrs.length ? Math.round(rrs.reduce((a, b) => a + b, 0) / rrs.length * 100) / 100 : null;
  const res = cl.map(t => num(t.result)).filter(v => v != null);
  const tot = Math.round(res.reduce((a, b) => a + b, 0) * 100) / 100;
  const wr = res.length ? Math.round(res.filter(v => v > 0).length / res.length * 100) : null;

  $('#main').innerHTML = `<div class="fade-in">
    <div class="page-head">
      <div><div class="eyebrow">${tx('Operatività')}</div><h1 class="page-title">${tx('Idee di Trade')}</h1>
        <p class="page-sub">${tx('Le tue idee con livelli, tesi, driver macro e invalidazione. Il segnale automatico dice se la direzione è in linea con i bias scelti sulle valute.')}</p></div>
      <div class="actions">
        <div class="seg"><button data-v="board" class="${view === 'board' ? 'on' : ''}">${tx('Board')}</button><button data-v="table" class="${view === 'table' ? 'on' : ''}">${tx('Tabella')}</button></div>
        <button class="btn primary" id="add-trade"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>${tx('Nuova idea')}</button>
      </div>
    </div>
    <div class="kpis" style="margin-top:0">
      <div class="kpi" style="--c:var(--b-long)"><div class="kpi-label">${tx('Attive')}</div><div class="kpi-value">${act.length}</div><div class="kpi-sub">${wl.length} ${tx('in watchlist')}</div></div>
      <div class="kpi" style="--c:var(--accent)"><div class="kpi-label">${tx('R:R medio')}</div><div class="kpi-value">${avg == null ? '—' : '1 : ' + avg}</div><div class="kpi-sub">${tx('su idee attive e watchlist')}</div></div>
      <div class="kpi" style="--c:var(--pos)"><div class="kpi-label">${tx('Risultato chiuse')}</div><div class="kpi-value">${res.length ? fR(tot) : '—'}</div><div class="kpi-sub">${cl.length} ${tx('chiuse')}${wr == null ? '' : ' · ' + tx('win rate') + ' ' + wr + '%'}</div></div>
    </div>
    <section class="section">
      ${all.length ? (view === 'board' ? `<div class="tboard">${Object.keys(TSTATUS).map(st => {
        const items = all.filter(t => tStatus(t) === st);
        return `<div class="tcol" data-st="${st}" style="--c:${TSTATUS[st].color}"><div class="col-head"><i></i>${TSTATUS[st].label}<span>${items.length}</span></div>
          ${items.map(tradeCard).join('') || `<div class="empty" style="padding:22px;font-size:12px">${tx('Trascina qui un’idea')}</div>`}</div>`;
      }).join('')}</div>` : tradeTable()) : `<div class="empty">${tx('Nessuna idea di trade. Aggiungi la prima con “Nuova idea”.')}</div>`}
    </section></div>`;

  $$('.seg button').forEach(b => b.onclick = () => { pref.set('trade_view', b.dataset.v); renderTrades(); });
  $('#add-trade').onclick = () => openTradeModal(null);
  $$('.tcard, .trow').forEach(el => el.onclick = () => openTradeModal(el.dataset.id));
  $$('.tcard').forEach(el => {
    el.ondragstart = e => { e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('drag'); };
    el.ondragend = () => el.classList.remove('drag');
  });
  $$('.tcol').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = async e => {
      e.preventDefault(); col.classList.remove('over');
      const t = S.trades.find(x => x.id === e.dataTransfer.getData('text/plain')); if (!t || tStatus(t) === col.dataset.st) return;
      t.status = col.dataset.st; const patch = { status: t.status };
      const today = new Date().toISOString().slice(0, 10);
      if (t.status === 'attiva' && !t.date_open) { t.date_open = today; patch.date_open = today; }
      if (t.status === 'chiusa' && !t.date_close) { t.date_close = today; patch.date_close = today; }
      await api('PUT', `/api/trades/${t.id}`, patch); rerender(); toast(tx('Stato aggiornato'));
    };
  });
}

function tradeCard(t) {
  const c = tCalc(t), st = tStatus(t), p = parsePair(t.instrument);
  const exp = p ? [...riskExposure(p[0]), ...riskExposure(p[1])] : [];
  const uniq = [...new Map(exp.map(r => [r.id, r])).values()];
  return `<article class="tcard" draggable="true" data-id="${esc(t.id)}" style="--c:${tColor(t)}">
    <div class="tc-head"><h4>${esc(t.instrument || tx('Senza nome'))}</h4>${dirChip(t)}</div>
    <div class="tc-levels">
      <div><small>${tx('Ingresso')}</small><b>${fpx(num(t.entry))}</b></div>
      <div><small>${tx('Stop')}</small><b style="color:var(--neg)">${fpx(num(t.stop))}</b></div>
      <div><small>${tx('Target')}</small><b style="color:var(--pos)">${fpx(num(t.target))}</b></div>
      <div><small>${tx('R:R')}</small><b>${rrText(c)}${c.ok ? '' : ` <span title="${tx('Livelli incoerenti con la direzione')}" style="color:var(--warn)">⚠</span>`}</b></div>
    </div>
    ${st === 'chiusa' && t.result != null ? `<div class="tc-result" style="color:${num(t.result) > 0 ? 'var(--pos)' : num(t.result) < 0 ? 'var(--neg)' : 'var(--text-2)'}">${tx('Risultato')} ${fR(num(t.result))}</div>` : ''}
    <div class="tc-meta">${convMeter(t.conv)}${t.horizon ? `<span class="tag">${esc((THORIZ[t.horizon] || t.horizon).split(' ')[0])}</span>` : ''}${alignChip(t)}</div>
    ${t.thesis ? `<p class="tc-thesis">${esc(t.thesis)}</p>` : ''}
    <div class="tc-foot"><span>${t.date_open ? tx('Aperta') + ' ' + fDate(t.date_open) : ''}${t.date_close ? ' · ' + tx('chiusa') + ' ' + fDate(t.date_close) : ''}</span>
      ${uniq.length ? `<a href="#risks" class="rtag" style="--rc:${rColor(uniq[0])}" title="${esc(uniq.map(r => r.title).join(' · '))}" onclick="event.stopPropagation()">${uniq.length} ${uniq.length === 1 ? tx('rischio') : tx('rischi')}</a>` : ''}</div>
  </article>`;
}

function tradeTable() {
  const rows = [...S.trades].sort((a, b) => Object.keys(TSTATUS).indexOf(tStatus(a)) - Object.keys(TSTATUS).indexOf(tStatus(b)));
  return `<div class="table-wrap"><table><thead><tr><th>${tx('Strumento')}</th><th>${tx('Direzione')}</th><th>${tx('Stato')}</th><th class="num">${tx('Ingresso')}</th><th class="num">${tx('Stop')}</th><th class="num">${tx('Target')}</th><th class="num">${tx('R:R')}</th><th>${tx('Convinzione')}</th><th>${tx('Bias')}</th><th class="num">${tx('Risultato')}</th></tr></thead><tbody>
  ${rows.map(t => { const c = tCalc(t); return `<tr class="trow clickable" data-id="${esc(t.id)}">
    <td>${esc(t.instrument)}</td><td>${dirChip(t)}</td><td><span class="status" style="--sc:${TSTATUS[tStatus(t)].color}"><i></i>${TSTATUS[tStatus(t)].label}</span></td>
    <td class="num">${fpx(num(t.entry))}</td><td class="num">${fpx(num(t.stop))}</td><td class="num">${fpx(num(t.target))}</td><td class="num">${rrText(c)}</td>
    <td>${convMeter(t.conv)}</td><td>${alignChip(t)}</td><td class="num">${t.result != null ? fR(num(t.result)) : '—'}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}

function renderHomeTrades() {
  const el = $('#home-trades'); if (!el) return;
  const rows = [...S.trades.filter(t => tStatus(t) === 'attiva'), ...S.trades.filter(t => tStatus(t) === 'watchlist')].slice(0, 6);
  el.innerHTML = rows.length ? rows.map(t => { const c = tCalc(t); return `<tr class="clickable" data-go="trades">
    <td>${esc(t.instrument)}</td><td>${dirChip(t)}</td><td><span class="status" style="--sc:${TSTATUS[tStatus(t)].color}"><i></i>${TSTATUS[tStatus(t)].label}</span></td>
    <td class="num">${fpx(num(t.entry))}</td><td class="num">${fpx(num(t.stop))}</td><td class="num">${fpx(num(t.target))}</td><td class="num">${rrText(c)}</td><td>${alignChip(t)}</td></tr>`; }).join('')
    : `<tr><td colspan="8"><div class="empty" style="border:0">${tx('Nessuna idea attiva o in watchlist.')}</div></td></tr>`;
  $$('#home-trades tr.clickable').forEach(tr => tr.onclick = () => { location.hash = '#trades'; });
}

function openTradeModal(id) {
  const t = id ? S.trades.find(x => x.id === id) : { instrument: '', dir: 'long', status: 'watchlist', horizon: 'medio', conv: 2, thesis: '', drivers: '', trigger: '', invalid: '', note: '', date_open: '', date_close: '' };
  const sel = (idn, opts, cur) => `<select id="${idn}">${Object.entries(opts).map(([k, l]) => `<option value="${k}" ${String(cur) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const inp = (idn, label, val, extra = '') => `<div class="field s2"><label>${label}</label><input id="${idn}" inputmode="decimal" value="${val ?? ''}" ${extra}></div>`;
  openModal(`<h3>${id ? tx('Modifica idea') : tx('Nuova idea di trade')}</h3><div class="sub">${tx('Livelli, tesi e invalidazione. R:R e allineamento ai bias si calcolano da soli.')}</div>
    <div class="form-grid">
      <div class="field s3"><label>${tx('Strumento (coppia o asset)')}</label><input id="t-inst" value="${esc(t.instrument)}" placeholder="${tx('es. EUR/USD')}"></div>
      <div class="field s3"><label>${tx('Direzione')}</label>${sel('t-dir', { long: '▲ Long', short: '▼ Short' }, tDir(t))}</div>
      <div class="field s2"><label>${tx('Stato')}</label>${sel('t-status', Object.fromEntries(Object.entries(TSTATUS).map(([k, v]) => [k, v.label])), tStatus(t))}</div>
      <div class="field s2"><label>${tx('Orizzonte')}</label>${sel('t-hor', THORIZ, t.horizon || 'medio')}</div>
      <div class="field s2"><label>${tx('Convinzione')}</label>${sel('t-conv', TCONV, t.conv || 2)}</div>
      ${inp('t-entry', tx('Ingresso'), t.entry)}${inp('t-stop', tx('Stop'), t.stop)}${inp('t-target', tx('Target 1'), t.target)}
      ${inp('t-target2', tx('Target 2 (opz.)'), t.target2)}${inp('t-risk', tx('Rischio % del conto'), t.risk_pct)}${inp('t-result', tx('Risultato (R)'), t.result, `placeholder="${tx('se chiusa')}"`)}
      <div class="field s3"><label>${tx('Data apertura')}</label><input id="t-dopen" type="date" value="${esc(t.date_open || '')}"></div>
      <div class="field s3"><label>${tx('Data chiusura')}</label><input id="t-dclose" type="date" value="${esc(t.date_close || '')}"></div>
      <div class="field"><div id="t-preview" class="dirs" style="font-size:12px"></div></div>
      <div class="field"><label>${tx('Tesi')}</label><textarea id="t-thesis" placeholder="${tx('Perché questa idea?')}">${esc(t.thesis)}</textarea></div>
      <div class="field s3"><label>${tx('Driver macro (uno per riga)')}</label><textarea id="t-drivers" placeholder="${tx('Tassi, inflazione, PIL, rischi…')}">${esc(t.drivers)}</textarea></div>
      <div class="field s3"><label>${tx("Trigger d'ingresso")}</label><textarea id="t-trigger" placeholder="${tx('Cosa aspetti per entrare?')}">${esc(t.trigger)}</textarea></div>
      <div class="field"><label>${tx('Invalidazione')}</label><input id="t-invalid" value="${esc(t.invalid)}" placeholder="${tx("Cosa ti dice che l'idea è sbagliata?")}"></div>
      <div class="field"><label>${tx('Note')}</label><textarea id="t-note">${esc(t.note)}</textarea></div>
    </div>
    <div class="modal-foot"><div>${id ? `<button class="btn danger" id="m-del">${tx('Elimina')}</button>` : ''}</div>
      <div class="actions"><button class="btn" id="m-cancel">${tx('Annulla')}</button><button class="btn primary" id="m-save">${tx('Salva')}</button></div></div>`);

  const read = () => ({
    instrument: $('#t-inst').value.trim(), dir: $('#t-dir').value, status: $('#t-status').value, horizon: $('#t-hor').value, conv: parseInt($('#t-conv').value, 10),
    entry: num($('#t-entry').value), stop: num($('#t-stop').value), target: num($('#t-target').value), target2: num($('#t-target2').value),
    risk_pct: num($('#t-risk').value), result: num($('#t-result').value), date_open: $('#t-dopen').value, date_close: $('#t-dclose').value,
    thesis: $('#t-thesis').value.trim(), drivers: $('#t-drivers').value.trim(), trigger: $('#t-trigger').value.trim(), invalid: $('#t-invalid').value.trim(), note: $('#t-note').value.trim(),
  });
  const preview = () => {
    const d = read(), c = tCalc(d), a = tAlign(d);
    $('#t-preview').innerHTML = `<div class="dir-row"><span>${tx('R:R')}</span><b>${c.rr == null ? '—' : '1 : ' + c.rr}${c.rr2 != null ? ' · T2 1 : ' + c.rr2 : ''}${c.ok ? '' : ` <span style="color:var(--warn)">${tx('⚠ livelli incoerenti con la direzione')}</span>`}</b></div>
      <div class="dir-row"><span>${tx('Bias')}</span><b>${a ? alignChip(d) : `<span class="chip flat">${tx('coppia non riconosciuta')}</span>`}</b></div>`;
  };
  $$('#modal input, #modal select').forEach(el => { el.oninput = preview; el.onchange = preview; });
  preview();

  $('#m-cancel').onclick = closeModal;
  if (id) $('#m-del').onclick = async () => {
    if (!confirm(tx('Eliminare questa idea? L\'operazione non si può annullare.'))) return;
    await api('DELETE', `/api/trades/${id}`); S.trades = S.trades.filter(x => x.id !== id); closeModal(); rerender();
  };
  $('#m-save').onclick = async () => {
    const body = read(); if (!body.instrument) { $('#t-inst').focus(); return; }
    try {
      if (id) Object.assign(t, await api('PUT', `/api/trades/${id}`, body)); else S.trades.push(await api('POST', '/api/trades', body));
      closeModal(); rerender(); toast(tx('Salvato'));
    } catch (e) { toast(tx('Errore nel salvataggio')); }
  };
}

/* ───────── pagina TOOL: gallery di link utili (modificabile) ───────── */
// I tool stanno in data.json: puoi aggiungerli, cambiarli o eliminarli dall'app (pulsante "Modifica").
const toolUrl = u => { const s = String(u || '').trim(); if (!s) return ''; const w = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s; return /^https?:\/\//i.test(w) ? w : ''; };

function renderTools() {
  const edit = pref.get('tools_edit', '0') === '1';
  const list = S.tools;
  const catOf = x => (x.cat || '').trim() || 'Altro';
  const cats = [...new Set(list.map(catOf))];
  const card = (x, i) => {
    const u = toolUrl(x.u); let host = u;
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) {}
    const ico = esc(x.code || String(x.name || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase());
    const body = `<h3>${esc(x.name)}</h3><p>${tx(x.d || '')}</p><small>${esc(host) || tx('Link non valido')}</small>`;
    const delay = `style="animation-delay:${i * 45}ms"`;
    if (edit) return `<div class="tool editing" data-id="${esc(x.id)}" ${delay}><div class="tool-top"><span class="tool-ico">${ico}</span>
      <span class="tool-act"><button type="button" data-act="edit" title="${tx('Modifica')}">✎</button><button type="button" data-act="del" class="danger" title="${tx('Elimina')}">✕</button></span></div>${body}</div>`;
    if (!u) return `<div class="tool broken" title="${tx('Link non valido')}" ${delay}><div class="tool-top"><span class="tool-ico">${ico}</span></div>${body}</div>`;
    return `<a class="tool" href="${esc(u)}" target="_blank" rel="noopener noreferrer" ${delay}><div class="tool-top"><span class="tool-ico">${ico}</span><svg viewBox="0 0 24 24"><path d="M7 17L17 7M8 7h9v9"/></svg></div>${body}</a>`;
  };
  $('#main').innerHTML = `<div class="fade-in">
    <div class="page-head"><div><div class="eyebrow">${tx('Risorse')}</div><h1 class="page-title">${tx('Tool')}</h1>
      <p class="page-sub">${tx('I siti che usi ogni giorno per la tua analisi, a portata di clic. Si aprono in una nuova scheda.')}</p></div>
      <div class="actions"><button class="btn ${edit ? 'on' : ''}" id="tools-edit">${edit ? tx('Fine') : tx('Modifica')}</button>
        <button class="btn primary" id="add-tool"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>${tx('Nuovo tool')}</button></div></div>
    ${edit ? `<div class="edit-hint">${tx('Modalità modifica: clicca ✎ per cambiare un tool o ✕ per eliminarlo (utile per i link che non funzionano).')}</div>` : ''}
    ${list.length ? cats.map(cat => `<section class="section"><div class="section-head"><div><div class="eyebrow">${tx('Categoria')}</div><h2 class="section-title">${tx(cat)}</h2></div></div>
      <div class="tools">${list.filter(x => catOf(x) === cat).map(card).join('')}</div></section>`).join('')
      : `<div class="empty">${tx('Nessun tool. Aggiungine uno con “Nuovo tool”.')}</div>`}
  </div>`;

  $('#tools-edit').onclick = () => { pref.set('tools_edit', edit ? '0' : '1'); renderTools(); };
  $('#add-tool').onclick = () => openToolModal(null);
  $$('.tool.editing').forEach(el => {
    el.onclick = () => openToolModal(el.dataset.id);
    $$('[data-act]', el).forEach(b => b.onclick = async e => {
      e.stopPropagation();
      if (b.dataset.act === 'edit') return openToolModal(el.dataset.id);
      const t = S.tools.find(x => x.id === el.dataset.id); if (!t) return;
      if (!confirm(tx('Eliminare {n}? L\'operazione non si può annullare.', { n: t.name }))) return;
      try { await api('DELETE', `/api/tools/${t.id}`); S.tools = S.tools.filter(x => x.id !== t.id); rerender(); toast(tx('Tool eliminato')); }
      catch (err) { toast(tx('Errore nel salvataggio')); }
    });
  });
}

function openToolModal(id) {
  const t = id ? S.tools.find(x => x.id === id) : { name: '', u: '', cat: '', d: '' };
  const cats = [...new Set(S.tools.map(x => (x.cat || '').trim()).filter(Boolean))];
  openModal(`<h3>${id ? tx('Modifica tool') : tx('Nuovo tool')}</h3><div class="sub">${tx('Aggiungi o modifica i link che usi per la tua analisi.')}</div>
    <div class="form-grid">
      <div class="field s3"><label>${tx('Nome')}</label><input id="tl-name" value="${esc(t.name)}" placeholder="BlackRock Weekly Market Commentary"></div>
      <div class="field s3"><label>${tx('Categoria')}</label><input id="tl-cat" list="tl-cats" value="${esc(t.cat)}" placeholder="${tx('Analisi')}"><datalist id="tl-cats">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
      <div class="field"><label>${tx('Indirizzo (link)')}</label><input id="tl-url" value="${esc(t.u)}" placeholder="https://…"></div>
      <div class="field"><label>${tx('Descrizione')}</label><textarea id="tl-desc">${esc(t.d ? tx(t.d) : '')}</textarea></div>
    </div>
    <div class="modal-foot"><div>${id ? `<button class="btn danger" id="m-del">${tx('Elimina')}</button>` : ''}</div>
      <div class="actions"><button class="btn" id="tl-test" type="button">${tx('Prova il link')} ↗</button><button class="btn" id="m-cancel">${tx('Annulla')}</button><button class="btn primary" id="m-save">${tx('Salva')}</button></div></div>`);
  $('#m-cancel').onclick = closeModal;
  $('#tl-test').onclick = () => { const u = toolUrl($('#tl-url').value); if (!u) { toast(tx('Link non valido')); $('#tl-url').focus(); return; } window.open(u, '_blank', 'noopener,noreferrer'); };
  if (id) $('#m-del').onclick = async () => {
    if (!confirm(tx('Eliminare {n}? L\'operazione non si può annullare.', { n: t.name }))) return;
    try { await api('DELETE', `/api/tools/${id}`); S.tools = S.tools.filter(x => x.id !== id); closeModal(); rerender(); toast(tx('Tool eliminato')); }
    catch (err) { toast(tx('Errore nel salvataggio')); }
  };
  $('#m-save').onclick = async () => {
    const name = $('#tl-name').value.trim(), u = toolUrl($('#tl-url').value);
    if (!name) { $('#tl-name').focus(); return; }
    if (!u) { toast(tx('Inserisci un nome e un link valido (https://…)')); $('#tl-url').focus(); return; }
    const body = { name, u, cat: $('#tl-cat').value.trim(), d: $('#tl-desc').value.trim() };
    try {
      if (id) Object.assign(t, await api('PUT', `/api/tools/${id}`, body)); else S.tools.push(await api('POST', '/api/tools', body));
      closeModal(); rerender(); toast(tx('Salvato'));
    } catch (e) { toast(tx('Errore nel salvataggio')); }
  };
}

/* ───────── IMPOSTAZIONI ───────── */
function applyTheme() {
  let t = pref.get('theme', 'fallout'); if (t === 'auto') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
}
function renderSettings() {
  const theme = pref.get('theme', 'fallout'), bub = pref.get('bubble', 'medium'), cc = pref.get('cardcolor', '1') === '1', side = pref.get('side', 'open') === 'open';
  const seg = (name, opts, cur) => `<div class="seg" data-name="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('#main').innerHTML = `<div class="fade-in">
    <div class="page-head"><div><div class="eyebrow">${tx('Preferenze')}</div><h1 class="page-title">${tx('Impostazioni')}</h1><p class="page-sub">${tx('Le preferenze sono salvate nel browser. I dati restano nel file data.json, solo sul tuo computer.')}</p></div></div>
    <div class="settings">
      <div class="set-row"><div><b>${tx('Lingua')}</b><span>${tx('Lingua dell\'interfaccia.')}</span></div>${seg('lang', Object.entries(LANGS), LANG)}</div>
      <div class="set-row"><div><b>${tx('Tema')}</b><span>${tx('Pip-Boy (predefinito, schermo a fosfori verdi), scuro, chiaro o in base al sistema.')}</span></div>${seg('theme', [['fallout', 'Pip-Boy'], ['dark', tx('Scuro')], ['light', tx('Chiaro')], ['auto', 'Auto']], theme)}</div>
      <div class="set-row"><div><b>${tx('Colore delle schede')}</b><span>${tx('Le schede prendono il colore del bias del paese.')}</span></div><button class="switch ${cc ? 'on' : ''}" data-sw="cardcolor"></button></div>
      <div class="set-row"><div><b>${tx('Grandezza delle bolle')}</b><span>${tx('Dimensione delle bolle nella Mappa delle Valute.')}</span></div>${seg('bubble', [['small', tx('Piccole')], ['medium', tx('Medie')], ['large', tx('Grandi')]], bub)}</div>
      <div class="set-row"><div><b>${tx('Menu laterale')}</b><span>${tx('Mostra o nascondi la sidebar.')}</span></div><button class="switch ${side ? 'on' : ''}" data-sw="side"></button></div>
      <div class="set-row"><div><b>${tx('Backup dei dati')}</b><span>${tx('Scarica una copia di tutto ciò che hai inserito.')}</span></div><button class="btn" id="export">${tx('Esporta JSON')}</button></div>
    </div></div>`;
  $$('.seg[data-name] button').forEach(b => b.onclick = () => { const n = b.parentElement.dataset.name; pref.set(n, b.dataset.v); if (n === 'theme') applyTheme(); if (n === 'lang') { location.reload(); return; } renderSettings(); });
  $$('.switch').forEach(sw => sw.onclick = () => {
    const k = sw.dataset.sw;
    if (k === 'cardcolor') pref.set('cardcolor', cc ? '0' : '1'); else { pref.set('side', side ? 'hidden' : 'open'); applySide(); }
    renderSettings();
  });
  $('#export').onclick = async () => {
    const d = await api('GET', '/api/data'); const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    a.download = 'macro-terminal-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  };
}

/* ───────── testi statici di index.html ───────── */
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  $$('[data-i18n]').forEach(el => { el.textContent = tx(el.dataset.i18n); });
  $$('[data-i18n-title]').forEach(el => { el.title = tx(el.dataset.i18nTitle); });
}

/* ───────── sidebar ───────── */
function applySide() { $('#app').classList.toggle('side-hidden', pref.get('side', 'open') !== 'open'); }
$('#collapse').onclick = () => { pref.set('side', 'hidden'); applySide(); };
$('#reopen').onclick = () => { pref.set('side', 'open'); applySide(); };
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (pref.get('theme', 'fallout') === 'auto') applyTheme(); });

/* ───────── tema Pip-Boy: barra di stato e sequenza di avvio ───────── */
function tick() { const c = $('#pip-clock'); if (c) c.textContent = new Date().toLocaleTimeString(LOCALE); }
function pipbar() {
  const el = $('#pipbar'); if (!el) return;
  const sur = allSurprises();
  el.innerHTML = `<span>${tx('◄ Dati locali ►')}</span><span>${tx('Paesi')} <b>${S.countries.length}</b></span><span>${tx('Rischi attivi')} <b>${S.risks.filter(rActive).length}</b></span>
    <span>${tx('Sorprese')} <b class="pos">+${sur.filter(x => x.s.sig > 0).length}</b> / <b class="neg">-${sur.filter(x => x.s.sig < 0).length}</b></span><span class="pip-clock" id="pip-clock"></span>`;
  tick();
}
setInterval(tick, 1000);
function bootSequence() {
  if (document.documentElement.dataset.theme !== 'fallout') return;
  try { if (sessionStorage.getItem('mt_boot')) return; sessionStorage.setItem('mt_boot', '1'); } catch (e) {}
  const el = document.createElement('div'); el.className = 'boot'; document.body.appendChild(el);
  const text = tx('ROBCO INDUSTRIES (TM) TERMLINK PROTOCOL\nMACRO TERMINAL  //  ANALISI MACRO-ECONOMICA\n\n> CARICAMENTO DATI LOCALI ........ OK\n> CALIBRAZIONE MAPPA VALUTE ...... OK\n> SEGNALI DI SORPRESA ............ OK\n\nPRONTO.');
  let i = 0, done = false;
  const end = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => el.remove(), 600); };
  el.onclick = end; document.addEventListener('keydown', end, { once: true });
  (function type() { if (done) return; el.innerHTML = esc(text.slice(0, i)) + '<span class="cur"></span>'; if (i++ < text.length) setTimeout(type, 16); else setTimeout(end, 700); })();
}

/* ───────── avvio ───────── */
(async function boot() {
  applyTheme(); applySide(); applyStaticI18n();
  try { await load(); } catch (e) { $('#main').innerHTML = `<div class="empty">${tx('Impossibile leggere i dati. Il server è in esecuzione?')}</div>`; return; }
  route();
  bootSequence();
})();
