import { understand } from '../brain';
import { repair } from '../spell';
import { buildPlanXml } from '../plan-xml';

describe('forgiving input', () => {
    it('repairs shorthand and typos', () => {
        expect(repair('make me a bot that trade v100 after 3 consecutive odd and put 2 dollas')).toContain('volatility 100');
        expect(repair('2 dollas')).toBe('2 dollars');
        expect(repair('3 consecutve evn')).toBe('3 consecutive even');
        expect(repair('marting ale of 2 and volitility 50')).toContain('volatility 50');
    });
});
describe('conditions', () => {
    it('wait for three consecutive evens then odd, v100, $2', () => {
        const u = understand('make me a bot that trade v100 after 3 consecutive even and enter odd, put 2 dollas')!;
        expect(u.plan.symbol).toBe('R_100');
        expect(u.plan.stake).toBe(2);
        expect(u.plan.stages[0].choice.a.side).toBe('DIGITODD');
        expect(u.plan.enterWhen).toMatchObject({ t: 'cmp', m: { k: 'measure', m: 'RUN_EVEN' }, op: 'GTE', v: 3 });
        const xml = buildPlanXml(u.plan);
        expect(xml).toContain('nx_metric');
        expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length).toBe(0);
    });
    it('indicators with AND / OR', () => {
        const u = understand('trade rise... no, trade even on vol 50 only when rsi 14 is below 30 and price is above sma 20, stop when rsi is above 80')!;
        expect(u.plan.enterWhen?.t).toBe('and');
        expect(u.plan.stopWhen?.length).toBe(1);
    });
    it('stop after two consecutive losses', () => {
        const u = understand('even on vol 25, stake 1, stop after two consecutive losses, take profit 10')!;
        expect(u.plan.stopWhen?.[0].cond).toMatchObject({ m: { s: 'lossStreak' }, op: 'GTE', v: 2 });
        expect(u.plan.takeProfit).toBe(10);
        expect(u.plan.stages.length).toBe(1);
        expect(buildPlanXml(u.plan)).toContain('Stop rule');
    });
    it('flags an entry that waits for losses before ever trading', () => {
        const u = understand('Create a bot that trades Volatility 100 after three consecutive losses.')!;
        expect(u.notes.join(' ')).toContain('DEADLOCK');
    });
});
