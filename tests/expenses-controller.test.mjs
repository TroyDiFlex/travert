import test from 'node:test';
import assert from 'node:assert/strict';

import { ExpensesController, SEED_ACCOUNT_ID, UNCATEGORIZED_ID } from '../finance/controller.js';
import { normalizeLocalIdentity } from '../finance/local/db.js';

const IDENTITY = { backendId: 'local', uid: 'controller-test', bookId: 'main', epoch: 'local-epoch' };

function createMemoryFactory() {
  const databases = new Map();
  return {
    async open(identityInput) {
      const identity = normalizeLocalIdentity(identityInput);
      const name = `${identity.backendId}:${identity.uid}:${identity.bookId}`;
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

async function openController() {
  const { FinanceRepository } = await import('../finance/repository.js');
  const memory = createMemoryFactory();
  const controller = new ExpensesController({
    repository: new FinanceRepository({ openLocalStore: memory.open }),
  });
  await controller.open(IDENTITY);
  return controller;
}

test('первое открытие создает счет и системную категорию, повторное не дублирует', async () => {
  const controller = await openController();
  await controller.ensureSeed();
  const accounts = await controller.listAccounts();
  const categories = await controller.listCategories();
  assert.equal(accounts.filter((item) => item.id === SEED_ACCOUNT_ID).length, 1);
  assert.equal(categories.filter((item) => item.id === UNCATEGORIZED_ID).length, 1);
  assert.equal(await controller.pendingCount(), 2);
});

test('расход сохраняется через текст суммы и виден в списке', async () => {
  const controller = await openController();
  const acknowledgement = await controller.saveExpense({
    date: '2026-10-02',
    amountText: '1 250,50',
    accountId: SEED_ACCOUNT_ID,
    categoryId: UNCATEGORIZED_ID,
    note: 'Проверка',
  });
  assert.equal(acknowledgement.status, 'saved-local');
  const expenses = await controller.listExpenses();
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].amountMinor, 125050);
  assert.equal(expenses[0].month, '2026-10');
  assert.equal(controller.formatAmount(125050, 'RUB'), '1 250,50 ₽');
});

test('некорректный ввод отклоняется до записи', async () => {
  const controller = await openController();
  await assert.rejects(controller.saveExpense({
    date: '2026-10-02', amountText: '0', accountId: SEED_ACCOUNT_ID,
  }), /больше нуля/);
  await assert.rejects(controller.saveExpense({
    date: '2026-13-40', amountText: '100', accountId: SEED_ACCOUNT_ID,
  }), /Дата|даты/);
  await assert.rejects(controller.saveExpense({
    date: '2026-10-02', amountText: '100', accountId: 'account_missing',
  }), /сч[её]т/);
  await assert.rejects(controller.saveExpense({
    date: '2026-10-02', amountText: 'сумма', accountId: SEED_ACCOUNT_ID,
  }), /сумм/i);
  assert.equal(await controller.listExpenses().then((items) => items.length), 0);
});

test('категория с неизвестной иконкой получает нейтральную', async () => {
  const controller = await openController();
  const acknowledgement = await controller.createCategory({ name: 'Тест', iconId: 'local:nope', color: '#ff0000' });
  assert.equal(acknowledgement.entity.iconId, 'local:circle');
  const categories = await controller.listCategories();
  assert.ok(categories.some((item) => item.name === 'Тест'));
});

test('расход удаляется и очередь растет честно', async () => {
  const controller = await openController();
  const acknowledgement = await controller.saveExpense({
    date: '2026-10-03', amountText: '500', accountId: SEED_ACCOUNT_ID,
  });
  const before = await controller.pendingCount();
  await controller.deleteExpense(acknowledgement.entity.id);
  assert.equal(await controller.listExpenses().then((items) => items.length), 0);
  assert.equal(await controller.pendingCount(), before + 1);
});
