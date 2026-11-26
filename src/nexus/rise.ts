import { hub } from './ticks-hub';

/**
 * "Rose" test. The digit circles show each digit's share of the last 1,000 ticks. When a digit lands its count goes up by one,
 * but the tick that falls out of the window goes down by one: if that tick was a different digit, the landed digit's share ROSE
 * (10.4 → 10.5); if it was the same digit, its share stayed the same (8.4 → 8.4).
 */
export const roseAt = (symbol: string, back = 0): boolean => {
    const f = hub.feed(symbol);
    if (!f) return false;
    const d = f.digits.at(-1 - back);
    const out = f.outs.at(-1 - back);
    return d !== undefined && out !== undefined && out !== d;
};

/** Digits that rose on the latest `n` ticks, the most recent first (one entry per digit). */
export const recentRisers = (symbol: string, n: number): number[] => {
    const f = hub.feed(symbol);
    if (!f) return [];
    const out: number[] = [];
    for (let b = 0; b < Math.min(n, f.outs.length); b++) {
        const d = f.digits.at(-1 - b);
        if (d !== undefined && roseAt(symbol, b) && !out.includes(d)) out.push(d);
    }
    return out;
};

export type HistoryTest = { ticks: number; triggers: number; hits: number; rate: number; chance: number; byRun: number[]; runs: number; trick: boolean };

/**
 * Replays the rapid rule over a list of digits (oldest first). The first 1,000 form the starting window; every later tick is
 * played as it would have been live. `hit` = the digit landed again within the next `runs` ticks.
 */
export const testRule = (digits: number[], runs: number, trick: boolean, wanted: number | null = null): HistoryTest => {
    const W = 1000;
    const byRun = Array(runs).fill(0);
    let triggers = 0, hits = 0, i = W + 1, blockedUntil = 0;
    for (; i + runs < digits.length; i++) {
        if (i < blockedUntil) continue;
        const p = digits[i - 1], pOut = digits[i - 1 - W], d = digits[i], out = digits[i - W];
        const pRose = pOut !== p && (wanted === null || p === wanted);
        const stays = d !== p && out !== p; // the digit that rose keeps its rise after the cursor leaves it
        const flat = out === d; // the digit the cursor moved to did not rise
        if (!pRose || !stays || (trick && !flat)) continue;
        triggers++;
        blockedUntil = i + runs;
        for (let k = 1; k <= runs; k++) if (digits[i + k] === p) { hits++; byRun[k - 1]++; break; }
    }
    return { ticks: Math.max(0, digits.length - W), triggers, hits, rate: triggers ? (hits / triggers) * 100 : 0, chance: (1 - Math.pow(0.9, runs)) * 100, byRun, runs, trick };
};

/** Fetches up to 5,000 recent ticks of a market and returns their last digits. */
export const fetchDigits = async (symbol: string): Promise<number[]> => {
    const m = await hub.call({ ticks_history: symbol, end: 'latest', count: 5000, style: 'ticks' });
    const prices: number[] = (m.history?.prices ?? []).map(Number);
    let pip = typeof m.pip_size === 'number' ? m.pip_size : NaN;
    if (pip > 0 && pip < 1) pip = Math.round(-Math.log10(pip));
    if (!Number.isInteger(pip) || pip < 0 || pip > 8) pip = Math.max(0, ...prices.slice(-200).map(x => (String(x).split('.')[1] || '').length));
    return prices.map(p => Number(p.toFixed(pip).slice(-1)));
};
