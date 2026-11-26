import { BASIC_BOT_NAME, buildBasicXml } from '../basic';
import { FREE_BOTS } from '@/pages/free-bots/bots';

describe('Basic Bot', () => {
    const xml = buildBasicXml();
    it('is well formed XML', () => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    });
    it('has the editable settings and the stock blocks', () => {
        ['Stake', 'Initial Stake', 'Martingale', 'Take Profit', 'Stop Loss', 'Ticks'].forEach(n => expect(xml).toContain(`>${n}</field>`));
        ['trade_definition', 'before_purchase', 'after_purchase', 'purchase', 'trade_again'].forEach(t => expect(xml).toContain(`type="${t}"`));
        expect(xml).toContain('The Prime strategy worked');
    });
    it('is the first free bot and loads its own xml', async () => {
        expect(FREE_BOTS[0].title).toBe(BASIC_BOT_NAME);
        expect(FREE_BOTS[0].n).toBe(1);
        expect(((await FREE_BOTS[0].load()) as any).default).toBe(xml);
    });
});
