jest.mock('@/constants/backend-error-messages', () => ({ getLocalizedErrorMessage: x => x }), { virtual: true });
jest.mock('@deriv-com/translations', () => ({ localize: x => x }));
jest.mock('../../utils/cliTools', () => ({}), { virtual: true });
jest.mock('lodash.debounce', () => f => f);
global.mockSend = jest.fn();
const mockSend = global.mockSend;
jest.mock('../../../api/api-base', () => ({ api_base: { api: { send: (...a) => mockSend(...a) } } }));
jest.mock('../../../../utils/observer', () => ({ observer: { emit: () => {} } }));
jest.mock('../../../../utils/binary-utils', () => ({ getLast: a => a[a.length - 1] }));
jest.mock('../../utils/helpers', () => ({ getDirection: () => 'x', getLastDigit: s => Number(String(s).slice(-1)) }));
jest.mock('../../utils/sanitize', () => ({ expectPositiveInteger: x => x }));
jest.mock('../state/constants', () => ({}));

import Ticks from '../Ticks';

const prices = { R_10: [1.1, 1.2, 1.3, 1.5], R_25: [1.2, 1.4, 1.6, 1.8], R_50: [1.1, 1.3, 1.5, 1.7] }; // last digits: R_10 1,2,3,5 | R_25 2,4,6,8 | R_50 1,3,5,7
class Base {}
const Engine = Ticks(Base);

it('scan picks the market with the most even digits and switches to it', async () => {
    mockSend.mockImplementation(async ({ ticks_history }) => ({ pip_size: 1, history: { prices: prices[ticks_history] ?? [1.1] } }));
    const e = new Engine();
    e.symbol = 'R_10'; e.options = { symbol: 'R_10' };
    e.switchTrade = jest.fn(async c => { e.symbol = c.symbol; });
    const sym = await e.scanMarkets({ scope: 'all', kind: 'EVEN', digit: 5, count: 4, condition: 'ABOVE', threshold: 50 });
    expect(sym).toBe('R_25'); // 100% even
    expect(e.switchTrade).toHaveBeenCalledWith({ symbol: 'R_25' });
    // nothing reaches 101%
    expect(await e.scanMarkets({ scope: 'all', kind: 'EVEN', digit: 5, count: 4, condition: 'ABOVE', threshold: 101 })).toBe('');
    // cached: no new requests
    const calls = mockSend.mock.calls.length;
    await e.scanMarkets({ scope: 'all', kind: 'ODD', digit: 5, count: 4, condition: 'ABOVE', threshold: 0 });
    expect(mockSend.mock.calls.length).toBe(calls);
    expect(e.symbol).toBe('R_50'); // the ODD scan moved there
    expect(await e.rotateMarket()).toBe('R_75');
});

it('scans for the likelier of two outcomes and can insist on a different market', async () => {
    mockSend.mockImplementation(async ({ ticks_history }) => ({ pip_size: 1, history: { prices: prices[ticks_history] ?? [1.1] } }));
    const e = new Engine();
    e.symbol = 'R_25'; e.options = { symbol: 'R_25' };
    e.switchTrade = jest.fn(async c => { e.symbol = c.symbol; });
    // R_25 is 100% even and the best, but we ask for a different one
    const other = await e.scanMarkets({ scope: 'all', kind: 'EVENODD', digit: 0, count: 4, condition: 'ABOVE', threshold: 50, other: true });
    expect(other).not.toBe('R_25');
    expect(other).not.toBe('');
    e.symbol = 'R_25';
    expect(await e.scanMarkets({ scope: 'all', kind: 'OVERUNDER', digit: 4, count: 4, condition: 'ABOVE', threshold: 100, other: false })).not.toBe('');
});
