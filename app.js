'use strict';

/* =========================================================
   Pilotage Dépenses — application 100 % locale (localStorage)
   ========================================================= */

const STORAGE_KEY = 'pilotage-depenses:v1';
const FORECAST_HORIZON = 6;

const DEFAULT_CATEGORIES = [
  { id: 'c-salaire', name: 'Salaire', icon: '💼', color: '#0f9d63', type: 'income' },
  { id: 'c-freelance', name: 'Freelance', icon: '💻', color: '#14b8a6', type: 'income' },
  { id: 'c-autres-rev', name: 'Autres revenus', icon: '🎁', color: '#22c55e', type: 'income' },
  { id: 'c-logement', name: 'Logement', icon: '🏠', color: '#6366f1', type: 'expense' },
  { id: 'c-courses', name: 'Courses', icon: '🛒', color: '#f59e0b', type: 'expense' },
  { id: 'c-transport', name: 'Transport', icon: '🚗', color: '#0ea5e9', type: 'expense' },
  { id: 'c-restau', name: 'Restaurants', icon: '🍽️', color: '#ef4444', type: 'expense' },
  { id: 'c-loisirs', name: 'Loisirs', icon: '🎬', color: '#a855f7', type: 'expense' },
  { id: 'c-shopping', name: 'Shopping', icon: '🛍️', color: '#f97316', type: 'expense' },
  { id: 'c-sante', name: 'Santé', icon: '💊', color: '#ec4899', type: 'expense' },
  { id: 'c-factures', name: 'Factures', icon: '💡', color: '#64748b', type: 'expense' },
  { id: 'c-abos', name: 'Abonnements', icon: '📱', color: '#8b5cf6', type: 'expense' },
  { id: 'c-divers', name: 'Divers', icon: '📦', color: '#94a3b8', type: 'expense' },
];
// Catégories de repli (non supprimables) quand une catégorie est effacée
const FALLBACK = { expense: 'c-divers', income: 'c-autres-rev' };

const VIEW_TITLES = {
  dashboard: 'Tableau de bord',
  transactions: 'Opérations',
  budgets: 'Budgets',
  forecast: 'Prévisions',
  settings: 'Réglages',
};

/* ---------- Utilitaires ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt = (n) => eur.format(n || 0);
const fmt0 = (n) => eur0.format(n || 0);
const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const pct = (n) => `${Math.round(n)} %`;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const monthKey = (date) => date.slice(0, 7);
function addMonths(mk, n) {
  let [y, m] = mk.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
function daysInMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function mkDate(mk, day = 1) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, day);
}
const monthLong = (mk) => mkDate(mk).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const monthShort = (mk) => mkDate(mk).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
const monthOnly = (mk) => mkDate(mk).toLocaleDateString('fr-FR', { month: 'long' });
function dayLabel(date) {
  const t = todayStr();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const ys = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
  if (date === t) return "Aujourd'hui";
  if (date === ys) return 'Hier';
  const [yy, mm, dd] = date.split('-').map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function parseAmount(s) {
  const n = parseFloat(String(s).replace(/\s| |€/g, '').replace(',', '.'));
  return Number.isFinite(n) ? round2(n) : NaN;
}
const sign = (o) => (o.type === 'income' ? o.amount : -o.amount);
const softColor = (hex, alpha = '22') => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + alpha : hex);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- État & persistance ---------- */
function defaultState() {
  return {
    version: 1,
    settings: { initialBalance: 0, theme: 'auto' },
    categories: structuredClone(DEFAULT_CATEGORIES),
    transactions: [],
    recurring: [],
    budgets: {},
  };
}
function normalize(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  return {
    version: 1,
    settings: { ...d.settings, ...(s.settings || {}) },
    categories: Array.isArray(s.categories) && s.categories.length ? s.categories : d.categories,
    transactions: Array.isArray(s.transactions) ? s.transactions : [],
    recurring: Array.isArray(s.recurring) ? s.recurring : [],
    budgets: s.budgets && typeof s.budgets === 'object' ? s.budgets : {},
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* stockage indisponible */ }
  return defaultState();
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast("⚠️ Impossible d'enregistrer : le stockage du navigateur est indisponible");
  }
}

let state = load();
const ui = {
  view: 'dashboard',
  month: monthKey(todayStr()),
  filter: { q: '', type: 'all', cat: 'all' },
  reduction: 0,
};
const charts = {};

/* ---------- Modèle ---------- */
const cat = (id) => state.categories.find((c) => c.id === id) || { id, name: 'Sans catégorie', icon: '❔', color: '#94a3b8', type: 'expense' };
const catsOf = (type) => state.categories.filter((c) => c.type === type);

const ruleActive = (r, mk) => mk >= r.start && (!r.end || mk <= r.end);
const ruleDate = (r, mk) => `${mk}-${pad(Math.min(r.day, daysInMonth(mk)))}`;

/** Toutes les opérations d'un mois : saisies + occurrences des récurrences. */
function monthOps(mk) {
  const real = state.transactions.filter((t) => monthKey(t.date) === mk);
  const virt = state.recurring
    .filter((r) => ruleActive(r, mk))
    .map((r) => ({
      id: `r:${r.id}:${mk}`, ruleId: r.id, recurring: true,
      type: r.type, amount: r.amount, categoryId: r.categoryId, label: r.label,
      date: ruleDate(r, mk),
    }));
  return [...real, ...virt];
}
/** Opérations réalisées (date ≤ aujourd'hui). */
const doneOps = (mk) => monthOps(mk).filter((o) => o.date <= todayStr());

function totals(ops) {
  let inc = 0, exp = 0;
  for (const o of ops) o.type === 'income' ? (inc += o.amount) : (exp += o.amount);
  return { inc: round2(inc), exp: round2(exp), net: round2(inc - exp) };
}
function firstMonth() {
  let m = null;
  for (const t of state.transactions) { const k = monthKey(t.date); if (!m || k < m) m = k; }
  for (const r of state.recurring) if (!m || r.start < m) m = r.start;
  return m || monthKey(todayStr());
}
function balanceAt(date) {
  let b = Number(state.settings.initialBalance) || 0;
  const end = monthKey(date);
  for (let mk = firstMonth(); mk <= end; mk = addMonths(mk, 1)) {
    for (const o of monthOps(mk)) if (o.date <= date) b += sign(o);
  }
  return round2(b);
}
const hasData = () => state.transactions.length > 0 || state.recurring.length > 0;

/** Dépenses par catégorie pour un ensemble d'opérations. */
function byCategory(ops, type = 'expense') {
  const map = new Map();
  for (const o of ops) if (o.type === type) map.set(o.categoryId, (map.get(o.categoryId) || 0) + o.amount);
  return [...map.entries()].map(([id, v]) => ({ cat: cat(id), value: round2(v) })).sort((a, b) => b.value - a.value);
}

/**
 * Prévision : récurrences + opérations planifiées + moyenne des dépenses/revenus
 * « variables » (saisies non récurrentes) des 3 derniers mois complets.
 */
function computeForecast(reduction = 0) {
  const today = todayStr();
  const cur = monthKey(today);
  const fm = firstMonth();
  const past = [1, 2, 3].map((i) => addMonths(cur, -i)).filter((mk) => mk >= fm);

  const curVar = totals(state.transactions.filter((t) => monthKey(t.date) === cur && t.date <= today));
  let avgVarInc, avgVarExp, basis;
  if (past.length) {
    const v = totals(state.transactions.filter((t) => past.includes(monthKey(t.date))));
    avgVarInc = v.inc / past.length;
    avgVarExp = v.exp / past.length;
    basis = past.length === 1 ? 'le mois dernier' : `la moyenne des ${past.length} derniers mois`;
  } else {
    const day = Number(today.slice(8));
    avgVarInc = curVar.inc;
    avgVarExp = curVar.exp * (daysInMonth(cur) / Math.max(day, 1));
    basis = 'le rythme du mois en cours';
  }
  const k = 1 - reduction;
  const balanceNow = balanceAt(today);

  const all = monthOps(cur);
  const tDone = totals(all.filter((o) => o.date <= today));
  const tUp = totals(all.filter((o) => o.date > today));
  const remInc = Math.max(0, avgVarInc - curVar.inc);
  const remExp = Math.max(0, avgVarExp * k - curVar.exp);

  const months = [];
  let bal = balanceNow + tUp.net + remInc - remExp;
  const cInc = tDone.inc + tUp.inc + remInc;
  const cExp = tDone.exp + tUp.exp + remExp;
  months.push({ mk: cur, inc: round2(cInc), exp: round2(cExp), net: round2(cInc - cExp), end: round2(bal), current: true });

  for (let i = 1; i <= FORECAST_HORIZON; i++) {
    const mk = addMonths(cur, i);
    const t = totals(monthOps(mk));
    const inc = t.inc + avgVarInc;
    const exp = t.exp + avgVarExp * k;
    bal += inc - exp;
    months.push({ mk, inc: round2(inc), exp: round2(exp), net: round2(inc - exp), end: round2(bal) });
  }
  return { balanceNow, avgVarInc: round2(avgVarInc), avgVarExp: round2(avgVarExp), basis, months, pastCount: past.length };
}

/* ---------- Thème ---------- */
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
const isDark = () => {
  const t = state.settings.theme;
  return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
};

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = esc(msg) + (undo ? ' <button class="btn btn-sm" id="toast-undo" style="margin-left:10px;padding:3px 10px">Annuler</button>' : '');
  el.style.pointerEvents = undo ? 'auto' : 'none';
  el.classList.add('show');
  if (undo) $('#toast-undo').onclick = () => { undo(); el.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 5000 : 2600);
}
/** Exécute une modification en permettant de l'annuler. */
function mutate(fn, msg) {
  const snapshot = JSON.stringify(state);
  fn();
  save();
  render();
  if (msg) toast(msg, () => { state = normalize(JSON.parse(snapshot)); save(); render(); });
}

/* ---------- Modale ---------- */
let lastFocus;
function openModal(title, html, onMount) {
  lastFocus = document.activeElement;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
  onMount?.($('#modal-body'));
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
  lastFocus?.focus?.();
}

/* =========================================================
   Rendu
   ========================================================= */
function render() {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${ui.view}`));
  $('#view-title').textContent = VIEW_TITLES[ui.view];
  $('#month-switch').hidden = ui.view === 'forecast' || ui.view === 'settings';
  $('#month-label').textContent = monthLong(ui.month);
  $('#month-label').title = ui.month === monthKey(todayStr()) ? 'Mois en cours' : 'Revenir au mois en cours';

  Object.values(charts).forEach((c) => c.destroy());
  for (const k in charts) delete charts[k];

  ({ dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets, forecast: renderForecast, settings: renderSettings })[ui.view]();
}

function emptyState(title, text) {
  return `<div class="card empty">
    <div class="empty-art">🌱</div>
    <h3>${title}</h3>
    <p>${text}</p>
    <div class="actions">
      <button class="btn btn-primary" data-action="add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Ajouter une opération</button>
      <button class="btn" data-action="demo">Essayer avec des données de démo</button>
    </div>
  </div>`;
}

function txItem(o) {
  const c = cat(o.categoryId);
  const upcoming = o.date > todayStr();
  return `<button class="tx" data-action="edit" data-id="${esc(o.id)}"${upcoming ? ' style="opacity:.7"' : ''}>
    <span class="tx-icon" style="background:${softColor(c.color)}">${c.icon}</span>
    <span class="tx-main">
      <span class="tx-label">${esc(o.label || c.name)}</span>
      <span class="tx-meta">${esc(c.name)}${o.recurring ? ' <span class="badge"><svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/></svg>Mensuel</span>' : ''}</span>
    </span>
    <span class="tx-amount num ${o.type === 'income' ? 'income-c' : ''}">${o.type === 'income' ? '+' : '−'}${fmt(o.amount)}</span>
  </button>`;
}

function txGroups(ops) {
  const sorted = [...ops].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let html = '', day = null;
  for (const o of sorted) {
    if (o.date !== day) {
      day = o.date;
      const dayNet = totals(sorted.filter((x) => x.date === day)).net;
      html += `<div class="tx-day"><span>${dayLabel(day)}</span><span class="num">${fmtSigned(dayNet)}</span></div>`;
    }
    html += txItem(o);
  }
  return `<div class="tx-list">${html}</div>`;
}

/* ---------- Tableau de bord ---------- */
function renderDashboard() {
  const el = $('#view-dashboard');
  if (!hasData()) {
    el.innerHTML = emptyState('Bienvenue 👋', 'Renseignez vos revenus et vos dépenses : vous verrez ici votre solde, la répartition de vos dépenses et vos prévisions.');
    return;
  }
  const today = todayStr();
  const cur = monthKey(today);
  const mk = ui.month;
  const ops = doneOps(mk);
  const t = totals(ops);
  const prev = totals(doneOps(addMonths(mk, -1)));
  const fc = computeForecast();

  // Carte « solde »
  let balLabel, balValue, balSub;
  if (mk === cur) {
    balLabel = 'Solde actuel';
    balValue = fc.balanceNow;
    balSub = `Fin ${monthOnly(cur)} estimée : <strong>${fmt(fc.months[0].end)}</strong>`;
  } else if (mk < cur) {
    balLabel = `Solde fin ${monthOnly(mk)}`;
    balValue = balanceAt(`${mk}-${pad(daysInMonth(mk))}`);
    balSub = `Aujourd'hui : ${fmt(fc.balanceNow)}`;
  } else {
    const f = fc.months.find((m) => m.mk === mk);
    balLabel = `Solde prévu fin ${monthOnly(mk)}`;
    balValue = f ? f.end : null;
    balSub = f ? 'Selon vos prévisions' : 'Au-delà de l’horizon de prévision';
  }

  const trend = (now, before, goodWhenUp) => {
    if (mk >= cur || !before) return '';
    const d = ((now - before) / before) * 100;
    if (!Number.isFinite(d) || Math.abs(d) < 0.5) return '';
    const good = goodWhenUp ? d > 0 : d < 0;
    return `<span class="chip-trend ${good ? 'up' : 'down'}">${d > 0 ? '↑' : '↓'} ${Math.abs(Math.round(d))} %</span>`;
  };

  let expSub = mk < cur ? 'vs mois précédent' : '';
  if (mk === cur) {
    const upcomingExp = totals(monthOps(cur).filter((o) => o.date > today)).exp;
    expSub = `Fin de mois estimée : ${fmt0(fc.months[0].exp)}`;
    if (upcomingExp) expSub += ` · ${fmt0(upcomingExp)} à venir`;
  }
  const rate = t.inc > 0 ? (t.net / t.inc) * 100 : null;

  const recent = ops.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
  const cats = byCategory(ops);
  const budgets = Object.entries(state.budgets).filter(([, v]) => v > 0);

  el.innerHTML = `
    <div class="grid grid-4">
      <div class="card kpi hero">
        <div class="kpi-label"><span class="kpi-icon"><svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="3"/><path d="M16 13h2M2 10h20"/></svg></span>${balLabel}</div>
        <div class="kpi-value num">${balValue == null ? '—' : fmt(balValue)}</div>
        <div class="kpi-sub">${balSub}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label"><span class="kpi-icon" style="background:var(--income-soft);color:var(--income)"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>Revenus</div>
        <div class="kpi-value num">${fmt(t.inc)}</div>
        <div class="kpi-sub">${trend(t.inc, prev.inc, true)} ${mk < cur ? 'vs mois précédent' : ''}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label"><span class="kpi-icon" style="background:var(--expense-soft);color:var(--expense)"><svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></span>Dépenses</div>
        <div class="kpi-value num">${fmt(t.exp)}</div>
        <div class="kpi-sub">${trend(t.exp, prev.exp, false)} ${expSub}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label"><span class="kpi-icon" style="background:var(--accent-soft);color:var(--accent)"><svg viewBox="0 0 24 24"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/><circle cx="16" cy="11" r=".5"/></svg></span>Épargne</div>
        <div class="kpi-value num ${t.net < 0 ? 'expense-c' : ''}">${fmtSigned(t.net)}</div>
        <div class="kpi-sub">${rate == null ? 'Aucun revenu ce mois-ci' : `${pct(rate)} de vos revenus`}</div>
      </div>
    </div>

    <div class="grid grid-3-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3>Revenus et dépenses</h3><span class="small muted">6 derniers mois</span></div>
        <div class="chart-box"><canvas id="ch-bars"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Où va votre argent</h3><span class="small muted" style="text-transform:capitalize">${monthOnly(mk)}</span></div>
        ${cats.length ? `<div class="donut-wrap">
          <div class="chart-box"><canvas id="ch-donut"></canvas><div class="donut-center"><div><span class="small muted">Total</span><strong class="num">${fmt0(t.exp)}</strong></div></div></div>
          <ul class="legend">${cats.slice(0, 6).map((c) => `<li><span class="dot" style="background:${c.cat.color}"></span><span class="name">${c.cat.icon} ${esc(c.cat.name)}</span><span class="num">${fmt0(c.value)}</span><span class="pct num">${Math.round((c.value / t.exp) * 100)}%</span></li>`).join('')}
          ${cats.length > 6 ? `<li class="muted small">+ ${cats.length - 6} autre(s)</li>` : ''}</ul>
        </div>` : '<p class="muted">Aucune dépense ce mois-ci.</p>'}
      </div>
    </div>

    <div class="grid grid-3-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3>Dernières opérations</h3><button class="link" data-goto="transactions">Tout voir →</button></div>
        ${recent.length ? txGroups(recent) : '<p class="muted">Aucune opération ce mois-ci.</p>'}
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>Budgets</h3><button class="link" data-goto="budgets">Gérer →</button></div>
          ${budgets.length ? `<div class="stack" style="gap:14px">${budgets.slice(0, 4).map(([id, b]) => budgetMini(id, b, ops)).join('')}</div>`
            : '<p class="muted small" style="margin:0">Fixez des plafonds par catégorie pour garder le cap.</p><button class="btn btn-sm" style="margin-top:12px" data-goto="budgets">Créer un budget</button>'}
        </div>
        <div class="card">
          <div class="card-head"><h3>À retenir</h3><button class="link" data-goto="forecast">Prévisions →</button></div>
          <div class="stack" style="gap:10px">${insights(fc).slice(0, 3).join('')}</div>
        </div>
      </div>
    </div>`;

  // Graphique barres (6 mois jusqu'au mois sélectionné)
  const mks = [5, 4, 3, 2, 1, 0].map((i) => addMonths(mk, -i));
  const series = mks.map((m) => totals(doneOps(m)));
  charts.bars = new Chart($('#ch-bars'), {
    type: 'bar',
    data: {
      labels: mks.map(monthShort),
      datasets: [
        { label: 'Revenus', data: series.map((s) => s.inc), backgroundColor: cssVar('--income'), borderRadius: 6, maxBarThickness: 22 },
        { label: 'Dépenses', data: series.map((s) => s.exp), backgroundColor: cssVar('--expense'), borderRadius: 6, maxBarThickness: 22 },
      ],
    },
    options: baseChartOptions({ legend: true }),
  });

  if (cats.length) {
    charts.donut = new Chart($('#ch-donut'), {
      type: 'doughnut',
      data: {
        labels: cats.map((c) => c.cat.name),
        datasets: [{ data: cats.map((c) => c.value), backgroundColor: cats.map((c) => c.cat.color), borderWidth: 2, borderColor: cssVar('--surface'), hoverOffset: 6 }],
      },
      options: {
        cutout: '72%', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label} : ${fmt(c.raw)}` } } },
      },
    });
  }
}

function budgetMini(id, budget, ops) {
  const c = cat(id);
  const spent = ops.filter((o) => o.type === 'expense' && o.categoryId === id).reduce((s, o) => s + o.amount, 0);
  const ratio = spent / budget;
  const color = ratio > 1 ? 'var(--expense)' : ratio > 0.85 ? 'var(--warn)' : c.color;
  return `<div class="budget">
    <div class="budget-top" style="gap:10px">
      <span class="budget-name small">${c.icon} ${esc(c.name)}</span>
      <span class="small num"><strong>${fmt0(spent)}</strong> <span class="muted">/ ${fmt0(budget)}</span></span>
    </div>
    <div class="bar" style="height:7px"><div class="bar-fill" style="width:${Math.min(ratio * 100, 100)}%;background:${color}"></div></div>
  </div>`;
}

function insights(fc) {
  const out = [];
  const item = (emoji, bg, html) => `<div class="insight"><div class="insight-icon" style="background:${bg}">${emoji}</div><p>${html}</p></div>`;
  const next = fc.months[1];
  if (next) {
    out.push(next.net >= 0
      ? item('💰', 'var(--income-soft)', `Au rythme actuel, vous mettez de côté environ <strong>${fmt0(next.net)}</strong> par mois.`)
      : item('⚠️', 'var(--expense-soft)', `Au rythme actuel, vos dépenses dépassent vos revenus d'environ <strong>${fmt0(-next.net)}</strong> par mois.`));
  }
  const neg = fc.months.find((m) => m.end < 0);
  if (neg) out.push(item('📉', 'var(--expense-soft)', `Votre solde pourrait passer <strong>sous zéro fin ${monthLong(neg.mk)}</strong>. Anticipez dès maintenant.`));
  else {
    const last = fc.months[fc.months.length - 1];
    out.push(item('🔭', 'var(--accent-soft)', `Solde estimé fin ${monthLong(last.mk)} : <strong>${fmt0(last.end)}</strong>.`));
  }
  // Catégorie en hausse ce mois-ci vs moyenne des 3 mois précédents
  const cur = monthKey(todayStr());
  const now = byCategory(doneOps(cur));
  const prevMonths = [1, 2, 3].map((i) => addMonths(cur, -i)).filter((m) => m >= firstMonth());
  if (prevMonths.length) {
    let best = null;
    for (const c of now) {
      const avg = prevMonths.reduce((s, m) => s + doneOps(m).filter((o) => o.type === 'expense' && o.categoryId === c.cat.id).reduce((a, o) => a + o.amount, 0), 0) / prevMonths.length;
      if (avg > 0 && c.value - avg > 20 && c.value / avg > 1.2 && (!best || c.value - avg > best.diff)) best = { c, avg, diff: c.value - avg };
    }
    if (best) out.push(item(best.c.cat.icon, softColor(best.c.cat.color, '33'), `Dépenses <strong>${esc(best.c.cat.name)}</strong> déjà à ${fmt0(best.c.value)} ce mois-ci, contre ${fmt0(best.avg)} en moyenne.`));
  }
  // Budgets dépassés
  const over = Object.entries(state.budgets).filter(([id, b]) => b > 0 && byCategory(doneOps(cur)).find((x) => x.cat.id === id)?.value > b);
  if (over.length) out.push(item('🚨', 'var(--warn-soft)', `Budget dépassé ce mois-ci : <strong>${over.map(([id]) => esc(cat(id).name)).join(', ')}</strong>.`));
  return out;
}

function baseChartOptions({ legend = false, money = true } = {}) {
  const grid = cssVar('--border');
  const text = cssVar('--text-2');
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, position: 'top', align: 'end', labels: { color: text, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8, boxHeight: 8, padding: 14 } },
      tooltip: { callbacks: { label: (c) => (c.raw == null ? null : ` ${c.dataset.label} : ${money ? fmt(c.raw) : c.raw}`) } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: text }, border: { display: false } },
      y: { grid: { color: grid }, ticks: { color: text, callback: (v) => (money ? fmt0(v) : v), maxTicksLimit: 6 }, border: { display: false } },
    },
  };
}

/* ---------- Opérations ---------- */
function renderTransactions() {
  const el = $('#view-transactions');
  if (!hasData()) {
    el.innerHTML = emptyState('Aucune opération', 'Ajoutez votre première dépense ou votre premier revenu pour commencer.');
    return;
  }
  const today = todayStr();
  const f = ui.filter;
  const q = f.q.trim().toLowerCase();
  const all = monthOps(ui.month).filter((o) =>
    (f.type === 'all' || o.type === f.type) &&
    (f.cat === 'all' || o.categoryId === f.cat) &&
    (!q || (o.label || '').toLowerCase().includes(q) || cat(o.categoryId).name.toLowerCase().includes(q)));
  const done = all.filter((o) => o.date <= today);
  const upcoming = all.filter((o) => o.date > today);
  const t = totals(done);

  el.innerHTML = `
    <div class="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input type="search" id="f-q" placeholder="Rechercher une opération…" value="${esc(f.q)}">
      </div>
      <div class="seg" id="f-type">
        <button data-v="all" class="${f.type === 'all' ? 'active' : ''}">Tout</button>
        <button data-v="expense" class="${f.type === 'expense' ? 'active' : ''}">Dépenses</button>
        <button data-v="income" class="${f.type === 'income' ? 'active' : ''}">Revenus</button>
      </div>
      <select id="f-cat" style="width:auto;min-width:170px">
        <option value="all">Toutes catégories</option>
        ${state.categories.map((c) => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="card summary-bar">
      <div><span>Revenus</span><strong class="num income-c">${fmt(t.inc)}</strong></div>
      <div><span>Dépenses</span><strong class="num expense-c">${fmt(t.exp)}</strong></div>
      <div><span>Solde du mois</span><strong class="num">${fmtSigned(t.net)}</strong></div>
      <div><span>Opérations</span><strong class="num">${done.length}</strong></div>
    </div>
    ${upcoming.length ? `<div class="card" style="margin-bottom:16px">
      <div class="card-head" style="margin-bottom:8px"><h3>À venir ce mois-ci</h3><span class="small muted num">${fmtSigned(totals(upcoming).net)}</span></div>
      ${txGroups(upcoming)}
    </div>` : ''}
    <div class="card">
      ${done.length ? txGroups(done) : `<p class="muted" style="margin:0;text-align:center;padding:24px">${q || f.type !== 'all' || f.cat !== 'all' ? 'Aucune opération ne correspond à vos filtres.' : 'Aucune opération ce mois-ci.'}</p>`}
    </div>`;

  const qIn = $('#f-q');
  qIn.addEventListener('input', () => {
    f.q = qIn.value;
    const pos = qIn.selectionStart;
    renderTransactions();
    const n = $('#f-q'); n.focus(); n.setSelectionRange(pos, pos);
  });
  $$('#f-type button').forEach((b) => b.addEventListener('click', () => { f.type = b.dataset.v; renderTransactions(); }));
  $('#f-cat').addEventListener('change', (e) => { f.cat = e.target.value; renderTransactions(); });
}

/* ---------- Budgets ---------- */
function renderBudgets() {
  const el = $('#view-budgets');
  const today = todayStr();
  const cur = monthKey(today);
  const mk = ui.month;
  const ops = doneOps(mk);
  const spentBy = Object.fromEntries(byCategory(ops).map((x) => [x.cat.id, x.value]));
  const withBudget = catsOf('expense').filter((c) => state.budgets[c.id] > 0);
  const without = catsOf('expense').filter((c) => !(state.budgets[c.id] > 0));
  const totalBudget = withBudget.reduce((s, c) => s + state.budgets[c.id], 0);
  const totalSpent = withBudget.reduce((s, c) => s + (spentBy[c.id] || 0), 0);
  const dim = daysInMonth(mk);
  const day = mk === cur ? Number(today.slice(8)) : mk < cur ? dim : 0;
  const timeRatio = day / dim;

  const card = (c) => {
    const b = state.budgets[c.id];
    const s = spentBy[c.id] || 0;
    const ratio = s / b;
    // Projection au rythme actuel, seulement après une semaine (sinon trop peu fiable)
    const proj = mk === cur && day >= 7 ? (s / day) * dim : null;
    let status, cls;
    if (ratio > 1) { status = `Dépassé de ${fmt0(s - b)}`; cls = 'over'; }
    else if (proj != null && proj > b * 1.02) { status = `Risque de dépassement (≈ ${fmt0(proj)})`; cls = 'warn'; }
    else if (ratio > 0.85) { status = 'Presque atteint'; cls = 'warn'; }
    else { status = mk > cur ? 'À venir' : 'Dans les clous'; cls = 'ok'; }
    const color = cls === 'over' ? 'var(--expense)' : cls === 'warn' ? 'var(--warn)' : c.color;
    return `<button class="card budget" data-action="budget" data-id="${c.id}" style="text-align:left;cursor:pointer">
      <div class="budget-top">
        <span class="tx-icon" style="background:${softColor(c.color)}">${c.icon}</span>
        <span class="budget-name">${esc(c.name)}</span>
        <span class="budget-amounts num"><strong style="font-size:15px">${fmt(s)}</strong><br><span class="muted">sur ${fmt0(b)}</span></span>
      </div>
      <div class="bar">
        <div class="bar-fill" style="width:${Math.min(ratio * 100, 100)}%;background:${color}"></div>
        ${mk === cur ? `<div class="bar-proj" style="left:${timeRatio * 100}%" title="Aujourd'hui"></div>` : ''}
      </div>
      <div class="budget-foot"><span class="status ${cls}">${status}</span><span class="num">${ratio <= 1 ? `Reste ${fmt0(b - s)}` : ''}</span></div>
    </button>`;
  };

  el.innerHTML = `
    ${withBudget.length ? `<div class="card summary-bar">
      <div><span>Budget total</span><strong class="num">${fmt(totalBudget)}</strong></div>
      <div><span>Dépensé</span><strong class="num ${totalSpent > totalBudget ? 'expense-c' : ''}">${fmt(totalSpent)}</strong></div>
      <div><span>Reste</span><strong class="num">${fmt(totalBudget - totalSpent)}</strong></div>
      ${mk === cur ? `<div><span>Mois écoulé</span><strong class="num">${pct(timeRatio * 100)}</strong></div>` : ''}
    </div>
    <div class="grid grid-2">${withBudget.map(card).join('')}</div>` : `<div class="card empty">
      <div class="empty-art">🎯</div><h3>Aucun budget pour l'instant</h3>
      <p>Fixez un plafond mensuel par catégorie. La barre pointillée indique où vous en êtes dans le mois : si la barre de couleur la dépasse, vous dépensez trop vite.</p>
    </div>`}
    ${without.length ? `<div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Ajouter un budget</h3></div>
      <div class="cat-grid">${without.map((c) => `<button class="cat-opt" data-action="budget" data-id="${c.id}"><span class="emo">${c.icon}</span><span>${esc(c.name)}</span><span class="small muted num" style="font-weight:500">${spentBy[c.id] ? fmt0(spentBy[c.id]) : '+ Budget'}</span></button>`).join('')}</div>
    </div>` : ''}`;
}

function openBudgetForm(id) {
  const c = cat(id);
  const cur = state.budgets[id];
  // Suggestion : moyenne des 3 derniers mois
  const m = monthKey(todayStr());
  const avg = [1, 2, 3].map((i) => addMonths(m, -i)).reduce((s, mk) => s + (byCategory(doneOps(mk)).find((x) => x.cat.id === id)?.value || 0), 0) / 3;
  openModal(`Budget · ${c.icon} ${c.name}`, `
    <form class="form" id="budget-form">
      <div class="amount-input"><input id="b-amount" type="text" inputmode="decimal" placeholder="0" value="${cur ? String(cur).replace('.', ',') : ''}" autocomplete="off"><span class="cur">€</span></div>
      <p class="small muted" style="margin:-6px 0 0;text-align:center">Plafond mensuel${avg > 0 ? ` · vous dépensez en moyenne <strong>${fmt0(avg)}</strong>` : ''}</p>
      <p class="small" id="b-err" style="color:var(--expense);margin:0" hidden></p>
      <div class="form-actions">
        ${cur ? '<button type="button" class="btn btn-danger" id="b-del">Retirer le budget</button>' : ''}
        <div class="right"><button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </div>
    </form>`, (root) => {
    const input = $('#b-amount', root);
    setTimeout(() => input.focus(), 50);
    $('#budget-form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = parseAmount(input.value);
      if (!(v > 0)) { const er = $('#b-err', root); er.textContent = 'Saisissez un montant supérieur à 0.'; er.hidden = false; return; }
      closeModal();
      mutate(() => { state.budgets[id] = v; }, 'Budget enregistré');
    });
    $('#b-del', root)?.addEventListener('click', () => {
      closeModal();
      mutate(() => { delete state.budgets[id]; }, 'Budget retiré');
    });
  });
}

/* ---------- Prévisions ---------- */
function renderForecast() {
  const el = $('#view-forecast');
  if (!hasData()) {
    el.innerHTML = emptyState('Pas encore de prévisions', 'Les prévisions se basent sur vos opérations récurrentes (salaire, loyer…) et vos habitudes de dépenses. Ajoutez quelques opérations pour les voir apparaître.');
    return;
  }
  const fc = computeForecast(ui.reduction);
  const base = ui.reduction ? computeForecast(0) : fc;
  const today = todayStr();
  const cur = monthKey(today);
  const last = fc.months[fc.months.length - 1];
  const gain = round2(last.end - base.months[base.months.length - 1].end);
  const rules = state.recurring.filter((r) => !r.end || r.end >= cur);
  const rInc = rules.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const rExp = rules.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

  el.innerHTML = `
    <div class="grid grid-4">
      <div class="card kpi hero">
        <div class="kpi-label"><span class="kpi-icon"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/></svg></span>Solde dans ${FORECAST_HORIZON} mois</div>
        <div class="kpi-value num">${fmt(last.end)}</div>
        <div class="kpi-sub">Fin ${monthLong(last.mk)} · aujourd'hui ${fmt0(fc.balanceNow)}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Fin de ce mois</div>
        <div class="kpi-value num">${fmt(fc.months[0].end)}</div>
        <div class="kpi-sub">Solde estimé au ${pad(daysInMonth(cur))}/${cur.slice(5)}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Fixe mensuel</div>
        <div class="kpi-value num ${rInc - rExp < 0 ? 'expense-c' : ''}">${fmtSigned(rInc - rExp)}</div>
        <div class="kpi-sub"><span class="income-c">+${fmt0(rInc)}</span> · <span class="expense-c">−${fmt0(rExp)}</span> récurrents</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Variable mensuel</div>
        <div class="kpi-value num">−${fmt0(round2(fc.avgVarExp * (1 - ui.reduction)))}</div>
        <div class="kpi-sub">D'après ${fc.basis}${fc.avgVarInc ? ` · +${fmt0(fc.avgVarInc)} de revenus` : ''}</div>
      </div>
    </div>

    <div class="grid grid-3-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3>Évolution du solde</h3><span class="small muted">Réel et prévu</span></div>
        <div class="chart-box"><canvas id="ch-fc"></canvas></div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>Et si je dépensais moins ?</h3></div>
          <label class="field" style="gap:10px">
            <span style="display:flex;justify-content:space-between"><span>Réduire mes dépenses variables de</span><strong style="color:var(--accent)" id="red-val">${Math.round(ui.reduction * 100)} %</strong></span>
            <input type="range" id="red" min="0" max="50" step="5" value="${Math.round(ui.reduction * 100)}">
          </label>
          <p class="small" style="margin:12px 0 0">${ui.reduction
            ? `Vous économiseriez <strong class="income-c">${fmt0(round2(fc.avgVarExp * ui.reduction))}</strong> par mois, soit <strong class="income-c">+${fmt0(gain)}</strong> sur ${FORECAST_HORIZON} mois.`
            : '<span class="muted">Déplacez le curseur pour simuler l’effet d’une baisse de vos dépenses courantes (hors dépenses fixes).</span>'}</p>
        </div>
        <div class="card">
          <div class="card-head"><h3>À retenir</h3></div>
          <div class="stack" style="gap:10px">${insights(fc).join('')}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;overflow-x:auto">
      <div class="card-head"><h3>Mois par mois</h3></div>
      <table class="fc-table">
        <thead><tr><th>Mois</th><th>Revenus</th><th>Dépenses</th><th>Épargne</th><th>Solde fin de mois</th></tr></thead>
        <tbody>${fc.months.map((m) => `<tr>
          <td style="text-transform:capitalize">${monthLong(m.mk)}${m.current ? ' <span class="badge">En cours</span>' : ''}</td>
          <td class="num income-c">${fmt0(m.inc)}</td>
          <td class="num expense-c">${fmt0(m.exp)}</td>
          <td class="num">${fmtSigned(Math.round(m.net))}</td>
          <td class="num" style="font-weight:700;${m.end < 0 ? 'color:var(--expense)' : ''}">${fmt0(m.end)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="small muted" style="margin:14px 0 0">Méthode : opérations mensuelles récurrentes + opérations déjà planifiées + dépenses et revenus ponctuels estimés d'après ${fc.basis}. ${rules.length ? '' : '<strong>Astuce :</strong> marquez votre salaire et votre loyer comme « Répéter chaque mois » pour des prévisions bien plus fiables.'}</p>
    </div>`;

  // Graphique : 6 mois passés (fin de mois) + aujourd'hui + prévisions
  const pastMks = [5, 4, 3, 2, 1].map((i) => addMonths(cur, -i)).filter((m) => m >= addMonths(firstMonth(), -1));
  const labels = [...pastMks.map(monthShort), "Auj.", ...fc.months.map((m) => (m.current ? `Fin ${monthShort(m.mk)}` : monthShort(m.mk)))];
  const real = [...pastMks.map((m) => balanceAt(`${m}-${pad(daysInMonth(m))}`)), fc.balanceNow, ...fc.months.map(() => null)];
  const proj = [...pastMks.map(() => null), fc.balanceNow, ...fc.months.map((m) => m.end)];
  const accent = cssVar('--accent');
  const ctx = $('#ch-fc').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, softColor(accent.length === 7 ? accent : '#4f46e5', '40'));
  grad.addColorStop(1, softColor(accent.length === 7 ? accent : '#4f46e5', '00'));
  const opts = baseChartOptions({ legend: true });
  opts.spanGaps = false;
  charts.fc = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Solde réel', data: real, borderColor: accent, backgroundColor: grad, fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: accent, borderWidth: 2.5 },
        { label: 'Prévision', data: proj, borderColor: accent, borderDash: [6, 5], backgroundColor: 'transparent', tension: .35, pointRadius: 3, pointBackgroundColor: cssVar('--surface'), pointBorderColor: accent, borderWidth: 2 },
      ],
    },
    options: opts,
  });

  const red = $('#red');
  red.addEventListener('input', () => { $('#red-val').textContent = `${red.value} %`; });
  red.addEventListener('change', () => { ui.reduction = Number(red.value) / 100; render(); });
}

/* ---------- Réglages ---------- */
function renderSettings() {
  const el = $('#view-settings');
  const cur = monthKey(todayStr());
  const rules = [...state.recurring].sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === 'income' ? -1 : 1));
  const catRows = (type) => catsOf(type).map((c) => `
    <div class="cat-row" data-cat="${c.id}">
      <input type="text" class="emo-in" value="${esc(c.icon)}" data-f="icon" aria-label="Icône" maxlength="4">
      <input type="text" value="${esc(c.name)}" data-f="name" aria-label="Nom">
      <input type="color" value="${esc(c.color)}" data-f="color" aria-label="Couleur">
      ${Object.values(FALLBACK).includes(c.id) ? '<span class="icon-btn" title="Catégorie par défaut" style="cursor:default">🔒</span>'
        : `<button class="icon-btn" data-action="del-cat" data-id="${c.id}" aria-label="Supprimer"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>`}
    </div>`).join('');

  el.innerHTML = `
    <div class="grid grid-2" style="align-items:start">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>Général</h3></div>
          <div class="setting-row">
            <div><h4>Solde de départ</h4><p>Le montant sur votre compte avant votre première opération.</p></div>
            <div class="amount-input" style="width:170px"><input id="s-init" type="text" inputmode="decimal" style="font-size:16px;padding:9px 34px 9px 12px;text-align:right" value="${String(state.settings.initialBalance || 0).replace('.', ',')}"><span class="cur" style="font-size:15px;right:12px">€</span></div>
          </div>
          <div class="setting-row">
            <div><h4>Thème</h4><p>Clair, sombre ou selon votre système.</p></div>
            <div class="seg" id="s-theme">
              ${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<button data-v="${v}" class="${state.settings.theme === v ? 'active' : ''}">${l}</button>`).join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Opérations mensuelles</h3><span class="small muted">${rules.length} au total</span></div>
          ${rules.length ? `<div class="tx-list">${rules.map((r) => {
            const c = cat(r.categoryId);
            const ended = r.end && r.end < cur;
            return `<button class="tx" data-action="edit-rule" data-id="${r.id}"${ended ? ' style="opacity:.55"' : ''}>
              <span class="tx-icon" style="background:${softColor(c.color)}">${c.icon}</span>
              <span class="tx-main"><span class="tx-label">${esc(r.label || c.name)}</span>
              <span class="tx-meta">Le ${r.day} de chaque mois · ${ended ? `terminé en ${monthLong(r.end)}` : `depuis ${monthLong(r.start)}`}</span></span>
              <span class="tx-amount num ${r.type === 'income' ? 'income-c' : ''}">${r.type === 'income' ? '+' : '−'}${fmt(r.amount)}</span>
            </button>`;
          }).join('')}</div>` : '<p class="muted small" style="margin:0">Aucune. Cochez « Répéter chaque mois » en ajoutant une opération (salaire, loyer, abonnements…).</p>'}
        </div>

        <div class="card">
          <div class="card-head"><h3>Vos données</h3></div>
          <p class="small muted" style="margin:0 0 14px">Vos données restent <strong>uniquement dans ce navigateur</strong>, sur cet appareil. Exportez-les régulièrement pour en garder une sauvegarde.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn" data-action="export-json"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Sauvegarder (.json)</button>
            <button class="btn" data-action="import-json"><svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></svg>Restaurer</button>
            <button class="btn" data-action="export-csv"><svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></svg>Exporter pour Excel (.csv)</button>
          </div>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
            <button class="btn btn-sm" data-action="demo">Charger des données de démo</button>
            <button class="btn btn-sm btn-danger" data-action="reset">Tout effacer</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Catégories</h3></div>
        <p class="small muted" style="margin:0 0 6px;font-weight:600">DÉPENSES</p>
        ${catRows('expense')}
        <button class="btn btn-sm" data-action="add-cat" data-type="expense" style="margin:6px 0 20px">+ Catégorie de dépense</button>
        <p class="small muted" style="margin:0 0 6px;font-weight:600">REVENUS</p>
        ${catRows('income')}
        <button class="btn btn-sm" data-action="add-cat" data-type="income" style="margin-top:6px">+ Catégorie de revenu</button>
      </div>
    </div>`;

  $('#s-init').addEventListener('change', (e) => {
    const v = parseAmount(e.target.value || '0');
    if (Number.isNaN(v)) { toast('Montant invalide'); e.target.value = String(state.settings.initialBalance).replace('.', ','); return; }
    state.settings.initialBalance = v; save(); toast('Solde de départ enregistré');
  });
  $$('#s-theme button').forEach((b) => b.addEventListener('click', () => {
    state.settings.theme = b.dataset.v; save(); applyTheme(); render();
  }));
  $$('.cat-row input').forEach((inp) => inp.addEventListener('change', () => {
    const c = state.categories.find((x) => x.id === inp.closest('.cat-row').dataset.cat);
    const v = inp.value.trim();
    if (!v) { inp.value = c[inp.dataset.f]; return; }
    c[inp.dataset.f] = v; save();
  }));
}

/* =========================================================
   Formulaire d'opération
   ========================================================= */
function defaultDate() {
  const t = todayStr();
  return monthKey(t) === ui.month ? t : `${ui.month}-01`;
}

/** opts : {} nouvelle · { tx } opération saisie · { rule, month } opération mensuelle */
function openTxForm(opts = {}) {
  const rule = opts.rule || null;
  const tx = opts.tx || null;
  const src = rule || tx;
  const d = {
    type: src?.type || 'expense',
    categoryId: src?.categoryId || '',
  };
  const labels = [...new Set(state.transactions.map((t) => t.label).filter(Boolean))].slice(-200);
  const title = rule ? 'Opération mensuelle' : tx ? "Modifier l'opération" : 'Nouvelle opération';

  openModal(title, `
    <form class="form" id="tx-form" novalidate>
      ${rule ? `<div class="insight"><div class="insight-icon" style="background:var(--accent-soft)">🔁</div><p class="small">Cette opération revient <strong>chaque mois</strong>. Vos modifications s'appliquent à tous les mois, depuis ${monthLong(rule.start)}.</p></div>` : ''}
      <div class="type-toggle" id="f-type">
        <button type="button" data-type="expense">Dépense</button>
        <button type="button" data-type="income">Revenu</button>
      </div>
      <div class="amount-input">
        <input id="f-amount" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Montant" value="${src ? String(src.amount).replace('.', ',') : ''}">
        <span class="cur">€</span>
      </div>
      <label class="field">Libellé
        <input id="f-label" type="text" list="labels-dl" placeholder="Ex. Supermarché, Loyer, Salaire…" value="${esc(src?.label || '')}" autocomplete="off">
      </label>
      <datalist id="labels-dl">${labels.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
      <div class="field"><span>Catégorie</span><div class="cat-grid" id="f-cats"></div></div>
      ${rule
        ? `<label class="field">Jour du mois<input id="f-day" type="number" min="1" max="31" value="${rule.day}"></label>`
        : `<label class="field">Date<input id="f-date" type="date" value="${tx ? tx.date : defaultDate()}"></label>
           <label class="check"><input type="checkbox" id="f-repeat"> <span>Répéter chaque mois <span class="small muted">(salaire, loyer, abonnement…)</span></span></label>`}
      <p class="small" id="f-err" style="color:var(--expense);margin:0" hidden></p>
      <div class="form-actions">
        ${rule ? `<button type="button" class="btn btn-sm btn-danger" id="f-stop">${rule.end && rule.end < monthKey(todayStr()) ? 'Supprimer' : 'Arrêter'}</button>`
          : tx ? '<button type="button" class="btn btn-danger" id="f-del">Supprimer</button>' : ''}
        <div class="right">
          <button type="button" class="btn" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">${src ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </div>
    </form>`, (root) => {
    const amount = $('#f-amount', root);
    const err = $('#f-err', root);
    const setType = (type) => {
      d.type = type;
      $$('#f-type button', root).forEach((b) => b.classList.toggle('active', b.dataset.type === type));
      if (d.categoryId && cat(d.categoryId).type !== type) d.categoryId = '';
      $('#f-cats', root).innerHTML = catsOf(type).map((c) => `
        <button type="button" class="cat-opt ${c.id === d.categoryId ? 'active' : ''}" data-id="${c.id}">
          <span class="emo">${c.icon}</span><span>${esc(c.name)}</span>
        </button>`).join('');
    };
    setType(d.type);
    $('#f-type', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setType(b.dataset.type); });
    $('#f-cats', root).addEventListener('click', (e) => {
      const b = e.target.closest('.cat-opt'); if (!b) return;
      d.categoryId = b.dataset.id;
      $$('.cat-opt', root).forEach((x) => x.classList.toggle('active', x === b));
    });
    // Auto-catégorie à partir d'un libellé déjà utilisé
    $('#f-label', root).addEventListener('change', (e) => {
      const match = [...state.transactions].reverse().find((t) => t.label?.toLowerCase() === e.target.value.trim().toLowerCase());
      if (match && !d.categoryId) { if (match.type !== d.type) setType(match.type); d.categoryId = match.categoryId; setType(d.type); }
    });
    setTimeout(() => amount.focus(), 50);

    $('#tx-form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const value = parseAmount(amount.value);
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      if (!(value > 0)) return fail('Saisissez un montant supérieur à 0.');
      if (!d.categoryId) return fail('Choisissez une catégorie.');
      const label = $('#f-label', root).value.trim();
      const base = { type: d.type, amount: value, categoryId: d.categoryId, label };

      if (rule) {
        const day = Math.min(31, Math.max(1, parseInt($('#f-day', root).value, 10) || rule.day));
        closeModal();
        return mutate(() => Object.assign(state.recurring.find((r) => r.id === rule.id), base, { day }), 'Opération mensuelle modifiée');
      }
      const date = $('#f-date', root).value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Choisissez une date.');
      const repeat = $('#f-repeat', root).checked;
      closeModal();
      if (repeat) {
        mutate(() => {
          if (tx) state.transactions = state.transactions.filter((t) => t.id !== tx.id);
          state.recurring.push({ id: uid(), ...base, day: Number(date.slice(8)), start: monthKey(date), end: null });
        }, 'Opération mensuelle créée');
      } else if (tx) {
        mutate(() => Object.assign(state.transactions.find((t) => t.id === tx.id), base, { date }), 'Opération modifiée');
      } else {
        mutate(() => state.transactions.push({ id: uid(), ...base, date }), d.type === 'income' ? 'Revenu ajouté' : 'Dépense ajoutée');
      }
      if (monthKey(date) !== ui.month) { ui.month = monthKey(date); render(); }
    });

    $('#f-del', root)?.addEventListener('click', () => {
      closeModal();
      mutate(() => { state.transactions = state.transactions.filter((t) => t.id !== tx.id); }, 'Opération supprimée');
    });
    $('#f-stop', root)?.addEventListener('click', () => {
      const cur = monthKey(todayStr());
      const end = ruleDate(rule, cur) <= todayStr() ? cur : addMonths(cur, -1);
      const alreadyEnded = rule.end && rule.end < cur;
      if (alreadyEnded || end < rule.start) {
        if (!alreadyEnded || confirm("Supprimer cette opération mensuelle et tout son historique ?")) {
          closeModal();
          mutate(() => { state.recurring = state.recurring.filter((r) => r.id !== rule.id); }, 'Opération mensuelle supprimée');
        }
        return;
      }
      closeModal();
      mutate(() => { state.recurring.find((r) => r.id === rule.id).end = end; }, "Arrêtée : l'historique est conservé");
    });
  });
}

function openEdit(id) {
  if (id.startsWith('r:')) {
    const [, ruleId, mk] = id.split(':');
    const rule = state.recurring.find((r) => r.id === ruleId);
    if (rule) openTxForm({ rule, month: mk });
  } else {
    const tx = state.transactions.find((t) => t.id === id);
    if (tx) openTxForm({ tx });
  }
}

/* =========================================================
   Import / export / démo
   ========================================================= */
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJSON() {
  download(`pilotage-depenses-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Sauvegarde téléchargée');
}
function exportCSV() {
  const rows = [];
  const end = monthKey(todayStr());
  const last = state.transactions.reduce((m, t) => (monthKey(t.date) > m ? monthKey(t.date) : m), end);
  for (let mk = firstMonth(); mk <= last; mk = addMonths(mk, 1)) rows.push(...monthOps(mk).filter((o) => !o.recurring || o.date <= todayStr()));
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['Date;Type;Libellé;Catégorie;Montant;Mensuel'];
  for (const o of rows) {
    lines.push([o.date, o.type === 'income' ? 'Revenu' : 'Dépense', q(o.label), q(cat(o.categoryId).name), String(sign(o)).replace('.', ','), o.recurring ? 'oui' : 'non'].join(';'));
  }
  download(`operations-${todayStr()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('Export CSV téléchargé');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.transactions)) throw new Error('format');
      if (!confirm('Remplacer vos données actuelles par celles de ce fichier ?')) return;
      mutate(() => { state = normalize(data); }, 'Données restaurées');
      applyTheme();
    } catch {
      toast("❌ Ce fichier n'est pas une sauvegarde valide");
    }
  };
  reader.readAsText(file);
}

function loadDemo() {
  if (hasData() && !confirm('Remplacer vos données actuelles par des données de démonstration ?')) return;
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const between = (a, b) => round2(a + rand() * (b - a));
  const today = todayStr();
  const cur = monthKey(today);
  const start = addMonths(cur, -5);
  const s = defaultState();
  s.settings.theme = state.settings.theme;
  s.settings.initialBalance = 1800;
  const rule = (type, label, amount, categoryId, day) => s.recurring.push({ id: uid(), type, label, amount, categoryId, day, start, end: null });
  rule('income', 'Salaire', 2450, 'c-salaire', 1);
  rule('expense', 'Loyer', 820, 'c-logement', 5);
  rule('expense', 'Pass Navigo', 86.4, 'c-transport', 3);
  rule('expense', 'Électricité', 68, 'c-factures', 12);
  rule('expense', 'Box internet', 29.99, 'c-factures', 18);
  rule('expense', 'Forfait mobile', 12.99, 'c-abos', 9);
  rule('expense', 'Netflix', 13.49, 'c-abos', 15);
  rule('expense', 'Salle de sport', 34.9, 'c-sante', 2);

  const add = (date, type, label, amount, categoryId) => { if (date <= today) s.transactions.push({ id: uid(), type, label, amount, categoryId, date }); };
  for (let i = 0; i < 6; i++) {
    const mk = addMonths(start, i);
    const dim = daysInMonth(mk);
    const day = (n) => `${mk}-${pad(Math.min(n, dim))}`;
    for (const d of [2, 9, 16, 23, 29]) add(day(d), 'expense', rand() > .5 ? 'Carrefour' : 'Lidl', between(38, 105), 'c-courses');
    const nr = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < nr; k++) add(day(1 + Math.floor(rand() * dim)), 'expense', ['Pizzeria', 'Sushi', 'Café du coin', 'Brasserie'][Math.floor(rand() * 4)], between(12, 48), 'c-restau');
    add(day(6 + Math.floor(rand() * 20)), 'expense', ['Cinéma', 'Concert', 'Bowling'][Math.floor(rand() * 3)], between(12, 55), 'c-loisirs');
    if (rand() > .3) add(day(10 + Math.floor(rand() * 15)), 'expense', ['Zara', 'Fnac', 'Amazon', 'Decathlon'][Math.floor(rand() * 4)], between(25, 140), 'c-shopping');
    if (rand() > .55) add(day(4 + Math.floor(rand() * 20)), 'expense', 'Pharmacie', between(8, 35), 'c-sante');
    add(day(12 + Math.floor(rand() * 10)), 'expense', 'Essence', between(45, 70), 'c-transport');
    if (i % 2 === 1) add(day(20), 'income', 'Mission freelance', between(250, 600), 'c-freelance');
  }
  s.budgets = { 'c-courses': 380, 'c-restau': 140, 'c-loisirs': 80, 'c-shopping': 100, 'c-transport': 160 };
  state = s;
  save();
  ui.month = cur;
  render();
  toast('Données de démo chargées ✨');
}

/* =========================================================
   Événements globaux
   ========================================================= */
function setView(v) {
  ui.view = v;
  render();
  window.scrollTo({ top: 0 });
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav-item');
  if (nav) return setView(nav.dataset.view);
  const go = e.target.closest('[data-goto]');
  if (go) return setView(go.dataset.goto);
  if (e.target.closest('[data-close]')) return closeModal();
  if (e.target === $('#modal')) return closeModal();

  const a = e.target.closest('[data-action]');
  if (!a) return;
  const id = a.dataset.id;
  switch (a.dataset.action) {
    case 'add': openTxForm(); break;
    case 'edit': openEdit(id); break;
    case 'edit-rule': { const rule = state.recurring.find((r) => r.id === id); if (rule) openTxForm({ rule }); break; }
    case 'budget': openBudgetForm(id); break;
    case 'demo': loadDemo(); break;
    case 'export-json': exportJSON(); break;
    case 'export-csv': exportCSV(); break;
    case 'import-json': {
      const input = $('#import-file');
      input.onchange = () => { if (input.files[0]) importJSON(input.files[0]); input.value = ''; };
      input.click();
      break;
    }
    case 'reset':
      if (confirm('Effacer toutes vos opérations, budgets et catégories ? Pensez à faire une sauvegarde avant.')) {
        const theme = state.settings.theme;
        mutate(() => { state = defaultState(); state.settings.theme = theme; }, 'Toutes les données ont été effacées');
      }
      break;
    case 'add-cat': {
      const type = a.dataset.type;
      const palette = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#84cc16'];
      state.categories.push({ id: 'c-' + uid(), name: 'Nouvelle catégorie', icon: '🏷️', color: palette[state.categories.length % palette.length], type });
      save(); render();
      const input = $$('.cat-row input[data-f="name"]').filter((i) => i.value === 'Nouvelle catégorie').pop();
      input?.focus(); input?.select();
      break;
    }
    case 'del-cat': {
      const c = cat(id);
      const used = state.transactions.filter((t) => t.categoryId === id).length + state.recurring.filter((r) => r.categoryId === id).length;
      const fb = cat(FALLBACK[c.type]);
      if (used && !confirm(`${used} opération(s) utilisent « ${c.name} ». Elles seront déplacées vers « ${fb.name} ». Continuer ?`)) break;
      mutate(() => {
        state.transactions.forEach((t) => { if (t.categoryId === id) t.categoryId = fb.id; });
        state.recurring.forEach((r) => { if (r.categoryId === id) r.categoryId = fb.id; });
        delete state.budgets[id];
        state.categories = state.categories.filter((x) => x.id !== id);
      }, `Catégorie « ${c.name} » supprimée`);
      break;
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
  // Raccourci « n » : nouvelle opération
  if (e.key === 'n' && $('#modal').hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); openTxForm(); }
});

$('#add-btn').addEventListener('click', () => openTxForm());
$('#fab').addEventListener('click', () => openTxForm());
$('#prev-month').addEventListener('click', () => { ui.month = addMonths(ui.month, -1); render(); });
$('#next-month').addEventListener('click', () => { ui.month = addMonths(ui.month, 1); render(); });
$('#month-label').addEventListener('click', () => { ui.month = monthKey(todayStr()); render(); });
$('#theme-toggle').addEventListener('click', () => {
  state.settings.theme = isDark() ? 'light' : 'dark';
  save(); applyTheme(); render();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.theme === 'auto') render(); });

/* ---------- Démarrage ---------- */
if (window.Chart) {
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
} else {
  // Sans connexion au CDN, on remplace les graphiques par un message
  window.Chart = class { constructor(canvas) { canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Graphique indisponible hors connexion.' })); } destroy() {} };
}
applyTheme();
render();
