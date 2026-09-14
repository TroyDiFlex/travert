import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountCommand,
  createCategoryCommand,
  recordExpenseCommand,
} from '../finance/core/commands.js';
import { FinanceRepository } from '../finance/repository.js';
import { localDatabaseName, normalizeLocalIdentity } from '../finance/local/db.js';

const T0 = '2026-09-14T08:00:00.000Z';
const IDENTITY = { backendId: 'local', uid: 'demo-user', bookId: 'main', epoch: 'epoch-1' };

function options(opId, entityId) {
  return { opId, entityId, createdAt: T0 };
}

function createMemoryFactory() {
  const databases = new Map();
  return {
    databases,
    async open(identityInput) {
      const identity = normalizeLocalIdentity(identityInput);
      const name = localDatabaseName(identity);
      if (!databases.has(name)) {
        databases.set(name, {
          viewEntities: [], serverEntities: [], outbox: [], conflicts: [],
          meta: { identity, localSequence: 0, cursor: 0, activeEpoch: identity.epoch },
          failNextCommit: false,
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
          if (backing.failNextCommit) {
            backing.failNextCommit = false;
            throw new Error('synthetic storage failure');
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

async function seed(repository) {
  await repository.dispatch(createAccountCommand(
    { name: 'Основная карта', kind: 'bank', currency: 'RUB' },
    options('op_account', 'account_main'),
  ));
  await repository.dispatch(createCategoryCommand(
    { name: 'Продукты', iconId: 'local:basket', color: '#16a34a' },
    options('op_category', 'category_food'),
  ));
  return repository.dispatch(recordExpenseCommand({
    date: '2026-09-14', accountId: 'account_main', categoryId: 'category_food',
    amountMinor: 34990, currency: 'RUB', note: 'Пример',
  }, options('op_expense', 'txn_demo')));
}

test('repository keeps projection and outbox together across reopen', async () => {
  const memory = createMemoryFactory();
  const repository = new FinanceRepository({ openLocalStore: memory.open });
  await repository.open(IDENTITY);
  const acknowledgement = await seed(repository);
  assert.equal(acknowledgement.status, 'saved-local');
  assert.equal(acknowledgement.pendingCount, 3);
  repository.close();

  const reopened = new FinanceRepository({ openLocalStore: memory.open });
  await reopened.open(IDENTITY);
  const expenses = await reopened.query({ type: 'expenses' });
  const pending = await reopened.query({ type: 'pending-count' });
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].amountMinor, 34990);
  assert.equal(pending, 3);

  const recovery = await reopened.exportRecovery();
  assert.equal(recovery.identity.uid, 'demo-user');
  assert.equal(recovery.stores.outbox.length, 3);
});

test('failed commit leaves neither entity nor outbox record', async () => {
  const memory = createMemoryFactory();
  const repository = new FinanceRepository({ openLocalStore: memory.open });
  await repository.open(IDENTITY);
  const backing = memory.databases.get(localDatabaseName(IDENTITY));
  backing.failNextCommit = true;

  await assert.rejects(repository.dispatch(createAccountCommand(
    { name: 'Не сохранится', kind: 'cash', currency: 'RUB' },
    options('op_failure', 'account_failure'),
  )), /synthetic storage failure/);
  assert.equal((await repository.query({ type: 'accounts' })).length, 0);
  assert.equal(await repository.query({ type: 'pending-count' }), 0);
});

test('local database identity separates users and books', () => {
  assert.notEqual(
    localDatabaseName({ ...IDENTITY, uid: 'first' }),
    localDatabaseName({ ...IDENTITY, uid: 'second' }),
  );
  assert.notEqual(
    localDatabaseName({ ...IDENTITY, bookId: 'first' }),
    localDatabaseName({ ...IDENTITY, bookId: 'second' }),
  );
});
