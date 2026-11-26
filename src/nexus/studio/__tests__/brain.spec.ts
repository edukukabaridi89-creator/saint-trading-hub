import { needsBrain, understand, planToSpec } from '../brain';
import { buildPlanXml } from '../plan-xml';
import { buildBotXml } from '../templates';

const A = 'I need a bot that trades on even by choosing the volatility with the percentage 70 and above and have a martingale of two';
const B = `${A}, but it recovers with a different trade type and different volatility, or same but the likelier one, and switches to over four`;

describe('Bot Studio brain', () => {
    it('reads example 1: even, scan 70%+, martingale 2', () => {
        expect(needsBrain(A)).toBe(true);
        const u = understand(A)!;
        const s = u.plan.stages[0];
        expect(s.choice.a.side).toBe('DIGITEVEN');
        expect(s.scan).toMatchObject({ threshold: 70, scope: 'all', count: 100 });
        expect(u.plan.multiplier).toBe(2);
        expect(u.plan.stages.length).toBe(1);
        console.log(u.rules.join('\n'), '\n', u.assumed.join('\n'), '\n', u.notes.join('\n'));
    });
    it('reads example 2: recovery on another volatility with fallback, then over 4', () => {
        const u = understand(B)!;
        console.log(u.rules.join('\n'), '\n', u.assumed.join('\n'), '\n', u.notes.join('\n'));
        expect(u.plan.stages.length).toBe(3);
        const [m, r, last] = u.plan.stages;
        expect(m.scan?.threshold).toBe(70);
        expect(r.after).toBe(1);
        expect(r.scan?.other).toBe(true);
        expect(r.choice.b).toBeTruthy();
        expect(r.fallback?.b).toBeTruthy();
        expect(last.choice.a).toMatchObject({ side: 'DIGITOVER', barrier: 4 });
        expect(last.after).toBe(2);
        expect(u.notes).toEqual([]);
    });
    it('builds well formed xml with Journal lines and one stock purchase', () => {
        const u = understand(B)!;
        const xml = buildPlanXml(u.plan);
        expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length).toBe(0);
        expect(xml.match(/type="purchase"/g)?.length).toBe(1);
        expect(xml).toContain('nx_scan_pick');
        expect(xml).toContain('type="notify"');
        expect(xml).toContain('The Prime strategy worked');
        expect(xml).toContain('OTHER">other');
    });
    it('goes through buildBotXml like any saved bot', async () => {
        const u = understand(B)!;
        const xml = await buildBotXml(planToSpec(u) as any);
        expect(xml).toContain('nx_scan_pick');
    });
    it('simple phrases still work: switch to over 4 after 3 losses, stake and limits', () => {
        const u = understand('Trade odd on volatility 50, stake 2, take profit 15, stop loss 40, after 3 losses switch to over 4, double the stake after a loss')!;
        expect(u.plan.symbol).toBe('R_50'); expect(u.plan.stake).toBe(2); expect(u.plan.takeProfit).toBe(15); expect(u.plan.stopLoss).toBe(40);
        expect(u.plan.multiplier).toBe(2);
        expect(u.plan.stages[1]).toMatchObject({ after: 3, choice: { a: { side: 'DIGITOVER', barrier: 4 } } });
    });
    it('over/under main trade scanned with its digit and a percentage in words', () => {
        const u = understand('trade over 3 on the volatility with seventy five percent or more in the last 50 ticks, recover on the opposite')!;
        expect(u.plan.stages[0].scan).toMatchObject({ threshold: 75, count: 50 });
        expect(u.plan.stages[1].choice.a.side).toBe('DIGITUNDER');
        expect(u.plan.stages[1].choice.a.barrier).toBe(3);
    });
    it('plain ordinary text does not need the brain', () => {
        expect(needsBrain('Even on Volatility 50, 1 tick, stake 1, no martingale')).toBe(false);
    });
});
