import { extract, normalize, parseSide } from './nlu';
import { repair } from './spell';
import { parseConds } from './conds';
import { marketLabel, needsBarrier, NO_LIMIT, oppositeOf, type Draft, type Side } from './bot-spec';
import { legLabel, type Choice, type Leg } from './advanced';
import { condText, pairOf, planRules, scanKindOf, validatePlan, type Cond, type Plan, type Scan, type Stage } from './plan';

/**
 * The plain-English brain of Bot Studio. It reads a whole description ("trade even on the volatility with 70% and above,
 * martingale 2, recover with a different trade on a different volatility or the likelier one, then switch to over 4")
 * and builds a Plan: a main trade plus stages that take over after losses. Anything it had to guess is listed in `assumed`.
 */

export type Understood = { explicit: string[]; plan: Plan; rules: string[]; assumed: string[]; notes: string[]; spec: Pick<Draft, 'symbol' | 'side' | 'barrier'> };

const NUMS = '(\\d+(?:\\.\\d+)?)';
const LOSS = '(?:loss(?:es)?|lose|loses|lost|losing)';
const PROB = /\b(?:likel\w+|more\s+(?:often|likely)|probab\w*|higher\s+(?:chance|odds)|best\s+(?:chance|odds)|most\s+(?:often|frequent\w*))\b/;
const MARKET_WORD = '(?:volatilit(?:y|ies)|vol|markets?|index|indices|symbols?)';

/** First "70%", "70 percent", "percentage 70", "at least 70", "70 and above" found in the text. */
const findThreshold = (t: string): { value: number; text: string } | null => {
    const tail = '(?:\\s*\\+|\\s*(?:and|or)\\s+(?:above|over|up|more|higher|greater|better))?';
    const lead = '(?:at\\s+least|above|over|more\\s+than|greater\\s+than|>=?)?';
    const forms = [
        new RegExp(`(?:percentage|percent|chance|probability|share)\\s*(?:of|is|at|=|:)?\\s*${lead}\\s*${NUMS}\\s*%?${tail}`),
        new RegExp(`(?:at\\s+least|above|over|more\\s+than|>=?|reach(?:es|ing)?|hits?)\\s*${NUMS}\\s*(?:%|percent)${tail}`),
        new RegExp(`${NUMS}\\s*(?:%|percent(?:age)?)${tail}`),
        new RegExp(`${NUMS}\\s*(?:\\+|(?:and|or)\\s+(?:above|over|up|more|higher))`),
    ];
    for (const re of forms) {
        const m = t.match(re);
        if (m) {
            const value = Number(m[1]);
            if (value >= 0 && value <= 100) return { value, text: m[0] };
        }
    }
    return null;
};

const takeOut = (t: string, re: RegExp): { t: string; m: RegExpMatchArray | null } => {
    const m = t.match(re);
    return m ? { t: t.replace(m[0], ' '), m } : { t, m: null };
};

/** Does this text describe a bot the step-by-step Studio can't (percentage markets, market recovery, stages)? */
export const needsBrain = (raw: string): boolean => {
    const t = normalize(raw);
    if (findThreshold(t)) return true;
    if (new RegExp(`\\b(?:different|another|other|best|next)\\s+${MARKET_WORD}\\b`).test(t)) return true;
    if (/\b(?:switch(?:es)?|move(?:s)?|go(?:es)?|change(?:s)?)\s+(?:over\s+)?to\b/.test(t) && new RegExp(`\\b${LOSS}\\b`).test(t)) return true;
    if (new RegExp(`\\b(?:choos\\w+|pick\\w*|select\\w*|scan\\w*|find\\w*)\\s+(?:the\\s+)?(?:best\\s+)?${MARKET_WORD}\\b`).test(t)) return true;
    return false;
};

const leg = (side: Side, barrier?: number): Leg => ({ side, barrier: needsBarrier(side) ? barrier : undefined });

const familyOf = (s: Side): 'evenodd' | 'overunder' | 'other' => (s === 'DIGITEVEN' || s === 'DIGITODD' ? 'evenodd' : s === 'DIGITOVER' || s === 'DIGITUNDER' ? 'overunder' : 'other');

export const understand = (raw: string): Understood | null => {
    const assumed: string[] = [];
    const notes: string[] = [];
    let t = normalize(repair(raw));
    const stopWhen: { cond: Cond; say: string }[] = [];
    const entryConds: Cond[] = [];
    // stop rules: "stop after 2 consecutive losses", "quit when RSI is above 80"
    t = t.replace(/\b(?:stop|quit|exit|end|halt)\w*\s+(?:trading\s+)?(?:the\s+bot\s+)?(?:after|when|once|if|on)\s+([^,.;]*)/g, (m, clause: string) => {
        const r = parseConds(clause);
        if (!r.cond) return m;
        stopWhen.push({ cond: r.cond, say: `Stop rule: ${condText(r.cond)}` });
        return ` ${r.text} `;
    });

    // ticks the scan looks at: "in the last 50 ticks"
    let count = 100;
    {
        const r = takeOut(t, /\b(?:in|over|from|within)?\s*the\s+(?:last|past|recent|previous)\s+(\d+)\s*ticks?\b/);
        const r2 = r.m ? r : takeOut(t, /\b(?:last|past|recent|previous)\s+(\d+)\s*ticks?\b/);
        if (r2.m) { count = Math.min(1000, Math.max(10, Number(r2.m[1]))); t = r2.t; }
    }

    // stake plan words belong to the whole bot, wherever they appear ("martingale of 2 after a loss")
    let multiplier: number | null = null;
    {
        let r = takeOut(t, /\b(?:no|without)\s+martingale\b|\bflat\s+stake\b|\bsame\s+stake\b/);
        if (r.m) { multiplier = 1; t = r.t; }
        else if ((r = takeOut(t, new RegExp(`\\b(?:a\\s+|the\\s+|with\\s+|have\\s+|using\\s+|use\\s+)*martingale\\b(?:\\s*(?:of|x|by|at|=|:|with|multiplier)?\\s*${NUMS}\\s*x?)?(?:\\s+(?:after|on|when)\\s+(?:a\\s+|each\\s+|every\\s+)?${LOSS})?`))).m) {
            multiplier = r.m[1] ? Number(r.m[1]) : 2; t = r.t;
        } else if ((r = takeOut(t, new RegExp(`\\b${NUMS}\\s*x\\s*martingale\\b`))).m) { multiplier = Number(r.m[1]); t = r.t; }
        else if ((r = takeOut(t, new RegExp(`\\b(double|triple)s?\\b(?:\\s+(?:the\\s+)?stake)?\\s+(?:after|on|when)\\s+(?:a\\s+|each\\s+|every\\s+)?${LOSS}`))).m) { multiplier = r.m[1] === 'double' ? 2 : 3; t = r.t; }
    }

    // split at the first thing that talks about what happens after losing
    const MARK = new RegExp(`\\b(?:recover(?:y|ing|s|ed)?|recoup|(?:win|get)(?:ting)?\\s+it\\s+back|after\\s+(?:a\\s+|an\\s+|any\\s+|the\\s+|each\\s+|every\\s+|\\d+\\s+)?(?:more\\s+)?(?:consecutive\\s+)?${LOSS}|on\\s+(?:a\\s+)?${LOSS}|(?:when|if)\\s+(?:it|the\\s+bot|you|i)\\s+${LOSS}|(?:then\\s+|and\\s+|it\\s+|also\\s+)?(?:switch|move|go|change)(?:es)?\\s+(?:over\\s+)?to\\b)`);
    const cut = t.search(MARK);
    const head = cut < 0 ? t : t.slice(0, cut);
    const tail = cut < 0 ? '' : t.slice(cut);

    // ---------- the main trade ----------
    const headThr = findThreshold(head);
    const headNoThr = headThr ? head.replace(headThr.text, ' ') : head;
    const scanWords = new RegExp(`\\b(?:choos\\w+|pick\\w*|select\\w*|scan\\w*|find\\w*|best)\\s+(?:the\\s+|a\\s+)?(?:best\\s+)?(?:\\w+\\s+)?${MARKET_WORD}\\b`).test(head) || !!headThr;
    const hc = parseConds(headNoThr, { skipChance: scanWords });
    if (hc.cond) entryConds.push(hc.cond);
    const headClean = hc.text;
    const hp = extract(headClean, { looseStake: true });
    const tp = tail ? extract(tail, { looseStake: false }) : ({} as Draft);
    const pickFrom = <K extends keyof Draft>(k: K): Draft[K] => (hp[k] !== undefined ? hp[k] : tp[k]);

    let side: Side | undefined = hp.side;
    let barrier = hp.barrier;
    const likelyMain = (side === undefined || ['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER'].includes(side)) && (!!hp.pickBest || (PROB.test(head) && /\b(?:even|odd|over|under)\b.*\b(?:or|\/)\b/.test(head)));
    if (!side) {
        side = 'DIGITEVEN';
        assumed.push('You did not name the main trade, so it trades Even.');
    }
    if (needsBarrier(side) && barrier === undefined) {
        barrier = 4; // placeholder: the chat asks which digit (explicit 'barrier' is missing)
    }
    const mainLeg = leg(side, barrier);
    const mainChoice: Choice = likelyMain ? pairOf(mainLeg) : { a: mainLeg };

    // market choice by percentage
    const wantsScan = !!headThr || new RegExp(`\\b(?:choos\\w+|pick\\w*|select\\w*|scan\\w*|find\\w*|best)\\s+(?:the\\s+|a\\s+)?(?:best\\s+)?(?:\\w+\\s+)?${MARKET_WORD}\\b`).test(head);
    let mainScan: Scan | undefined;
    if (wantsScan) {
        mainScan = { threshold: headThr?.value ?? 0, count, scope: /\b(?:this|current|same)\s+(?:market|volatility)\b/.test(head) ? 'this' : 'all', other: false };
        if (!headThr) assumed.push('No percentage given for choosing the volatility, so it takes the best one available.');
    }
    const stages: Stage[] = [{ after: 0, choice: mainChoice, scan: mainScan && scanKindOf(mainChoice) ? mainScan : undefined }];
    if (mainScan && !scanKindOf(mainChoice)) notes.push('That trade can not be scanned by percentage, so it stays on one volatility.');

    // ---------- the stages after losses ----------
    const chunks = tail
        ? tail.split(/(?=\b(?:then\s+|and\s+then\s+|and\s+|finally\s+|eventually\s+|if\s+(?:it\s+)?(?:still|keeps?)\s+\w*\s*)?(?:it\s+)?(?:switch|move|go|change)(?:es)?\s+(?:over\s+)?to\b)/).map(c => c.trim()).filter(c => c.length > 2)
        : [];
    for (let i = 0; i < chunks.length - 1; i++) {
        // "after 3 losses" on its own belongs to the "switch to ..." that follows it
        if (/^(?:then\s+|and\s+)?(?:after|on|when|if)\b/.test(chunks[i]) && chunks[i].length < 45 && !/\brecover/.test(chunks[i]) && !parseSide(chunks[i]).side) {
            chunks.splice(i, 2, `${chunks[i]} ${chunks[i + 1]}`);
            i--;
        }
    }
    const lossMark = new RegExp(`\\b${LOSS}\\b`);
    chunks.forEach(chunk => {
        if (!/\b(?:recover\w*|switch\w*|move\w*|go(?:es)?|change\w*|different|another|likel\w+|opposite|then)\b/.test(chunk) && !parseSide(chunk).side) {
            const pc = parseConds(chunk);
            if (pc.cond) { entryConds.push(pc.cond); return; }
        }
        if (!lossMark.test(chunk) && !/\b(?:recover\w*|switch\w*|move\w*|go(?:es)?|change\w*|then|different|another|likel\w+)\b/.test(chunk)) return;
        const prev = stages[stages.length - 1];
        const idx = stages.length; // 1 = recovery, 2 = last resort ...
        // how many losses before it starts
        let after: number | null = null;
        const am = chunk.match(new RegExp(`\\bafter\\s+${NUMS}\\s*(more\\s+)?(?:consecutive\\s+)?${LOSS}`)) ?? chunk.match(new RegExp(`\\b${NUMS}\\s+${LOSS}\\s+in\\s+a\\s+row`));
        if (am) after = am[2] ? prev.after + Number(am[1]) : Number(am[1]);
        if (after === null || !(after > prev.after)) {
            after = prev.after + 1;
            if (idx > 1) assumed.push(`No loss count given for the last-resort switch, so it starts after ${after} losses in a row.`);
        }
        // "A, or B" -> A on a new volatility, B (the fallback) here
        const alt = chunk.split(/,?\s*\b(?:or|otherwise)\b\s+/);
        let mainPart = alt[0];
        const altPart = alt.slice(1).find(a => /\b(?:same|stay|current|here)\b/.test(a));
        const thr = findThreshold(mainPart);
        if (thr) mainPart = mainPart.replace(thr.text, ' ');
        const wantOther = new RegExp(`\\b(?:different|another|other|new|next)\\s+(?:${MARKET_WORD})\\b`).test(mainPart);
        const wantSame = new RegExp(`\\b(?:same|current)\\s+(?:${MARKET_WORD})\\b`).test(mainPart);
        const named = extract(mainPart.replace(/\bover\s+(\d)\b/g, ' ').replace(/\bunder\s+(\d)\b/g, ' '), { looseStake: false }).symbol;
        const differentType = /\b(?:different|another|other|new)\s+(?:trade|contract|type|trade\s+type|kind)\b/.test(mainPart);
        const likely = PROB.test(mainPart);
        const sd = parseSide(mainPart.replace(/\b(?:different|another|other)\s+trade\s+type\b/g, ' '));
        const baseSide = mainChoice.a.side;
        const fam = familyOf(baseSide);

        const resolve = (explicit: ReturnType<typeof parseSide>, isLikely: boolean, diff: boolean, text: string): Choice => {
            const pair = new RegExp('even\\s*(?:or|/|and|vs)\\s*odd|odd\\s*(?:or|/|and|vs)\\s*even').test(text) ? 'evenodd' : new RegExp('over\\s*(?:or|/|and|vs)\\s*under|under\\s*(?:or|/|and|vs)\\s*over').test(text) ? 'overunder' : null;
            if (pair === 'evenodd') return pairOf(leg('DIGITEVEN'));
            if (pair === 'overunder') return pairOf(leg('DIGITOVER', explicit.barrier ?? mainChoice.a.barrier ?? 4));
            if (explicit.side && !/^DIGIT(?:MATCH|DIFF)$/.test(explicit.side) && explicit.side !== 'CALL' && explicit.side !== 'PUT') {
                const bar = explicit.barrier ?? (needsBarrier(explicit.side) ? mainChoice.a.barrier ?? 4 : undefined);
                if (explicit.barrier === undefined && needsBarrier(explicit.side)) assumed.push(`No digit given for ${legLabel(leg(explicit.side, bar)).split(' ')[0]} in the recovery, so I used ${bar}.`);
                const l = leg(explicit.side, bar);
                return isLikely ? pairOf(l) : { a: l };
            }
            if (/\bopposite\b/.test(text)) return { a: leg(oppositeOf(baseSide) as Side, mainChoice.a.barrier) };
            if (diff) {
                const target = fam === 'overunder' ? pairOf(leg('DIGITEVEN')) : pairOf(leg('DIGITOVER', 4));
                assumed.push(`"Different trade type" is read as the likelier of ${fam === 'overunder' ? 'Even or Odd' : 'Over 4 or Under 4'}.`);
                return target;
            }
            if (isLikely) return fam === 'overunder' ? pairOf(leg('DIGITOVER', mainChoice.a.barrier ?? 4)) : pairOf(leg('DIGITEVEN'));
            return prev.choice;
        };

        const choice = resolve(sd, likely, differentType, mainPart);
        const stage: Stage = { after, choice };
        if (named) stage.market = named;
        else if (wantOther || (thr && !wantSame) || /\b(?:different|another)\s+volatility\b/.test(mainPart)) {
            const sk = scanKindOf(choice);
            if (sk) {
                stage.scan = { threshold: thr?.value ?? 0, count, scope: 'all', other: wantOther };
                if (!thr) assumed.push(`No percentage given for the recovery volatility, so it takes the best ${wantOther ? 'other ' : ''}one available.`);
            } else notes.push('The recovery trade can not be scanned by percentage, so it stays on this volatility.');
        }
        if (altPart && stage.scan) {
            const aSide = parseSide(altPart);
            const aLikely = PROB.test(altPart);
            stage.fallback = resolve(aSide, aLikely || (!aSide.side && familyOf(choice.a.side) !== 'other'), false, altPart);
        }
        stages.push(stage);
    });

    // recovery that names nothing it can act on: e.g. "recover" alone -> trade the likelier of the same family
    if (tail && stages.length === 1 && /\brecover/.test(tail)) {
        stages.push({ after: 1, choice: familyOf(mainChoice.a.side) === 'overunder' ? pairOf(leg('DIGITOVER', mainChoice.a.barrier ?? 4)) : pairOf(leg('DIGITODD')) });
        assumed.push('"Recover" with no details is read as: after a loss, trade the likelier of the two sides.');
    }

    // ---------- money and limits ----------
    const stake = pickFrom('stake') ?? 1;
    if (pickFrom('stake') === undefined) assumed.push('No stake given, so it uses 1.');
    const riseFall = side === 'CALL' || side === 'PUT';
    const duration = pickFrom('duration') ?? (riseFall ? 5 : 1);
    if (pickFrom('duration') === undefined) assumed.push(`No duration given, so each trade is ${riseFall ? 5 : 1} tick${riseFall ? 's' : ''}.`);
    let takeProfit = pickFrom('takeProfit');
    if (takeProfit === undefined) { takeProfit = 10; assumed.push('No take profit given, so it stops at 10 profit.'); }
    else if (takeProfit >= NO_LIMIT) takeProfit = NO_LIMIT;
    let stopLoss = pickFrom('stopLoss');
    if (stopLoss === undefined) { stopLoss = 30; assumed.push('No stop loss given, so it stops at 30 loss.'); }
    else if (stopLoss >= NO_LIMIT) stopLoss = NO_LIMIT;
    const mult = multiplier ?? (hp.multiplier ?? tp.multiplier ?? (hp.progression === 'martingale' || tp.progression === 'martingale' ? 2 : 1));
    if (mult !== 1 && !(mult > 1 && mult <= 10)) notes.push('The martingale multiplier must be above 1 and no more than 10, so I used 2.');
    const multiplierFinal = mult === 1 ? 1 : mult > 1 && mult <= 10 ? mult : 2;
    const entry = hp.entry ?? tp.entry;
    const maxStake = pickFrom('maxStake') ?? null;

    const symbol = hp.symbol ?? tp.symbol ?? 'R_100';
    if (!hp.symbol && !(stages[0].scan)) assumed.push(`No volatility given, so it starts on ${marketLabel(symbol)}.`);

    const explicit = [hp.side && 'side', hp.barrier !== undefined && 'barrier', pickFrom('stake') !== undefined && 'stake', pickFrom('takeProfit') !== undefined && 'takeProfit', pickFrom('stopLoss') !== undefined && 'stopLoss', multiplier !== null && 'multiplier', pickFrom('duration') !== undefined && 'duration', hp.symbol && 'symbol'].filter(Boolean) as string[];
    const enterWhen: Cond | undefined = entryConds.length === 0 ? undefined : entryConds.length === 1 ? entryConds[0] : { t: 'and', c: entryConds };
    const plan: Plan = {
        ...(enterWhen ? { enterWhen } : {}),
        ...(stopWhen.length ? { stopWhen } : {}),
        name: pickFrom('name') ?? defaultPlanName(stages),
        symbol, stake, duration, takeProfit, stopLoss,
        multiplier: multiplierFinal, maxStake: typeof maxStake === 'number' ? maxStake : null, window: 100,
        entry: entry?.mode === 'digit' && entry.op && entry.digit !== undefined ? { mode: 'digit', op: entry.op, digit: entry.digit } : { mode: 'any' },
        stages,
    };
    const problems = validatePlan(plan);
    if (problems.length) notes.push(...problems);
    if (!stages.length || (side === undefined && !raw.trim())) return null;
    return { explicit, plan, rules: planRules(plan), assumed: [...new Set(assumed)], notes: [...new Set(notes)], spec: { symbol, side: mainLeg.side, barrier: mainLeg.barrier } };
};

export const defaultPlanName = (stages: Stage[]): string => {
    const m = stages[0];
    const label = legLabel(m.choice.a) + (m.choice.b ? ' / ' + legLabel(m.choice.b) : '');
    return `${label}${m.scan ? ` ${m.scan.threshold}%+ scanner` : ''}${stages.length > 1 ? ' with recovery' : ''}`.slice(0, 40);
};

/** Finished BotSpec (what My Bots stores) from an understood plan. */
export const planToSpec = (u: Understood, name?: string) => {
    const p = u.plan;
    const a = p.stages[0].choice.a;
    return {
        name: (name ?? p.name).trim() || p.name,
        symbol: p.symbol, side: a.side, barrier: a.barrier,
        stake: p.stake, duration: p.duration,
        progression: p.multiplier > 1 ? ('martingale' as const) : ('flat' as const), multiplier: p.multiplier > 1 ? p.multiplier : undefined,
        maxStake: p.maxStake, takeProfit: p.takeProfit, stopLoss: p.stopLoss, entry: p.entry,
        plan: { ...p, name: (name ?? p.name).trim() || p.name },
    };
};
