// 计时器（浏览器端）：右键菜单 →「计时」打开小面板，输入时长开始倒计时；
// 时间到时用 Web Audio 连续响铃（直到用户点「停止提示音」），页面在后台时另外弹一条系统通知。
//
// 设计要点：
//   - 倒计时状态是模块级单例：关闭面板不会取消计时，重新打开面板会看到剩余时间；
//   - 截止时刻用 Date.now() 对比（endAt），不依赖 setTimeout 的精度——后台标签页的
//     定时器会被节流，但 tick 每次都按真实时间判断，到点最迟晚一个节拍，不会漏响；
//   - 浏览器要求 AudioContext 在用户手势里创建/恢复，所以在「开始」点击时就解锁音频；
//   - 纯逻辑（时长解析、mm:ss 格式化）在 ./timer.ts，这里只管状态、声音与 DOM；
//   - 位于 src/shared（浏览器与桌面共用，见 shared/index.ts）：桌面 sprite.js 与浏览器 pet.ts 都从这里取同一份实现。

import { formatRemaining, parseDuration, remainingMs } from './timer';

type Status = 'idle' | 'running' | 'done';

interface TimerState {
  status: Status;
  endAt: number; // epoch 毫秒
}

let state: TimerState = { status: 'idle', endAt: 0 };
let tickHandle: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const ALARM_BEEP_INTERVAL_MS = 1500; // 两次响铃之间的间隔
const ALARM_MAX_MS = 60_000; // 最长响铃 60 秒，之后自动静音（防止无人值守时一直响）
let alarmHandle: ReturnType<typeof setInterval> | undefined;
let alarmStopHandle: ReturnType<typeof setTimeout> | undefined;
let audioCtx: AudioContext | null = null;

/** 在用户手势（点击）中调用：创建或恢复 AudioContext，之后的定时响铃才能出声 */
function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
}

/** 响一声：两个短促的正弦音（880Hz → 1175Hz），带包络避免爆音 */
function beepOnce(): void {
  const ctx = audioCtx;
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  [880, 1175].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = t0 + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

/** 开始连续响铃，直到 stopAlarm 或超过 ALARM_MAX_MS */
function startAlarm(): void {
  stopAlarm();
  beepOnce();
  alarmHandle = setInterval(beepOnce, ALARM_BEEP_INTERVAL_MS);
  alarmStopHandle = setTimeout(stopAlarm, ALARM_MAX_MS);
}

function stopAlarm(): void {
  if (alarmHandle !== undefined) clearInterval(alarmHandle);
  if (alarmStopHandle !== undefined) clearTimeout(alarmStopHandle);
  alarmHandle = undefined;
  alarmStopHandle = undefined;
}

function emit(): void {
  for (const fn of listeners) fn();
}

function stopTicking(): void {
  if (tickHandle !== undefined) clearInterval(tickHandle);
  tickHandle = undefined;
}

/** 倒计时到点：进入 done、响铃；页面不可见时补一条系统通知（已授权才发） */
function fire(): void {
  stopTicking();
  state = { status: 'done', endAt: state.endAt };
  startAlarm();
  if (typeof document !== 'undefined' && document.hidden && typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      try {
        new Notification('计时结束', { body: '时间到啦！' });
      } catch {
        /* 个别环境构造 Notification 会抛错：忽略，声音已经在响 */
      }
    }
  }
  emit();
}

function tick(): void {
  if (state.status !== 'running') return;
  if (remainingMs(state.endAt, Date.now()) === 0) {
    fire();
  } else {
    emit(); // 只为刷新显示
  }
}

/** 开始计时（秒）。在用户点击里调用，顺带解锁音频。 */
export function startTimer(seconds: number): void {
  unlockAudio();
  stopAlarm();
  stopTicking();
  state = { status: 'running', endAt: Date.now() + seconds * 1000 };
  tickHandle = setInterval(tick, 500);
  emit();
}

/** 取消计时并停止响铃 */
export function cancelTimer(): void {
  stopAlarm();
  stopTicking();
  state = { status: 'idle', endAt: 0 };
  emit();
}

/** 停止提示音（计时已结束时用），回到空闲 */
export function dismissAlarm(): void {
  cancelTimer();
}

export function getTimerState(): Readonly<TimerState> & { remainingMs: number } {
  return {
    ...state,
    remainingMs: state.status === 'running' ? remainingMs(state.endAt, Date.now()) : 0,
  };
}

/** 订阅状态变化（含每秒一次的刷新）；返回取消订阅函数 */
export function subscribeTimer(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---------- 面板 ----------

const TIMER_CSS = [
  '.dsh-pet-timer{position:fixed;z-index:2147483000;width:220px;padding:12px;background:#fff;color:#2b2b2b;',
  'border:1px solid rgba(0,0,0,.12);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.2);',
  "font:13px/1.5 'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none}",
  '.dsh-pet-timer *{box-sizing:border-box}',
  '.dsh-pet-timer-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}',
  '.dsh-pet-timer-title{font-weight:600}',
  '.dsh-pet-timer-close{border:0;background:none;cursor:pointer;color:#888;font-size:16px;line-height:1;padding:2px 4px}',
  '.dsh-pet-timer-display{font-size:28px;font-variant-numeric:tabular-nums;text-align:center;margin:6px 0}',
  '.dsh-pet-timer-display.done{color:#d9480f}',
  '.dsh-pet-timer-input{width:100%;padding:6px 8px;border:1px solid rgba(0,0,0,.2);border-radius:6px;font:inherit}',
  '.dsh-pet-timer-err{color:#c92a2a;font-size:12px;min-height:16px;margin-top:4px}',
  '.dsh-pet-timer-btns{display:flex;gap:6px;margin-top:6px}',
  '.dsh-pet-timer-btns button{flex:1;padding:5px 0;border:1px solid rgba(0,0,0,.15);border-radius:6px;',
  'background:#f7f7f7;cursor:pointer;font:inherit}',
  '.dsh-pet-timer-btns button.primary{background:#2b63ff;border-color:#2b63ff;color:#fff}',
  '.dsh-pet-timer-btns button:focus-visible{outline:2px solid #2b63ff;outline-offset:2px}',
].join('');

let timerCssInjected = false;
function injectTimerCss(): void {
  if (timerCssInjected || typeof document === 'undefined') return;
  timerCssInjected = true;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = 'dsh-pet/timer';
  tag.textContent = TIMER_CSS;
  document.head.appendChild(tag);
}

export interface TimerDialogMount {
  close: () => void;
}

/** 打开计时面板（定位在宠物右上角，与对话弹窗同一套落点）。关闭面板不影响正在进行的计时。 */
export function mountTimerDialog(opts: {
  x: number;
  y: number;
  /** 弹窗关闭时调用（宿主据此复位交互/穿透状态）；计时本身不受影响 */
  onClose?: () => void;
  /** 弹窗允许占用的矩形（视口局部坐标）；缺省 = 整个视口 */
  clamp?: { x: number; y: number; w: number; h: number };
}): TimerDialogMount {
  injectTimerCss();

  const root = document.createElement('div');
  root.className = 'dsh-pet-timer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '计时器');

  const head = document.createElement('div');
  head.className = 'dsh-pet-timer-head';
  const title = document.createElement('span');
  title.className = 'dsh-pet-timer-title';
  title.textContent = '计时';
  const closeX = document.createElement('button');
  closeX.className = 'dsh-pet-timer-close';
  closeX.type = 'button';
  closeX.setAttribute('aria-label', '关闭面板');
  closeX.textContent = '×';
  head.append(title, closeX);

  const display = document.createElement('div');
  display.className = 'dsh-pet-timer-display';
  display.setAttribute('role', 'status');

  const input = document.createElement('input');
  input.className = 'dsh-pet-timer-input';
  input.type = 'text';
  input.placeholder = '分钟，或 5:30 / 90s';
  input.maxLength = 12;
  input.setAttribute('aria-label', '计时时长');

  const err = document.createElement('div');
  err.className = 'dsh-pet-timer-err';
  err.setAttribute('aria-live', 'polite');

  const btns = document.createElement('div');
  btns.className = 'dsh-pet-timer-btns';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'primary';
  startBtn.textContent = '开始';
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.textContent = '取消计时';
  btns.append(startBtn, stopBtn);

  root.append(head, display, input, err, btns);
  document.body.appendChild(root);

  // 落点：右上角，超出视口夹回
  const rr = root.getBoundingClientRect();
  const c =
    opts.clamp && Number.isFinite(opts.clamp.x + opts.clamp.y + opts.clamp.w + opts.clamp.h)
      ? opts.clamp
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  root.style.left = Math.max(c.x + 4, Math.min(opts.x, c.x + c.w - rr.width - 4)) + 'px';
  root.style.top = Math.max(c.y + 4, Math.min(opts.y, c.y + c.h - rr.height - 4)) + 'px';

  const render = (): void => {
    const s = getTimerState();
    display.classList.toggle('done', s.status === 'done');
    if (s.status === 'running') {
      display.textContent = formatRemaining(s.remainingMs);
    } else if (s.status === 'done') {
      display.textContent = '时间到！';
    } else {
      display.textContent = '00:00';
    }
    // 状态相关的按钮：计时中可取消；响铃中改为「停止提示音」
    stopBtn.textContent = s.status === 'done' ? '停止提示音' : '取消计时';
    stopBtn.disabled = s.status === 'idle';
    startBtn.disabled = s.status === 'running';
  };

  const onStart = (): void => {
    const seconds = parseDuration(input.value);
    if (seconds === null) {
      err.textContent = '请输入 1–720 分钟，例如 25、5:30 或 90s';
      input.focus();
      return;
    }
    err.textContent = '';
    input.value = '';
    startTimer(seconds);
  };
  const onStop = (): void => {
    if (getTimerState().status === 'done') dismissAlarm();
    else cancelTimer();
  };

  startBtn.addEventListener('click', onStart);
  stopBtn.addEventListener('click', onStop);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onStart();
  });
  input.addEventListener('input', () => {
    err.textContent = '';
  });

  const unsubscribe = subscribeTimer(render);
  const interval = setInterval(render, 1000); // 状态外的时间流逝也要刷新
  render();
  input.focus();

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    unsubscribe();
    root.remove();
    opts.onClose?.();
  };
  closeX.addEventListener('click', close);
  return { close };
}
