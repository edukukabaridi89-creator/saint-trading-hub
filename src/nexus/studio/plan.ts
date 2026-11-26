import { marketLabel, needsBarrier, NO_LIMIT, SIDE_LABEL, type Side } from './bot-spec';
import { usesOwnHistory } from './conds';
import { canCompare, legLabel, type Choice, type Leg } from './advanced';

/**
 * A "plan" is what Bot Studio's plain-English brain (brain.ts) understands from a description. It is richer than a BotSpec:
 * the bot can choose its market by a percentage, and it moves through stages as losses pile up (main trade, recovery,
 * a last resort), each stage with its own trade and its own way of choosing the volatility.
 */

export type Scan = {
    threshold: number; // % of the last `count` ticks the outcome must reach (0 = just take the best market)
    count: number;
    scope: 'all' | 'this';
    other: boolean; // must be a different market from the one the bot is on
};

export type CmpOp = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'NEQ';
export const MEASURES = ['RUN_EVEN', 'RUN_ODD', 'RUN_OVER', 'RUN_UNDER', 'RUN_DIGIT', 'RUN_RISE', 'RUN_FALL', 'SMA', 'EMA', 'RSI', 'PRICE', 'LASTDIGIT', 'HOUR'] as const;
export type Measure = (typeof MEASURES)[number];
export const STATES = ['lossStreak', 'winStreak', 'trades', 'profit', 'stake'] as const;
export type StateName = (typeof STATES)[number];
/** Something the bot can measure: a digit chance, a run length / indicator on the ticks, or its own state (streaks, profit, trade count). */
export type Metric =
    | { k: 'chance'; kind: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'MATCH'; digit?: number; window?: number }
    | { k: 'measure'; m: Measure; arg?: number }
    | { k: 'state'; s: StateName };
/** A yes/no condition. Nest and/or/not as deep as needed (up to 8 levels). */
export type Cond = { t: 'cmp'; m: Metric; op: CmpOp; v: number | Metric } | { t: 'and' | 'or'; c: Cond[] } | { t: 'not'; c: Cond };

export type Stage = {
    when?: Cond; // this stage only trades while the condition is true
    after: number; // consecutive losses before this stage starts (0 for the main trade)
    choice: Choice; // one leg = that trade, two legs = whichever is likelier right now
    market?: string; // go to this volatility when the stage starts
    scan?: Scan; // choose the volatility by percentage
    fallback?: Choice; // used on the current market when the scan finds nothing
};

export type Plan = {
    name: string;
    symbol: string; // where it starts
    stake: number;
    duration: number;
    takeProfit: number;
    stopLoss: number;
    multiplier: number; // stake x multiplier after each loss (1 = flat)
    maxStake: number | null;
    window: number; // ticks looked at when picking the likelier of two trades
    entry: { mode: 'any' } | { mode: 'digit'; op: 'EQ' | 'GT' | 'LT'; digit: number };
    enterWhen?: Cond; // every trade (any stage) waits for this to be true
    stopWhen?: { cond: Cond; say: string }[]; // extra reasons to stop, each written to the Journal
    stages: Stage[]; // stages[0] is the main trade; later stages have a higher `after`
};

/** What a scan measures for a choice: 'EVENODD' / 'OVERUNDER' mean "whichever of the two is more frequent". */
export const scanKindOf = (c: Choice): { kind: string; digit: number } | null => {
    if (!c.b) {
        const { side, barrier } = c.a;
        if (side === 'DIGITEVEN') return { kind: 'EVEN', digit: 0 };
        if (side === 'DIGITODD') return { kind: 'ODD', digit: 0 };
        if (side === 'DIGITOVER') return { kind: 'OVER', digit: barrier ?? 4 };
        if (side === 'DIGITUNDER') return { kind: 'UNDER', digit: barrier ?? 4 };
        return null;
    }
    const sides = [c.a.side, c.b.side].sort().join();
    if (sides === 'DIGITEVEN,DIGITODD') return { kind: 'EVENODD', digit: 0 };
    if (sides === 'DIGITOVER,DIGITUNDER') return { kind: 'OVERUNDER', digit: c.a.barrier ?? 4 };
    return null;
};

export const choiceText = (c: Choice) => (c.b ? `the likelier of ${legLabel(c.a)} or ${legLabel(c.b)}` : legLabel(c.a));

const leg = (l: Leg) => l;
export const pairOf = (a: Leg): Choice => {
    const opp: Side = a.side === 'DIGITEVEN' ? 'DIGITODD' : a.side === 'DIGITODD' ? 'DIGITEVEN' : a.side === 'DIGITOVER' ? 'DIGITUNDER' : 'DIGITOVER';
    return { a: leg(a), b: { side: opp, barrier: needsBarrier(opp) ? a.barrier : undefined } };
};

const OP_TEXT: Record<CmpOp, string> = { GT: '>', GTE: '>=', LT: '<', LTE: '<=', EQ: '=', NEQ: '!=' };
const MEASURE_TEXT: Record<Measure, string> = {
    RUN_EVEN: 'run of Even digits', RUN_ODD: 'run of Odd digits', RUN_OVER: 'run of digits over', RUN_UNDER: 'run of digits under', RUN_DIGIT: 'run of the same digit',
    RUN_RISE: 'run of rising ticks', RUN_FALL: 'run of falling ticks', SMA: 'SMA', EMA: 'EMA', RSI: 'RSI', PRICE: 'last price', LASTDIGIT: 'last digit', HOUR: 'hour (UTC)',
};
const STATE_TEXT: Record<StateName, string> = { lossStreak: 'losses in a row', winStreak: 'wins in a row', trades: 'trades made', profit: 'total profit', stake: 'current stake' };
export const metricText = (m: Metric): string =>
    m.k === 'chance' ? `${m.kind.toLowerCase()}${m.kind === 'OVER' || m.kind === 'UNDER' || m.kind === 'MATCH' ? ` ${m.digit ?? 0}` : ''} % in the last ${m.window ?? 100} ticks`
        : m.k === 'measure' ? `${MEASURE_TEXT[m.m]}${['RUN_OVER', 'RUN_UNDER', 'RUN_DIGIT', 'SMA', 'EMA', 'RSI'].includes(m.m) ? ` ${m.arg ?? 0}` : ''}`
        : STATE_TEXT[m.s];
export const condText = (c: Cond): string =>
    c.t === 'cmp' ? `${metricText(c.m)} ${OP_TEXT[c.op]} ${typeof c.v === 'number' ? c.v : metricText(c.v)}` : c.t === 'not' ? `not (${condText(c.c)})` : `(${c.c.map(condText).join(c.t === 'and' ? ' AND ' : ' OR ')})`;

const condProblems = (c: Cond | undefined, where: string, depth = 0): string[] => {
    if (!c) return [];
    if (depth > 8) return [`${where}: the condition is nested too deeply (8 levels at most).`];
    if (c.t === 'cmp') {
        const e: string[] = [];
        if (typeof c.v === 'number' && !Number.isFinite(c.v)) e.push(`${where}: a comparison needs a number.`);
        if (c.m.k === 'measure' && !(MEASURES as readonly string[]).includes(c.m.m)) e.push(`${where}: unknown measure "${c.m.m}".`);
        if (c.m.k === 'measure' && ['SMA', 'EMA', 'RSI'].includes(c.m.m) && !((c.m.arg ?? 14) >= 2 && (c.m.arg ?? 14) <= 500)) e.push(`${where}: the ${c.m.m} period must be from 2 to 500.`);
        if (c.m.k === 'state' && !(STATES as readonly string[]).includes(c.m.s)) e.push(`${where}: unknown value "${c.m.s}".`);
        if (c.m.k === 'chance' && !((c.m.window ?? 100) >= 10 && (c.m.window ?? 100) <= 1000)) e.push(`${where}: a chance needs 10 to 1000 ticks.`);
        return e;
    }
    if (c.t === 'not') return condProblems(c.c, where, depth + 1);
    if (!c.c.length) return [`${where}: an AND / OR needs at least one condition.`];
    return c.c.flatMap(x => condProblems(x, where, depth + 1));
};

export const validatePlan = (p: Plan): string[] => {
    const e: string[] = [];
    if (!p.stages.length) return ['The bot has no trade.'];
    if (!(p.stake >= 0.35)) e.push('The minimum stake is 0.35.');
    if (!Number.isInteger(p.duration) || p.duration < 1 || p.duration > 10) e.push('Duration must be a whole number of ticks from 1 to 10.');
    if (!(p.takeProfit > 0) || !(p.stopLoss > 0)) e.push('Take profit and stop loss must be more than 0.');
    if (p.takeProfit > 0 && p.stopLoss > 0 && p.multiplier > 1 && p.stake * p.multiplier > p.stopLoss) e.push('Risk check: the first martingale step already costs more than the stop loss.');
    e.push(...condProblems(p.enterWhen, 'Entry condition'));
    if (usesOwnHistory(p.enterWhen) || usesOwnHistory(p.stages[0].when)) e.push('DEADLOCK: the entry condition counts the bot\'s own trades or losses, but the bot cannot have any before it first trades, so it would never start.');
    p.stopWhen?.forEach((s, i) => e.push(...condProblems(s.cond, `Stop rule ${i + 1}`)));
    p.stages.forEach((st, i) => e.push(...condProblems(st.when, i === 0 ? 'Main trade condition' : `Stage ${i + 1} condition`)));
    p.stages.forEach((st, i) => {
        const where = i === 0 ? 'The main trade' : `Stage ${i + 1}`;
        const legs = [st.choice.a, st.choice.b, st.fallback?.a, st.fallback?.b].filter(Boolean) as Leg[];
        legs.forEach(l => {
            if (needsBarrier(l.side) && (l.barrier === undefined || l.barrier < 0 || l.barrier > 9)) e.push(`${where}: ${SIDE_LABEL[l.side]} needs a digit from 0 to 9.`);
            if (l.side === 'DIGITOVER' && l.barrier === 9) e.push(`${where}: Over 9 can never win.`);
            if (l.side === 'DIGITUNDER' && l.barrier === 0) e.push(`${where}: Under 0 can never win.`);
        });
        [st.choice, st.fallback].forEach(c => c?.b && (!canCompare(c.a.side) || !canCompare(c.b.side)) && e.push(`${where}: only Even, Odd, Over and Under can be compared by chance.`));
        if (st.scan && !scanKindOf(st.choice)) e.push(`${where}: only Even, Odd, Over and Under can be scanned for by percentage.`);
        if (st.scan && (st.scan.threshold < 0 || st.scan.threshold > 100)) e.push(`${where}: the percentage must be from 0 to 100.`);
        if (i > 0 && st.after <= p.stages[i - 1].after) e.push(`${where} must start after more losses than the stage before it.`);
    });
    const allLegs = p.stages.flatMap(s => [s.choice.a, s.choice.b, s.fallback?.a, s.fallback?.b]).filter(Boolean) as Leg[];
    const rf = allLegs.some(l => l.side === 'CALL' || l.side === 'PUT');
    if (rf && allLegs.some(l => l.side.startsWith('DIGIT'))) e.push('Rise/Fall can not be mixed with digit trades in one bot. Use one kind.');
    if (rf && (p.duration < 5 || p.duration > 10)) e.push('Rise/Fall needs 5 to 10 ticks.');
    return e;
};

const money = (n: number) => (n >= NO_LIMIT ? 'no limit' : n.toFixed(2).replace(/\.00$/, ''));
const scanText = (s: Scan, c: Choice): string => {
    const k = scanKindOf(c);
    const what = k ? (k.kind === 'EVENODD' ? 'Even or Odd' : k.kind === 'OVERUNDER' ? `Over or Under ${k.digit}` : legLabel(c.a)) : 'the outcome';
    const where = s.scope === 'all' ? (s.other ? 'every other volatility' : 'every volatility') : 'this volatility';
    return s.threshold > 0
        ? `scans ${where} (last ${s.count} ticks) for ${what} at ${s.threshold}% or more and moves to the best one`
        : `scans ${where} (last ${s.count} ticks) for ${what} and moves to the best one`;
};

/** The plan in plain sentences, for the chat and the panel. */
export const planRules = (p: Plan): string[] => {
    const out: string[] = [];
    p.stages.forEach((st, i) => {
        const head = i === 0 ? 'Every trade' : `After ${st.after} loss${st.after === 1 ? '' : 'es'} in a row`;
        let line = `${head}: `;
        const steps: string[] = [];
        if (st.market) steps.push(`goes to ${marketLabel(st.market)}`);
        if (st.scan) steps.push(scanText(st.scan, st.choice));
        steps.push(`trades ${choiceText(st.choice)}`);
        line += steps.join(', then ');
        if (st.scan) line += st.fallback ? `. If no volatility qualifies it stays here and trades ${choiceText(st.fallback)}` : st.scan.threshold > 0 ? '. If none qualifies it waits and scans again' : '';
        out.push(`${line}.`);
    });
    out.push(
        p.multiplier > 1
            ? `Stake ${money(p.stake)}, multiplied by ${p.multiplier} after every loss${p.maxStake ? ` (never above ${money(p.maxStake)})` : ''}, back to ${money(p.stake)} after a win. ${p.duration} tick${p.duration === 1 ? '' : 's'} per trade.`
            : `Flat stake ${money(p.stake)}, ${p.duration} tick${p.duration === 1 ? '' : 's'} per trade.`
    );
    if (p.enterWhen) out.push(`Only trades when ${condText(p.enterWhen)}.`);
    p.stages.forEach((st, i) => st.when && out.push(`${i === 0 ? 'The main trade' : `Stage ${i + 1}`} only runs when ${condText(st.when)}.`));
    p.stopWhen?.forEach(sw => out.push(`Also stops when ${condText(sw.cond)}.`));
    out.push(`Stops at ${money(p.takeProfit)} profit (and says "The Prime strategy worked") or at ${money(p.stopLoss)} loss.`);
    if (p.entry.mode === 'digit') out.push(`Only enters when the last digit is ${p.entry.op === 'EQ' ? '' : p.entry.op === 'GT' ? 'over ' : 'under '}${p.entry.digit}.`);
    out.push('Every scan, switch, trade, win and loss is written to the Journal.');
    return out;
};
