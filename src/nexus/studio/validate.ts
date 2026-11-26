import { validatePlan, type Plan } from './plan';
import { MIN_STAKE } from './bot-spec';

export type Check = { ok: boolean; label: string; detail?: string };

/** Longest losing streak the stop loss can absorb, and what the stake would be at the end of it. */
export const worstCase = (p: Plan): { steps: number; lastStake: number; spent: number } => {
    let stake = p.stake, spent = 0, steps = 0;
    while (steps < 50) {
        if (spent + stake > p.stopLoss) break;
        spent += stake; steps++;
        stake = Math.min(p.maxStake ?? Infinity, stake * p.multiplier);
        if (p.multiplier === 1 && steps >= 50) break;
    }
    return { steps, lastStake: Math.round(stake * 100) / 100, spent: Math.round(spent * 100) / 100 };
};

/** Every check the studio runs before a bot may be created, each with a plain-English result. */
export const checks = (p: Plan): Check[] => {
    const problems = validatePlan(p);
    const out: Check[] = [
        { ok: p.stages.length > 0, label: 'A trade is defined' },
        { ok: p.stake >= MIN_STAKE, label: 'Stake is at least the minimum', detail: `Stake ${p.stake}, minimum ${MIN_STAKE}.` },
        { ok: Number.isInteger(p.duration) && p.duration >= 1 && p.duration <= 10, label: 'Duration is valid', detail: `${p.duration} tick${p.duration === 1 ? '' : 's'}.` },
        { ok: p.takeProfit > 0 && p.stopLoss > 0, label: 'Take profit and stop loss are set' },
    ];
    const known = new Set(['A trade is defined']);
    const w = worstCase(p);
    out.push({ ok: !(p.multiplier > 1 && w.steps < 4), label: 'Risk: the stop loss survives a few losses in a row', detail: p.multiplier > 1 ? `With martingale ×${p.multiplier}, the stop loss is reached after about ${w.steps} losses in a row (last stake ${w.lastStake}).` : `Flat stake: about ${w.steps} losses fit inside the stop loss.` });
    problems.forEach(t => out.push({ ok: false, label: t.startsWith('DEADLOCK') ? 'The bot can start' : 'Rule check', detail: t.replace('DEADLOCK: ', '') }));
    if (!problems.length) out.push({ ok: true, label: 'Conditions, trades and stages are consistent' });
    return out.filter(c => !known.has(c.label) || c.ok);
};

/** The block stack of a generated bot, as an indented outline (for the "Blocks" panel). */
export const outlineXml = (xml: string): string[] => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const lines: string[] = [];
    const walk = (el: Element, depth: number) => {
        Array.from(el.children).forEach(c => {
            if (c.tagName === 'block' || c.tagName === 'shadow') {
                const t = c.getAttribute('type') || '';
                if (c.tagName === 'block' && !['math_number', 'text', 'variables_get'].includes(t)) {
                    const f = Array.from(c.children).find(x => x.tagName === 'field');
                    lines.push(`${'  '.repeat(depth)}${t}${f && !['trade_definition_market'].includes(t) ? ` · ${(f.textContent || '').slice(0, 24)}` : ''}`);
                }
                walk(c, depth + 1);
            } else walk(c, depth);
        });
    };
    walk(doc.documentElement, 0);
    return lines;
};
