import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FinanceRepository } from '../finance/repository.js';
import { normalizeLocalIdentity, localDatabaseName } from '../finance/local/db.js';
import { seedDemoData } from '../finance/local/seed.js';
import { CATEGORY_ICONS } from '../finance/icons.js';

const root = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(root, '..', 'finance', 'demo-seed.json'), 'utf8'));
const IDENTITY = { backendId: 'local', uid: 'seed-user', bookId: 'main', epoch: 'epoch-1' };

function createMemoryFactory() {
  const databases = new Map();
  return {
    async open(identityInput) {
      const identity = normalizeLocalIdentity(identityInput);
      const name = localDatabaseName(identity);
      if (!databases.has(name)) {
        databases.set(name, {
          viewEntities: [], serverEntities: [], outbox: [], conflicts: [],
          meta: { identity, localSequence: 0, cursor: 0, activeEpoch: identity.epoch },
        });
      }
      const backing = databases.get(name);
      return {
        identity,
        async readState() { return structuredClone(backing); },
        async commitCommand(command, planner) {
          const working = structuredClone(backing);
          const plan = planner(command, {
            entities: new Map(working.viewEntities.map((entity) => [entity.key, entity])),
            outbox: working.outbox,
          }, working.meta.localSequence + 1);
          if (!plan.duplicate) {
            const index = working.viewEntities.findIndex((entity) => entity.key === plan.entity.key);
            if (index === -1) working.viewEntities.push(structuredClone(plan.entity));
            else working.viewEntities[index] = structuredClone(plan.entity);
            working.outbox.push(structuredClone(plan.outbox));
            working.meta.localSequence += 1;
          }
          Object.assign(backing, working);
          return structuredClone(plan);
        },
        async exportRecovery() {
          return { format: 'travert-local-recovery', version: 1, identity, stores: structuredClone(backing) };
        },
        close() {},
      };
    },
  };
}

test('demo seed file is internally consistent', () => {
  assert.ok(CATEGORY_ICONS.length >= 150, 'каталог должен содержать минимум 150 локальных иконок');
  const iconIds = new Set(CATEGORY_ICONS.map((icon) => icon.id));
  const accounts = new Map(seed.accounts.map((account) => [account.id, account]));
  const categories = new Set(seed.categories.map((category) => category.id));
  for (const category of seed.categories) {
    assert.ok(iconIds.has(category.iconId), `неизвестная иконка: ${category.iconId}`);
  }
  assert.ok(categories.has('category_uncategorized'), 'нужна системная категория «Без категории»');
  for (const expense of seed.expenses) {
    const account = accounts.get(expense.accountId);
    assert.ok(account, `неизвестный счёт: ${expense.accountId}`);
    assert.ok(categories.has(expense.categoryId), `неизвестная категория: ${expense.categoryId}`);
    assert.equal(expense.currency, account.currency, 'валюта расхода обязана совпадать со счётом');
    assert.ok(Number.isSafeInteger(expense.amountMinor) && expense.amountMinor > 0, 'сумма должна быть положительной');
  }
  for (const transfer of seed.transfers ?? []) {
    const from = accounts.get(transfer.fromAccountId);
    const to = accounts.get(transfer.toAccountId);
    assert.ok(from && to, 'перевод ссылается на известные счета');
    assert.notEqual(transfer.fromAccountId, transfer.toAccountId, 'перевод не может быть внутри одного счёта');
    assert.equal(transfer.currency, from.currency, 'валюта перевода совпадает со счётом списания');
    assert.equal(transfer.currency, to.currency, 'валюта перевода совпадает со счётом зачисления');
    assert.ok(transfer.fromAmountMinor > 0 && transfer.toAmountMinor > 0, 'обе суммы перевода положительные');
  }
});

test('seed loads demo data once and is idempotent on rerun', async () => {
  const repository = new FinanceRepository({ openLocalStore: createMemoryFactory().open });
  await repository.open(IDENTITY);

  const first = await seedDemoData(repository, seed);
  assert.deepEqual(first.added, {
    accounts: seed.accounts.length,
    categories: seed.categories.length,
    expenses: seed.expenses.length,
    transfers: (seed.transfers ?? []).length,
  });

  const expenses = await repository.query({ type: 'expenses' });
  assert.equal(expenses.length, seed.expenses.length);
  const transfers = await repository.query({ type: 'transfers' });
  assert.equal(transfers.length, (seed.transfers ?? []).length);
  const summary = await repository.query({ type: 'expense-summary' });
  assert.equal(summary.count, seed.expenses.length);
  assert.ok(Object.keys(summary.totalByCurrency).length >= 2, 'демо должно покрывать несколько валют');

  const second = await seedDemoData(repository, seed);
  assert.deepEqual(second.added, { accounts: 0, categories: 0, expenses: 0, transfers: 0 });
  assert.equal(second.pendingCount, first.pendingCount);
  assert.equal((await repository.query({ type: 'expenses' })).length, seed.expenses.length);
});
