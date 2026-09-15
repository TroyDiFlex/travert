import test from 'node:test';
import assert from 'node:assert/strict';

import {LocalIncomeApi} from '../local-income.js';
import {parseBackup, verifyBackupChecksum} from '../data-transfer.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    peek: (key) => map.get(key),
  };
}

async function mutateOk(api, operation) {
  const current = await api.read();
  return api.mutate(current.revision, operation);
}

test('local income works without password: sources, entries, revision guard', async () => {
  const api = new LocalIncomeApi({storage: memoryStorage()});
  const empty = await api.login();
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(empty.entries, []);

  const afterSource = await mutateOk(api, {type: 'setSource', source: {id: 's1', name: 'Фриланс', color: '#a78bfa', active: true, order: 0}});
  assert.equal(afterSource.sources.length, 1);

  const afterEntries = await mutateOk(api, {type: 'setEntries', entries: [{sourceId: 's1', month: '2026-09', amount: 150000}]});
  assert.equal(afterEntries.entries.length, 1);
  assert.equal(afterEntries.entries[0].amount, 150000);

  await assert.rejects(api.mutate('stale-revision', {type: 'setEntries', entries: []}), /Обновить/);

  const removed = await mutateOk(api, {type: 'setEntries', entries: [{sourceId: 's1', month: '2026-09', amount: null}]});
  assert.equal(removed.entries.length, 0);
});

test('trash keeps 30 days, restores, then deletes forever with expiry purge', async () => {
  const storage = memoryStorage();
  const api = new LocalIncomeApi({storage});
  await mutateOk(api, {type: 'setSource', source: {id: 's1', name: 'Фриланс', color: '#a78bfa', active: true, order: 0}});
  await mutateOk(api, {type: 'setEntries', entries: [{sourceId: 's1', month: '2026-09', amount: 100}]});

  const trashed = await mutateOk(api, {type: 'trashSource', sourceId: 's1'});
  assert.equal(trashed.sources.length, 0);
  assert.equal(trashed.trash.length, 1);
  assert.equal(trashed.trash[0].entryCount, 1);

  const restored = await mutateOk(api, {type: 'restoreSource', sourceId: 's1'});
  assert.equal(restored.sources.length, 1);
  assert.equal(restored.entries.length, 1);

  await mutateOk(api, {type: 'trashSource', sourceId: 's1'});
  const deleted = await mutateOk(api, {type: 'deleteSource', sourceId: 's1'});
  assert.equal(deleted.trash.length, 0);

  await mutateOk(api, {type: 'setSource', source: {id: 's2', name: 'Работа', color: '#5ed9bc', active: true, order: 1}});
  await mutateOk(api, {type: 'trashSource', sourceId: 's2'});
  const raw = JSON.parse(storage.peek('travert-income-v1'));
  raw.sources.find((s) => s.id === 's2').deletedAt = Date.now() - 31 * 86400000;
  storage.setItem('travert-income-v1', JSON.stringify(raw));
  const reread = await api.read();
  assert.equal(reread.trash.length, 0);
  assert.equal(reread.sources.length, 0);
});

test('backup envelope passes client-side backup checks and restores', async () => {
  const api = new LocalIncomeApi({storage: memoryStorage()});
  await mutateOk(api, {type: 'setSource', source: {id: 's1', name: 'Фриланс', color: '#a78bfa', active: true, order: 0}});
  await mutateOk(api, {type: 'setEntries', entries: [{sourceId: 's1', month: '2026-09', amount: 777}]});

  const backup = await api.backup();
  const parsed = parseBackup(JSON.stringify(backup));
  await verifyBackupChecksum(parsed);

  const fresh = new LocalIncomeApi({storage: memoryStorage()});
  const restored = await mutateOk(fresh, {type: 'restoreBackup', backup});
  assert.equal(restored.sources.length, 1);
  assert.equal(restored.entries[0].amount, 777);

  const tampered = new LocalIncomeApi({storage: memoryStorage()});
  const tamperedRevision = (await tampered.read()).revision;
  await assert.rejects(
    tampered.mutate(tamperedRevision, {type: 'restoreBackup', backup: {...backup, checksum: '0'.repeat(64)}}),
    /Контрольная сумма/,
  );
});

test('drive backups report local-mode limitation instead of hanging', async () => {
  const api = new LocalIncomeApi({storage: memoryStorage()});
  await assert.rejects(api.createBackup(), /локальном режиме/);
  await assert.rejects(api.backupMaintenance(), /локальном режиме/);
});
