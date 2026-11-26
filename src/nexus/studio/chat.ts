import { normalize } from './nlu';
import { repair } from './spell';
import { parseSide } from './nlu';
import { condText, pairOf, planRules, validatePlan, type Plan } from './plan';
import { defaultPlanName, understand, type Understood } from './brain';
import { needsBarrier, NO_LIMIT, SIDE_LABEL } from './bot-spec';

/**
 * Conversation manager for Bot Studio: remembers the bot being built, applies each message to it as a change (never a
 * rebuild), asks only for what is really missing, and refuses to claim a change that did not validate.
 * Runs entirely in the browser, with no AI service and no key.
 */

export type Pending = 'side' | 'barrier' | 'stake' | 'exits' | 'deadlock' | 'name' | null;
export type ChatChip = { label: string; text?: string; action?: 'create' | 'test' | 'undo' | 'restart' };
export type Session = {
    cur: Understood | null;
    undo: Understood[]; // earlier versions, newest last
    pending: Pending;
    asked: string[]; // questions already put to the user, so they are never repeated
};
export type Reply = { say: string[]; chips: ChatChip[]; session: Session; changed: boolean; ready: boolean };

export const newSession = (): Session => ({ cur: null, undo: [], pending: null, asked: [] });

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const YES = /^\s*(?:yes|yep|yeah|create|create it|create bot|build|build it|go ahead|do it|make it|ok|okay|looks good|confirm|save)\b/;

const hasExplicit = (u: Understood | null, k: string) => !!u?.explicit.includes(k);

/** Applies what a new message says on top of the bot so far. Only things the message actually states are changed. */
const merge = (prev: Understood | null, next: Understood, text: string): Understood => {
    if (!prev) return next;
    const p = clone(prev.plan);
    const n = next.plan;
    const ex = new Set(next.explicit);
    if (ex.has('stake')) p.stake = n.stake;
    if (ex.has('duration')) p.duration = n.duration;
    if (ex.has('takeProfit')) p.takeProfit = n.takeProfit;
    if (ex.has('stopLoss')) p.stopLoss = n.stopLoss;
    if (ex.has('multiplier')) p.multiplier = n.multiplier;
    if (ex.has('symbol')) p.symbol = n.symbol;
    if (ex.has('side') || ex.has('barrier')) {
        p.stages[0].choice = n.stages[0].choice;
        if (!ex.has('side') && ex.has('barrier')) p.stages[0].choice = prev.plan.stages[0].choice;
    }
    if (n.stages[0].scan) p.stages[0].scan = n.stages[0].scan;
    if (n.stages.length > 1) p.stages = [p.stages[0], ...n.stages.slice(1)];
    const adding = /\b(?:add|also|another|and also|as well|plus)\b/.test(text);
    if (n.enterWhen) p.enterWhen = adding && p.enterWhen ? { t: 'and', c: [p.enterWhen, n.enterWhen] } : n.enterWhen;
    if (n.stopWhen?.length) p.stopWhen = [...(p.stopWhen ?? []), ...n.stopWhen];
    if (n.entry.mode === 'digit') p.entry = n.entry;
    p.name = defaultPlanName(p.stages);
    const explicit = [...new Set([...prev.explicit, ...next.explicit])];
    return { ...prev, plan: p, explicit, rules: planRules(p), assumed: next.assumed, notes: next.notes };
};

/** First thing the bot still needs from the user, or null. Nothing important is invented silently. */
const missing = (u: Understood, asked: string[]): Pending => {
    const side = u.plan.stages[0].choice.a.side;
    if (!hasExplicit(u, 'side') && !asked.includes('side')) return 'side';
    if (needsBarrier(side) && !hasExplicit(u, 'barrier') && !asked.includes('barrier')) return 'barrier';
    if (!hasExplicit(u, 'stake') && !asked.includes('stake')) return 'stake';
    if (!hasExplicit(u, 'takeProfit') && !hasExplicit(u, 'stopLoss') && !asked.includes('exits')) return 'exits';
    return null;
};

const ask = (what: Pending, u: Understood): { say: string; chips: ChatChip[] } => {
    switch (what) {
        case 'side':
            return { say: 'What should it trade?', chips: ['Even', 'Odd', 'Over 3', 'Under 6', 'Matches', 'Differs', 'Rise', 'Fall'].map(l => ({ label: l, text: l })) };
        case 'barrier': {
            const s = u.plan.stages[0].choice.a.side;
            return { say: `Which digit for ${SIDE_LABEL[s]}? Use 0 to 9.`, chips: Array.from({ length: 10 }, (_, i) => ({ label: String(i), text: String(i) })) };
        }
        case 'stake':
            return { say: 'How much per trade?', chips: ['0.35', '1', '2', '5', '10'].map(l => ({ label: `$${l}`, text: `stake ${l}` })) };
        case 'exits':
            return {
                say: 'When should it stop? Give me a take profit and a stop loss, for example "take profit 10, stop loss 30".',
                chips: [{ label: 'TP 10, SL 30', text: 'take profit 10 stop loss 30' }, { label: 'TP 5, SL 15', text: 'take profit 5 stop loss 15' }, { label: 'TP 20, SL 50', text: 'take profit 20 stop loss 50' }],
            };
        default:
            return { say: '', chips: [] };
    }
};

const describeChange = (a: Plan, b: Plan): string[] => {
    const ra = planRules(a), rb = planRules(b);
    const added = rb.filter(r => !ra.includes(r));
    return added;
};

const finish = (s: Session, say: string[], changed: boolean, u: Understood | null): Reply => {
    const pending = u ? missing(u, s.asked) : null;
    if (u && pending && pending !== 'deadlock') {
        const q = ask(pending, u);
        s.pending = pending;
        s.asked = [...s.asked, pending];
        return { say: [...say, q.say], chips: q.chips, session: s, changed, ready: false };
    }
    s.pending = null;
    return {
        say, session: s, changed, ready: !!u,
        chips: u ? [{ label: 'Create bot', action: 'create' }, { label: 'Test on recent ticks', action: 'test' }, ...(s.undo.length ? [{ label: 'Undo last change', action: 'undo' } as ChatChip] : [])] : [],
    };
};

const deadlockReply = (s: Session, u: Understood): Reply => {
    const say = [
        `The entry condition (${u.plan.enterWhen ? condText(u.plan.enterWhen) : 'losses first'}) counts this bot's own trades or losses. It cannot have any before its first trade, so it would never start, and Deriv gives no way to count "virtual" losses for a bot that is not trading.`,
        'What I can do instead: wait for a pattern in the market itself (for example three Even digits in a row), or start trading right away and switch to a different trade after losses.',
    ];
    s.pending = 'deadlock';
    return {
        say, session: s, changed: false, ready: false,
        chips: [
            { label: 'Wait for 3 Even in a row', text: 'replace the entry condition: wait for 3 consecutive even' },
            { label: 'Wait for 3 Odd in a row', text: 'replace the entry condition: wait for 3 consecutive odd' },
            { label: 'Trade now, change after 3 losses', text: 'trade every tick, after 3 losses recover with the likelier trade' },
        ],
    };
};

export const respond = (prev: Session, raw: string): Reply => {
    const s: Session = clone(prev);
    const text = normalize(repair(raw));

    if (/\b(?:start over|start again|reset|new bot|from scratch)\b/.test(text)) return { say: ['Cleared. Tell me about the bot you want.'], chips: [], session: newSession(), changed: true, ready: false };
    if (/^\s*undo\b|\b(?:undo|go back|revert)\b/.test(text)) {
        const last = s.undo.pop();
        if (!last) return { say: ['There is nothing to undo yet.'], chips: [], session: s, changed: false, ready: !!s.cur };
        s.cur = last;
        return finish(s, ['Undone. Back to the earlier version of the bot.'], true, s.cur);
    }
    if (s.cur && YES.test(text) && !missing(s.cur, s.asked)) return { say: [], chips: [], session: s, changed: false, ready: true };
    if (s.cur && /\b(?:explain|show (?:me )?the logic|how does it work|what does it do|why)\b/.test(text)) {
        return finish(s, ['Here is exactly what the bot does:\n' + s.cur.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')], false, s.cur);
    }
    if (s.cur && /\b(?:remove|delete|drop)\b.*\b(?:last |latest )?(?:condition|rule)\b/.test(text)) {
        const p = clone(s.cur.plan);
        if (p.stopWhen?.length) p.stopWhen.pop();
        else if (p.enterWhen) delete p.enterWhen;
        else return { say: ['There is no extra condition to remove.'], chips: [], session: s, changed: false, ready: true };
        s.undo.push(s.cur);
        s.cur = { ...s.cur, plan: p, rules: planRules(p) };
        return finish(s, ['Removed it. ' + (describeChange(clone(s.undo[s.undo.length - 1].plan), p).length ? '' : 'The rules now read:\n' + s.cur.rules.join('\n'))], true, s.cur);
    }
    if (s.cur && /\b(?:more conservative|safer|less risk|lower risk)\b/.test(text)) {
        return {
            say: ['I will not change your strategy without your say-so. Safer options:'], session: s, changed: false, ready: true,
            chips: [{ label: 'Halve the stake', text: `stake ${Math.max(0.35, Math.round((s.cur.plan.stake / 2) * 100) / 100)}` }, { label: 'No martingale', text: 'no martingale' }, { label: 'Stop after 2 losses in a row', text: 'stop after 2 consecutive losses' }, { label: 'Stop loss 10', text: 'stop loss 10' }],
        };
    }

    // answers to the question that was just asked
    let input = raw;
    if (s.pending === 'barrier' && s.cur) {
        const m = text.match(/\b(\d)\b/);
        if (m) {
            const p = clone(s.cur.plan);
            const a = p.stages[0].choice;
            const side = a.a.side;
            p.stages[0].choice = a.b ? pairOf({ side, barrier: Number(m[1]) }) : { a: { side, barrier: Number(m[1]) } };
            const problems = validatePlan(p);
            if (problems.length) return finish(s, [problems[0]], false, s.cur);
            s.undo.push(s.cur);
            s.cur = { ...s.cur, plan: p, explicit: [...s.cur.explicit, 'barrier'], rules: planRules(p) };
            return finish(s, [`${SIDE_LABEL[side]} ${m[1]}, noted.`], true, s.cur);
        }
    }
    if (s.pending === 'stake' && s.cur && /^\s*\$?\d+(?:\.\d+)?\s*(?:dollars?)?\s*$/.test(text)) input = `stake ${text.replace(/[^\d.]/g, '')}`;
    if (s.pending === 'exits' && s.cur && /^\s*(?:no|none|skip|no limits?|nothing)\b/.test(text)) {
        const p = clone(s.cur.plan);
        p.takeProfit = NO_LIMIT; p.stopLoss = NO_LIMIT;
        s.undo.push(s.cur);
        s.cur = { ...s.cur, plan: p, explicit: [...s.cur.explicit, 'takeProfit', 'stopLoss'], rules: planRules(p) };
        return finish(s, ['No take profit and no stop loss. The bot keeps trading until you stop it.'], true, s.cur);
    }
    if (s.pending === 'side' && s.cur) {
        const sd = parseSide(text);
        if (sd.side) input = `${SIDE_LABEL[sd.side]} ${sd.barrier ?? ''} ${raw.replace(/\b(?:even|odd|over|under|match\w*|differ\w*|rise|fall)\b/gi, '')}`;
    }

    const next = understand(input);
    if (!next) return finish(s, ["I couldn't turn that into a change. Tell me what to trade, for example \"even on vol 50 after 3 consecutive odd, stake 1\"."], false, s.cur);

    const before = s.cur;
    const merged = s.pending === 'deadlock' && before ? mergeReplacingEntry(before, next, text) : merge(before, next, text);
    const problems = validatePlan(merged.plan);
    const dead = problems.find(p => p.startsWith('DEADLOCK'));
    if (dead && !before?.plan.enterWhen) {
        s.cur = { ...merged, plan: { ...merged.plan, enterWhen: undefined }, rules: planRules({ ...merged.plan, enterWhen: undefined }) };
        return deadlockReply(s, merged);
    }
    const hard = problems.filter(p => !p.startsWith('DEADLOCK'));
    if (hard.length) {
        const say = ['I did not apply that, because it would make an invalid bot:', ...hard.map(h => `• ${h}`)];
        return finish(s, say, false, before);
    }
    if (before) s.undo.push(before);
    if (s.undo.length > 30) s.undo.shift();
    s.cur = merged;

    const lines: string[] = [];
    if (!before) lines.push('Here is the bot as I understand it:\n' + merged.rules.map((r, i) => `${i + 1}. ${r}`).join('\n'));
    else {
        const added = describeChange(before.plan, merged.plan);
        lines.push(added.length ? `Done. The bot now reads:\n${added.map(a => `• ${a}`).join('\n')}` : 'I read that, but nothing in the bot changed.');
    }
    const questions = missing(merged, s.asked);
    if (!before && merged.assumed.length && !questions) lines.push(`I filled in what you did not say:\n${merged.assumed.map(a => `• ${a}`).join('\n')}`);
    if (merged.notes.length) lines.push(`Careful:\n${merged.notes.filter(n => !n.startsWith('DEADLOCK')).map(a => `• ${a}`).join('\n')}`.trimEnd());
    return finish(s, lines.filter(l => l.trim() !== 'Careful:'), !!lines.length && !!(before ? describeChange(before.plan, merged.plan).length : true), merged);
};

/** After a deadlock explanation: the new condition replaces the old one instead of being added to it. */
const mergeReplacingEntry = (prev: Understood, next: Understood, text: string): Understood => {
    const base: Understood = { ...prev, plan: { ...prev.plan, enterWhen: undefined } };
    const m = merge(base, next, text);
    return m;
};

export const _internals = { missing, merge };
