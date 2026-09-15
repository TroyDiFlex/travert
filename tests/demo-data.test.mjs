import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateData } from '../model.js';
import { LocalIncomeApi, seedLocalIncome } from '../local-income.js';
import { buildExpenseBackfill, buildIncomeSeed, buildTransferBackfill } from '../scripts/gen-demo-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const financeSeed = JSON.parse(readFileSync(join(root, 'finance', 'demo-seed.json'), 'utf8'));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

test('income demo covers two full years and validates', () => {
  const first = buildIncomeSeed();
  assert.deepEqual(first, buildIncomeSeed(), 'генератор обязан быть детерминированным');
  validateData({ sources: first.sources, entries: first.entries });
  assert.equal(first.sources.length, 6);
  const months = [...new Set(first.entries.map((e) => e.month))].sort();
  assert.equal(months[0], '2024-10');
  assert.equal(months.at(-1), '2026-09');
  assert.ok(months.length >= 23, 'два года помесячно');
  assert.ok(first.entries.length > 90);
  assert.ok(first.entries.some((e) => e.amount === 0), 'есть явный нулевой месяц для проверки семантики 0 ≠ пропуск');
  const onDisk = JSON.parse(readFileSync(join(root, 'income-demo-seed.json'), 'utf8'));
  assert.deepEqual(onDisk, first, 'файл обязан совпадать с генератором');
});

test('expense backfill respects accounts, currencies and date window', () => {
  const backfill = buildExpenseBackfill(financeSeed.accounts, financeSeed.categories);
  assert.deepEqual(backfill, buildExpenseBackfill(financeSeed.accounts, financeSeed.categories));
  assert.ok(backfill.length > 150, 'плотность для графиков за два года');
  const accounts = new Map(financeSeed.accounts.map((a) => [a.id, a]));
  for (const e of backfill) {
    assert.equal(e.currency, accounts.get(e.accountId).currency);
    assert.ok(e.date >= '2024-10-01' && e.date < '2026-07-01');
    assert.ok(e.amountMinor > 0);
  }
  const transfers = buildTransferBackfill();
  assert.ok(transfers.length >= 20);
  for (const t of transfers) {
    assert.notEqual(t.fromAccountId, t.toAccountId);
    assert.equal(t.currency, 'RUB');
  }
});

test('income seed fills empty storage once and never overwrites', async () => {
  const api = new LocalIncomeApi({ storage: memoryStorage() });
  assert.equal(seedLocalIncome(api, buildIncomeSeed()), 'seeded');
  const data = await api.read();
  assert.equal(data.sources.length, 6);
  assert.ok(data.entries.length > 90);
  assert.equal(seedLocalIncome(api, buildIncomeSeed()), 'skipped');
  assert.throws(() => seedLocalIncome(api, { sources: [], entries: 'junk' }), /Некорректный сид/);
});
