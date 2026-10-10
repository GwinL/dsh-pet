// 计时器的纯逻辑（无 DOM / 无音频依赖，可单测）：时长解析与剩余时间格式化。
// 浏览器端的倒计时状态机、提示音与对话框在 src/client/timer.ts，这里只放与环境无关的部分。

/** 允许的最长时长（分钟）：避免输入离谱的数字（如 1e9）造成溢出或永远不响 */
export const TIMER_MAX_MINUTES = 12 * 60;

/**
 * 解析用户输入的时长，返回秒数；无法识别或越界时返回 null。
 * 支持：
 *   - "25"        → 25 分钟（纯数字按分钟）
 *   - "25m" / "25分钟" / "25 min" → 25 分钟
 *   - "90s" / "90秒" → 90 秒
 *   - "5:30"      → 5 分 30 秒（m:ss）
 *   - "1:05:00"   → 1 小时 5 分（h:mm:ss）
 * 时长必须为正；总量不得超过 TIMER_MAX_MINUTES 分钟。
 */
export function parseDuration(input: string): number | null {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;

  let seconds: number | null = null;

  const colon = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (colon) {
    const [, a, b, c] = colon;
    if (c === undefined) {
      // m:ss
      if (Number(b) >= 60) return null;
      seconds = Number(a) * 60 + Number(b);
    } else {
      // h:mm:ss
      if (Number(b) >= 60 || Number(c) >= 60) return null;
      seconds = Number(a) * 3600 + Number(b) * 60 + Number(c);
    }
  } else {
    const unit = /^(\d+(?:\.\d+)?)\s*(m|min|mins|分钟|分|s|sec|secs|秒)?$/.exec(s);
    if (!unit) return null;
    const n = Number(unit[1]);
    const u = unit[2];
    const isSeconds = u === 's' || u === 'sec' || u === 'secs' || u === '秒';
    seconds = Math.round(isSeconds ? n : n * 60);
  }

  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds > TIMER_MAX_MINUTES * 60) return null;
  return seconds;
}

/** 剩余毫秒数（不为负）。endAt 与 now 均为 epoch 毫秒。 */
export function remainingMs(endAt: number, now: number): number {
  return Math.max(0, endAt - now);
}

/**
 * 把剩余毫秒格式化为显示文本：不足 1 小时用 mm:ss，否则 h:mm:ss。
 * 向上取整到秒（倒计时 0.3 秒时仍显示 00:01，直到真正归零才显示 00:00）。
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
