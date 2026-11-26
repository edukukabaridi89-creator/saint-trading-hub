import { buildBasicXml } from '../basic';
import { buildPlanXml } from '../plan-xml';
import { understand } from '../brain';
import { buildAdvancedXml, toAdv } from '../advanced';
import { finalize } from '../bot-spec';
import { opening, step } from '../conversation';

const check = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    // Bot Builder's text join is a statement block: no <mutation items> and no ADDn inputs
    expect(xml).not.toMatch(/ADD\d/);
    expect(xml).not.toMatch(/<block type="text_join"><mutation/);
    const joins = Array.from(doc.querySelectorAll('block[type="text_join"]'));
    joins.forEach(j => {
        expect(j.querySelector(':scope > field[name="VARIABLE"]')).toBeTruthy();
        expect(j.querySelector(':scope > statement[name="STACK"] > block[type="text_statement"]')).toBeTruthy();
        const next = j.querySelector(':scope > next > block[type="notify"]');
        expect(next).toBeTruthy();
        expect(next!.querySelector(':scope > value[name="MESSAGE"] block[type="variables_get"]')).toBeTruthy();
    });
    // every notify has a message
    doc.querySelectorAll('block[type="notify"]').forEach(n => expect(n.querySelector(':scope > value[name="MESSAGE"]')).toBeTruthy());
    // the variable the join fills is declared
    if (joins.length) expect(xml).toContain('<variable type="" id="v_Message_0"');
    return joins.length;
};

it('Basic Bot, plan bots and smart bots all write valid Journal messages', () => {
    expect(check(buildBasicXml())).toBeGreaterThan(0);
    expect(check(buildPlanXml(understand('even on vol 50 after 3 consecutive odd, recover on a different volatility with the likelier, stop after 2 consecutive losses, stake 1 tp 10 sl 30')!.plan))).toBeGreaterThan(3);
    let t = opening(); let d: any = {}; let ex = t.expecting;
    for (const x of ['Even on Volatility 50, 1 tick, stake 1, martingale x2, no cap, take profit 10, stop loss 30, every tick, recover on odd']) { t = step(d, { text: x }, ex); d = t.draft; ex = t.expecting; }
    expect(check(buildAdvancedXml(toAdv(finalize(d, 'x'))))).toBeGreaterThan(0);
});
