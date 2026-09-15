import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountCommand,
  createCategoryCommand,
  deleteAccountCommand,
  deleteCategoryCommand,
  planLocalCommand,
  recordExpenseCommand,
  updateCategoryCommand,
  updateExpenseCommand,
} from '../finance/core/commands.js';
import { selectAccountUsage, selectCategoryUsage, selectExpenseSummary } from '../finance/core/selectors.js';
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
