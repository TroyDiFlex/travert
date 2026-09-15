import { CATEGORY_COLORS, ExpensesController, UNCATEGORIZED_ID } from './finance/controller.js';
import { iconSvg, searchIcons } from './finance/icons.js';

const controller = new ExpensesController();

const elements = {};
for (const id of [
  'sync-status', 'sync-note', 'pending-note', 'expense-form', 'expense-date', 'expense-amount', 'expense-currency',
  'expense-account', 'expense-note', 'expense-error', 'expense-submit',
  'category-chip', 'category-list-dialog', 'category-list', 'expense-list', 'expense-empty', 'expense-month',
  'category-dialog', 'category-form', 'category-name', 'category-colors',
  'category-icon-pick', 'category-error', 'icon-dialog', 'icon-search', 'icon-grid',
  'account-dialog', 'account-form', 'account-name', 'account-kind', 'account-currency',
  'account-error', 'toast',
]) {
  elements[id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = document.getElementById(id);
}

const state = {
  accounts: [],
  categories: [],
  expenses: [],
  pending: 0,
  online: navigator.onLine !== false,
  categoryId: UNCATEGORIZED_ID,
  iconId: 'local:basket',
  color: CATEGORY_COLORS[6],
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.toast.hidden = true; }, 2600);
}

function showError(element, error) {
  element.textContent = error?.message ?? 'Не получилось сохранить. Попробуйте ещё раз.';
}

function iconBadge(iconId, color) {
  return `<span class="icon-badge" style="background:${color}">${iconSvg(iconId)}</span>`;
}

function categoryById(id) {
  return state.categories.find((category) => category.id === id);
}

function accountById(id) {
  return state.accounts.find((account) => account.id === id);
}

function todayLocal() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function renderStatus() {
  const pill = elements.syncStatus;
  if (!state.online) {
    pill.textContent = 'Офлайн · сохраняем';
    pill.className = 'sync-pill is-offline';
  } else {
    pill.textContent = '✓ Всё сохранено';
    pill.className = 'sync-pill is-saved';
  }
  elements.pendingNote.textContent = state.pending > 0
    ? `Записей на устройстве: ${state.pending}. Отправка на другие устройства появится позже.`
    : '';
}

function renderAccounts() {
  elements.expenseAccount.innerHTML = '';
  for (const account of state.accounts) {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = `${account.name} · ${account.currency}`;
    elements.expenseAccount.append(option);
  }
  if (!accountById(elements.expenseAccount.value) && state.accounts.length > 0) {
    elements.expenseAccount.value = state.accounts[0].id;
  }
  const current = accountById(elements.expenseAccount.value);
  elements.expenseCurrency.textContent = current ? `(${current.currency})` : '';
}

function renderCategoryChip() {
  const category = categoryById(state.categoryId);
  elements.categoryChip.innerHTML = category
    ? `${iconBadge(category.iconId, category.color)}<span>${escapeHtml(category.name)}</span>`
    : 'Выбрать…';
}

function renderExpenses() {
  const month = elements.expenseMonth.value;
  const visible = month ? state.expenses.filter((item) => item.month === month) : state.expenses;
  elements.expenseEmpty.hidden = visible.length > 0;
  elements.expenseList.innerHTML = '';
  const categories = new Map(state.categories.map((category) => [category.id, category]));
  for (const item of visible) {
    const category = categories.get(item.categoryId) ?? { name: 'Без категории', iconId: 'local:circle', color: '#94a3b8' };
    const row = document.createElement('li');
    row.className = 'expense-row';
    row.innerHTML = `${iconBadge(category.iconId, category.color)}
      <div class="expense-main"><div class="expense-title">${escapeHtml(category.name)}</div>
      <div class="expense-sub">${escapeHtml(item.date)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</div></div>
      <span class="expense-amount">${escapeHtml(controller.formatAmount(item.amountMinor, item.currency))}</span>`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button';
    remove.textContent = '🗑';
    remove.setAttribute('aria-label', 'Удалить расход');
    remove.addEventListener('click', async () => {
      if (!window.confirm('Удалить этот расход?')) return;
      try {
        await controller.deleteExpense(item.id);
        await refresh();
        showToast('Расход удалён.');
      } catch (error) {
        showToast(error?.message ?? 'Не получилось удалить.');
      }
    });
    row.append(remove);
    elements.expenseList.append(row);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

async function refresh() {
  const [accounts, categories, expenses, pending] = await Promise.all([
    controller.listAccounts(),
    controller.listCategories(),
    controller.listExpenses(),
    controller.pendingCount(),
  ]);
  state.accounts = accounts;
  state.categories = categories;
  state.expenses = expenses;
  state.pending = pending;
  if (!categoryById(state.categoryId)) state.categoryId = UNCATEGORIZED_ID;
  renderAccounts();
  renderCategoryChip();
  renderExpenses();
  renderStatus();
}

function renderCategoryList() {
  const list = elements.categoryList;
  list.innerHTML = '';
  for (const category of state.categories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(category.id === state.categoryId));
    button.innerHTML = `${iconBadge(category.iconId, category.color)}<span>${escapeHtml(category.name)}</span>`;
    button.addEventListener('click', () => {
      state.categoryId = category.id;
      renderCategoryChip();
      elements.categoryListDialog.close();
    });
    list.append(button);
  }
}

function renderColorOptions() {
  elements.categoryColors.innerHTML = '';
  for (const color of CATEGORY_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.background = color;
    button.setAttribute('aria-label', color);
    button.setAttribute('aria-pressed', String(color === state.color));
    button.addEventListener('click', () => {
      state.color = color;
      renderColorOptions();
    });
    elements.categoryColors.append(button);
  }
}

function renderIconGrid() {
  const query = elements.iconSearch.value;
  const found = searchIcons(query);
  const grid = elements.iconGrid;
  grid.innerHTML = '';
  for (const icon of found) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', icon.label);
    button.title = icon.label;
    button.setAttribute('aria-selected', String(icon.id === state.iconId));
    button.innerHTML = iconSvg(icon.id);
    button.addEventListener('click', () => {
      state.iconId = icon.id;
      renderIconPick();
      elements.iconDialog.close();
    });
    grid.append(button);
  }
  if (found.length === 0) {
    grid.innerHTML = '<p class="muted">Ничего не нашлось. Попробуйте другое слово.</p>';
  }
}

function renderIconPick() {
  elements.categoryIconPick.innerHTML = `${iconSvg(state.iconId)}<span>Иконка выбрана</span>`;
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialogs(root) {
  for (const dialog of root.querySelectorAll('dialog[open]')) dialog.close();
}

async function init() {
  elements.expenseDate.value = todayLocal();
  renderColorOptions();
  renderIconPick();
  await controller.open();
  controller.onUpdate(() => { refresh().catch(() => {}); });
  await refresh();

  elements.expenseAccount.addEventListener('change', renderAccounts);

  elements.expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.expenseError.textContent = '';
    elements.expenseSubmit.disabled = true;
    try {
      await controller.saveExpense({
        date: elements.expenseDate.value,
        amountText: elements.expenseAmount.value,
        accountId: elements.expenseAccount.value,
        categoryId: state.categoryId,
        note: elements.expenseNote.value,
      });
      elements.expenseAmount.value = '';
      elements.expenseNote.value = '';
      await refresh();
      showToast('Расход сохранён на устройстве.');
    } catch (error) {
      showError(elements.expenseError, error);
    } finally {
      elements.expenseSubmit.disabled = false;
    }
  });

  elements.expenseMonth.addEventListener('change', renderExpenses);

  elements.categoryChip.addEventListener('click', () => {
    renderCategoryList();
    openDialog(elements.categoryListDialog);
  });

  document.getElementById('add-category').addEventListener('click', () => {
    elements.categoryError.textContent = '';
    openDialog(elements.categoryDialog);
  });

  elements.categoryIconPick.addEventListener('click', () => {
    elements.iconSearch.value = '';
    renderIconGrid();
    openDialog(elements.iconDialog);
  });

  elements.iconSearch.addEventListener('input', renderIconGrid);

  elements.categoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.categoryError.textContent = '';
    try {
      const acknowledgement = await controller.createCategory({
        name: elements.categoryName.value,
        color: state.color,
        iconId: state.iconId,
      });
      state.categoryId = acknowledgement.entity.id;
      elements.categoryName.value = '';
      elements.categoryDialog.close();
      await refresh();
      showToast('Категория создана.');
    } catch (error) {
      showError(elements.categoryError, error);
    }
  });

  document.getElementById('add-account').addEventListener('click', () => {
    elements.accountError.textContent = '';
    openDialog(elements.accountDialog);
  });

  elements.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.accountError.textContent = '';
    try {
      const acknowledgement = await controller.createAccount({
        name: elements.accountName.value,
        kind: elements.accountKind.value,
        currency: elements.accountCurrency.value,
      });
      elements.accountName.value = '';
      elements.accountDialog.close();
      await refresh();
      elements.expenseAccount.value = acknowledgement.entity.id;
      renderAccounts();
      showToast(`Счёт «${acknowledgement.entity.name}» создан.`);
    } catch (error) {
      showError(elements.accountError, error);
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.classList?.contains('close-dialog')) closeDialogs(document);
  });

  window.addEventListener('online', () => { state.online = true; renderStatus(); });
  window.addEventListener('offline', () => { state.online = false; renderStatus(); });
}

init().catch((error) => {
  elements.syncStatus.textContent = 'Не открылось: ' + (error?.message ?? error);
});
