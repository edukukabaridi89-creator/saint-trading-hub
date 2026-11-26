import { xmlKit } from './advanced';

const { Vars, chain, ifElse, compare, arith, notify, notifyJoin, num, shadowNum, id, reset } = xmlKit;

/**
 * Basic Bot (free bot #1). Every setting sits in the "Run once at start" block: Stake, Martingale, Take Profit, Stop Loss, Ticks.
 * It starts on Even/Odd (Even). To use another trade type, change the "Trade type" and the Purchase block in Bot Builder as with
 * any bot: the stake, martingale, take profit and stop loss logic stays exactly the same for every trade type.
 * Stake is multiplied by Martingale after a loss and reset after a win; it stops at take profit or stop loss.
 */
export const BASIC_BOT_NAME = 'Basic Bot (any trade type)';

export const buildBasicXml = (): string => {
    reset();
    const v = new Vars();
    const init = chain([
        v.set('Stake', num(1)),
        v.set('Initial Stake', num(1)),
        v.set('Martingale', num(2)),
        v.set('Take Profit', num(10)),
        v.set('Stop Loss', num(30)),
        v.set('Ticks', num(1)),
        v.set('Total', num(0)),
    ]);
    const after = chain([
        v.change('Total', '<block type="read_details"><field name="DETAIL_INDEX">4</field></block>'),
        ifElse(
            '<block type="contract_check_result"><field name="CHECK_RESULT">win</field></block>',
            v.set('Stake', v.get('Initial Stake')),
            v.set('Stake', arith('MULTIPLY', v.get('Stake'), v.get('Martingale')))
        ),
        ifElse(
            compare('GTE', v.get('Total'), v.get('Take Profit')),
            notifyJoin('success', 'The Prime strategy worked, printed ', v.get('Total'), ' USD. Bot stopped.'),
            ifElse(compare('LTE', v.get('Total'), arith('MINUS', num(0), v.get('Stop Loss'))), notify('warn', 'Stop loss reached. Bot stopped.'), '<block type="trade_again"></block>')
        ),
    ]);
    const body = `<block type="trade_definition" id="${id()}" deletable="false" x="0" y="0">
<statement name="TRADE_OPTIONS"><block type="trade_definition_market" deletable="false" movable="false"><field name="MARKET_LIST">synthetic_index</field><field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">R_100</field><next>
<block type="trade_definition_tradetype" deletable="false" movable="false"><field name="TRADETYPECAT_LIST">digits</field><field name="TRADETYPE_LIST">evenodd</field><next>
<block type="trade_definition_contracttype" deletable="false" movable="false"><field name="TYPE_LIST">both</field><next>
<block type="trade_definition_candleinterval" deletable="false" movable="false"><field name="CANDLEINTERVAL_LIST">60</field><next>
<block type="trade_definition_restartbuysell" deletable="false" movable="false"><field name="TIME_MACHINE_ENABLED">FALSE</field><next>
<block type="trade_definition_restartonerror" deletable="false" movable="false"><field name="RESTARTONERROR">TRUE</field></block>
</next></block></next></block></next></block></next></block></next></block></statement>
<statement name="INITIALIZATION">${init}</statement>
<statement name="SUBMARKET"><block type="trade_definition_tradeoptions"><mutation has_first_barrier="false" has_second_barrier="false" has_prediction="false"></mutation><field name="DURATIONTYPE_LIST">t</field><field name="CURRENCY_LIST">USD</field>
<value name="DURATION">${shadowNum(1)}${v.get('Ticks')}</value>
<value name="AMOUNT">${shadowNum(1)}${v.get('Stake')}</value></block></statement>
</block>
<block type="before_purchase" x="0" y="420"><statement name="BEFOREPURCHASE_STACK"><block type="purchase"><field name="PURCHASE_LIST">DIGITEVEN</field></block></statement></block>
<block type="after_purchase" x="640" y="0"><statement name="AFTERPURCHASE_STACK">${after}</statement></block>`;
    return `<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true" collection="false">${v.declarations()}${body}</xml>`;
};
