import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatRemaining, parseDuration, remainingMs, TIMER_MAX_MINUTES } from './timer';

describe('parseDuration', () => {
  it('纯数字按分钟', () => {
    assert.equal(parseDuration('25'), 25 * 60);
  });
  it('分钟单位的多种写法', () => {
    assert.equal(parseDuration('25m'), 25 * 60);
    assert.equal(parseDuration('25分钟'), 25 * 60);
    assert.equal(parseDuration(' 3 min '), 3 * 60);
  });
  it('秒单位', () => {
    assert.equal(parseDuration('90s'), 90);
    assert.equal(parseDuration('90秒'), 90);
  });
  it('m:ss 与 h:mm:ss', () => {
    assert.equal(parseDuration('5:30'), 5 * 60 + 30);
    assert.equal(parseDuration('1:05:00'), 3600 + 5 * 60);
  });
  it('拒绝非法输入', () => {
    for (const bad of ['', '   ', 'abc', '0', '0m', '-5', '1.5.2', '5:75', '1:2:99', '12x']) {
      assert.equal(parseDuration(bad), null, bad);
    }
  });
  it('拒绝超过上限', () => {
    assert.equal(parseDuration(String(TIMER_MAX_MINUTES)), TIMER_MAX_MINUTES * 60);
    assert.equal(parseDuration(String(TIMER_MAX_MINUTES + 1)), null);
    assert.equal(parseDuration('1e9'), null);
  });
});

describe('remainingMs', () => {
  it('不为负', () => {
    assert.equal(remainingMs(1000, 500), 500);
    assert.equal(remainingMs(1000, 2000), 0);
  });
});

describe('formatRemaining', () => {
  it('mm:ss', () => {
    assert.equal(formatRemaining(0), '00:00');
    assert.equal(formatRemaining(5_000), '00:05');
    assert.equal(formatRemaining(25 * 60 * 1000), '25:00');
  });
  it('向上取整：未满 1 秒仍显示 00:01', () => {
    assert.equal(formatRemaining(300), '00:01');
  });
  it('超过 1 小时显示 h:mm:ss', () => {
    assert.equal(formatRemaining((3600 + 61) * 1000), '1:01:01');
  });
});
