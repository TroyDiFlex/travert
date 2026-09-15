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
  updateAccountCommand,
  updateCategoryCommand,
  updateExpenseCommand,
} from './finance/core/commands.js';
import { formatMoney, parseMoney } from './finance/core/money.js';
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
let accounts = [], categories = [], expenses = [];
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
  const [a, c, e, pending] = await Promise.all([
    repo.query({ type: 'accounts' }),
    repo.query({ type: 'categories' }),
    repo.query({ type: 'expenses' }),
    repo.query({ type: 'pending-count' }),
  ]);
  accounts = a; categories = c; expenses = e;
  $('sync-status').textContent = pending
    ? `Локально · не отправлено: ${pending} (сервер не подключён)`
    : 'Локально · всё сохранено в браузере';
  renderAccounts();
  renderCategories();
  renderFilters();
  renderExpenses();
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
    return `<div class="account-row"><i class="source-dot" style="background:var(--accent)"></i>`
      + `<div class="account-info"><b>${esc(a.name)}</b><small>${esc(ACCOUNT_KINDS[a.kind] || a.kind)} · ${esc(a.currency)} · расходов: ${usage.length}</small></div>`
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

function renderExpenses() {
  const list = filteredExpenses();
  const totals = {};
  for (const e of list) totals[e.currency] = (totals[e.currency] ?? 0) + e.amountMinor;
  $('expenses-summary').innerHTML = list.length
    ? Object.entries(totals).map(([cur, sum]) => `<span>${esc(cur)}: <strong>${esc(formatMoney(sum, cur))}</strong></span>`).join('') + `<span class="muted">${list.length} шт.</span>`
    : `<span class="muted">Ничего не найдено.</span>`;
  const box = $('expenses-list');
  if (!list.length) {
    const empty = !expenses.length;
    box.innerHTML = `<div class="expenses-empty">${empty ? 'Расходов пока нет. Добавьте первый — кнопки выше.' : 'Под фильтры ничего не попало.'}${empty && accounts.length && categories.length ? `<br><button class="button subtle" type="button" data-empty-expense>Добавить расход</button>` : ''}</div>`;
    box.querySelector('[data-empty-expense]')?.addEventListener('click', () => openExpense());
    return;
  }
  box.innerHTML = list.map((e) => {
    const a = accountById(e.accountId), c = categoryById(e.categoryId);
    return `<div class="expense-row"><span class="cat-icon category-chip" style="padding:0;border:0;background:none"><span class="cat-icon" style="background:${esc(c?.color || '#666')}">${categoryIconSvg(c?.iconId || 'local:circle')}</span></span>`
      + `<div class="expense-info"><b>${esc(c?.name || 'Удалённая категория')}</b><small>${esc(prettyDate(e.date))} · ${esc(a?.name || 'Удалённый счёт')}${e.note ? ' · ' + esc(e.note) : ''}</small></div>`
      + `<span class="expense-amount">${esc(formatMoney(e.amountMinor, e.currency))}</span>`
      + `<div class="row-actions"><button class="icon-button" type="button" data-edit-expense="${esc(e.id)}" aria-label="Изменить">${ico('dots')}</button>`
      + `<button class="icon-button" type="button" data-del-expense="${esc(e.id)}" aria-label="Удалить">${ico('trash')}</button></div></div>`;
  }).join('');
  box.querySelectorAll('[data-edit-expense]').forEach((b) => b.addEventListener('click', () => openExpense(b.dataset.editExpense)));
  box.querySelectorAll('[data-del-expense]').forEach((b) => b.addEventListener('click', () => askRemoveExpense(b.dataset.delExpense)));
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
  const e = id ? expenses.find((x) => x.id === id) : null;
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
$('add-expense').addEventListener('click', () => openExpense());
$('expense-account').addEventListener('change', updateCurrencyHint);
$('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
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
function askRemoveAccount(id) {
  const a = accountById(id);
  if (!a) return;
  const items = expenses.filter((e) => e.accountId === id);
  const others = accounts.filter((x) => x.id !== id && x.currency);
  removeTask = { kind: 'account', id };
  $('remove-title').textContent = `Удалить «${a.name}»?`;
  $('remove-text').textContent = usageText(items);
  const sameCurrency = (targetId) => accountById(targetId)?.currency === a.currency;
  $('remove-extra').innerHTML = items.length ? `
    <label class="radio-card"><input type="radio" name="remove-mode" value="trash" checked><span>В корзину вместе с расходами<small>Удалятся счёт и все его ${items.length} шт. Восстановить нельзя.</small></span></label>
    <label class="radio-card"><input type="radio" name="remove-mode" value="reassign"><span>Переназначить на другой счёт<small>Только счёт в той же валюте (${esc(a.currency)}).</small></span></label>
    <div class="reassign-list">` + items.map((e) => `<div class="reassign-row"><span>${esc(prettyDate(e.date))} · ${esc(formatMoney(e.amountMinor, e.currency))}</span>`
      + `<select data-reassign-expense="${esc(e.id)}" aria-label="Новый счёт">` + others.filter((o) => o.currency === a.currency).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('') + `</select></div>`).join('') + `</div>` : `<p class="muted help">Расходов нет — счёт удалится сразу.</p>`;
  if (items.length && !others.some((o) => sameCurrency(o.id))) {
    $('remove-extra').querySelector('input[value="reassign"]').disabled = true;
  }
  $('remove-error').textContent = '';
  $('remove-dialog').showModal();
}
$('remove-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!removeTask) return;
  $('remove-error').textContent = '';
  $('remove-submit').disabled = true;
  try {
    if (removeTask.kind === 'expense') {
      await repo.dispatch(deleteTransactionCommand(removeTask.id));
    } else {
      const mode = $('remove-extra').querySelector('input[name="remove-mode"]:checked')?.value || 'trash';
      const rows = [...$('remove-extra').querySelectorAll('[data-reassign-expense]')];
      if (mode === 'reassign') {
        if (!rows.length) throw new Error('Некуда переназначить.');
        for (const select of rows) {
          const patch = removeTask.kind === 'category'
            ? { categoryId: select.value }
            : { accountId: select.value };
          await repo.dispatch(removeTask.kind === 'category'
            ? updateExpenseCommand(select.dataset.reassignExpense, patch)
            : updateExpenseCommand(select.dataset.reassignExpense, patch));
        }
      } else {
        for (const select of rows) await repo.dispatch(deleteTransactionCommand(select.dataset.reassignExpense));
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
