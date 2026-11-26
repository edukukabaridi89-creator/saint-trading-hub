import { observer as bus } from '@/external/bot-skeleton/utils/observer';
import { nexus } from './store';
import { say } from './voice-say';

/** The take-profit line every Saint module uses: shown on screen, written to the Journal and spoken aloud. */
export const celebrateTP = (profit: number, currency?: string) => {
    const cur = currency || nexus.root?.client?.currency || 'USD';
    const msg = `The Prime strategy worked, printed ${Math.abs(profit).toFixed(2)} ${cur}.`;
    nexus.log(msg);
    try { bus.emit('ui.log.notify', { className: 'success', message: msg, sound: 'silent' }); } catch (e) { /* ignore */ }
    (window as any).__nxSpoken = msg;
    say(msg);
    return msg;
};

export const stopLossLine = (loss: number, currency?: string) => `Stop loss reached, ${Math.abs(loss).toFixed(2)} ${currency || nexus.root?.client?.currency || 'USD'}. Stopped.`;
