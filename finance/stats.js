export function lastMonths(count, fromDate = new Date()) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 120) {
    throw new RangeError('Число месяцев должно быть от 1 до 120.');
  }
  const months = [];
  let year = fromDate.getFullYear();
  let month = fromDate.getMonth();
  for (let index = 0; index < count; index += 1) {
    months.unshift(`${year}-${String(month + 1).padStart(2, '0')}`);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return months;
}

export function formatMonthShort(month) {
  const [year, index] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ru', { month: 'short', year: '2-digit' })
    .format(new Date(year, index - 1, 1))
    .replace('.', '');
}

export function pickDisplayCurrency(expenses) {
  const currencies = new Set(expenses.map((item) => item.currency));
  if (currencies.has('RUB')) return 'RUB';
  return expenses[0]?.currency ?? 'RUB';
}

export function monthlyTotals(expenses, months, currency) {
  const totals = new Map(months.map((month) => [month, 0]));
  for (const item of expenses) {
    if (item.currency !== currency) continue;
    if (!totals.has(item.month)) continue;
    totals.set(item.month, totals.get(item.month) + item.amountMinor);
  }
  return months.map((month) => ({ month, totalMinor: totals.get(month) }));
}

export function categoryTotals(expenses, { month = null, currency = null } = {}) {
  const totals = new Map();
  for (const item of expenses) {
    if (month && item.month !== month) continue;
    if (currency && item.currency !== currency) continue;
    totals.set(item.categoryId, (totals.get(item.categoryId) ?? 0) + item.amountMinor);
  }
  return [...totals.entries()]
    .map(([categoryId, totalMinor]) => ({ categoryId, totalMinor }))
    .sort((left, right) => right.totalMinor - left.totalMinor);
}

export function totalsByCurrency(expenses) {
  const totals = {};
  for (const item of expenses) {
    totals[item.currency] = (totals[item.currency] ?? 0) + item.amountMinor;
  }
  return totals;
}
