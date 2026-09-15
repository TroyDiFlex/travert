import { FinanceRepository } from './finance/repository.js';
import { seedDemoData } from './finance/local/seed.js';
import { localDatabaseName } from './finance/local/db.js';
import {
  createAccountCommand,
  createCategoryCommand,
  deleteAccountCommand,
  deleteCategoryCommand,
  deleteTransactionCommand,
  recordExpenseCommand,
  recordTransferCommand,
  updateAccountCommand,
  updateCategoryCommand,
  updateExpenseCommand,
  updateTransferCommand,
} from './finance/core/commands.js';
import { formatMoney, parseMoney } from './finance/core/money.js';
import { incomeChart, incomeSourceSeries, chartGeometry, lineRevealStarts } from './chart.js';
import { monthLabel, summarize, incomeInsights, validMonth, currentMonth } from './model.js';
import { categoryIconSvg, getCategoryIcon, searchCategoryIcons } from './finance/icons.js';
import { COLORS } from './model.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '&gt;': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;
const IDENTITY = Object.freeze({ backendId: 'local', uid: 'local-user', bookId: 'main', epoch: 'local-epoch' });
const ACCOUNT_KINDS = { cash: 'Наличные', bank: 'Карта', savings: 'Накопления' };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monthOf = (iso) => String(iso).slice(0, 7);
const prettyDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }); };

const repo = new FinanceRepository();
let accounts = [], categories = [], expenses = [], transfers = [];
let filters = { month: '', accountId: 'all', categoryId: 'all' };
let categoryColor = COLORS[0], categoryIcon = 'local:circle';
let removeTask = null, toastTimer = 0;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function fail(error) {
  return error?.field ? `${error.message}` : (error?.message || 'Не удалось сохранить.');
}
function closeDialog(dialog) { dialog.close(); }
document.querySelectorAll('.close-dialog').forEach((b) => b.addEventListener('click', () => closeDialog(b.closest('dialog'))));

async function refresh() {
  const [a, c, e, t, pending] = await Promise.all([
    repo.query({ type: 'accounts' }),
    repo.query({ type: 'categories' }),
    repo.query({ type: 'expenses' }),
    repo.query({ type: 'transfers' }),
    repo.query({ type: 'pending-count' }),
  ]);
  accounts = a; categories = c; expenses = e; transfers = t;
  $('sync-status').textContent = pending
    ? `Локально · не отправлено: ${pending} (сервер не подключён)`
    : 'Локально · всё сохранено в браузере';
  renderAccounts();
  renderCategories();
  renderFilters();
  renderExpenses();
  renderExpCategoryFilter();
  renderExpOverview();
}

function accountById(id) { return accounts.find((a) => a.id === id); }
function categoryById(id) { return categories.find((c) => c.id === id); }

function renderAccounts() {
  const box = $('accounts-list');
  if (!accounts.length) {
    box.innerHTML = `<div class="expenses-empty">Счетов пока нет.<br><button class="button subtle" type="button" data-empty-account>Создать первый счёт</button></div>`;
    box.querySelector('[data-empty-account]').addEventListener('click', () => openAccount());
    return;
  }
  box.innerHTML = accounts.map((a) => {
    const usage = expenses.filter((e) => e.accountId === a.id);
    const moves = transfers.filter((t) => t.fromAccountId === a.id || t.toAccountId === a.id);
    return `<div class="account-row"><i class="source-dot" style="background:var(--accent)"></i>`
      + `<div class="account-info"><b>${esc(a.name)}</b><small>${esc(ACCOUNT_KINDS[a.kind] || a.kind)} · ${esc(a.currency)} · расходов: ${usage.length} · переводов: ${moves.length}</small></div>`
      + `<div class="row-actions"><button class="icon-button" type="button" data-edit-account="${esc(a.id)}" aria-label="Изменить счёт">${ico('dots')}</button>`
      + `<button class="icon-button" type="button" data-del-account="${esc(a.id)}" aria-label="Удалить счёт">${ico('trash')}</button></div></div>`;
  }).join('');
  box.querySelectorAll('[data-edit-account]').forEach((b) => b.addEventListener('click', () => openAccount(b.dataset.editAccount)));
  box.querySelectorAll('[data-del-account]').forEach((b) => b.addEventListener('click', () => askRemoveAccount(b.dataset.delAccount)));
}

function renderCategories() {
  const box = $('categories-list');
  if (!categories.length) {
    box.innerHTML = `<div class="expenses-empty">Категорий пока нет.<br><button class="button subtle" type="button" data-empty-category>Создать первую категорию</button></div>`;
    box.querySelector('[data-empty-category]').addEventListener('click', () => openCategory());
    return;
  }
  box.innerHTML = `<div class="category-grid">` + categories.map((c) => {
    const usage = expenses.filter((e) => e.categoryId === c.id).length;
    return `<span class="category-chip"><span class="cat-icon" style="background:${esc(c.color)}">${categoryIconSvg(c.iconId)}</span>`
      + `<span>${esc(c.name)}${c.system ? ' · система' : ''} · ${usage}</span>`
      + (c.system ? '' : `<button class="icon-button" type="button" data-edit-category="${esc(c.id)}" aria-label="Изменить">${ico('dots')}</button>`
        + `<button class="icon-button" type="button" data-del-category="${esc(c.id)}" aria-label="Удалить">${ico('trash')}</button>`)
      + `</span>`;
  }).join('') + `</div>`;
  box.querySelectorAll('[data-edit-category]').forEach((b) => b.addEventListener('click', () => openCategory(b.dataset.editCategory)));
  box.querySelectorAll('[data-del-category]').forEach((b) => b.addEventListener('click', () => askRemoveCategory(b.dataset.delCategory)));
}

function renderFilters() {
  const fa = $('filter-account'), fc = $('filter-category');
  const keepA = filters.accountId, keepC = filters.categoryId;
  fa.innerHTML = `<option value="all">Все счета</option>` + accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.currency)}</option>`).join('');
  fc.innerHTML = `<option value="all">Все категории</option>` + categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  fa.value = [...fa.options].some((o) => o.value === keepA) ? keepA : 'all';
  fc.value = [...fc.options].some((o) => o.value === keepC) ? keepC : 'all';
  filters.accountId = fa.value; filters.categoryId = fc.value;
}

function filteredExpenses() {
  return expenses
    .filter((e) => !filters.month || e.month === filters.month)
    .filter((e) => filters.accountId === 'all' || e.accountId === filters.accountId)
    .filter((e) => filters.categoryId === 'all' || e.categoryId === filters.categoryId);
}

// --- Обзор расходов ---
// Категории маппятся на источники общей модели графиков, но показатели и подписи
// остаются специфичными для расходов.
let expCurrency = 'RUB';
let expPeriod = 'all';
let expSelectedYear = currentMonth().slice(0, 4);
let expCustomFrom = '';
let expCustomTo = '';
let expChartType = 'line';
let expComparison = 'average';
let expCategoryFilter = ['all'];
let expChart = null;
let expChartSelection = -1;
let expTab = 'list';
try {
  const savedTab = localStorage.getItem('travert-exp-tab');
  if (['list', 'accounts', 'categories'].includes(savedTab)) expTab = savedTab;
} catch {}
try {
  const saved = localStorage.getItem('travert-exp-comparison');
  if (['total', 'average'].includes(saved)) expComparison = saved;
} catch {}
try {
  const saved = JSON.parse(localStorage.getItem('travert-exp-category-filter'));
  if (Array.isArray(saved) && saved.every((id) => typeof id === 'string')) expCategoryFilter = [...new Set(saved)];
} catch {}

function expenseCurrencies() {
  return [...new Set(expenses.map((e) => e.currency))].sort();
}
function expenseChartData(currency) {
  const sources = [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, active: c.active !== false, order: c.sortOrder }));
  const entries = expenses
    .filter((e) => e.currency === currency)
    .map((e) => ({ sourceId: e.categoryId, month: e.month, amount: e.amountMinor }));
  return { sources, entries };
}
function expPeriodBounds() {
  if (expPeriod === 'year') return [`${expSelectedYear}-01`, `${expSelectedYear}-12`];
  if (expPeriod === 'custom') return [expCustomFrom, expCustomTo];
  return ['', ''];
}
function expYears(allMonths) {
  const set = new Set([currentMonth().slice(0, 4), expSelectedYear]);
  for (const m of allMonths) set.add(m.slice(0, 4));
  return [...set].filter((y) => /^\d{4}$/.test(y)).sort();
}
const EXP_SYMBOLS = { RUB: '₽', USD: '$', EUR: '€' };
const expMoney = (minor) => {
  try { return formatMoney(minor, expCurrency); }
  catch { return `${(minor / 100).toLocaleString('ru-RU')} ${expCurrency}`; }
};

function expCategoryLabel() {
  if (!expCategoryFilter.length) return 'Категории не выбраны';
  if (expCategoryFilter.length === 1) {
    if (expCategoryFilter[0] === 'all') return 'Общий расход';
    return categories.find((c) => c.id === expCategoryFilter[0])?.name || 'Общий расход';
  }
  return expCategoryFilter.includes('all')
    ? `Общий расход + ${expCategoryFilter.length - 1}`
    : `Выбрано категорий: ${expCategoryFilter.length}`;
}

function renderExpCategoryFilter() {
  const panel = $('exp-source-filter-options');
  if (!panel) return;
  const valid = new Set(['all', ...categories.map((c) => c.id)]);
  expCategoryFilter = expCategoryFilter.filter((id) => valid.has(id));
  if (!expCategoryFilter.length) expCategoryFilter = ['all'];
  const choices = [
    { id: 'all', name: 'Общий расход', color: 'var(--accent)', active: true },
    ...[...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru')),
  ];
  panel.innerHTML = choices.map((c) => `<label class="source-filter-option" style="--source-color:${esc(c.color)}"><input type="checkbox" data-exp-filter-category value="${esc(c.id)}"><span class="source-checkbox" aria-hidden="true"></span><span class="source-option-name">${esc(c.name)}${c.active ? '' : '<small>Неактивная</small>'}</span><i class="source-dot" style="background:${esc(c.color)}" aria-hidden="true"></i></label>`).join('');
  updateExpCategoryFilter();
}

function updateExpCategoryFilter() {
  if (!$('exp-source-filter-label')) return;
  $('exp-source-filter-label').textContent = expCategoryLabel();
  $('exp-source-filter-trigger').setAttribute('aria-label', `Категории расходов: ${expCategoryLabel()}`);
  document.querySelectorAll('[data-exp-filter-category]').forEach((input) => { input.checked = expCategoryFilter.includes(input.value); });
  const all = $('exp-source-toggle-all');
  if (all) {
    const complete = expCategoryFilter.length === categories.length + 1;
    all.checked = complete;
    all.indeterminate = expCategoryFilter.length > 0 && !complete;
  }
}

function renderExpPeriod(allMonths) {
  document.querySelectorAll('[data-exp-period]').forEach((b) => {
    const selected = b.dataset.expPeriod === expPeriod;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  let html = '';
  if (expPeriod === 'year') {
    const years = expYears(allMonths);
    if (!years.includes(expSelectedYear)) expSelectedYear = years.at(-1) || currentMonth().slice(0, 4);
    html = `<label class="sr-only" for="exp-filter-year">Год</label><select id="exp-filter-year">${years.map((y) => `<option value="${y}" ${y === expSelectedYear ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
  }
  if (expPeriod === 'custom') {
    html = `<label class="sr-only" for="exp-filter-from">Начало периода</label><input type="month" id="exp-filter-from" value="${esc(expCustomFrom)}"><span class="muted">—</span><label class="sr-only" for="exp-filter-to">Конец периода</label><input type="month" id="exp-filter-to" value="${esc(expCustomTo)}">`;
  }
  $('exp-period-controls').innerHTML = html;
  $('exp-filter-year')?.addEventListener('change', (e) => { expSelectedYear = e.target.value; renderExpOverview(); });
  for (const id of ['exp-filter-from', 'exp-filter-to']) {
    $(id)?.addEventListener('change', () => {
      const from = $('exp-filter-from').value, to = $('exp-filter-to').value;
      if (!validMonth(from) || !validMonth(to) || from > to) { toast('Начало периода должно быть раньше конца.'); return; }
      expCustomFrom = from; expCustomTo = to; renderExpOverview();
    });
  }
}

function renderExpOverview(chartOptions) {
  if (!$('expenses-overview-view')) return;
  const currencies = expenseCurrencies();
  if (!currencies.includes(expCurrency)) expCurrency = currencies[0] || 'RUB';
  const currencyBox = $('exp-overview-currency');
  if (currencyBox) {
    currencyBox.innerHTML = currencies.map((c) => `<button type="button" class="${c === expCurrency ? 'selected' : ''}" data-exp-overview-currency="${c}" aria-pressed="${c === expCurrency}">${c}</button>`).join('')
      || '<span class="muted">Нет данных</span>';
  }
  if ($('exp-overview-chart-unit')) $('exp-overview-chart-unit').textContent = `${EXP_SYMBOLS[expCurrency] || expCurrency} / месяц`;
  document.querySelectorAll('#exp-overview-comparison-mode [data-exp-overview-comparison]').forEach((b) => {
    const selected = b.dataset.expOverviewComparison === expComparison;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  if ($('exp-overview-comparison-kicker')) $('exp-overview-comparison-kicker').textContent = expComparison === 'average' ? 'РАСХОД ЗА МЕСЯЦ С ЗАПИСЬЮ' : 'ВКЛАД В ОБЩИЙ РАСХОД';

  const data = expenseChartData(expCurrency);
  const [from, to] = expPeriodBounds();
  const allMonths = [...new Set(data.entries.map((e) => e.month))].sort();
  if (!expCustomFrom && allMonths.length) { expCustomFrom = allMonths[0]; expCustomTo = allMonths.at(-1); }
  if (!allMonths.length && !expCustomFrom) { expCustomFrom = currentMonth(); expCustomTo = currentMonth(); }
  renderExpPeriod(allMonths);
  updateExpCategoryFilter();

  const withNames = (model) => {
    for (const s of [...model.lines, ...model.bars]) {
      s.name = s.name.replace('Общий доход', 'Общий расход').replace('источников', 'категорий').replace('источники', 'категории').replace('Остальные источники', 'Остальные категории');
    }
    return model;
  };
  const model = withNames(incomeChart(data, from, to, expCategoryFilter));
  const s = model.summary;
  const insights = incomeInsights(data, from, to, expCategoryFilter);

  if ($('exp-hero-total')) {
    $('exp-hero-total').innerHTML = expCategoryFilter.length && s.observed.length
      ? `${esc(expMoney(s.total)).replace(/[₽$€]/, '<span class="currency">$&</span>')}`
      : '—';
  }
  if ($('exp-hero-caption')) {
    $('exp-hero-caption').textContent = s.observed.length
      ? `${s.observed.length} мес. с записями · ${expCategoryLabel()}`
      : 'Добавьте первый расход';
  }

  const percent = (value) => (value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`);
  const compared = (item) => (item.amount === null ? `${monthLabel(item.month, true)} · нет записи` : `${monthLabel(item.month, true)} · ${expMoney(item.amount)}`);
  const topCategory = s.sources[0] || null;
  const topCategoryShare = topCategory && s.total ? 100 * topCategory.total / s.total : 0;
  const metrics = [
    ['Последний месяц', insights.latest ? expMoney(insights.latest.total) : '—', insights.latest ? monthLabel(insights.latest.month) : 'Нет записей', 'wallet'],
    ['К прошлому месяцу', percent(insights.previous.change), compared(insights.previous), 'arrow'],
    ['Год к году', percent(insights.yearAgo.change), compared(insights.yearAgo), 'arrow'],
    ['Среднее в месяц', s.observed.length ? expMoney(s.average) : '—', s.observed.length ? `${s.observed.length} мес. с расходами` : 'Нет записей', 'chart'],
    ['Пиковый месяц', s.best ? expMoney(s.best.total) : '—', s.best ? monthLabel(s.best.month) : 'Нет записей', 'arrow'],
    ['Главная категория', topCategory?.name || '—', topCategory ? `${topCategoryShare.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% · ${expMoney(topCategory.total)}` : 'Нет записей', 'check', true],
  ];
  if ($('exp-overview-metrics')) {
    $('exp-overview-metrics').innerHTML = metrics.map((m) => `<article class="metric"><div class="metric-label">${esc(m[0])}${ico(m[3])}</div><div class="metric-value${m[4] ? ' name' : ''}">${esc(m[1])}</div><div class="metric-foot">${esc(m[2])}</div></article>`).join('');
  }
  renderExpDonut(s);
  renderExpComparison(s);
  renderExpChart(data, model, chartOptions);
  if ($('exp-overview-updated')) $('exp-overview-updated').textContent = `Обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderExpDonut(s) {
  const value = (x) => (expComparison === 'average' ? x.average : x.total);
  // Preserve one category order between modes. Only arc sizes should animate;
  // reordering circles makes every segment rotate through its neighbours.
  const sources = s.sources;
  const total = sources.reduce((sum, x) => sum + value(x), 0);
  const donut = $('exp-overview-donut');
  if (!donut) return;
  $('exp-overview-share-count').textContent = `${sources.length} кат.`;
  if (!donut.querySelector('svg')) donut.innerHTML = '<svg viewBox="0 0 160 160" role="img"><circle cx="80" cy="80" r="63" stroke="var(--grid)"/></svg><div class="donut-center"><strong></strong><span></span></div>';
  const svg = donut.querySelector('svg');
  svg.setAttribute('aria-label', `Доли категорий расходов — ${expComparison === 'average' ? 'средний расход' : 'общий расход'}`);
  donut.querySelector('strong').textContent = total ? '100%' : '—';
  donut.querySelector('span').textContent = total ? (expComparison === 'average' ? 'средний расход' : 'общий расход') : 'нет расходов';
  const circles = new Map([...svg.querySelectorAll('[data-source]')].map((circle) => [circle.dataset.source, circle]));
  const circumference = 2 * Math.PI * 63;
  let offset = 0;
  for (const source of sources) {
    let circle = circles.get(source.id);
    if (!circle) {
      circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.dataset.source = source.id;
      circle.setAttribute('class', 'donut-segment');
      for (const [name, val] of Object.entries({ cx: 80, cy: 80, r: 63 })) circle.setAttribute(name, val);
      svg.append(circle);
    }
    const fraction = total ? value(source) / total : 0, dash = Math.max(0, circumference * fraction - 3);
    circle.setAttribute('stroke', source.color);
    circle.style.strokeDasharray = `${dash} ${circumference - dash}`;
    circle.style.strokeDashoffset = String(-offset);
    offset += circumference * fraction;
    circles.delete(source.id);
  }
  circles.forEach((circle) => circle.remove());
  $('exp-overview-share-legend').innerHTML = sources.length
    ? sources.map((x) => `<div class="share-item"><i class="source-dot" style="background:${x.color}"></i><span class="label" title="${esc(x.name)}">${esc(x.name)}</span><strong>${total ? (100 * value(x) / total).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '0'}%</strong></div>`).join('')
    : '<p class="muted help">В этом периоде пока нет расходов.</p>';
  scheduleExpShareLayout();
}

let expShareLayoutFrame = 0;
function scheduleExpShareLayout() {
  cancelAnimationFrame(expShareLayoutFrame);
  expShareLayoutFrame = requestAnimationFrame(updateExpShareLayout);
}
function updateExpShareLayout() {
  const legend = $('exp-overview-share-legend');
  if (!legend) return;
  const card = $('exp-overview-share-card') || legend.closest('.share-card');
  const body = legend.parentElement;
  if (!card || !card.getClientRects().length) return;
  const comparison = $('exp-overview-comparison-card') || document.querySelector('#expenses-overview-view .comparison-card');
  const style = getComputedStyle(card), bodyStyle = getComputedStyle(body);
  const width = body.clientWidth, compact = parseFloat(style.getPropertyValue('--donut-compact-size')) || 154;
  const beside = comparison ? Math.abs(card.getBoundingClientRect().top - comparison.getBoundingClientRect().top) < 2 : false;
  const probe = legend.cloneNode(true);
  probe.removeAttribute('id'); probe.className = 'share-legend share-measure'; probe.setAttribute('aria-hidden', 'true');
  probe.style.width = `${width}px`; card.append(probe);
  const legendHeight = probe.getBoundingClientRect().height; probe.remove();
  const available = beside && comparison
    ? comparison.getBoundingClientRect().height
      - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
      - card.querySelector('.section-heading').getBoundingClientRect().height - parseFloat(bodyStyle.paddingTop)
    : 0;
  const roomForRing = available - legendHeight - 20;
  const narrow = width < compact + parseFloat(style.getPropertyValue('--share-row-gap') || 25) + 150;
  const stacked = narrow || (legend.children.length > 0 && roomForRing >= Math.min(210, width));
  const size = stacked ? Math.floor(Math.min(320, width, Math.max(compact, beside ? roomForRing : compact))) : compact;
  card.dataset.shareLayout = stacked ? 'stacked' : 'row';
  card.style.setProperty('--donut-size', `${size}px`);
}

function renderExpComparison(s) {
  const value = (x) => (expComparison === 'average' ? x.average : x.total);
  const sources = [...s.sources].sort((a, b) => value(b) - value(a) || b.total - a.total);
  const total = sources.reduce((sum, x) => sum + value(x), 0);
  const maximum = sources.length ? value(sources[0]) : 0;
  const box = $('exp-overview-comparison');
  if (!box) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows = new Map([...box.querySelectorAll('.comparison-item')].map((row) => [row.dataset.source, row]));
  const positions = new Map([...rows].map(([id, row]) => {
    const fill = row.querySelector('.bar-fill'), trackWidth = fill.parentElement.getBoundingClientRect().width;
    return [id, { top: row.getBoundingClientRect().top, width: trackWidth ? (fill.getBoundingClientRect().width / trackWidth) * 100 : 0 }];
  }));
  rows.forEach((row) => row.getAnimations({ subtree: true }).forEach((a) => a.cancel()));
  if (!sources.length) {
    box.innerHTML = '<div class="empty-state"><h3>Пока нечего сравнивать</h3>Выберите другой период или добавьте расход.</div>';
    return;
  }
  box.querySelector('.empty-state')?.remove();
  const ordered = sources.map((x) => {
    let row = rows.get(x.id);
    if (!row) {
      row = document.createElement('div'); row.className = 'comparison-item'; row.dataset.source = x.id;
      row.innerHTML = '<div class="comparison-heading"><i class="source-dot"></i><span></span><strong></strong></div><div class="bar-track"><div class="bar-fill"></div></div><div class="comparison-meta"><span></span><span></span></div>';
    }
    const category = categoryById(x.id);
    const name = row.querySelector('.comparison-heading span'), fill = row.querySelector('.bar-fill'), meta = row.querySelector('.comparison-meta');
    name.textContent = x.name; name.title = x.name;
    row.querySelector('.source-dot').style.background = x.color;
    row.querySelector('strong').textContent = expMoney(value(x));
    fill.style.width = `${maximum ? (value(x) / maximum) * 100 : 0}%`; fill.style.background = x.color;
    meta.firstElementChild.textContent = `${category?.active === false ? 'Неактивная' : 'Категория'} · ${x.count} мес. с записями`;
    meta.lastElementChild.hidden = false;
    meta.lastElementChild.textContent = `${total ? (100 * value(x) / total).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '0'}%`;
    rows.delete(x.id);
    return row;
  });
  rows.forEach((row) => row.remove());
  ordered.forEach((row, index) => { if (box.children[index] !== row) box.insertBefore(row, box.children[index] || null); });
  if (!reduceMotion) {
    const motion = { duration: 550, easing: 'cubic-bezier(.22,1,.36,1)' };
    const moves = ordered.map((row) => ({ row, previous: positions.get(row.dataset.source), top: row.getBoundingClientRect().top }));
    moves.forEach(({ row, previous, top }) => {
      if (!previous) return;
      const off = previous.top - top, fill = row.querySelector('.bar-fill');
      if (Math.abs(off) > 0.5) row.animate([{ transform: `translateY(${off}px)` }, { transform: 'translateY(0)' }], motion);
      if (Math.abs(previous.width - parseFloat(fill.style.width)) > 0.01) fill.animate([{ width: `${previous.width}%` }, { width: fill.style.width }], motion);
    });
  }
}

function renderExpChart(data, model, { animate = true, newSourcesOnly = false } = {}) {
  const s = model.summary, container = $('exp-overview-chart');
  if (!container) return;
  const legend = expChartType === 'bars' ? model.bars : model.lines;
  $('exp-overview-chart-legend').innerHTML = legend.map((series) => `<span class="chart-legend-item"><i class="legend-line" style="background:${series.color}"></i><span>${esc(series.name)}</span></span>`).join('');
  container.setAttribute('aria-label', `Расходы по месяцам. ${expCategoryLabel()}. Стрелки влево и вправо — просмотр месяцев.`);
  if (!s.observed.length) {
    container.innerHTML = expCategoryFilter.length
      ? '<div class="empty-state"><h3>Здесь появится ваш график</h3>Добавьте расход или выберите другой период.</div>'
      : '<div class="empty-state"><h3>Выберите категории</h3>Отметьте их в списке над графиком.</div>';
    $('exp-overview-chart-range').textContent = expCategoryFilter.length ? 'Нет записей' : '';
    $('exp-overview-data-table').replaceChildren();
    expChart = null;
    return;
  }
  const [from, to] = expPeriodBounds();
  const now = performance.now(), previous = newSourcesOnly && expChart?.type === expChartType ? expChart : null;
  const lineReveals = animate && expChartType !== 'bars' ? lineRevealStarts(model, previous, now) : new Map();
  const geometry = chartGeometry(model, expChartType, container.clientWidth, container.clientHeight, { animate, lineReveals, now, idPrefix: 'expense-' });
  const tooltipRows = expCategoryFilter.length === 1 && expCategoryFilter[0] === 'all'
    ? incomeSourceSeries(data, from, to)
    : expChartType === 'bars' ? model.bars : model.lines.filter((ser) => ser.id !== 'all');
  container.innerHTML = `${geometry.svg}<div id="exp-overview-tooltip" class="tooltip" hidden></div>`;
  expChart = { ...geometry, s, model, type: expChartType, lineReveals, tooltipRows };
  expChartSelection = -1;
  $('exp-overview-chart-range').textContent = `${monthLabel(s.months[0].month, true)} — ${monthLabel(s.months.at(-1).month, true)}`;
  const series = model.lines.length ? model.lines : [{ id: 'all', name: 'Общий расход', months: s.months }];
  $('exp-overview-data-table').innerHTML = `<table><caption>Расходы по месяцам за выбранный период</caption><thead><tr><th scope="col">Месяц</th>${series.map((item) => `<th scope="col">${esc(item.name)}</th>`).join('')}</tr></thead><tbody>${s.months.map((month, index) => `<tr><th scope="row">${monthLabel(month.month)}</th>${series.map((item) => { const point = item.months[index]; return `<td>${point.count ? esc(expMoney(point.total)) : 'Нет записи'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}

function hideExpTooltip() {
  if ($('exp-overview-tooltip')) $('exp-overview-tooltip').hidden = true;
  $('exp-overview-chart')?.querySelector('#crosshair')?.setAttribute('opacity', '0');
  $('exp-overview-chart')?.querySelectorAll('.hover-dot').forEach((dot) => dot.setAttribute('opacity', '0'));
}
function expOverviewTooltip(index) {
  if (!expChart) return;
  const { s, x, y, width, hoverSeries, tooltipRows } = expChart;
  index = Math.max(0, Math.min(s.months.length - 1, index));
  const m = s.months[index], tip = $('exp-overview-tooltip');
  if (index === expChartSelection && !tip.hidden) return;
  expChartSelection = index;
  tip.style.transition = tip.hidden ? 'none' : '';
  tip.innerHTML = `<small>${monthLabel(m.month)} · ${expCategoryFilter.includes('all') ? 'Общий расход' : 'Выбранные категории'}</small><b>${m.count ? esc(expMoney(m.total)) : 'Нет записей'}</b>` + tooltipRows.map((series) => {
    const point = series.months[index];
    let amount = 'Нет записи';
    try { amount = point.count ? esc(formatMoney(point.total, expCurrency)) : amount; } catch { amount = point.count ? esc(expMoney(point.total)) : amount; }
    return `<div class="tooltip-row"><span title="${esc(series.name)}"><i class="source-dot" style="background:${series.color}"></i>${esc(series.name)}</span><span>${amount}</span></div>`;
  }).join('');
  tip.hidden = false;
  const highest = hoverSeries.reduce((max, series) => Math.max(max, series.months[index].total), 0);
  const chart = $('exp-overview-chart'), gap = 16, pointX = (x(index) * chart.clientWidth) / width;
  const tipWidth = tip.offsetWidth, tipHeight = tip.offsetHeight;
  const beside = pointX - tipWidth - gap >= 0 ? pointX - tipWidth - gap : pointX + gap;
  tip.style.transform = `translate3d(${Math.max(0, Math.min(chart.clientWidth - tipWidth, beside))}px,${Math.max(0, Math.min(chart.clientHeight - tipHeight - 20, y(highest) - tipHeight - 15))}px,0)`;
  const cross = chart.querySelector('#crosshair');
  if (cross) { cross.setAttribute('x1', x(index)); cross.setAttribute('x2', x(index)); cross.setAttribute('opacity', '.5'); }
  hoverSeries.forEach((series, i) => {
    const point = series.months[index], dot = chart.querySelector(`#hover-dot-${i}`);
    if (!dot) return;
    dot.setAttribute('cx', x(index)); dot.setAttribute('cy', y(point.total)); dot.setAttribute('opacity', point.count ? '1' : '0');
  });
}

function filteredTransfers() {
  // У переводов нет категории: при фильтре по категории они скрываются.
  if (filters.categoryId !== 'all') return [];
  return transfers
    .filter((t) => !filters.month || t.month === filters.month)
    .filter((t) => filters.accountId === 'all' || t.fromAccountId === filters.accountId || t.toAccountId === filters.accountId);
}

function transferTitle(t) {
  const from = accountById(t.fromAccountId), to = accountById(t.toAccountId);
  return `${from?.name || 'Удалённый счёт'} → ${to?.name || 'Удалённый счёт'}`;
}

function renderExpenses() {
  const list = filteredExpenses();
  const moves = filteredTransfers();
  const totals = {};
  for (const e of list) totals[e.currency] = (totals[e.currency] ?? 0) + e.amountMinor;
  $('expenses-summary').innerHTML = (list.length || moves.length)
    ? Object.entries(totals).map(([cur, sum]) => `<span>${esc(cur)}: <strong>${esc(formatMoney(sum, cur))}</strong></span>`).join('')
      + `<span class="muted">${list.length} расх. · ${moves.length} перев.</span>`
    : `<span class="muted">Ничего не найдено.</span>`;
  const box = $('expenses-list');
  if (!list.length && !moves.length) {
    const empty = !expenses.length && !transfers.length;
    box.innerHTML = `<div class="expenses-empty">${empty ? 'Операций пока нет. Добавьте первую — кнопки выше.' : 'Под фильтры ничего не попало.'}${empty && accounts.length && categories.length ? `<br><button class="button subtle" type="button" data-empty-expense>Добавить расход</button>` : ''}</div>`;
    box.querySelector('[data-empty-expense]')?.addEventListener('click', () => openExpense());
    return;
  }
  const rows = [
    ...list.map((e) => ({ kind: 'expense', date: e.date, createdAt: e.createdAt, id: e.id, item: e })),
    ...moves.map((t) => ({ kind: 'transfer', date: t.date, createdAt: t.createdAt, id: t.id, item: t })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  box.innerHTML = rows.map((row) => {
    if (row.kind === 'transfer') {
      const t = row.item;
      return `<div class="expense-row"><span class="cat-icon category-chip" style="padding:0;border:0;background:none"><span class="cat-icon" style="background:var(--accent)">⇄</span></span>`
        + `<div class="expense-info"><b>Перевод · ${esc(transferTitle(t))}</b><small>${esc(prettyDate(t.date))}${t.note ? ' · ' + esc(t.note) : ''}${t.fromAmountMinor !== t.toAmountMinor ? ` · разница ${esc(formatMoney(t.fromAmountMinor - t.toAmountMinor, t.currency))}` : ''}</small></div>`
        + `<span class="expense-amount">−${esc(formatMoney(t.fromAmountMinor, t.currency))} / +${esc(formatMoney(t.toAmountMinor, t.currency))}</span>`
        + `<div class="row-actions"><button class="icon-button" type="button" data-edit-transfer="${esc(t.id)}" aria-label="Изменить">${ico('dots')}</button>`
        + `<button class="icon-button" type="button" data-del-transfer="${esc(t.id)}" aria-label="Удалить">${ico('trash')}</button></div></div>`;
    }
    const e = row.item;
    const a = accountById(e.accountId), c = categoryById(e.categoryId);
    return `<div class="expense-row"><span class="cat-icon category-chip" style="padding:0;border:0;background:none"><span class="cat-icon" style="background:${esc(c?.color || '#666')}">${categoryIconSvg(c?.iconId || 'local:circle')}</span></span>`
      + `<div class="expense-info"><b>${esc(c?.name || 'Удалённая категория')}</b><small>${esc(prettyDate(e.date))} · ${esc(a?.name || 'Удалённый счёт')}${e.note ? ' · ' + esc(e.note) : ''}</small></div>`
      + `<span class="expense-amount">${esc(formatMoney(e.amountMinor, e.currency))}</span>`
      + `<div class="row-actions"><button class="icon-button" type="button" data-edit-expense="${esc(e.id)}" aria-label="Изменить">${ico('dots')}</button>`
      + `<button class="icon-button" type="button" data-del-expense="${esc(e.id)}" aria-label="Удалить">${ico('trash')}</button></div></div>`;
  }).join('');
  box.querySelectorAll('[data-edit-expense]').forEach((b) => b.addEventListener('click', () => openExpense(b.dataset.editExpense)));
  box.querySelectorAll('[data-del-expense]').forEach((b) => b.addEventListener('click', () => askRemoveExpense(b.dataset.delExpense)));
  box.querySelectorAll('[data-edit-transfer]').forEach((b) => b.addEventListener('click', () => openTransfer(b.dataset.editTransfer)));
  box.querySelectorAll('[data-del-transfer]').forEach((b) => b.addEventListener('click', () => askRemoveTransfer(b.dataset.delTransfer)));
}

// --- Счета ---
function openAccount(id) {
  const a = id ? accountById(id) : null;
  $('account-title').textContent = a ? 'Настроить счёт' : 'Новый счёт';
  $('account-id').value = a?.id || '';
  $('account-name').value = a?.name || '';
  $('account-kind').value = a?.kind || 'bank';
  $('account-currency').value = a?.currency || 'RUB';
  $('account-currency').disabled = Boolean(a);
  $('account-error').textContent = '';
  $('account-dialog').showModal();
  setTimeout(() => $('account-name').focus(), 0);
}
$('add-account').addEventListener('click', () => openAccount());
$('account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('account-error').textContent = '';
  const id = $('account-id').value || `account_${crypto.randomUUID()}`;
  const name = $('account-name').value.trim();
  if (!name) { $('account-error').textContent = 'Укажите название счёта.'; return; }
  try {
    if ($('account-id').value) {
      await repo.dispatch(updateAccountCommand(id, { name, kind: $('account-kind').value }));
    } else {
      await repo.dispatch(createAccountCommand({ name, kind: $('account-kind').value, currency: $('account-currency').value }, { entityId: id }));
    }
    $('account-dialog').close();
    await refresh();
    toast('Счёт сохранён');
  } catch (err) { $('account-error').textContent = fail(err); }
});

// --- Категории ---
function renderColorOptions() {
  $('category-colors').innerHTML = COLORS.map((c) => `<button type="button" class="color-option ${c === categoryColor ? 'selected' : ''}" data-color="${c}" style="background:${c}" aria-label="Цвет ${c}" aria-pressed="${c === categoryColor}"></button>`).join('');
}
function renderIconPicker() {
  const q = $('icon-search').value;
  const found = searchCategoryIcons(q);
  $('icon-picker').innerHTML = found.length
    ? found.map((icon) => `<button type="button" class="icon-pick ${icon.id === categoryIcon ? 'selected' : ''}" data-icon="${esc(icon.id)}" title="${esc(icon.name)}" aria-label="${esc(icon.name)}" aria-pressed="${icon.id === categoryIcon}">${categoryIconSvg(icon.id)}</button>`).join('')
    : `<span class="muted">Ничего не найдено.</span>`;
  $('icon-picker').querySelectorAll('[data-icon]').forEach((b) => b.addEventListener('click', () => { categoryIcon = b.dataset.icon; renderIconPicker(); }));
}
function openCategory(id) {
  const c = id ? categoryById(id) : null;
  $('category-title').textContent = c ? 'Настроить категорию' : 'Новая категория';
  $('category-id').value = c?.id || '';
  $('category-name').value = c?.name || '';
  categoryColor = c?.color || COLORS[categories.length % COLORS.length];
  categoryIcon = c?.iconId || 'local:circle';
  $('icon-search').value = '';
  $('category-error').textContent = '';
  renderColorOptions();
  renderIconPicker();
  $('category-dialog').showModal();
  setTimeout(() => $('category-name').focus(), 0);
}
$('add-category').addEventListener('click', () => openCategory());
$('category-colors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (b) { categoryColor = b.dataset.color; renderColorOptions(); }
});
$('icon-search').addEventListener('input', renderIconPicker);
$('category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('category-error').textContent = '';
  const name = $('category-name').value.trim();
  if (!name) { $('category-error').textContent = 'Укажите название категории.'; return; }
  const icon = getCategoryIcon(categoryIcon);
  const id = $('category-id').value || `category_${crypto.randomUUID()}`;
  try {
    if ($('category-id').value) {
      await repo.dispatch(updateCategoryCommand(id, { name, color: categoryColor, iconId: icon.id }));
    } else {
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
      await repo.dispatch(createCategoryCommand({ name, color: categoryColor, iconId: icon.id, sortOrder: maxOrder + 10 }, { entityId: id }));
    }
    $('category-dialog').close();
    await refresh();
    toast('Категория сохранена');
  } catch (err) { $('category-error').textContent = fail(err); }
});

// --- Расходы ---
function expenseSelects(selectedAccount, selectedCategory) {
  $('expense-account').innerHTML = accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.currency)}</option>`).join('');
  $('expense-category').innerHTML = categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (selectedAccount) $('expense-account').value = selectedAccount;
  if (selectedCategory) $('expense-category').value = selectedCategory;
  updateCurrencyHint();
}
function updateCurrencyHint() {
  const a = accountById($('expense-account').value);
  $('expense-currency-hint').textContent = a ? `Сумма в валюте счёта: ${a.currency}.` : '';
}
function openExpense(id) {
  if (!accounts.length || !categories.length) { toast('Сначала создайте счёт и категорию.'); return; }
  setEntryKind('expense');
  const e = id ? expenses.find((x) => x.id === id) : null;
  $('expense-kicker').textContent = 'РАСХОД';
  $('expense-title').textContent = e ? 'Изменить расход' : 'Новый расход';
  $('expense-id').value = e?.id || '';
  expenseSelects(e?.accountId || $('expense-account').value || accounts[0].id, e?.categoryId || $('expense-category').value || categories[0].id);
  $('expense-date').value = e?.date || todayIso();
  const current = e ? accountById(e.accountId) : accountById($('expense-account').value);
  $('expense-amount').value = e && current ? (e.amountMinor / 100).toString().replace('.', ',') : '';
  $('expense-note').value = e?.note || '';
  $('expense-error').textContent = '';
  updateCurrencyHint();
  $('expense-dialog').showModal();
  setTimeout(() => $('expense-amount').focus(), 0);
}
function setEntryKind(kind) {
  document.querySelectorAll('#expense-type [data-expense-type]').forEach((b) => {
    const selected = b.dataset.expenseType === kind;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  $('expense-fields').hidden = kind !== 'expense';
  $('transfer-fields').hidden = kind !== 'transfer';
  for (const id of ['expense-date', 'expense-account', 'expense-category', 'expense-amount']) $(id).toggleAttribute('required', kind === 'expense');
  for (const id of ['transfer-date', 'transfer-from', 'transfer-to', 'transfer-from-amount', 'transfer-to-amount']) $(id).toggleAttribute('required', kind === 'transfer');
}
function entryKind() {
  return $('transfer-fields').hidden ? 'expense' : 'transfer';
}
$('expense-type').addEventListener('click', (e) => {
  const b = e.target.closest('[data-expense-type]');
  if (!b || b.dataset.expenseType === entryKind()) return;
  // При смене типа всегда создаём новую операцию: молчаливая смена типа у существующей запрещена ядром.
  $('expense-id').value = '';
  $('expense-error').textContent = '';
  if (b.dataset.expenseType === 'transfer') {
    if (accounts.length < 2) { toast('Для перевода нужно минимум два счёта.'); return; }
    setEntryKind('transfer');
    fillTransferForm(null);
    $('expense-kicker').textContent = 'ПЕРЕВОД';
    $('expense-title').textContent = 'Новый перевод';
    setTimeout(() => $('transfer-from-amount').focus(), 0);
  } else {
    setEntryKind('expense');
    $('expense-kicker').textContent = 'РАСХОД';
    $('expense-title').textContent = 'Новый расход';
    setTimeout(() => $('expense-amount').focus(), 0);
  }
});
function transferAccountOptions(selected) {
  return accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.currency)}</option>`).join('');
}
function updateTransferHints() {
  const from = accountById($('transfer-from').value), to = accountById($('transfer-to').value);
  const currency = from?.currency || to?.currency;
  $('transfer-currency-hint').textContent = from && to
    ? (from.currency === to.currency ? `Валюта перевода: ${from.currency}. Переводы пока только внутри одной валюты.` : 'Счета в разных валютах: такой перевод пока запрещён.')
    : '';
  const feeHint = $('transfer-fee-hint');
  try {
    if (!currency) { feeHint.hidden = true; return; }
    const out = parseMoney($('transfer-from-amount').value, currency);
    const inn = parseMoney($('transfer-to-amount').value, currency);
    if (out > 0 && inn > 0 && out !== inn) {
      feeHint.hidden = false;
      feeHint.textContent = `Разница ${formatMoney(out - inn, currency)} останется комиссией: она не попадёт ни в расходы, ни на счета.`;
    } else feeHint.hidden = true;
  } catch { feeHint.hidden = true; }
}
function fillTransferForm(t) {
  $('transfer-from').innerHTML = transferAccountOptions();
  $('transfer-to').innerHTML = transferAccountOptions();
  if (t) { $('transfer-from').value = t.fromAccountId; $('transfer-to').value = t.toAccountId; }
  if ($('transfer-from').value === $('transfer-to').value) {
    $('transfer-to').value = [...$('transfer-to').options].map((o) => o.value).find((v) => v !== $('transfer-from').value) || $('transfer-to').value;
  }
  $('transfer-date').value = t?.date || todayIso();
  $('transfer-from-amount').value = t ? (t.fromAmountMinor / 100).toString().replace('.', ',') : '';
  $('transfer-to-amount').value = t ? (t.toAmountMinor / 100).toString().replace('.', ',') : '';
  $('transfer-note').value = t?.note || '';
  $('expense-error').textContent = '';
  updateTransferHints();
}
function openTransfer(id) {
  if (accounts.length < 2) { toast('Для перевода нужно минимум два счёта.'); return; }
  setEntryKind('transfer');
  const t = id ? transfers.find((x) => x.id === id) : null;
  $('expense-kicker').textContent = 'ПЕРЕВОД';
  $('expense-title').textContent = t ? 'Изменить перевод' : 'Новый перевод';
  $('expense-id').value = t?.id || '';
  fillTransferForm(t);
  $('expense-dialog').showModal();
  setTimeout(() => $('transfer-from-amount').focus(), 0);
}
$('add-expense').addEventListener('click', () => openExpense());
$('expense-account').addEventListener('change', updateCurrencyHint);
$('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (entryKind() === 'transfer') { await submitTransfer(e); return; }
  $('expense-error').textContent = '';
  const account = accountById($('expense-account').value);
  const category = categoryById($('expense-category').value);
  const date = $('expense-date').value;
  if (!account || !category) { $('expense-error').textContent = 'Выберите счёт и категорию.'; return; }
  let amountMinor;
  try {
    amountMinor = parseMoney($('expense-amount').value, account.currency);
  } catch (err) { $('expense-error').textContent = fail(err); return; }
  if (amountMinor <= 0) { $('expense-error').textContent = 'Сумма должна быть больше нуля.'; return; }
  const id = $('expense-id').value || `txn_${crypto.randomUUID()}`;
  const note = $('expense-note').value.trim();
  try {
    if ($('expense-id').value) {
      const current = expenses.find((x) => x.id === id);
      const patch = {};
      if (date !== current.date) patch.date = date;
      if (account.id !== current.accountId) { patch.accountId = account.id; patch.currency = account.currency; }
      if (category.id !== current.categoryId) patch.categoryId = category.id;
      if (amountMinor !== current.amountMinor) patch.amountMinor = amountMinor;
      if (account.currency !== current.currency && !patch.currency) patch.currency = account.currency;
      if (note !== current.note) patch.note = note;
      if (!Object.keys(patch).length) { $('expense-dialog').close(); return; }
      await repo.dispatch(updateExpenseCommand(id, patch));
    } else {
      await repo.dispatch(recordExpenseCommand({ date, accountId: account.id, categoryId: category.id, amountMinor, currency: account.currency, note }, { entityId: id }));
    }
    $('expense-dialog').close();
    await refresh();
    toast('Расход сохранён');
  } catch (err) { $('expense-error').textContent = fail(err); }
});

$('transfer-from').addEventListener('change', updateTransferHints);
$('transfer-to').addEventListener('change', updateTransferHints);
$('transfer-from-amount').addEventListener('input', updateTransferHints);
$('transfer-to-amount').addEventListener('input', updateTransferHints);
async function submitTransfer() {
  $('expense-error').textContent = '';
  const from = accountById($('transfer-from').value), to = accountById($('transfer-to').value);
  const date = $('transfer-date').value;
  if (!from || !to) { $('expense-error').textContent = 'Выберите оба счёта.'; return; }
  if (from.id === to.id) { $('expense-error').textContent = 'Счета должны различаться.'; return; }
  if (from.currency !== to.currency) { $('expense-error').textContent = 'Переводы пока только внутри одной валюты.'; return; }
  let fromAmountMinor, toAmountMinor;
  try {
    fromAmountMinor = parseMoney($('transfer-from-amount').value, from.currency);
    toAmountMinor = parseMoney($('transfer-to-amount').value, from.currency);
  } catch (err) { $('expense-error').textContent = fail(err); return; }
  if (fromAmountMinor <= 0 || toAmountMinor <= 0) { $('expense-error').textContent = 'Обе суммы должны быть больше нуля.'; return; }
  const id = $('expense-id').value || `txn_${crypto.randomUUID()}`;
  const note = $('transfer-note').value.trim();
  try {
    if ($('expense-id').value) {
      const current = transfers.find((x) => x.id === id);
      if (!current) throw new Error('Перевод не найден. Обновите страницу.');
      const patch = {};
      if (date !== current.date) patch.date = date;
      if (from.id !== current.fromAccountId) patch.fromAccountId = from.id;
      if (to.id !== current.toAccountId) patch.toAccountId = to.id;
      if (fromAmountMinor !== current.fromAmountMinor) patch.fromAmountMinor = fromAmountMinor;
      if (toAmountMinor !== current.toAmountMinor) patch.toAmountMinor = toAmountMinor;
      if (from.currency !== current.currency) patch.currency = from.currency;
      if (note !== current.note) patch.note = note;
      if (!Object.keys(patch).length) { $('expense-dialog').close(); return; }
      await repo.dispatch(updateTransferCommand(id, patch));
    } else {
      await repo.dispatch(recordTransferCommand({ date, fromAccountId: from.id, toAccountId: to.id, fromAmountMinor, toAmountMinor, currency: from.currency, note }, { entityId: id }));
    }
    $('expense-dialog').close();
    await refresh();
    toast('Перевод сохранён');
  } catch (err) { $('expense-error').textContent = fail(err); }
}

// --- Удаления ---
function usageText(items) {
  if (!items.length) return 'Привязанных расходов нет.';
  const totals = {};
  for (const e of items) totals[e.currency] = (totals[e.currency] ?? 0) + e.amountMinor;
  return `Привязано расходов: ${items.length} — ` + Object.entries(totals).map(([cur, sum]) => `${formatMoney(sum, cur)}`).join(', ') + '.';
}
function askRemoveExpense(id) {
  const e = expenses.find((x) => x.id === id);
  if (!e) return;
  const c = categoryById(e.categoryId);
  removeTask = { kind: 'expense', id };
  $('remove-title').textContent = 'Удалить расход?';
  $('remove-text').textContent = `${c?.name || 'Расход'} · ${formatMoney(e.amountMinor, e.currency)} · ${prettyDate(e.date)}. Действие необратимо.`;
  $('remove-extra').innerHTML = '';
  $('remove-error').textContent = '';
  $('remove-dialog').showModal();
}
function askRemoveCategory(id) {
  const c = categoryById(id);
  if (!c || c.system) return;
  const items = expenses.filter((e) => e.categoryId === id);
  const others = categories.filter((x) => x.id !== id);
  removeTask = { kind: 'category', id };
  $('remove-title').textContent = `Удалить «${c.name}»?`;
  $('remove-text').textContent = usageText(items);
  $('remove-extra').innerHTML = items.length ? `
    <label class="radio-card"><input type="radio" name="remove-mode" value="trash" checked><span>В корзину вместе с расходами<small>Удалятся категория и все её ${items.length} шт. Восстановить нельзя.</small></span></label>
    <label class="radio-card"><input type="radio" name="remove-mode" value="reassign" ${others.length ? '' : 'disabled'}><span>Переназначить в другие категории<small>${others.length ? 'Выберите категорию для каждого расхода ниже.' : 'Некуда переназначить — сначала создайте категорию.'}</small></span></label>
    <div class="reassign-list" id="reassign-list">` + items.map((e) => {
    const a = accountById(e.accountId);
    return `<div class="reassign-row"><span>${esc(prettyDate(e.date))} · ${esc(formatMoney(e.amountMinor, e.currency))}${e.note ? ' · ' + esc(e.note) : ''}</span>`
      + `<select data-reassign-expense="${esc(e.id)}" aria-label="Новая категория">` + others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('') + `</select></div>`;
  }).join('') + `</div>` : `<p class="muted help">Расходов нет — категория удалится сразу.</p>`;
  $('remove-error').textContent = '';
  $('remove-dialog').showModal();
}
function askRemoveTransfer(id) {
  const t = transfers.find((x) => x.id === id);
  if (!t) return;
  removeTask = { kind: 'transfer', id };
  $('remove-title').textContent = 'Удалить перевод?';
  $('remove-text').textContent = `${transferTitle(t)} · ${formatMoney(t.fromAmountMinor, t.currency)} → ${formatMoney(t.toAmountMinor, t.currency)} · ${prettyDate(t.date)}. Деньги «вернутся» обратно на счета. Действие необратимо.`;
  $('remove-extra').innerHTML = '';
  $('remove-error').textContent = '';
  $('remove-dialog').showModal();
}
function askRemoveAccount(id) {
  const a = accountById(id);
  if (!a) return;
  const items = expenses.filter((e) => e.accountId === id);
  const moves = transfers.filter((t) => t.fromAccountId === id || t.toAccountId === id);
  const others = accounts.filter((x) => x.id !== id && x.currency);
  const sameCurrency = others.filter((o) => o.currency === a.currency);
  removeTask = { kind: 'account', id };
  $('remove-title').textContent = `Удалить «${a.name}»?`;
  $('remove-text').textContent = usageText(items) + (moves.length ? ` Привязано переводов: ${moves.length}.` : '');
  $('remove-extra').innerHTML = (items.length || moves.length) ? `
    <label class="radio-card"><input type="radio" name="remove-mode" value="trash" checked><span>В корзину вместе с операциями<small>Удалятся счёт, ${items.length} расх. и ${moves.length} перев. Восстановить нельзя.</small></span></label>
    <label class="radio-card"><input type="radio" name="remove-mode" value="reassign" ${sameCurrency.length ? '' : 'disabled'}><span>Переназначить на другой счёт<small>${sameCurrency.length ? `Только счёт в той же валюте (${esc(a.currency)}).` : 'Некуда переназначить — сначала создайте счёт в той же валюте.'}</small></span></label>
    <div class="reassign-list">`
    + items.map((e) => `<div class="reassign-row"><span>Расход · ${esc(prettyDate(e.date))} · ${esc(formatMoney(e.amountMinor, e.currency))}</span>`
      + `<select data-reassign-expense="${esc(e.id)}" aria-label="Новый счёт">` + sameCurrency.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('') + `</select></div>`).join('')
    + moves.map((t) => {
      const side = t.fromAccountId === id ? 'fromAccountId' : 'toAccountId';
      const arrow = side === 'fromAccountId' ? 'уходит' : 'приходит';
      return `<div class="reassign-row"><span>Перевод · ${esc(prettyDate(t.date))} · ${arrow} ${esc(formatMoney(side === 'fromAccountId' ? t.fromAmountMinor : t.toAmountMinor, t.currency))}</span>`
        + `<select data-reassign-transfer="${esc(t.id)}" data-side="${side}" aria-label="Новый счёт">` + sameCurrency.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('') + `</select></div>`;
    }).join('') + `</div>` : `<p class="muted help">Операций нет — счёт удалится сразу.</p>`;
  $('remove-error').textContent = '';
  $('remove-dialog').showModal();
}
$('remove-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!removeTask) return;
  $('remove-error').textContent = '';
  $('remove-submit').disabled = true;
  try {
    if (removeTask.kind === 'expense' || removeTask.kind === 'transfer') {
      await repo.dispatch(deleteTransactionCommand(removeTask.id));
    } else {
      const mode = $('remove-extra').querySelector('input[name="remove-mode"]:checked')?.value || 'trash';
      const rows = [...$('remove-extra').querySelectorAll('[data-reassign-expense]')];
      const moveRows = [...$('remove-extra').querySelectorAll('[data-reassign-transfer]')];
      if (mode === 'reassign') {
        if (!rows.length && !moveRows.length) throw new Error('Некуда переназначить.');
        for (const select of rows) {
          const patch = removeTask.kind === 'category'
            ? { categoryId: select.value }
            : { accountId: select.value };
          await repo.dispatch(updateExpenseCommand(select.dataset.reassignExpense, patch));
        }
        for (const select of moveRows) {
          await repo.dispatch(updateTransferCommand(select.dataset.reassignTransfer, { [select.dataset.side]: select.value }));
        }
      } else {
        for (const select of rows) await repo.dispatch(deleteTransactionCommand(select.dataset.reassignExpense));
        for (const select of moveRows) await repo.dispatch(deleteTransactionCommand(select.dataset.reassignTransfer));
        if (!rows.length && removeTask.kind === 'category') {
          for (const item of expenses.filter((x) => x.categoryId === removeTask.id)) await repo.dispatch(deleteTransactionCommand(item.id));
        }
        if (!rows.length && removeTask.kind === 'account') {
          for (const item of expenses.filter((x) => x.accountId === removeTask.id)) await repo.dispatch(deleteTransactionCommand(item.id));
        }
      }
      await repo.dispatch(removeTask.kind === 'category' ? deleteCategoryCommand(removeTask.id) : deleteAccountCommand(removeTask.id));
    }
    $('remove-dialog').close();
    removeTask = null;
    await refresh();
    toast('Удалено');
  } catch (err) { $('remove-error').textContent = fail(err); }
  finally { $('remove-submit').disabled = false; }
});

// --- Фильтры, экспорт, сброс ---
$('filter-month').addEventListener('change', (e) => { filters.month = e.target.value; renderExpenses(); });
$('filter-account').addEventListener('change', (e) => { filters.accountId = e.target.value; renderExpenses(); });
$('filter-category').addEventListener('change', (e) => { filters.categoryId = e.target.value; renderExpenses(); });
// --- Обзор расходов: период, валюта, категории, тип графика, сравнение, ховер ---
function setExpTab(tab) {
  if (!['list', 'accounts', 'categories'].includes(tab)) tab = 'list';
  expTab = tab;
  try { localStorage.setItem('travert-exp-tab', tab); } catch {}
  document.querySelectorAll('[data-exp-tab]').forEach((b) => {
    const selected = b.dataset.expTab === tab;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  if ($('exp-pane-list')) $('exp-pane-list').hidden = tab !== 'list';
  if ($('exp-pane-accounts')) $('exp-pane-accounts').hidden = tab !== 'accounts';
  if ($('exp-pane-categories')) $('exp-pane-categories').hidden = tab !== 'categories';
}
$('exp-entry-tabs')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-tab]');
  if (b) setExpTab(b.dataset.expTab);
});
setExpTab(expTab);
$('exp-period-tabs')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-period]');
  if (b && b.dataset.expPeriod !== expPeriod) { expPeriod = b.dataset.expPeriod; renderExpOverview(); }
});
$('exp-overview-currency')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-overview-currency]');
  if (b && b.dataset.expOverviewCurrency !== expCurrency) { expCurrency = b.dataset.expOverviewCurrency; renderExpOverview(); }
});
$('exp-overview-chart-type')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-overview-chart]');
  if (!b || b.dataset.expOverviewChart === expChartType) return;
  expChartType = b.dataset.expOverviewChart;
  document.querySelectorAll('#exp-overview-chart-type [data-exp-overview-chart]').forEach((x) => {
    const selected = x === b;
    x.classList.toggle('selected', selected);
    x.setAttribute('aria-pressed', String(selected));
  });
  renderExpOverview();
});
$('exp-overview-comparison-mode')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-overview-comparison]');
  if (!b || !['total', 'average'].includes(b.dataset.expOverviewComparison) || b.dataset.expOverviewComparison === expComparison) return;
  expComparison = b.dataset.expOverviewComparison;
  try { localStorage.setItem('travert-exp-comparison', expComparison); } catch {}
  renderExpOverview();
});
function setExpFilterOpen(open) {
  $('exp-source-filter-panel').hidden = !open;
  $('exp-source-filter-trigger').setAttribute('aria-expanded', String(open));
}
$('exp-source-filter-trigger')?.addEventListener('click', () => setExpFilterOpen($('exp-source-filter-panel').hidden));
document.addEventListener('focusin', (e) => { if ($('exp-source-filter') && !$('exp-source-filter').contains(e.target)) setExpFilterOpen(false); });
document.addEventListener('pointerdown', (e) => { if ($('exp-source-filter') && !$('exp-source-filter').contains(e.target)) setExpFilterOpen(false); });
$('exp-source-filter-options')?.addEventListener('change', (e) => {
  const input = e.target.closest('[data-exp-filter-category]');
  if (!input) return;
  expCategoryFilter = input.checked ? [...new Set([...expCategoryFilter, input.value])] : expCategoryFilter.filter((id) => id !== input.value);
  try { localStorage.setItem('travert-exp-category-filter', JSON.stringify(expCategoryFilter)); } catch {}
  updateExpCategoryFilter();
  renderExpOverview({ newSourcesOnly: true });
});
$('exp-source-toggle-all')?.addEventListener('change', () => {
  expCategoryFilter = $('exp-source-toggle-all').checked ? ['all', ...categories.map((c) => c.id)] : [];
  try { localStorage.setItem('travert-exp-category-filter', JSON.stringify(expCategoryFilter)); } catch {}
  updateExpCategoryFilter();
  renderExpOverview({ newSourcesOnly: true });
});
$('exp-overview-chart')?.addEventListener('pointermove', (e) => {
  if (!expChart) return;
  const r = $('exp-overview-chart').getBoundingClientRect();
  expOverviewTooltip(Math.floor(((e.clientX - r.left) * expChart.width / r.width - expChart.left) / expChart.step));
});
$('exp-overview-chart')?.addEventListener('pointerleave', hideExpTooltip);
$('exp-overview-chart')?.addEventListener('blur', hideExpTooltip);
$('exp-overview-chart')?.addEventListener('keydown', (e) => {
  if (!expChart) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); expOverviewTooltip(expChartSelection + (e.key === 'ArrowRight' ? 1 : -1)); }
  if (e.key === 'Escape') hideExpTooltip();
});
window.addEventListener('travert-add-expense', () => openExpense());
let expResizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(expResizeTimer);
  expResizeTimer = setTimeout(() => {
    if (!expenses.length) return;
    if (!$('expenses-overview-view')?.hidden) renderExpOverview({ animate: false });
    scheduleExpShareLayout();
  }, 200);
});
// График под скрытой вкладкой не знает свою ширину: перерисовываем при показе.
window.addEventListener('expenses-overview-shown', () => {
  if ((expenses.length || transfers.length) && $('expenses-overview-view') && !$('expenses-overview-view').hidden) renderExpOverview({ animate: false });
});
window.addEventListener('expenses-shown', () => {
  setExpTab(expTab);
});
try {
  const expShareObserver = new ResizeObserver(scheduleExpShareLayout);
  if ($('exp-overview-comparison-card')) expShareObserver.observe($('exp-overview-comparison-card'));
  if ($('exp-overview-share-card')) expShareObserver.observe($('exp-overview-share-card'));
} catch {}
if (document.fonts?.ready) document.fonts.ready.then(() => scheduleExpShareLayout());
$('export-btn').addEventListener('click', async () => {
  const recovery = await repo.exportRecovery();
  const blob = new Blob([JSON.stringify(recovery, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `travert-recovery-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});
$('reset-btn').addEventListener('click', async () => {
  if (!window.confirm('Удалить все локальные данные расходов и загрузить демо заново?')) return;
  repo.close();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(localDatabaseName(IDENTITY));
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error('Закройте другие вкладки.')), { once: true });
  });
  location.reload();
});

// --- Старт ---
try {
  await repo.open(IDENTITY);
  const [seededAccounts, seededCategories] = await Promise.all([
    repo.query({ type: 'accounts' }),
    repo.query({ type: 'categories' }),
  ]);
  if (!seededAccounts.length && !seededCategories.length) {
    try {
      const response = await fetch('finance/demo-seed.json');
      if (response.ok) {
        const seed = await response.json();
        const result = await seedDemoData(repo, seed);
        const total = result.added.accounts + result.added.categories + result.added.expenses;
        if (total) toast(`Загружены демо-данные: ${total} записей`);
      }
    } catch { /* без сида откроется пустая книга — это нормально */ }
  }
  filters.month = monthOf(todayIso());
  $('filter-month').value = filters.month;
  await refresh();
} catch (error) {
  $('sync-status').textContent = 'Не удалось открыть локальную книгу';
  $('expenses-list').innerHTML = `<div class="expenses-empty">Ошибка: ${esc(error.message)}</div>`;
}
