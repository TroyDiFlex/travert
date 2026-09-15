import { incomeChart, incomeSourceSeries } from '../chart.js';
import { percentChange, shiftMonth } from '../model.js';

function selectionSet(selection) {
  const selected = new Set(Array.isArray(selection) ? selection : [selection]);
  // The aggregate and category lines use different scales. Keeping them mutually
  // exclusive makes both views readable and prevents double visual encoding.
  return selected.has('all') ? new Set(['all']) : selected;
}

function inPeriod(month, from, to) {
  return (!from || month >= from) && (!to || month <= to);
}

function coverage(data) {
  const months = data.entries.map((entry) => entry.month).sort();
  return months.length ? { from: months[0], to: months.at(-1) } : { from: '', to: '' };
}

function covered(month, span) {
  return Boolean(span.from && month >= span.from && month <= span.to);
}

function denseSeries(series, span) {
  return series.map((item) => ({
    ...item,
    months: item.months.map((month) => covered(month.month, span)
      ? { ...month, count: Math.max(1, month.count) }
      : month),
  }));
}

export function expenseChart(data, from = '', to = '', selection = ['all']) {
  const selected = selectionSet(selection);
  const normalizedSelection = [...selected];
  const base = incomeChart(data, from, to, normalizedSelection);
  const span = coverage(data);
  const months = base.summary.months.map((month) => covered(month.month, span)
    ? { ...month, count: Math.max(1, month.count) }
    : month);
  const observed = months.filter((month) => covered(month.month, span));
  const includedSources = selected.has('all')
    ? data.sources
    : data.sources.filter((source) => selected.has(source.id));
  const includedIds = new Set(includedSources.map((source) => source.id));
  const entries = data.entries.filter((entry) => includedIds.has(entry.sourceId) && inPeriod(entry.month, from, to));
  const grouped = new Map(includedSources.map((source) => [source.id, {
    ...source,
    total: 0,
    transactionCount: 0,
    expenseMonths: new Set(),
  }]));
  for (const entry of entries) {
    const source = grouped.get(entry.sourceId);
    if (!source) continue;
    source.total += entry.amount;
    source.transactionCount += 1;
    source.expenseMonths.add(entry.month);
  }
  const sources = [...grouped.values()]
    .filter((source) => source.transactionCount > 0)
    .map((source) => ({
      ...source,
      count: source.expenseMonths.size,
      average: observed.length ? Math.round(source.total / observed.length) : 0,
      expenseMonths: undefined,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru'));
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const best = observed.reduce((winner, month) => !winner || month.total > winner.total ? month : winner, null);
  return {
    summary: {
      ...base.summary,
      months,
      observed,
      total,
      sources,
      best,
      average: observed.length ? Math.round(total / observed.length) : 0,
      recordCount: entries.length,
    },
    lines: denseSeries(base.lines, span),
    bars: denseSeries(base.bars, span),
    coverage: span,
  };
}

export function expenseSourceSeries(data, from = '', to = '', sources = data.sources) {
  return denseSeries(incomeSourceSeries(data, from, to, sources), coverage(data));
}

export function expenseInsights(data, summary, selection = ['all']) {
  const latest = summary.observed.at(-1) || null;
  const span = coverage(data);
  const selected = selectionSet(selection);
  const sourceIds = new Set((selected.has('all') ? data.sources : data.sources.filter((source) => selected.has(source.id))).map((source) => source.id));
  const amountFor = (month) => {
    if (!covered(month, span)) return null;
    return data.entries
      .filter((entry) => entry.month === month && sourceIds.has(entry.sourceId))
      .reduce((total, entry) => total + entry.amount, 0);
  };
  const comparison = (offset) => {
    if (!latest) return { month: null, amount: null, change: null };
    const month = shiftMonth(latest.month, offset);
    const amount = amountFor(month);
    return { month, amount, change: amount === null ? null : percentChange(latest.total, amount) };
  };
  return { latest, previous: comparison(-1), yearAgo: comparison(-12) };
}
