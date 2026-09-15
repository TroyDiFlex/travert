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
import { incomeChart, incomeSourceSeries, chartGeometry } from './chart.js';
import { monthLabel } from './model.js';
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
  renderExpenseAnalytics();
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

// --- Аналитика: те же графики, что в обзоре доходов ---
// Категории маппятся на источники модели доходов, поэтому incomeChart,
// chartGeometry и сводка summarize переиспользуются без изменений.
let expCurrency = 'RUB', expChartType = 'line', expComparison = 'average', expChart = null;

function expenseCurrencies() {
  return [...new Set(expenses.map((e) => e.currency))].sort();
}
function expenseChartData(currency) {
  const sources = [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, active: true, order: c.sortOrder }));
  const entries = expenses
    .filter((e) => e.currency === currency)
    .map((e) => ({ sourceId: e.categoryId, month: e.month, amount: e.amountMinor }));
  return { sources, entries };
}
const EXP_SYMBOLS = { RUB: '₽', USD: '$', EUR: '€' };

function renderExpenseAnalytics() {
  const currencies = expenseCurrencies();
  if (!currencies.includes(expCurrency)) expCurrency = currencies[0] || 'RUB';
  $('exp-currency').innerHTML = currencies.map((c) => `<button type="button" class="${c === expCurrency ? 'selected' : ''}" data-exp-currency="${c}" aria-pressed="${c === expCurrency}">${c}</button>`).join('')
    || '<span class="muted">Нет данных</span>';
  $('exp-chart-unit').textContent = `${EXP_SYMBOLS[expCurrency] || expCurrency} / месяц`;
  document.querySelectorAll('#exp-comparison-mode [data-exp-comparison]').forEach((b) => {
    const selected = b.dataset.expComparison === expComparison;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  $('exp-comparison-kicker').textContent = expComparison === 'average' ? 'РАСХОД ЗА МЕСЯЦ С ЗАПИСЬЮ' : 'ВКЛАД В ОБЩИЙ РАСХОД';

  const data = expenseChartData(expCurrency);
  const model = incomeChart(data, '', '', ['all']);
  const s = model.summary;
  const total = s.total;
  $('exp-hero-total').innerHTML = s.observed.length
    ? `${esc(formatMoney(total, expCurrency)).replace(/[₽$€]/, '<span class="currency">$&</span>')}`
    : '—';
  $('exp-hero-caption').textContent = s.observed.length
    ? `${s.observed.length} мес. с записями · ${s.recordCount} расходов`
    : 'Добавьте первый расход';
  renderExpenseDonut(s);
  renderExpenseComparison(s);
  renderExpenseChart(data, model);
}

function renderExpenseDonut(s) {
  const value = (x) => (expComparison === 'average' ? x.average : x.total);
  const sources = [...s.sources].sort((a, b) => value(b) - value(a));
  const total = sources.reduce((sum, x) => sum + value(x), 0);
  const donut = $('exp-donut');
  $('exp-share-count').textContent = `${sources.length} кат.`;
  if (!donut.querySelector('svg')) donut.innerHTML = '<svg viewBox="0 0 160 160" role="img"><circle cx="80" cy="80" r="63" stroke="var(--grid)"/></svg><div class="donut-center"><strong></strong><span></span></div>';
  const svg = donut.querySelector('svg');
  svg.setAttribute('aria-label', `Доли категорий расходов — ${expComparison === 'average' ? 'средний расход' : 'общий расход'}`);
  donut.querySelector('strong').textContent = total ? '100%' : '—';
  donut.querySelector('span').textContent = total ? 'расходы' : 'нет расходов';
  const circumference = 2 * Math.PI * 63;
  let offset = 0;
  const parts = sources.map((source) => {
    const fraction = total ? value(source) / total : 0, dash = Math.max(0, circumference * fraction - 3);
    const rendered = `<circle class="donut-segment" data-source="${esc(source.id)}" cx="80" cy="80" r="63" stroke="${esc(source.color)}" style="stroke-dasharray:${dash} ${circumference - dash};stroke-dashoffset:${-offset}"/>`;
    offset += circumference * fraction;
    return rendered;
  }).join('');
  svg.querySelectorAll('[data-source]').forEach((circle) => circle.remove());
  svg.insertAdjacentHTML('beforeend', parts);
  $('exp-share-legend').innerHTML = sources.length ? sources.map((x) => `<div class="share-item"><i class="source-dot" style="background:${x.color}"></i><span class="label" title="${esc(x.name)}">${esc(x.name)}</span><strong>${total ? (100 * value(x) / total).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '0'}%</strong></div>`).join('')
    : '<p class="muted help">В этой валюте пока нет расходов.</p>';
}

function renderExpenseComparison(s) {
  const value = (x) => (expComparison === 'average' ? x.average : x.total);
  const sources = [...s.sources].sort((a, b) => value(b) - value(a) || b.total - a.total);
  const total = sources.reduce((sum, x) => sum + value(x), 0);
  const maximum = sources.length ? value(sources[0]) : 0;
  const box = $('exp-comparison');
  if (!sources.length) {
    box.innerHTML = '<div class="empty-state"><h3>Пока нечего сравнивать</h3>Добавьте расход в этой валюте.</div>';
    return;
  }
  box.innerHTML = sources.map((x) => {
    const category = categoryById(x.id);
    return `<div class="comparison-item"><div class="comparison-heading"><i class="source-dot" style="background:${x.color}"></i><span title="${esc(x.name)}">${esc(x.name)}</span><strong>${esc(formatMoney(value(x), expCurrency))}</strong></div>`
      + `<div class="bar-track"><div class="bar-fill" style="width:${maximum ? (value(x) / maximum) * 100 : 0}%;background:${x.color}"></div></div>`
      + `<div class="comparison-meta"><span>${category?.active === false ? 'Неактивная' : 'Категория'} · ${x.count} мес. с записями</span><span>${total ? (100 * value(x) / total).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '0'}%</span></div></div>`;
  }).join('');
}

function renderExpenseChart(data, model) {
  const s = model.summary, container = $('exp-chart');
  const legend = expChartType === 'bars' ? model.bars : model.lines;
  $('exp-chart-legend').innerHTML = legend.map((series) => `<span class="chart-legend-item"><i class="legend-line" style="background:${series.color}"></i><span>${esc(series.name.replace('Общий доход', 'Общий расход').replace('источников', 'категорий').replace('источники', 'категории'))}</span></span>`).join('');
  if (!s.observed.length) {
    container.innerHTML = '<div class="empty-state"><h3>Здесь появится график расходов</h3>Добавьте расход в этой валюте.</div>';
    $('exp-chart-range').textContent = 'Нет записей';
    expChart = null;
    return;
  }
  const geometry = chartGeometry(model, expChartType, container.clientWidth || 600, container.clientHeight || 240, { animate: false });
  const tooltipRows = incomeSourceSeries(data, '', '');
  container.innerHTML = `${geometry.svg}<div id="exp-chart-tooltip" class="tooltip" hidden></div>`;
  expChart = { ...geometry, s, model, tooltipRows };
  $('exp-chart-range').textContent = `${monthLabel(s.months[0].month, true)} — ${monthLabel(s.months.at(-1).month, true)}`;
}

function expenseChartTooltip(index) {
  if (!expChart) return;
  const { s, x, y, width, hoverSeries, tooltipRows } = expChart;
  index = Math.max(0, Math.min(s.months.length - 1, index));
  const m = s.months[index], tip = $('exp-chart-tooltip');
  tip.innerHTML = `<small>${monthLabel(m.month)} · Общий расход</small><b>${m.count ? esc(formatMoney(m.total, expCurrency)) : 'Нет записей'}</b>` + tooltipRows.map((series) => {
    const point = series.months[index];
    return `<div class="tooltip-row"><span title="${esc(series.name)}"><i class="source-dot" style="background:${series.color}"></i>${esc(series.name)}</span><span>${point.count ? esc(formatMoney(point.total, expCurrency)) : 'Нет записи'}</span></div>`;
  }).join('');
  tip.hidden = false;
  const highest = hoverSeries.reduce((max, series) => Math.max(max, series.months[index].total), 0);
  const chart = $('exp-chart'), gap = 16, pointX = (x(index) * chart.clientWidth) / width;
  const tipWidth = tip.offsetWidth, tipHeight = tip.offsetHeight;
  const beside = pointX - tipWidth - gap >= 0 ? pointX - tipWidth - gap : pointX + gap;
  tip.style.transform = `translate3d(${Math.max(0, Math.min(chart.clientWidth - tipWidth, beside))}px,${Math.max(0, Math.min(chart.clientHeight - tipHeight - 20, y(highest) - tipHeight - 15))}px,0)`;
  const cross = chart.querySelector('#crosshair');
  if (cross) { cross.setAttribute('x1', x(index)); cross.setAttribute('x2', x(index)); cross.setAttribute('opacity', '.5'); }
  hoverSeries.forEach((series, i) => {
    const point = series.months[index], dot = $('hover-dot-' + i);
    if (!dot) return;
    dot.setAttribute('cx', x(index));
    dot.setAttribute('cy', y(point.total));
    dot.setAttribute('opacity', point.count ? '1' : '0');
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
  setEntryKind(b.dataset.expenseType);
  $('expense-kicker').textContent = b.dataset.expenseType === 'transfer' ? 'ПЕРЕВОД' : 'РАСХОД';
  $('expense-title').textContent = b.dataset.expenseType === 'transfer' ? 'Новый перевод' : 'Новый расход';
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
function openTransfer(id) {
  if (accounts.length < 2) { toast('Для перевода нужно минимум два счёта.'); return; }
  setEntryKind('transfer');
  const t = id ? transfers.find((x) => x.id === id) : null;
  $('expense-kicker').textContent = 'ПЕРЕВОД';
  $('expense-title').textContent = t ? 'Изменить перевод' : 'Новый перевод';
  $('expense-id').value = t?.id || '';
  $('transfer-from').innerHTML = transferAccountOptions();
  $('transfer-to').innerHTML = transferAccountOptions();
  if (t) { $('transfer-from').value = t.fromAccountId; $('transfer-to').value = t.toAccountId; }
  if ($('transfer-from').value === $('transfer-to').value) {
    $('transfer-to').value = [...$('transfer-to').options].map((o) => o.value).find((v) => v !== $('transfer-from').value) || $('transfer-to').value;
  }
  $('transfer-date').value = t?.date || todayIso();
  const cur = t ? t.currency : (accountById($('transfer-from').value)?.currency || 'RUB');
  $('transfer-from-amount').value = t ? (t.fromAmountMinor / 100).toString().replace('.', ',') : '';
  $('transfer-to-amount').value = t ? (t.toAmountMinor / 100).toString().replace('.', ',') : '';
  $('transfer-note').value = t?.note || '';
  $('expense-error').textContent = '';
  updateTransferHints();
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
// --- Аналитика: валюта, тип графика, режим сравнения, ховер ---
$('exp-currency').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-currency]');
  if (b && b.dataset.expCurrency !== expCurrency) { expCurrency = b.dataset.expCurrency; renderExpenseAnalytics(); }
});
$('exp-chart-type').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-chart]');
  if (!b || b.dataset.expChart === expChartType) return;
  expChartType = b.dataset.expChart;
  document.querySelectorAll('#exp-chart-type [data-exp-chart]').forEach((x) => {
    const selected = x === b;
    x.classList.toggle('selected', selected);
    x.setAttribute('aria-pressed', String(selected));
  });
  renderExpenseAnalytics();
});
$('exp-comparison-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-exp-comparison]');
  if (!b || !['total', 'average'].includes(b.dataset.expComparison) || b.dataset.expComparison === expComparison) return;
  expComparison = b.dataset.expComparison;
  renderExpenseAnalytics();
});
$('exp-chart').addEventListener('pointermove', (e) => {
  if (!expChart) return;
  const r = $('exp-chart').getBoundingClientRect();
  expenseChartTooltip(Math.floor((((e.clientX - r.left) * expChart.width) / r.width - expChart.left) / expChart.step));
});
$('exp-chart').addEventListener('pointerleave', () => {
  if ($('exp-chart-tooltip')) $('exp-chart-tooltip').hidden = true;
  $('exp-chart').querySelector('#crosshair')?.setAttribute('opacity', '0');
  $('exp-chart').querySelectorAll('.hover-dot').forEach((dot) => dot.setAttribute('opacity', '0'));
});
let expResizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(expResizeTimer);
  expResizeTimer = setTimeout(() => { if (expenses.length) renderExpenseAnalytics(); }, 200);
});
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
