import test from 'node:test';
import assert from 'node:assert/strict';

import { chartGeometry } from '../chart.js';
import { expenseChart, expenseInsights, expenseSourceSeries } from '../finance/expenses-overview.js';

const data = {
  sources: [
    { id: 'food', name: 'Продукты', color: '#16a34a', active: true, order: 0 },
    { id: 'travel', name: 'Путешествия', color: '#0ea5e9', active: true, order: 1 },
  ],
  entries: [
    { month: '2026-01', sourceId: 'food', amount: 10000 },
    { month: '2026-03', sourceId: 'travel', amount: 30000 },
  ],
};

test('expense months inside the book history are zeroes rather than missing observations', () => {
  const model = expenseChart(data, '2025-12', '2026-04', ['all']);
  assert.deepEqual(model.summary.months.map((month) => [month.month, month.total, month.count]), [
    ['2025-12', 0, 0],
    ['2026-01', 10000, 1],
    ['2026-02', 0, 1],
    ['2026-03', 30000, 1],
    ['2026-04', 0, 0],
  ]);
  assert.equal(model.summary.observed.length, 3);
  assert.equal(model.summary.average, 13333);
});

test('aggregate and category dynamics are mutually exclusive and category lines stay continuous', () => {
  const aggregate = expenseChart(data, '2026-01', '2026-03', ['all', 'food']);
  assert.deepEqual(aggregate.lines.map((series) => series.id), ['all']);

  const categories = expenseChart(data, '2026-01', '2026-03', ['food', 'travel']);
  assert.deepEqual(categories.lines.map((series) => series.id), ['food', 'travel']);
  assert.deepEqual(categories.lines[0].months.map((month) => [month.total, month.count]), [[10000, 1], [0, 1], [0, 1]]);
  const { svg } = chartGeometry(categories, 'line', 900, 272, { idPrefix: 'expense-' });
  assert.equal((svg.match(/class="data-line"/g) || []).length, 2);
  assert.doesNotMatch(svg, /class="chart-point"(?! hover-dot)/);
});

test('category averages use covered months, while metadata counts months with expenses', () => {
  const model = expenseChart(data, '2026-01', '2026-03', ['all']);
  const food = model.summary.sources.find((source) => source.id === 'food');
  assert.equal(food.average, 3333);
  assert.equal(food.count, 1);
  assert.equal(food.transactionCount, 1);
  assert.deepEqual(expenseSourceSeries(data, '2026-01', '2026-03')[1].months.map((month) => month.count), [1, 1, 1]);
});

test('expense insights compare calendar months including a genuine zero month', () => {
  const model = expenseChart(data, '2026-01', '2026-03', ['all']);
  const insights = expenseInsights(data, model.summary, ['all']);
  assert.equal(insights.latest.month, '2026-03');
  assert.equal(insights.previous.month, '2026-02');
  assert.equal(insights.previous.amount, 0);
  assert.equal(insights.previous.change, null);
});

test('year-on-year insight can read the covered month outside the visible period', () => {
  const history = { ...data, entries: [{ month: '2025-03', sourceId: 'food', amount: 20000 }, ...data.entries] };
  const model = expenseChart(history, '2026-01', '2026-12', ['all']);
  const insights = expenseInsights(history, model.summary, ['all']);
  assert.equal(insights.latest.month, '2026-03');
  assert.equal(insights.yearAgo.month, '2025-03');
  assert.equal(insights.yearAgo.amount, 20000);
  assert.equal(insights.yearAgo.change, 50);
});
