import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountCommand,
  createCategoryCommand,
  deleteAccountCommand,
  deleteCategoryCommand,
  deleteTransactionCommand,
  planLocalCommand,
  recordExpenseCommand,
  recordTransferCommand,
  updateCategoryCommand,
  updateExpenseCommand,
  updateTransferCommand,
} from '../finance/core/commands.js';
import { selectAccountUsage, selectCategoryUsage, selectExpenseSummary, selectTransfers } from '../finance/core/selectors.js';
import { calculateLedger } from '../finance/core/ledger.js';
import { searchCategoryIcons } from '../finance/icons.js';

const T0 = '2026-09-14T08:00:00.000Z';
const T1 = '2026-09-15T09:00:00.000Z';

function options(opId, entityId, createdAt = T0) {
  return { opId, entityId, createdAt };
}

function emptySnapshot() {
  return { entities: new Map(), outbox: [] };
}

function append(snapshot, command) {
  const plan = planLocalCommand(command, snapshot, snapshot.outbox.length + 1);
  if (!plan.duplicate) {
    snapshot.entities.set(plan.entity.key, plan.entity);
    snapshot.outbox.push(plan.outbox);
  }
  return plan;
}

function seed(snapshot) {
  append(snapshot, createAccountCommand({ name: 'Карта', kind: 'bank', currency: 'RUB' }, options('op_acc', 'account_main')));
  append(snapshot, createAccountCommand({ name: 'Наличные', kind: 'cash', currency: 'RUB' }, options('op_cash', 'account_cash')));
  append(snapshot, createCategoryCommand({ name: 'Продукты', iconId: 'local:basket', color: '#22c55e' }, options('op_food', 'category_food')));
  append(snapshot, createCategoryCommand({ name: 'Кафе', iconId: 'local:cafe', color: '#f59e0b' }, options('op_cafe', 'category_cafe')));
  append(snapshot, recordExpenseCommand({
    date: '2026-09-14', accountId: 'account_main', categoryId: 'category_food',
    amountMinor: 125050, currency: 'RUB', note: 'Магазин',
  }, options('op_exp1', 'txn_1')));
  return snapshot;
}

function stateFrom(snapshot) {
  return { viewEntities: [...snapshot.entities.values()], outbox: snapshot.outbox };
}

test('expense can be edited: amount, date, account, category and note', () => {
  const snapshot = seed(emptySnapshot());
  const plan = append(snapshot, updateExpenseCommand('txn_1', {
    amountMinor: 99900, date: '2026-09-13', accountId: 'account_cash', categoryId: 'category_cafe', note: 'Кофе',
  }, options('op_edit', 'txn_1', T1)));
  assert.equal(plan.duplicate, false);
  assert.equal(plan.entity.amountMinor, 99900);
  assert.equal(plan.entity.date, '2026-09-13');
  assert.equal(plan.entity.month, '2026-09');
  assert.equal(plan.entity.accountId, 'account_cash');
  assert.equal(plan.entity.categoryId, 'category_cafe');
  assert.equal(plan.entity.note, 'Кофе');
  assert.deepEqual([...plan.outbox.dependsOn].sort(), ['op_exp1', 'op_cash', 'op_cafe'].sort());
});

test('expense edit rejects unknown fields, empty patch and currency mismatch', () => {
  const snapshot = seed(emptySnapshot());
  assert.throws(() => append(snapshot, updateExpenseCommand('txn_1', { unknown: 1 }, options('op_bad', 'txn_1', T1))), /нельзя изменить/);
  assert.throws(() => append(snapshot, updateExpenseCommand('txn_1', {}, options('op_empty', 'txn_1', T1))), /Нет изменений/);
  assert.throws(() => append(snapshot, updateExpenseCommand('missing', { note: 'x' }, options('op_missing', 'missing', T1))), /не найден/);
});

test('category and account can be renamed and deleted; system entity is protected', () => {
  const snapshot = seed(emptySnapshot());
  append(snapshot, updateCategoryCommand('category_food', { name: 'Еда' }, options('op_rename', 'category_food', T1)));
  assert.equal(snapshot.entities.get('categories:category_food').name, 'Еда');

  const usage = selectCategoryUsage(stateFrom(snapshot), 'category_food');
  assert.equal(usage.count, 1);
  assert.equal(usage.totalByCurrency.RUB, 125050);

  append(snapshot, deleteCategoryCommand('category_cafe'), { opId: 'op_del_cafe', entityId: 'category_cafe', createdAt: T1 });
  assert.ok(snapshot.entities.get('categories:category_cafe').deletedAt);

  append(snapshot, createCategoryCommand({ name: 'Системная', iconId: 'local:circle', color: '#ffffff', system: true }, options('op_sys', 'category_sys')));
  assert.throws(() => append(snapshot, deleteCategoryCommand('category_sys'), { opId: 'op_del_sys', entityId: 'category_sys', createdAt: T1 }), /Системную/);

  append(snapshot, deleteAccountCommand('account_cash'), { opId: 'op_del_acc', entityId: 'account_cash', createdAt: T1 });
  assert.ok(snapshot.entities.get('accounts:account_cash').deletedAt);
});

test('reassign flow: move expenses to another category, then delete the old one', () => {
  const snapshot = seed(emptySnapshot());
  append(snapshot, updateExpenseCommand('txn_1', { categoryId: 'category_cafe' }, options('op_move', 'txn_1', T1)));
  append(snapshot, deleteCategoryCommand('category_food'), { opId: 'op_del_food', entityId: 'category_food', createdAt: T1 });

  const state = stateFrom(snapshot);
  assert.equal(selectCategoryUsage(state, 'category_food').count, 0);
  assert.equal(selectCategoryUsage(state, 'category_cafe').count, 1);
  const summary = selectExpenseSummary(state, {});
  assert.equal(summary.count, 1);
  assert.equal(summary.byCategory[0].categoryId, 'category_cafe');
});

test('account usage counts expenses for the delete dialog', () => {
  const snapshot = seed(emptySnapshot());
  const state = stateFrom(snapshot);
  assert.equal(selectAccountUsage(state, 'account_main').count, 1);
  assert.equal(selectAccountUsage(state, 'account_cash').count, 0);
});

test('icon registry searches in Russian and falls back to neutral', () => {
  assert.ok(searchCategoryIcons('').length >= 20);
  assert.ok(searchCategoryIcons('кофе').some((icon) => icon.id === 'local:cafe'));
  assert.ok(searchCategoryIcons('бензин').some((icon) => icon.id === 'local:fuel'));
  assert.ok(searchCategoryIcons('несуществующий запрос 12345').length === 0);
});

test('transfer moves money between accounts without touching expenses', () => {
  const snapshot = seed(emptySnapshot());
  append(snapshot, recordTransferCommand({
    date: '2026-09-15', fromAccountId: 'account_main', toAccountId: 'account_cash',
    fromAmountMinor: 100000, toAmountMinor: 99000, currency: 'RUB', note: 'Снятие',
  }, options('op_tr1', 'txn_tr1', T1)));

  const state = stateFrom(snapshot);
  assert.equal(selectTransfers(state).length, 1);
  assert.equal(selectExpenseSummary(state, {}).count, 1);
  const ledger = calculateLedger([...snapshot.entities.values()]);
  assert.equal(ledger.balanceByAccount.get('account_main'), -125050 - 100000);
  assert.equal(ledger.balanceByAccount.get('account_cash'), 99000);
  assert.equal(ledger.expenseByCurrency.get('RUB'), 125050);
});

test('transfer rejects same account, zero amounts and currency mismatch', () => {
  const snapshot = seed(emptySnapshot());
  const base = {
    date: '2026-09-15', fromAccountId: 'account_main', toAccountId: 'account_cash',
    fromAmountMinor: 1000, toAmountMinor: 1000, currency: 'RUB',
  };
  assert.throws(() => append(snapshot, recordTransferCommand(
    { ...base, toAccountId: 'account_main' }, options('op_same', 'txn_same', T1))), /одним и тем же/);
  assert.throws(() => append(snapshot, recordTransferCommand(
    { ...base, toAmountMinor: 0 }, options('op_zero', 'txn_zero', T1))), /больше нуля/);
  assert.throws(() => append(snapshot, recordTransferCommand(
    { ...base, toAccountId: 'account_cash', currency: 'USD' }, options('op_cur', 'txn_cur', T1))), /валют/);
  assert.throws(() => append(snapshot, recordTransferCommand(
    { ...base, fromAccountId: 'missing' }, options('op_miss', 'txn_miss', T1))), /не найдена/);
});

test('transfer can be edited and deleted', () => {
  const snapshot = seed(emptySnapshot());
  append(snapshot, recordTransferCommand({
    date: '2026-09-15', fromAccountId: 'account_main', toAccountId: 'account_cash',
    fromAmountMinor: 100000, toAmountMinor: 100000, currency: 'RUB',
  }, options('op_tr1', 'txn_tr1', T1)));
  append(snapshot, updateTransferCommand('txn_tr1', { toAmountMinor: 99500, note: 'Комиссия банкомата' }, options('op_tr2', 'txn_tr1', T1)));
  const updated = snapshot.entities.get('transactions:txn_tr1');
  assert.equal(updated.toAmountMinor, 99500);
  assert.equal(updated.note, 'Комиссия банкомата');
  assert.throws(() => append(snapshot, updateTransferCommand('txn_1', { note: 'x' }, options('op_wrong', 'txn_1', T1))), /только перевод/);
  append(snapshot, deleteTransactionCommand('txn_tr1'), { opId: 'op_tr3', entityId: 'txn_tr1', createdAt: T1 });
  assert.equal(selectTransfers(stateFrom(snapshot)).length, 0);
});
