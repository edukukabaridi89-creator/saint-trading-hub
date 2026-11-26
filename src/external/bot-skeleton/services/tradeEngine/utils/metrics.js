/* Market measurements used by Bot Studio plans. Pure functions, shared by the running bot (Ticks.js) and by the
 * history simulator in the studio, so a backtest measures exactly what the live bot measures. */

const sma = (p, n) => {
    const w = p.slice(-n);
    return w.length === n ? w.reduce((a, b) => a + b, 0) / n : NaN;
};
const ema = (p, n) => {
    if (p.length < n) return NaN;
    const k = 2 / (n + 1);
    let e = p.slice(0, n).reduce((a, b) => a + b, 0) / n;
    for (let i = n; i < p.length; i++) e = p[i] * k + e * (1 - k);
    return e;
};
const rsi = (p, n) => {
    if (p.length < n + 1) return NaN;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = p[i] - p[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < p.length; i++) {
        const d = p[i] - p[i - 1];
        g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
        l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
    }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
};
/* length of the run at the end of the series that satisfies `ok` */
const run = (list, ok) => {
    let n = 0;
    for (let i = list.length - 1; i >= 0 && ok(list[i], i); i--) n++;
    return n;
};

export const METRICS = ['RUN_EVEN', 'RUN_ODD', 'RUN_OVER', 'RUN_UNDER', 'RUN_DIGIT', 'RUN_RISE', 'RUN_FALL', 'SMA', 'EMA', 'RSI', 'PRICE', 'LASTDIGIT', 'HOUR'];

/** `prices` = recent ticks (oldest first), `digits` = their last digits, `now` = epoch ms (for HOUR). NaN when there is not enough data yet. */
export const metricValue = (kind, arg, prices, digits, now = Date.now()) => {
    const a = Number(arg) || 0;
    switch (kind) {
        case 'RUN_EVEN': return run(digits, d => d % 2 === 0);
        case 'RUN_ODD': return run(digits, d => d % 2 === 1);
        case 'RUN_OVER': return run(digits, d => d > a);
        case 'RUN_UNDER': return run(digits, d => d < a);
        case 'RUN_DIGIT': return run(digits, d => d === a);
        case 'RUN_RISE': return run(prices, (x, i) => i > 0 && x > prices[i - 1]);
        case 'RUN_FALL': return run(prices, (x, i) => i > 0 && x < prices[i - 1]);
        case 'SMA': return sma(prices, a || 14);
        case 'EMA': return ema(prices, a || 14);
        case 'RSI': return rsi(prices, a || 14);
        case 'PRICE': return prices.length ? prices[prices.length - 1] : NaN;
        case 'LASTDIGIT': return digits.length ? digits[digits.length - 1] : NaN;
        case 'HOUR': return new Date(now).getUTCHours();
        default: return NaN;
    }
};
