import { addMinorUnits } from './money.js';

function addTo(map, key, delta) {
  map.set(key, addMinorUnits(map.get(key) ?? 0, delta));
}

export function calculateLedger(entities) {
  const active = [...entities].filter((entity) => !entity.deletedAt);
  const accounts = active.filter((entity) => entity.entityType === 'accounts');
  const transactions = active.filter((entity) => entity.entityType === 'transactions');
  const balanceByAccount = new Map(accounts.map((account) => [account.id, 0]));
  const expenseByCurrency = new Map();
  const expenseByCategory = new Map();

  for (const transaction of transactions) {
    if (transaction.kind === 'expense') {
      addTo(balanceByAccount, transaction.accountId, -transaction.amountMinor);
      addTo(expenseByCurrency, transaction.currency, transaction.amountMinor);
      addTo(expenseByCategory, `${transaction.currency}:${transaction.categoryId}`, transaction.amountMinor);
    } else if (transaction.kind === 'transfer') {
      // Перевод не расход и не доход: только движение между счетами.
      addTo(balanceByAccount, transaction.fromAccountId, -transaction.fromAmountMinor);
      addTo(balanceByAccount, transaction.toAccountId, transaction.toAmountMinor);
    }
  }

  return { balanceByAccount, expenseByCurrency, expenseByCategory };
}
