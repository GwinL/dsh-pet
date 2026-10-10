import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { cancelTimer, dismissAlarm, getTimerState, startTimer, subscribeTimer } from './timer';

// 计时状态机的单测（不依赖 DOM / 音频：测试环境没有 window，音频解锁与响铃会被安全跳过）
afterEach(() => {
  cancelTimer();
});

describe('client timer state machine', () => {
  it('开始后进入 running，剩余时间不超过设定值', () => {
    startTimer(60);
    const s = getTimerState();
    assert.equal(s.status, 'running');
    assert.ok(s.remainingMs > 59_000 && s.remainingMs <= 60_000);
  });

  it('取消后回到 idle', () => {
    startTimer(60);
    cancelTimer();
    assert.equal(getTimerState().status, 'idle');
  });

  it('到点后进入 done，并通知订阅者', async () => {
    let notified = 0;
    const unsubscribe = subscribeTimer(() => {
      notified++;
    });
    startTimer(0.05); // 50ms 后到点；tick 每 500ms 检查一次，最迟约 0.5s
    await new Promise((r) => setTimeout(r, 700));
    unsubscribe();
    assert.equal(getTimerState().status, 'done');
    assert.ok(notified > 0);
    dismissAlarm();
    assert.equal(getTimerState().status, 'idle');
  });

  it('取消订阅后不再收到通知', () => {
    let notified = 0;
    const unsubscribe = subscribeTimer(() => {
      notified++;
    });
    unsubscribe();
    startTimer(60);
    assert.equal(notified, 0);
  });
});
