import type { Cond, CmpOp, Metric } from './plan';

/**
 * Reads yes/no conditions out of (already repaired and normalised) text: runs of digits, loss/win streaks, digit chances,
 * indicators (RSI, SMA, EMA, price), and combines them with AND / OR.
 */

const NUM = '(\\d+(?:\\.\\d+)?)';
const CMP_WORDS = '(above|over|greater than|more than|at least|below|under|less than|at most|equals?|is|crosses above|crosses below|>=|<=|>|<|=)';
const toOp = (w: string, hadNum = true): CmpOp => {
    if (/^(?:at least|>=)/.test(w)) return 'GTE';
    if (/^(?:at most|<=)/.test(w)) return 'LTE';
    if (/^(?:above|over|greater|more|crosses above|>)/.test(w)) return 'GT';
    if (/^(?:below|under|less|crosses below|<)/.test(w)) return 'LT';
    return hadNum ? 'EQ' : 'EQ';
};

type Atom = { cond: Cond; start: number; end: number; text: string };
const mk = (m: Metric, op: CmpOp, v: number | Metric): Cond => ({ t: 'cmp', m, op, v });
const RUNS: Record<string, 'RUN_EVEN' | 'RUN_ODD' | 'RUN_RISE' | 'RUN_FALL'> = { even: 'RUN_EVEN', odd: 'RUN_ODD', rising: 'RUN_RISE', rises: 'RUN_RISE', rise: 'RUN_RISE', falling: 'RUN_FALL', falls: 'RUN_FALL', fall: 'RUN_FALL' };
const KIND_NOUN = '(?:digits?|numbers?|results?|ticks?|outcomes?|times?)';

const indicator = (kind: string, period: string | undefined): Metric => ({ k: 'measure', m: kind.toUpperCase() as 'SMA' | 'EMA' | 'RSI', arg: period ? Number(period) : 14 });

const atoms = (t: string, skipChance = false): Atom[] => {
    const out: Atom[] = [];
    const add = (re: RegExp, f: (m: RegExpExecArray) => Cond | null) => {
        const r = new RegExp(re.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = r.exec(t))) {
            const c = f(m);
            if (c && !out.some(a => m!.index < a.end && m!.index + m![0].length > a.start)) out.push({ cond: c, start: m.index, end: m.index + m[0].length, text: m[0] });
        }
    };
    // losses / wins in a row
    add(new RegExp(`\\b${NUM}\\s+consecutive\\s+(loss(?:es)?|wins?)\\b|\\bconsecutive\\s+${NUM}\\s+(loss(?:es)?|wins?)\\b|\\b(loss|win)\\s+streak\\s+(?:of|is|reaches|=)?\\s*${NUM}\\b`), m => {
        const n = Number(m[1] ?? m[3] ?? m[6]);
        const w = m[2] ?? m[4] ?? m[5];
        return mk({ k: 'state', s: /^loss/.test(w) ? 'lossStreak' : 'winStreak' }, 'GTE', n);
    });
    // runs of even / odd / rising / falling
    add(new RegExp(`\\b${NUM}\\s+consecutive\\s+(even|odd|rising|falling|rises|falls)(?:\\s+${KIND_NOUN})?|\\bconsecutive\\s+${NUM}\\s+(even|odd|rising|falling)(?:\\s+${KIND_NOUN})?|\\b${NUM}\\s+(even|odd|rising|falling)\\s+${KIND_NOUN}\\s+consecutive\\b`), m => {
        const n = Number(m[1] ?? m[3] ?? m[5]);
        const w = m[2] ?? m[4] ?? m[6];
        return mk({ k: 'measure', m: RUNS[w] }, 'GTE', n);
    });
    add(new RegExp(`\\b${NUM}\\s+consecutive\\s+(over|under|above|below)\\s*(\\d)\\b|\\bconsecutive\\s+${NUM}\\s+(over|under|above|below)\\s*(\\d)\\b`), m => {
        const n = Number(m[1] ?? m[4]);
        const w = m[2] ?? m[5];
        return mk({ k: 'measure', m: /over|above/.test(w) ? 'RUN_OVER' : 'RUN_UNDER', arg: Number(m[3] ?? m[6]) }, 'GTE', n);
    });
    // digit chance
    if (!skipChance) add(new RegExp(`\\b(even|odd|(?:over|under)\\s*(\\d))\\s*(?:chance|probability|percentage|share|%|percent)?\\s*(?:is\\s+)?${CMP_WORDS}\\s*${NUM}\\s*(?:%|percent)(?:\\s+(?:in|over)\\s+the\\s+(?:last|past)\\s+${NUM}\\s+ticks)?`), m => {
        const k = m[1].startsWith('over') ? 'OVER' : m[1].startsWith('under') ? 'UNDER' : m[1] === 'even' ? 'EVEN' : 'ODD';
        return mk({ k: 'chance', kind: k, digit: m[2] ? Number(m[2]) : undefined, window: m[5] ? Number(m[5]) : 100 }, toOp(m[3]), Number(m[4]));
    });
    // indicators
    add(new RegExp(`\\b(rsi|sma|ema)\\s*\\(?\\s*${NUM}?\\s*\\)?\\s*(?:is\\s+)?${CMP_WORDS}\\s*(?:${NUM}\\b(?!\\s*(?:ticks?|%))|(sma|ema|price)\\s*\\(?\\s*${NUM}?\\s*\\)?)`), m => {
        const left = indicator(m[1], m[2]);
        if (m[4] !== undefined) return mk(left, toOp(m[3]), Number(m[4]));
        if (m[5] === undefined) return null;
        const right: Metric = m[5] === 'price' ? { k: 'measure', m: 'PRICE' } : indicator(m[5], m[6]);
        return mk(left, toOp(m[3]), right);
    });
    add(new RegExp(`\\bprice\\s*(?:is\\s+)?${CMP_WORDS}\\s*(sma|ema)\\s*\\(?\\s*${NUM}?\\s*\\)?`), m => mk({ k: 'measure', m: 'PRICE' }, toOp(m[1]), indicator(m[2], m[3])));
    // own trades
    add(new RegExp(`\\b(?:after|once|when|for)\\s+${NUM}\\s+trades\\b`), m => mk({ k: 'state', s: 'trades' }, 'GTE', Number(m[1])));
    return out.sort((a, b) => a.start - b.start);
};

/** One AND/OR tree from the atoms found in `t`, joined by the words between them (AND binds tighter than OR). */
export const parseConds = (t: string, opts: { skipChance?: boolean } = {}): { cond?: Cond; text: string; count: number } => {
    const list = atoms(t, opts.skipChance);
    if (!list.length) return { text: t, count: 0 };
    const groups: Cond[][] = [[list[0].cond]];
    for (let i = 1; i < list.length; i++) {
        const between = t.slice(list[i - 1].end, list[i].start);
        if (/\bor\b/.test(between) && !/\band\b/.test(between)) groups.push([list[i].cond]);
        else groups[groups.length - 1].push(list[i].cond);
    }
    const andOf = (c: Cond[]): Cond => (c.length === 1 ? c[0] : { t: 'and', c });
    const cond = groups.length === 1 ? andOf(groups[0]) : { t: 'or' as const, c: groups.map(andOf) };
    let rest = t;
    [...list].reverse().forEach(a => { rest = `${rest.slice(0, a.start)} ${rest.slice(a.end)}`; });
    return { cond, text: rest.replace(/\s+/g, ' '), count: list.length };
};

/** Metrics that only move after the bot has traded (so they can never start a bot that has not traded yet). */
export const usesOwnHistory = (c?: Cond): boolean => {
    if (!c) return false;
    if (c.t === 'cmp') return (c.m.k === 'state' && ['lossStreak', 'winStreak', 'trades', 'profit'].includes(c.m.s)) || (typeof c.v !== 'number' && c.v.k === 'state');
    return c.t === 'not' ? usesOwnHistory(c.c) : c.c.some(usesOwnHistory);
};
