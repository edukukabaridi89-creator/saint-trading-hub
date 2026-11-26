// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { DBOT_TABS } from '@/constants/bot-contents';
import { myBots } from '@/nexus/my-bots';
import { openXmlInBotBuilder } from '@/nexus/open-bot';
import { nexus } from '@/nexus/store';
import { opening, step, type Chip, type Input, type Turn } from '@/nexus/studio/conversation';
import { defaultName, finalize, isComplete, summaryRows, type Draft } from '@/nexus/studio/bot-spec';
import { buildBotXml } from '@/nexus/studio/templates';
import { needsBrain, planToSpec, understand, type Understood } from '@/nexus/studio/brain';
import { useVoice } from '@/nexus/voice';
import '@/nexus/studio/studio.scss';

type Msg = { id: number; role: 'bot' | 'user'; text: string };
let uid = 0;
const bot = (text: string): Msg => ({ id: ++uid, role: 'bot', text });
const MicIcon = () => (
    <svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true'>
        <path d='M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z' fill='currentColor' />
    </svg>
);

export const ClassicStudio = () => {
    const first = useRef(opening()).current;
    const [draft, setDraft] = useState<Draft>({});
    const [expecting, setExpecting] = useState(first.expecting);
    const [chips, setChips] = useState<Chip[]>(first.chips);
    const [log, setLog] = useState<Msg[]>(() => first.say.map(bot));
    const [text, setText] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [brain, setBrain] = useState<Understood | null>(null);
    const [said, setSaid] = useState('');
    const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => {
        end.current?.scrollIntoView({ block: 'end' }); // braces on purpose: an effect must not return this call's value
    }, [log, chips, created]);

    const create = async (d: Draft) => {
        if (!isComplete(d)) return;
        setBusy(true);
        try {
            const spec = finalize(d, name || d.name);
            await buildBotXml(spec); // make sure it builds before anything is saved
            const saved = myBots.add({ name: spec.name, source: 'studio', spec });
            if (!saved) return setLog(l => [...l, bot('Your browser has no room left to store another bot. Delete one in My Bots and try again.')]);
            setCreated({ id: saved.id, name: saved.name });
            setLog(l => [...l, bot(`Created "${saved.name}". It's saved in My Bots. Open it in Bot Builder to review the blocks and run it.`)]);
        } catch (e) {
            console.error(e);
            setLog(l => [...l, bot("The bot couldn't be built. Try again, or change a setting first.")]);
        } finally {
            setBusy(false);
        }
    };

    const createPlan = async (u: Understood) => {
        setBusy(true);
        try {
            const spec = planToSpec(u, name);
            await buildBotXml(spec as any);
            const saved = myBots.add({ name: spec.name, source: 'studio', spec: spec as any });
            if (!saved) return setLog(l => [...l, bot('Your browser has no room left to store another bot. Delete one in My Bots and try again.')]);
            setCreated({ id: saved.id, name: saved.name });
            setLog(l => [...l, bot(`Created "${saved.name}". It's saved in My Bots. Open it in Bot Builder to review the blocks and run it. While it runs, the Journal shows every scan, switch, trade, win and loss.`)]);
        } catch (e) {
            console.error(e);
            setLog(l => [...l, bot("The bot couldn't be built. Try describing it a little differently.")]);
        } finally {
            setBusy(false);
        }
    };

    const think = (text: string, label?: string) => {
        const combined = said ? `${text} . ${said}` : text; // newest words first, so a new stake or limit replaces the old one
        const u = understand(combined);
        const msgs: Msg[] = [{ id: ++uid, role: 'user', text: label ?? text } as Msg];
        if (!u) return setLog(l => [...l, ...msgs, bot("I couldn't turn that into a bot. Tell me the trade, for example \"Even on the volatility with 70% or more, martingale 2\".")]);
        setSaid(combined);
        setBrain(u);
        setName('');
        setCreated(null);
        setChips([{ label: 'Create bot', action: 'create' }, { label: 'Start over', action: 'restart' }]);
        setExpecting(null);
        setLog(l => [
            ...l, ...msgs,
            bot(`Here is how I understood it:\n${u.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`),
            ...(u.assumed.length ? [bot(`I filled in what you did not say:\n${u.assumed.map(a => `• ${a}`).join('\n')}`)] : []),
            ...(u.notes.length ? [bot(`Careful:\n${u.notes.map(a => `• ${a}`).join('\n')}`)] : []),
            bot('Happy with it? Press Create bot. To change anything, just type it, like "stake 2", "take profit 20" or "switch to under 5 after 3 losses".'),
        ]);
    };

    const send = (input: Input, shown?: string) => {
        if (busy) return;
        const label = shown ?? input.text;
        if (input.action === 'restart' || (input.text && /\b(?:start over|start again|reset|new bot|from scratch)\b/i.test(input.text))) {
            setBrain(null); setSaid('');
        } else if (brain && input.action === 'create') {
            setLog(l => [...l, ...(label ? [{ id: ++uid, role: 'user', text: label } as Msg] : [])]);
            return createPlan(brain);
        } else if (brain && input.text) {
            if (/^\s*(?:yes|yep|yeah|create|create it|create bot|build|build it|go ahead|do it|make it|ok|okay|looks good|confirm)\b/i.test(input.text)) return send({ action: 'create' }, input.text);
            return think(input.text);
        } else if (!brain && input.text && Object.keys(draft).length === 0 && needsBrain(input.text)) {
            return think(input.text);
        }
        const turn: Turn = step(draft, input, expecting);
        setLog(l => [...l, ...(label ? [{ id: ++uid, role: 'user', text: label } as Msg] : []), ...turn.say.map(bot)]);
        if (Object.keys(turn.draft).length === 0) setName('');
        if (!turn.create) setCreated(null);
        setDraft(turn.draft);
        setExpecting(turn.expecting);
        setChips(turn.chips);
        if (turn.create) create(turn.draft);
    };
    const voice = useVoice(t => send({ text: t }));
    const onChip = (c: Chip) => (c.text ? send({ text: c.text }, c.text) : send({ patch: c.patch, clear: c.clear, action: c.action }, c.label));
    const openIt = async () => {
        const saved = myBots.bots.find(b => b.id === created?.id);
        if (saved) await openXmlInBotBuilder(await myBots.xmlOf(saved), saved.name);
    };

    return (
        <>
            <div className='studio__head'>
                <h2>Bot Studio</h2>
                <p>Describe the bot you want in plain English, even a complex one: choose the volatility by a percentage, martingale, recover on another trade or volatility, switch after losses. It builds it in Bot Builder blocks and writes every action to the Journal.</p>
            </div>
            <div className='studio__grid'>
                <section className='studio__chat'>
                    <div className='studio__log' role='log' aria-live='polite'>
                        {log.map(m => <div key={m.id} className={`studio__msg studio__msg--${m.role}`}>{m.text}</div>)}
                        {voice.listening && <div className='studio__msg studio__msg--user studio__msg--live'>{voice.heard || 'Listening…'}</div>}
                        {created ? (
                            <div className='studio__chips'>
                                <button className='studio__btn studio__btn--primary' onClick={openIt}>Open in Bot Builder</button>
                                <button className='studio__btn' onClick={() => nexus.goTab(DBOT_TABS.MY_BOTS)}>Go to My Bots</button>
                                <button className='studio__btn' onClick={() => send({ action: 'restart' }, 'Make another bot')}>Make another bot</button>
                            </div>
                        ) : (
                            <div className='studio__chips'>{chips.map((c, i) => <button key={`${c.label}${i}`} className='studio__chip' onClick={() => onChip(c)}>{c.label}</button>)}</div>
                        )}
                        <div ref={end} />
                    </div>
                    {voice.error && <div className='studio__error'>{voice.error}</div>}
                    <form className='studio__input' onSubmit={e => { e.preventDefault(); const t = text.trim(); if (t) { setText(''); send({ text: t }); } }}>
                        <input value={text} onChange={e => setText(e.target.value)} placeholder={voice.listening ? 'Listening…' : 'Type what you want, or answer the question above'} aria-label='Describe your bot' />
                        <button type='button' className={`studio__mic ${voice.listening ? 'is-on' : ''}`} onClick={voice.listening ? voice.stop : voice.start} disabled={!voice.supported} aria-label='Speak' title={voice.supported ? (voice.listening ? 'Stop' : 'Speak') : 'Voice input is not supported in this browser. Use Chrome, Edge or Safari.'}><MicIcon /></button>
                        <button type='submit' className='studio__btn studio__btn--primary' disabled={!text.trim()}>Send</button>
                    </form>
                </section>
                <aside className='studio__panel'>
                    <h3>Your bot</h3>
                    {brain ? <ol className='studio__rules'>{brain.rules.map((r, i) => <li key={i}>{r}</li>)}</ol> : null}
                    {brain ? null : <dl>{summaryRows(draft).map(r => <div key={r.label} className={r.value ? '' : 'is-empty'}><dt>{r.label}</dt><dd>{r.value ?? '—'}</dd></div>)}</dl>}
                    <label className='studio__name'>Name<input value={name || (brain ? '' : draft.name) || ''} onChange={e => setName(e.target.value)} placeholder={brain ? brain.plan.name : defaultName(draft)} maxLength={40} /></label>
                    <button className='studio__btn studio__btn--primary studio__create' disabled={(brain ? false : !isComplete(draft)) || busy} onClick={() => send({ action: 'create' }, 'Create bot')}>{busy ? 'Building…' : 'Create bot'}</button>
                    <button className='studio__link' onClick={() => send({ action: 'restart' }, 'Start over')}>Start over</button>
                </aside>
            </div>
        </>
    );
};
