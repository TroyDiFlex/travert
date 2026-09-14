import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountCommand,
  createCategoryCommand,
  recordExpenseCommand,
  updateAccountCommand,
} from '../finance/core/commands.js';
import { toEntityMap } from '../finance/core/entities.js';
import { materializeProjection } from '../finance/local/projection.js';
import { FinanceRepository } from '../finance/repository.js';
import { SyncConflictError, SyncEpochError } from '../finance/sync/conflicts.js';
import { SyncEngine } from '../finance/sync/engine.js';
import { canonicalJson, freezeOutboxRequest, sha256, verifyFrozenRequest } from '../finance/sync/protocol.js';

const IDENTITY = { projectId: 'demo', uid: 'user-a', bookId: 'main', epoch: 'epoch-1' };
const T0 = '2026-09-14T08:00:00.000Z';

function options(opId, entityId, createdAt = T0) {
  return { opId, entityId, createdAt };
}

class MemoryLocalStore {
  constructor(identity) {
    this.identity = structuredClone(identity);
    this.state = {
      serverEntities: [], viewEntities: [], outbox: [], conflicts: [],
      meta: { identity, localSequence: 0, cursor: 0, activeEpoch: identity.epoch, lastConfirmedSyncAt: null },
    };
  }

  async readState() { return structuredClone(this.state); }

  async commitCommand(command, planner) {
    const plan = planner(command, {
      entities: toEntityMap(this.state.viewEntities),
      outbox: this.state.outbox,
    }, this.state.meta.localSequence + 1);
    if (!plan.duplicate) {
      const index = this.state.viewEntities.findIndex((entity) => entity.key === plan.entity.key);
      if (index < 0) this.state.viewEntities.push(structuredClone(plan.entity));
      else this.state.viewEntities[index] = structuredClone(plan.entity);
      this.state.outbox.push(structuredClone(plan.outbox));
      this.state.meta.localSequence += 1;
    }
    return structuredClone(plan);
  }

  async getOutbox(opId) {
    return structuredClone(this.state.outbox.find((item) => item.opId === opId) ?? null);
  }

  async updateOutbox(opId, updater) {
    const index = this.state.outbox.findIndex((item) => item.opId === opId);
    if (index < 0) throw new Error('missing outbox item');
    this.state.outbox[index] = structuredClone(updater(structuredClone(this.state.outbox[index])));
    return structuredClone(this.state.outbox[index]);
  }

  async recordConflict(conflict) {
    const index = this.state.outbox.findIndex((item) => item.opId === conflict.opId);
    this.state.outbox[index] = { ...this.state.outbox[index], state: 'conflict', conflictId: conflict.conflictId };
    this.state.conflicts.push(structuredClone(conflict));
  }

  async applyRemotePage(page, confirmedAt) {
    const server = toEntityMap(this.state.serverEntities);
    const confirmed = new Set();
    for (const commit of page.commits) {
      assert.equal(commit.seq, this.state.meta.cursor + 1);
      this.state.meta.cursor = commit.seq;
      confirmed.add(commit.opId);
      for (const change of commit.changes) server.set(change.value.key, structuredClone(change.value));
    }
    this.state.serverEntities = [...server.values()];
    this.state.outbox = this.state.outbox.filter((item) => !confirmed.has(item.opId));
    this.state.viewEntities = materializeProjection(this.state.serverEntities, this.state.outbox);
    this.state.meta.lastConfirmedSyncAt = confirmedAt;
  }

  async exportRecovery() { return structuredClone(this.state); }
  close() {}
}

class MemoryRemote {
  constructor() {
    this.books = new Map();
    this.loseAfterCommit = new Set();
    this.lost = new Set();
  }

  key(identity) { return `${identity.uid}:${identity.bookId}`; }

  book(identity) {
    const key = this.key(identity);
    if (!this.books.has(key)) {
      this.books.set(key, { epoch: identity.epoch, headSeq: 0, entities: new Map(), commits: [], receipts: new Map() });
    }
    return this.books.get(key);
  }

  async pull({ identity, epoch, afterSeq, limit }) {
    const book = this.book(identity);
    if (book.epoch !== epoch) throw new SyncEpochError(epoch, book.epoch);
    return {
      epoch,
      headSeq: book.headSeq,
      commits: structuredClone(book.commits.filter((commit) => commit.seq > afterSeq).slice(0, limit)),
    };
  }

  async commit({ identity, request }) {
    const book = this.book(identity);
    if (book.epoch !== request.epoch) throw new SyncEpochError(request.epoch, book.epoch);
    const prior = book.receipts.get(request.opId);
    if (prior) {
      if (prior.payloadHash !== request.payloadHash) throw new Error('opId hash collision');
      return structuredClone(prior);
    }

    const serverChanges = [];
    for (const change of request.changes) {
      const current = book.entities.get(`${change.entityType}:${change.id}`) ?? null;
      if ((current?.version ?? 0) !== change.expectedVersion) {
        throw new SyncConflictError('Версия записи изменилась на сервере.', { server: current });
      }
      const value = {
        ...structuredClone(change.value),
        version: change.expectedVersion + 1,
        updatedAt: `2026-09-14T08:00:${String(book.headSeq + 1).padStart(2, '0')}.000Z`,
        lastOpId: request.opId,
      };
      serverChanges.push({ ...structuredClone(change), value });
    }

    book.headSeq += 1;
    for (const change of serverChanges) book.entities.set(change.value.key, change.value);
    const commit = { seq: book.headSeq, opId: request.opId, changes: serverChanges };
    book.commits.push(commit);
    const receipt = {
      opId: request.opId,
      payloadHash: request.payloadHash,
      seq: book.headSeq,
      results: serverChanges.map((change) => ({ id: change.id, version: change.value.version })),
    };
    book.receipts.set(request.opId, receipt);
    if (this.loseAfterCommit.has(request.opId) && !this.lost.has(request.opId)) {
      this.lost.add(request.opId);
      throw new Error('synthetic lost response');
    }
    return structuredClone(receipt);
  }

  externalUpdate(identity, entityType, id, patch, opId) {
    const book = this.book(identity);
    const current = book.entities.get(`${entityType}:${id}`);
    const value = { ...current, ...patch, version: current.version + 1, lastOpId: opId };
    book.headSeq += 1;
    book.entities.set(value.key, value);
    book.commits.push({
      seq: book.headSeq,
      opId,
      changes: [{ entityType, id, action: 'update', expectedVersion: current.version, value }],
    });
  }
}

async function setup() {
  const local = new MemoryLocalStore(IDENTITY);
  const repository = new FinanceRepository({ openLocalStore: async () => local });
  await repository.open(IDENTITY);
  const remote = new MemoryRemote();
  const engine = new SyncEngine({ localStore: local, remote, identity: IDENTITY, deviceId: 'device_a' });
  return { local, repository, remote, engine };
}

test('canonical payload hash is stable and covers nested values', async () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(await sha256({ b: 2, a: 1 }), await sha256({ a: 1, b: 2 }));
  assert.notEqual(await sha256({ a: 1 }), await sha256({ a: 2 }));
  const request = await freezeOutboxRequest(IDENTITY, 'device_a', {
    opId: 'op_hash', dependsOn: [], change: { entityType: 'accounts', id: 'account_hash', expectedVersion: 0, action: 'create', value: {} },
  });
  assert.equal(await verifyFrozenRequest(request), true);
  assert.equal('token' in request, false);
});

test('dependent local commands synchronize in order and leave one confirmed expense', async () => {
  const { local, repository, remote, engine } = await setup();
  await repository.dispatch(createAccountCommand(
    { name: 'Карта', kind: 'bank', currency: 'RUB' }, options('op_account', 'account_main'),
  ));
  await repository.dispatch(createCategoryCommand(
    { name: 'Еда', iconId: 'local:food', color: '#16a34a' }, options('op_category', 'category_food'),
  ));
  await repository.dispatch(recordExpenseCommand({
    date: '2026-09-14', accountId: 'account_main', categoryId: 'category_food', amountMinor: 50000, currency: 'RUB',
  }, options('op_expense', 'txn_food')));

  const status = await engine.syncNow();
  const state = await local.readState();
  const book = remote.book(IDENTITY);
  assert.equal(status.phase, 'synced');
  assert.equal(state.outbox.length, 0);
  assert.equal(state.meta.cursor, 3);
  assert.equal(book.receipts.size, 3);
  assert.equal([...book.entities.values()].filter((entity) => entity.entityType === 'transactions').length, 1);
  assert.ok(state.serverEntities.every((entity) => entity.version === 1));
});

test('a lost response keeps one server effect and is recovered by pull', async () => {
  const { local, repository, remote, engine } = await setup();
  remote.loseAfterCommit.add('op_lost');
  await repository.dispatch(createAccountCommand(
    { name: 'Наличные', kind: 'cash', currency: 'RUB' }, options('op_lost', 'account_cash'),
  ));

  assert.equal((await engine.syncNow()).phase, 'offline');
  assert.equal((await local.getOutbox('op_lost')).state, 'unknown');
  assert.equal(remote.book(IDENTITY).commits.length, 1);

  assert.equal((await engine.syncNow()).phase, 'synced');
  assert.equal((await local.readState()).outbox.length, 0);
  assert.equal(remote.book(IDENTITY).commits.length, 1);
});

test('concurrent edits preserve base, local and server versions as a conflict', async () => {
  const { local, repository, remote, engine } = await setup();
  await repository.dispatch(createAccountCommand(
    { name: 'Карта', kind: 'bank', currency: 'RUB' }, options('op_create', 'account_main'),
  ));
  await engine.syncNow();
  await repository.dispatch(updateAccountCommand(
    'account_main', { name: 'Моя карта' }, options('op_local_edit', 'account_main', '2026-09-14T09:00:00.000Z'),
  ));
  await repository.dispatch(createCategoryCommand(
    { name: 'Независимая', iconId: 'local:circle', color: '#abcdef' },
    options('op_independent', 'category_independent', '2026-09-14T09:01:00.000Z'),
  ));
  remote.externalUpdate(IDENTITY, 'accounts', 'account_main', { name: 'Серверная карта' }, 'op_other_device');

  const status = await engine.syncNow();
  const state = await local.readState();
  assert.equal(status.phase, 'conflict');
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.conflicts[0].base.name, 'Карта');
  assert.equal(state.conflicts[0].local.name, 'Моя карта');
  assert.equal(state.conflicts[0].server.name, 'Серверная карта');
  assert.equal(state.outbox[0].state, 'conflict');
  assert.equal(remote.book(IDENTITY).entities.get('categories:category_independent').name, 'Независимая');
  assert.equal(state.outbox.length, 1);
});

test('remote books are separated by uid', async () => {
  const remote = new MemoryRemote();
  const first = remote.book(IDENTITY);
  const second = remote.book({ ...IDENTITY, uid: 'user-b' });
  assert.notEqual(first, second);
  first.headSeq = 7;
  assert.equal(second.headSeq, 0);
});
