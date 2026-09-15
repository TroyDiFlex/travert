import {
  createAccountCommand,
  createCategoryCommand,
  recordExpenseCommand,
} from '../core/commands.js';

// Загружает демо-данные (finance/demo-seed.json) в открытую локальную книгу.
// Идемпотентно: существующие ID пропускаются, повторный запуск ничего не дублирует.
// Пишет только в IndexedDB через репозиторий; сам JSON-файл не изменяется.
// Боевой сервер подключается отдельно — сид нужен лишь для разработки и демо.
export async function seedDemoData(repository, seed) {
  if (!repository) throw new TypeError('Нужен открытый репозиторий.');
  if (!seed || !Array.isArray(seed.accounts) || !Array.isArray(seed.categories) || !Array.isArray(seed.expenses)) {
    throw new TypeError('Некорректный seed: нужны accounts, categories и expenses.');
  }
  const [existingAccounts, existingCategories, existingExpenses] = await Promise.all([
    repository.query({ type: 'accounts', includeDeleted: true }),
    repository.query({ type: 'categories', includeDeleted: true }),
    repository.query({ type: 'expenses', includeDeleted: true }),
  ]);
  const known = new Set([
    ...existingAccounts.map((entity) => `accounts:${entity.id}`),
    ...existingCategories.map((entity) => `categories:${entity.id}`),
    ...existingExpenses.map((entity) => `transactions:${entity.id}`),
  ]);
  const added = { accounts: 0, categories: 0, expenses: 0 };
  const seedOpId = (id) => `op_seed_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

  for (const account of seed.accounts) {
    if (known.has(`accounts:${account.id}`)) continue;
    await repository.dispatch(createAccountCommand(
      { name: account.name, kind: account.kind, currency: account.currency },
      { opId: seedOpId(account.id), entityId: account.id },
    ));
    added.accounts += 1;
  }
  for (const category of seed.categories) {
    if (known.has(`categories:${category.id}`)) continue;
    await repository.dispatch(createCategoryCommand(
      {
        name: category.name,
        iconId: category.iconId,
        color: category.color,
        sortOrder: category.sortOrder ?? 0,
        system: category.system ?? false,
      },
      { opId: seedOpId(category.id), entityId: category.id },
    ));
    added.categories += 1;
  }
  for (const expense of seed.expenses) {
    if (known.has(`transactions:${expense.id}`)) continue;
    await repository.dispatch(recordExpenseCommand(
      {
        date: expense.date,
        accountId: expense.accountId,
        categoryId: expense.categoryId,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        note: expense.note ?? '',
      },
      { opId: seedOpId(expense.id), entityId: expense.id },
    ));
    added.expenses += 1;
  }

  const pendingCount = await repository.query({ type: 'pending-count' });
  return { added, pendingCount };
}
