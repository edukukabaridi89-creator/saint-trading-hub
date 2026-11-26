import { newSession, respond, type Session } from '../chat';
import { planToSpec } from '../brain';
import { buildBotXml } from '../templates';

const talk = (msgs: string[]) => {
    let s: Session = newSession();
    const out: ReturnType<typeof respond>[] = [];
    for (const m of msgs) { const r = respond(s, m); s = r.session; out.push(r); }
    return { s, out, last: out[out.length - 1] };
};

describe('studio conversation', () => {
    it('Volatility 50 / Digit Match / $1 / 5 ticks, remembering every answer', () => {
        const { s, out } = talk(['Build a Volatility 50 bot.', 'Digit Match.', '4', 'Start with 1 dollar.', 'take profit 10 stop loss 20']);
        expect(out[0].say.join(' ')).toMatch(/What should it trade/);
        expect(out[1].say.join(' ')).toMatch(/Which digit/);
        expect(out[2].say.join(' ')).toMatch(/How much per trade/);
        expect(out[3].say.join(' ')).toMatch(/stop/i);
        const p = s.cur!.plan;
        expect(p.symbol).toBe('R_50'); expect(p.stages[0].choice.a).toMatchObject({ side: 'DIGITMATCH', barrier: 4 }); expect(p.stake).toBe(1);
        expect(out[4].ready).toBe(true);
    });
    it('changes one thing without rebuilding, and can undo', () => {
        const { s } = talk(['even on vol 25 stake 1 take profit 10 stop loss 30', 'change the stake to $5 and stop after two consecutive losses']);
        expect(s.cur!.plan.stake).toBe(5);
        expect(s.cur!.plan.stopWhen?.length).toBe(1);
        expect(s.cur!.plan.symbol).toBe('R_25');
        const r = respond(s, 'undo');
        expect(r.session.cur!.plan.stake).toBe(1);
    });
    it('refuses to claim an invalid change', () => {
        const { s, last } = talk(['even on vol 25 stake 1 take profit 10 stop loss 30', 'stake 0.1']);
        expect(s.cur!.plan.stake).toBe(1);
        expect(last.say.join(' ')).toMatch(/did not apply/);
    });
    it('explains the deadlock and offers working alternatives', () => {
        const { out } = talk(['Create a bot that trades Volatility 100 after three consecutive losses.']);
        expect(out[0].say.join(' ')).toMatch(/never start/);
        expect(out[0].chips.length).toBeGreaterThan(1);
    });
    it('consecutive evens then odd, built into xml', async () => {
        const { s } = talk(['make me a bot that trade v100 after 3 consecutive even and enter odd and put 2 dollas', 'take profit 5 stop loss 10']);
        expect(s.cur!.plan.enterWhen).toBeTruthy();
        const xml = await buildBotXml(planToSpec(s.cur!) as any);
        expect(xml).toContain('RUN_EVEN');
    });
});
