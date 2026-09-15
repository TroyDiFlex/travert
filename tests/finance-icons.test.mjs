import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getIcon,
  iconCount,
  iconSvg,
  isKnownIcon,
  listIcons,
  searchIcons,
} from '../finance/icons.js';

test('каталог иконок покрывает все группы и не имеет дублей', () => {
  assert.ok(iconCount() >= 60, `ожидалось минимум 60 иконок, получено ${iconCount()}`);
  const listed = listIcons();
  assert.equal(listed.length, iconCount());
  assert.equal(new Set(listed.map((icon) => icon.id)).size, listed.length);
  for (const icon of listed) {
    assert.match(icon.id, /^local:[a-z]+$/, `плохой id ${icon.id}`);
    assert.ok(icon.label.length > 0);
    assert.ok(icon.group.length > 0);
  }
  const groups = new Set(listed.map((icon) => icon.group));
  for (const group of ['Еда', 'Дом', 'Покупки', 'Транспорт', 'Здоровье', 'Образование', 'Работа', 'Путешествия', 'Развлечения', 'Финансы']) {
    assert.ok(groups.has(group), `нет группы ${group}`);
  }
});

test('русский поиск находит иконки по названию и синонимам', () => {
  assert.ok(searchIcons('кофе').some((icon) => icon.id === 'local:coffee'));
  assert.ok(searchIcons('КОФЕ').some((icon) => icon.id === 'local:coffee'));
  assert.ok(searchIcons('бензин').some((icon) => icon.id === 'local:fuel'));
  assert.ok(searchIcons('стоматолог зубы').some((icon) => icon.id === 'local:tooth'));
  assert.equal(searchIcons('абракадабра несуществующая').length, 0);
  assert.equal(searchIcons('').length, iconCount());
});

test('неизвестная иконка заменяется нейтральной', () => {
  assert.equal(isKnownIcon('local:coffee'), true);
  assert.equal(isKnownIcon('local:nope'), false);
  assert.equal(getIcon('local:nope').id, 'local:circle');
  const svg = iconSvg('local:nope');
  assert.ok(svg.includes('data-icon="local:circle"'));
  assert.ok(svg.startsWith('<svg '));
});
