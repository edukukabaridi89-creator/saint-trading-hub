import { kindOf, needsBarrier, NO_LIMIT, SIDE_LABEL, marketLabel } from './bot-spec';
import { legLabel, xmlKit, type Choice, type Leg } from './advanced';
import { scanKindOf, type Cond, type Metric, type Plan, type Scan, type Stage } from './plan';

/** Bot Builder XML for a Plan. Every decision the bot takes also writes a line to the Journal. */

const { joinNotify, Vars, chain, ifElse, compare, arith, notifyJoin, switchTrade, chance, num, shadowNum, id, reset } = xmlKit;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textShadow = (t: string) => `<shadow type="text"><field name="TEXT">${esc(t)}</field></shadow>`;
const textBlock = (t: string) => `<block type="text"><field name="TEXT">${esc(t)}</field></block>`;

type Part = string | { v: string };
const say = (kind: 'success' | 'info' | 'warn', parts: Part[]) => joinNotify(kind, parts);

const scanBlock = (sc: Scan, c: Choice) => {
    const k = scanKindOf(c)!;
    return `<block type="nx_scan_pick"><field name="SCOPE">${sc.scope}</field><field name="KIND">${k.kind}</field><field name="DIGIT">${k.digit}</field><field name="THRESHOLD">${sc.threshold}</field><field name="COUNT">${sc.count}</field><field name="OTHER">${sc.other ? 'other' : 'any'}</field></block>`;
};
const digitField = (l: Leg) => (needsBarrier(l.side) ? String(l.barrier ?? 0) : 'null');
const CHANCE_SIDE = new Set(['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER']);

const STATE_VAR = { lossStreak: 'losses', winStreak: 'wins', trades: 'trades', profit: 'total', stake: 'stake' } as const;

export const buildPlanXml = (p: Plan): string => {
    reset();
    const v = new Vars();
    const metric = (m: Metric): string =>
        m.k === 'state' ? v.get(STATE_VAR[m.s])
            : m.k === 'chance' ? `<block type="nx_digit_chance"><field name="KIND">${m.kind}</field><field name="DIGIT">${m.digit ?? 0}</field><field name="COUNT">${m.window ?? 100}</field></block>`
            : `<block type="nx_metric"><field name="METRIC">${m.m}</field><field name="ARG">${m.arg ?? (['SMA', 'EMA', 'RSI'].includes(m.m) ? 14 : 0)}</field></block>`;
    const cond = (c: Cond): string =>
        c.t === 'cmp' ? compare(c.op, metric(c.m), typeof c.v === 'number' ? num(c.v) : metric(c.v))
            : c.t === 'not' ? `<block type="logic_negate"><value name="BOOL">${cond(c.c)}</value></block>`
            : c.c.map(cond).reduce((a, b) => `<block type="logic_operation"><field name="OP">${c.t === 'and' ? 'AND' : 'OR'}</field><value name="A">${a}</value><value name="B">${b}</value></block>`);
    const main = p.stages[0].choice.a;
    const { tradetype, tradetypecat } = kindOf(main.side);
    const mainNeedsDigit = needsBarrier(main.side);
    const capped = p.maxStake !== null && p.maxStake < NO_LIMIT;
    let stockUsed = false;

    /** Journal line, trade switch and purchase for one leg. The first purchase uses the stock block (Bot Builder needs one). */
    const buyLeg = (l: Leg, why: string) => {
        const stock = !stockUsed;
        stockUsed = true;
        const buy = stock ? `<block type="purchase"><field name="PURCHASE_LIST">${l.side}</field></block>` : `<block type="nx_purchase_any"><field name="CONTRACT">${l.side}</field></block>`;
        return chain([
            say('info', [`${why}Trading ${legLabel(l)}, stake `, { v: v.get('stake') }, ' USD.']),
            v.set('waited', num(0)),
            switchTrade('', digitField(l)),
            buy,
        ]);
    };
    const buyChoice = (c: Choice, why: string) => {
        if (!c.b) return buyLeg(c.a, why);
        const [a, b] = [c.a, c.b];
        const pick = (x: Leg) => `${why}${legLabel(x)} is the likelier. `;
        return ifElse(compare('GTE', chance(a, p.window), chance(b, p.window)), buyLeg(a, pick(a)), buyLeg(b, pick(b)));
    };

    const runStage = (st: Stage, index: number): string => {
        const why = index === 0 ? '' : `Recovery (after ${st.after} loss${st.after === 1 ? '' : 'es'}): `;
        const go = (c: Choice) => buyChoice(c, why);
        const steps: string[] = [];
        if (st.market) steps.push(say('info', [`${why}Moving to ${marketLabel(st.market)}.`]), switchTrade(st.market, ''));
        if (st.scan && scanKindOf(st.choice)) {
            const sc = st.scan;
            const need = sc.threshold > 0 ? ` at ${sc.threshold}% or more` : '';
            const hit = chain([say('info', [`${why}Scan chose `, { v: v.get('picked') }, `${need ? ` (${need.trim()})` : ''}.`]), go(st.choice)]);
            const miss = st.fallback
                ? chain([say('info', [`${why}No volatility${need}. Staying here.`]), go(st.fallback)])
                : ifElse(compare('EQ', v.get('waited'), num(0)), chain([say('info', [`${why}No volatility${need} yet. Waiting and scanning again.`]), v.set('waited', num(1))]));
            steps.push(v.set('picked', scanBlock(sc, st.choice)), ifElse(compare('NEQ', v.get('picked'), textBlock('')), hit, miss));
        } else steps.push(go(st.choice));
        return chain(steps);
    };

    // ---- before purchase: pick the stage from the losses in a row ----
    const last = p.stages.length - 1;
    const bodies = p.stages.map((st, i) => (st.when ? ifElse(cond(st.when), runStage(st, i)) : runStage(st, i))); // built in order so the stock Purchase block lands in the main trade
    let decide = bodies[last];
    for (let i = last - 1; i >= 0; i--) decide = ifElse(compare('LT', v.get('losses'), num(p.stages[i + 1].after)), bodies[i], decide);
    if (p.enterWhen) decide = ifElse(cond(p.enterWhen), decide);
    if (p.entry.mode === 'digit') decide = ifElse(compare(p.entry.op, '<block type="last_digit"></block>', num(p.entry.digit)), decide);

    // ---- after purchase ----
    const onWin = chain([
        v.change('wins', num(1)),
        say('success', ['Won. Profit so far ', { v: v.get('total') }, ' USD. ', { v: v.get('wins') }, ' wins in a row.']),
        ifElse(compare('GT', v.get('losses'), num(0)), say('info', ['Recovered. Back to the main trade.'])),
        v.set('losses', num(0)),
        v.set('stake', v.get('base')),
    ]);
    const onLoss = chain([
        v.change('losses', num(1)),
        v.set('wins', num(0)),
        p.multiplier !== 1 ? v.set('stake', arith('MULTIPLY', v.get('stake'), num(p.multiplier))) : '',
        capped ? ifElse(compare('GT', v.get('stake'), num(p.maxStake as number)), v.set('stake', num(p.maxStake as number))) : '',
        say('warn', ['Lost. ', { v: v.get('losses') }, ' in a row. Total ', { v: v.get('total') }, ' USD. Next stake ', { v: v.get('stake') }, ' USD.']),
        ...p.stages.slice(1).map(st => ifElse(compare('EQ', v.get('losses'), num(st.after)), say('info', [`Reached ${st.after} loss${st.after === 1 ? '' : 'es'} in a row. Switching to the recovery plan.`]))),
    ]);
    const after = chain([
        v.change('total', '<block type="read_details"><field name="DETAIL_INDEX">4</field></block>'),
        v.change('trades', num(1)),
        ifElse('<block type="contract_check_result"><field name="CHECK_RESULT">win</field></block>', onWin, onLoss),
        ifElse(
            compare('GTE', v.get('total'), num(p.takeProfit)),
            notifyJoin('success', 'The Prime strategy worked, printed ', v.get('total'), ' USD. Bot stopped.'),
            ifElse(
                compare('LTE', v.get('total'), num(-p.stopLoss)),
                say('warn', ['Stop loss reached. Total ', { v: v.get('total') }, ' USD. Bot stopped.']),
                (p.stopWhen ?? []).reduceRight((tail, sw) => ifElse(cond(sw.cond), say('warn', [`${sw.say || 'Stop rule reached'}. Bot stopped. Total `, { v: v.get('total') }, ' USD.']), tail), '<block type="trade_again"></block>')
            )
        ),
    ]);

    const init = chain([
        v.set('base', num(p.stake)),
        v.set('stake', num(p.stake)),
        v.set('losses', num(0)),
        v.set('wins', num(0)),
        v.set('trades', num(0)),
        v.set('total', num(0)),
        v.set('waited', num(0)),
        v.set('picked', textBlock('')),
    ]);
    const predictionInput = mainNeedsDigit ? `<value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">${main.barrier ?? 0}</field></shadow></value>` : '';
    const body = `<block type="trade_definition" id="${id()}" deletable="false" x="0" y="0">
<statement name="TRADE_OPTIONS"><block type="trade_definition_market" deletable="false" movable="false"><field name="MARKET_LIST">synthetic_index</field><field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">${p.symbol}</field><next>
<block type="trade_definition_tradetype" deletable="false" movable="false"><field name="TRADETYPECAT_LIST">${tradetypecat}</field><field name="TRADETYPE_LIST">${tradetype}</field><next>
<block type="trade_definition_contracttype" deletable="false" movable="false"><field name="TYPE_LIST">both</field><next>
<block type="trade_definition_candleinterval" deletable="false" movable="false"><field name="CANDLEINTERVAL_LIST">60</field><next>
<block type="trade_definition_restartbuysell" deletable="false" movable="false"><field name="TIME_MACHINE_ENABLED">FALSE</field><next>
<block type="trade_definition_restartonerror" deletable="false" movable="false"><field name="RESTARTONERROR">TRUE</field></block>
</next></block></next></block></next></block></next></block></next></block></statement>
<statement name="INITIALIZATION">${init}</statement>
<statement name="SUBMARKET"><block type="trade_definition_tradeoptions"><mutation has_first_barrier="false" has_second_barrier="false" has_prediction="${mainNeedsDigit}"></mutation><field name="DURATIONTYPE_LIST">t</field><field name="CURRENCY_LIST">USD</field>
<value name="DURATION">${shadowNum(p.duration)}</value>
<value name="AMOUNT">${shadowNum(p.stake)}${v.get('stake')}</value>${predictionInput}</block></statement>
</block>
<block type="before_purchase" x="0" y="420"><statement name="BEFOREPURCHASE_STACK">${decide}</statement></block>
<block type="after_purchase" x="640" y="0"><statement name="AFTERPURCHASE_STACK">${after}</statement></block>`;
    return `<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true" collection="false">${v.declarations()}${body}</xml>`;
};

export { SIDE_LABEL };
