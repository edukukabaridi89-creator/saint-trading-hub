/** Text-to-speech in a man's voice (browser speechSynthesis). Silent where the browser has no voices or blocks speech. */
let chosen: SpeechSynthesisVoice | null = null;

const MALE = /(daniel|david|alex|fred|mark|guy|george|james|ryan|male|google uk english male|microsoft (david|mark|guy|ryan))/i;
const FEMALE = /(female|samantha|victoria|zira|susan|hazel|karen|moira|tessa|fiona|libby|aria|jenny|google us english)/i;

const pick = (): SpeechSynthesisVoice | null => {
    if (typeof speechSynthesis === 'undefined') return null;
    const all = speechSynthesis.getVoices();
    if (!all.length) return null;
    const en = all.filter(v => /^en/i.test(v.lang));
    const pool = en.length ? en : all;
    return pool.find(v => MALE.test(v.name) && !FEMALE.test(v.name)) || pool.find(v => !FEMALE.test(v.name)) || pool[0] || null;
};

export const sayReady = () => typeof speechSynthesis !== 'undefined';

/** Speaks `text` (a deep, steady voice). `onStart` fires when the speech begins. Returns a function that stops it. */
export const say = (text: string, opts: { rate?: number; pitch?: number; onStart?: () => void } = {}) => {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined' || !text) return () => {};
    try {
        chosen = chosen || pick();
        const u = new SpeechSynthesisUtterance(text);
        if (chosen) u.voice = chosen;
        u.lang = chosen?.lang || 'en-US';
        u.rate = opts.rate ?? 0.92;
        u.pitch = opts.pitch ?? 0.7; // lower pitch = a deeper, manlier voice
        u.volume = 1;
        if (opts.onStart) u.onstart = opts.onStart;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
    } catch (e) {
        /* speech is a bonus: never break the app for it */
    }
    return () => {
        try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    };
};

if (typeof speechSynthesis !== 'undefined') {
    // voices load a moment after the page opens
    speechSynthesis.addEventListener?.('voiceschanged', () => (chosen = pick()));
}
