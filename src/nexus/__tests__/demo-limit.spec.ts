import { observer as bus } from '@/external/bot-skeleton/utils/observer';
import { demoBlocked, demoGuard, demoTradesUsed, lockRemaining, startDemoLimit, isDemoLimitOpen, closeDemoLimit } from '../demo-limit';

const buy = () => bus.emit('contract.status', { id: 'contract.purchase_received' });

describe('demo limit', () => {
    beforeAll(() => startDemoLimit());
    beforeEach(() => { localStorage.clear(); closeDemoLimit(); jest.useFakeTimers().setSystemTime(new Date('2026-11-12T10:00:00Z')); });
    afterEach(() => jest.useRealTimers());

    it('counts demo trades and locks on the 5th, then resets after 24 hours', () => {
        localStorage.setItem('active_loginid', 'VRTC123');
        for (let i = 0; i < 9; i++) buy();
        expect(demoTradesUsed()).toBe(9);
        expect(demoBlocked()).toBe(false);
        buy();
        expect(demoBlocked()).toBe(true);
        expect(demoGuard()).toBe(true);
        expect(isDemoLimitOpen()).toBe(true);
        jest.setSystemTime(new Date('2026-11-13T09:59:00Z'));
        expect(demoBlocked()).toBe(true);
        expect(lockRemaining()).toBe(60000);
        jest.setSystemTime(new Date('2026-11-13T10:00:01Z'));
        expect(demoBlocked()).toBe(false);
        expect(demoTradesUsed()).toBe(0);
    });
    it('counts DOT demo accounts too and never a ROT real account', () => {
        localStorage.setItem('active_loginid', 'DOT555');
        for (let i = 0; i < 10; i++) buy();
        expect(demoBlocked()).toBe(true);
        localStorage.setItem('active_loginid', 'ROT555');
        expect(demoBlocked()).toBe(false);
    });
    it('never counts or blocks the owner demo account', () => {
        localStorage.setItem('active_loginid', 'DOT90326984');
        for (let i = 0; i < 15; i++) buy();
        expect(demoTradesUsed()).toBe(0);
        expect(demoBlocked()).toBe(false);
        expect(demoGuard()).toBe(false);
    });
    it('never counts or blocks a real account', () => {
        localStorage.setItem('active_loginid', 'CR90001');
        for (let i = 0; i < 8; i++) buy();
        expect(demoTradesUsed()).toBe(0);
        expect(demoBlocked()).toBe(false);
        expect(demoGuard()).toBe(false);
    });
});
