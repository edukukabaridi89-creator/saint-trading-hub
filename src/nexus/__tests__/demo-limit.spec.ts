import { observer as bus } from '@/external/bot-skeleton/utils/observer';
import { demoBlocked, demoGuard, demoTradesUsed, isDemoCheerOpen, closeDemoCheer, startDemoLimit } from '../demo-limit';

const buy = () => bus.emit('contract.status', { id: 'contract.purchase_received' });
const sold = () => bus.emit('contract.status', { id: 'contract.sold' });

describe('demo accounts: never blocked, one-time greeting at 15 trades', () => {
    beforeAll(() => startDemoLimit());
    beforeEach(() => { localStorage.clear(); closeDemoCheer(); });

    it('does not block the demo at any count', () => {
        localStorage.setItem('active_loginid', 'DOT555');
        for (let i = 0; i < 30; i++) buy();
        expect(demoBlocked()).toBe(false);
        expect(demoGuard()).toBe(false);
        expect(demoTradesUsed()).toBe(0);
        sold();
        closeDemoCheer(); // clear the greeting this run triggered
    });
    it('shows the greeting once, after the 15th demo trade settles', () => {
        localStorage.setItem('active_loginid', 'VRTC123');
        for (let i = 0; i < 14; i++) buy();
        sold();
        expect(isDemoCheerOpen()).toBe(false);
        buy();
        expect(isDemoCheerOpen()).toBe(false);
        sold();
        expect(isDemoCheerOpen()).toBe(true);
        closeDemoCheer();
        for (let i = 0; i < 20; i++) buy();
        sold();
        expect(isDemoCheerOpen()).toBe(false);
    });
    it('does not greet the owner demo account or real accounts', () => {
        localStorage.setItem('active_loginid', 'DOT90326984');
        for (let i = 0; i < 20; i++) buy();
        sold();
        localStorage.setItem('active_loginid', 'CR555');
        for (let i = 0; i < 20; i++) buy();
        sold();
        expect(isDemoCheerOpen()).toBe(false);
    });
});
