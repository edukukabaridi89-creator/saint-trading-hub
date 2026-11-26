import { metricValue } from '../../external/bot-skeleton/services/tradeEngine/utils/metrics';
import { needsBarrier, NO_LIMIT, type Side } from './bot-spec';
import type { Choice, Leg } from './advanced';
import type { Cond, Metric, Plan } from './plan';

/**
 * History test: runs a Plan over real recorded ticks with the same measurements the live bot uses (metrics.js).
 * It never invents money: profit is computed only when a real payout figure is supplied (from a Deriv proposal).
 * Limits, said plainly in the result: one market (scans are not simulated), contracts do not overlap, no slippage.
 */

export type SimResult = {
    ticks: number; trades: number; wins: number; losses: number;
    winRate: number; longestLossRun: number; maxStake: number;
    profit: number | null; // null when no payout figure was supplied
    stoppedBy: 'take profit' | 'stop loss' | 'stop rule' | 'end of data';
    notes: string[];
};

const digitsOf = (prices: number[], pip: number) => prices.map(p => Number(p.toFixed(pip).slice(-1)));
const pct = (digits: number[], kind: string, d: number) => {
    if (!digits.length) return 0;
    const f = kind === 'EVEN' ? (x: number) => x % 2 === 0 : kind === 'ODD' ? (x: number) => x % 2 === 1 : kind === 'OVER' ? (x: number) => x > d : kind === 'UNDER' ? (x: number) => x < d : (x: number) => x === d;
    return (digits.filter(f).length * 100) / digits.length;
};

export const legWins = (l: Leg, entry: number, exit: number, exitDigit: number): boolean => {
    switch (l.side) {
        case 'DIGITEVEN': return exitDigit % 2 === 0;
        case 'DIGITODD': return exitDigit % 2 === 1;
        case 'DIGITOVER': return exitDigit > (l.barrier ?? 0);
        case 'DIGITUNDER': return exitDigit < (l.barrier ?? 0);
        case 'DIGITMATCH': return exitDigit === (l.barrier ?? 0);
        case 'DIGITDIFF': return exitDigit !== (l.barrier ?? 0);
        case 'CALL': return exit > entry;
        default: return exit < entry;
    }
};

export const simulate = (plan: Plan, prices: number[], pip: number, payoutRatio: Record<string, number> | null = null): SimResult => {
    const digits = digitsOf(prices, pip);
    const notes: string[] = [];
    if (plan.stages.some(s => s.scan)) notes.push('Market scans are not simulated: the test ran on the starting volatility only.');
    if (plan.stages.some(s => s.market)) notes.push('Switching to another volatility is not simulated.');
    let i = 120, losses = 0, wins = 0, trades = 0, total = 0, stake = plan.stake, maxStake = stake, lossRun = 0, longest = 0, w = 0, l = 0;
    let stopped: SimResult['stoppedBy'] = 'end of data';
    let sinceTrade = 0;

    const metric = (m: Metric, end: number): number => {
        if (m.k === 'state') return ({ lossStreak: losses, winStreak: wins, trades, profit: total, stake } as const)[m.s];
        if (m.k === 'chance') return pct(digits.slice(Math.max(0, end - (m.window ?? 100)), end), m.kind, m.digit ?? 0);
        const v = metricValue(m.m, m.arg ?? (['SMA', 'EMA', 'RSI'].includes(m.m) ? 14 : 0), prices.slice(Math.max(0, end - 1000), end), digits.slice(Math.max(0, end - 1000), end), 0);
        return Number.isFinite(v) ? v : -1;
    };
    const cmp = (op: string, a: number, b: number) => (op === 'GT' ? a > b : op === 'GTE' ? a >= b : op === 'LT' ? a < b : op === 'LTE' ? a <= b : op === 'EQ' ? a === b : a !== b);
    const cond = (c: Cond | undefined, end: number): boolean => {
        if (!c) return true;
        if (c.t === 'cmp') return cmp(c.op, metric(c.m, end), typeof c.v === 'number' ? c.v : metric(c.v, end));
        if (c.t === 'not') return !cond(c.c, end);
        return c.t === 'and' ? c.c.every(x => cond(x, end)) : c.c.some(x => cond(x, end));
    };
    const pick = (ch: Choice, end: number): Leg => {
        if (!ch.b) return ch.a;
        const chanceOf = (g: Leg) => pct(digits.slice(Math.max(0, end - plan.window), end), g.side === 'DIGITEVEN' ? 'EVEN' : g.side === 'DIGITODD' ? 'ODD' : g.side === 'DIGITOVER' ? 'OVER' : 'UNDER', g.barrier ?? 0);
        return chanceOf(ch.a) >= chanceOf(ch.b) ? ch.a : ch.b;
    };

    while (i + plan.duration < prices.length) {
        sinceTrade++;
        const end = i + 1; // ticks seen so far (up to and including tick i)
        let si = 0;
        plan.stages.forEach((s, k) => { if (losses >= s.after) si = k; });
        const st = plan.stages[si];
        const ok = cond(plan.enterWhen, end) && cond(st.when, end) && (plan.entry.mode === 'any' || cmp(plan.entry.op, digits[i], plan.entry.digit));
        if (!ok) { i++; continue; }
        const leg = pick(st.choice, end);
        const exit = i + plan.duration;
        const won = legWins(leg, prices[i], prices[exit], digits[exit]);
        trades++;
        if (won) {
            w++; wins++; losses = 0; lossRun = 0;
            total += payoutRatio ? stake * ((payoutRatio[leg.side] ?? NaN) - 1) : 0;
            stake = plan.stake;
        } else {
            l++; losses++; wins = 0; lossRun++; longest = Math.max(longest, lossRun);
            total -= payoutRatio ? stake : 0;
            stake = Math.min(plan.maxStake ?? Infinity, stake * plan.multiplier);
            maxStake = Math.max(maxStake, stake);
        }
        i = exit + 1;
        if (payoutRatio && total >= plan.takeProfit && plan.takeProfit < NO_LIMIT) { stopped = 'take profit'; break; }
        if (payoutRatio && total <= -plan.stopLoss && plan.stopLoss < NO_LIMIT) { stopped = 'stop loss'; break; }
        if (plan.stopWhen?.some(sw => cond(sw.cond, i))) { stopped = 'stop rule'; break; }
        if (trades > 20000) break;
    }
    if (!payoutRatio) notes.push('No payout figure was available, so profit is not shown. Win and loss counts are exact.');
    if (trades === 0) notes.push('The entry conditions never became true in this data.');
    notes.push('A past result does not predict future results. This is not a promise of profit.');
    return { ticks: prices.length, trades, wins: w, losses: l, winRate: trades ? (w * 100) / trades : 0, longestLossRun: longest, maxStake, profit: payoutRatio ? Math.round(total * 100) / 100 : null, stoppedBy: stopped, notes };
};

export const sidesUsed = (plan: Plan): Side[] => [...new Set(plan.stages.flatMap(s => [s.choice.a, s.choice.b, s.fallback?.a, s.fallback?.b]).filter(Boolean).map(l => (l as Leg).side))];
export const needsDigit = (s: Side) => needsBarrier(s);
