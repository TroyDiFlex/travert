import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryTotals,
  formatMonthShort,
  lastMonths,
  monthlyTotals,
  pickDisplayCurrency,
  totalsByCurrency,
} from '../finance/stats.js';

const EXPENSES = [
  { month: '2026-08', currency: 'RUB', categoryId: 'food', amountMinor: 10000 },
  { month: '2026-09', currency: 'RUB', categoryId: 'food', amountMinor: 20000 },
  { month: '2026-09', currency: 'RUB', categoryId: 'bus', amountMinor: 5000 },
  { month: '2026-09', currency: 'USD', categoryId: 'food', amountMinor: 100 },
];

test('месячные итоги идут подряд и не смешивают валюты', () => {
  assert.deepEqual(lastMonths(3, new Date(2026, 8, 15)), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(lastMonths(2, new Date(2026, 0, 1)), ['2025-12', '2026-01']);
  const series = monthlyTotals(EXPENSES, ['2026-07', '2026-08', '2026-09'], 'RUB');
  assert.deepEqual(series.map((point) => point.totalMinor), [0, 10000, 25000]);
});

test('категории месяца сортируются по убыванию трат', () => {
  const shares = categoryTotals(EXPENSES, { month: '2026-09', currency: 'RUB' });
  assert.deepEqual(shares, [
    { categoryId: 'food', totalMinor: 20000 },
    { categoryId: 'bus', totalMinor: 5000 },
  ]);
});

test('валюта витрины и подписи месяцев честные', () => {
  assert.equal(pickDisplayCurrency(EXPENSES), 'RUB');
  assert.equal(pickDisplayCurrency(EXPENSES.filter((item) => item.currency === 'USD')), 'USD');
  assert.equal(pickDisplayCurrency([]), 'RUB');
  assert.deepEqual(totalsByCurrency(EXPENSES), { RUB: 35000, USD: 100 });
  assert.match(formatMonthShort('2026-09'), /сен/);
});
