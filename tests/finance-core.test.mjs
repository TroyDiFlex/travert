import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountCommand,
  createCategoryCommand,
  planLocalCommand,
  recordExpenseCommand,
} from '../finance/core/commands.js';
import { calculateLedger } from '../finance/core/ledger.js';
import { toEntityMap } from '../finance/core/entities.js';

const T0 = '2026-09-14T08:00:00.000Z';

function options(opId, entityId) {
  return { opId, entityId, createdAt: T0 };
}

function append(snapshot, command) {
  const plan = planLocalCommand(command, snapshot, snapshot.outbox.length + 1);
  snapshot.entities.set(plan.entity.key, plan.entity);
  snapshot.outbox.push(plan.outbox);
  return plan;
}

test('account, category and expense form a validated local command chain', () => {
  const snapshot = { entities: new Map(), outbox: [] };
  const account = append(snapshot, createAccountCommand(
    { name: 'Карта', kind: 'bank', currency: 'RUB' },
    options('op_account', 'account_main'),
  ));
  const category = append(snapshot, createCategoryCommand(
    { name: 'Продукты', iconId: 'local:basket', color: '#22c55e' },
    options('op_category', 'category_food'),
  ));
  const expense = append(snapshot, recordExpenseCommand({
    date: '2026-09-14',
    accountId: account.entity.id,
    categoryId: category.entity.id,
    amountMinor: 125050,
    currency: 'RUB',
    note: 'Магазин',
  }, options('op_expense', 'txn_grocery')));

  assert.deepEqual(expense.outbox.dependsOn.sort(), ['op_account', 'op_category']);
  assert.equal(expense.outbox.frozenRequest, null);
  assert.equal(expense.entity.month, '2026-09');
  assert.equal(expense.entity.amountMinor, 125050);

  const ledger = calculateLedger([...snapshot.entities.values()]);
  assert.equal(ledger.balanceByAccount.get('account_main'), -125050);
  assert.equal(ledger.expenseByCurrency.get('RUB'), 125050);
  assert.equal(ledger.expenseByCategory.get('RUB:category_food'), 125050);
});

test('an expense rejects missing references, zero money and currency mismatch', () => {
  const base = { entities: new Map(), outbox: [] };
  assert.throws(() => append(base, recordExpenseCommand({
    date: '2026-09-14', accountId: 'missing', categoryId: 'missing', amountMinor: 100, currency: 'RUB',
  }, options('op_missing', 'txn_missing'))), /не найдена/);

  const snapshot = { entities: new Map(), outbox: [] };
  append(snapshot, createAccountCommand(
    { name: 'Доллары', kind: 'cash', currency: 'USD' },
    options('op_usd', 'account_usd'),
  ));
  append(snapshot, createCategoryCommand(
    { name: 'Еда', iconId: 'local:food', color: '#abcdef' },
    options('op_food', 'category_food'),
  ));
  assert.throws(() => append(snapshot, recordExpenseCommand({
    date: '2026-09-14', accountId: 'account_usd', categoryId: 'category_food', amountMinor: 100, currency: 'RUB',
  }, options('op_wrong_currency', 'txn_wrong_currency'))), /не совпадает/);
  assert.throws(() => append(snapshot, recordExpenseCommand({
    date: '2026-09-14', accountId: 'account_usd', categoryId: 'category_food', amountMinor: 0, currency: 'USD',
  }, options('op_zero', 'txn_zero'))), /больше нуля/);
});

test('the same opId is idempotent locally but cannot carry another payload', () => {
  const snapshot = { entities: new Map(), outbox: [] };
  const firstCommand = createAccountCommand(
    { name: 'Карта', kind: 'bank', currency: 'RUB' },
    options('op_same', 'account_same'),
  );
  const first = append(snapshot, firstCommand);
  const duplicate = planLocalCommand(firstCommand, snapshot, 2);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.outbox.localSequence, first.outbox.localSequence);

  const collision = createAccountCommand(
    { name: 'Другая карта', kind: 'bank', currency: 'RUB' },
    options('op_same', 'account_same'),
  );
  assert.throws(() => planLocalCommand(collision, snapshot, 2), /разных команд/);
  assert.equal(toEntityMap([...snapshot.entities.values()]).size, 1);
});
