// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DBOT_TABS } from '@/constants/bot-contents';
import { hub } from '@/nexus/ticks-hub';
import { myBots } from '@/nexus/my-bots';
import { openXmlInBotBuilder } from '@/nexus/open-bot';
import { nexus } from '@/nexus/store';
import { say } from '@/nexus/voice-say';
import { useVoice } from '@/nexus/voice';
import { needsBrain, planToSpec } from '@/nexus/studio/brain';
import { newSession, respond } from '@/nexus/studio/chat';
import { simulate, sidesUsed, type SimResult } from '@/nexus/studio/simulate';
import { accountId, getName, idbKV, memoryKV, nameFrom, newId, Projects, setName, type ChatMsg, type Project } from '@/nexus/studio/store';
import { buildBotXml } from '@/nexus/studio/templates';
import { checks, outlineXml } from '@/nexus/studio/validate';
import { ClassicStudio } from './classic';
import '@/nexus/studio/studio.scss';

let uid = 0;
const msg = (role: 'bot' | 'user', text: string): ChatMsg => ({ id: ++uid + Date.now(), role, text });
const EXAMPLES = [
    'make me a bot that trade v100 after 3 consecutive even and enter odd, put 2 dollas, tp 10 sl 30',
    'Trade even on the volatility with 70% and above, martingale 2. After a loss recover on a different volatility with the likelier of over 4 or under 4, then switch to over 4',
    'even on vol 50 only when rsi 14 is below 30, stop after 2 consecutive losses, stake 1',
];

export const BotStudio = () => {
    const acct = useMemo(accountId, []);
    const kv = useMemo(() => idbKV() ?? memoryKV(), []);
    const projects = useMemo(() => new Projects(kv, acct), [kv, acct]);
    const [classic, setClassic] = useState(false);
    const [name, setNameState] = useState(getName(acct));
    const [awaitName, setAwaitName] = useState(!getName(acct));
    const [list, setList] = useState<Project[]>([]);
    const [pid, setPid] = useState(newId());
    const [session, setSession] = useState(newSession());
    const [log, setLog] = useState<ChatMsg[]>([]);
    const [chips, setChips] = useState<any[]>([]);
    const [text, setText] = useState('');
    const [thinking, setThinking] = useState(false);
    const [speak, setSpeak] = useState(false);
    const [tab, setTab] = useState('logic');
    const [sim, setSim] = useState<{ busy?: boolean; res?: SimResult; err?: string } | null>(null);
    const [outline, setOutline] = useState<string[]>([]);
    const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
    const [botName, setBotName] = useState('');
    const end = useRef<HTMLDivElement>(null);
    const hello = useCallback((n: string) => [msg('bot', n ? `Welcome back, ${n}. What kind of bot are we building today?` : 'Hi, I am Bot Studio. By the way, what should I call you? (You can skip this and just describe your bot.)')], []);

    useEffect(() => { setLog(hello(name)); projects.list().then(setList).catch(() => {}); }, []); // eslint-disable-line
    useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [log, chips, thinking]);

    const cur = session.cur;
    const plan = cur?.plan;
    const checkList = useMemo(() => (plan ? checks(plan) : []), [plan]);
    const allOk = checkList.length > 0 && checkList.every(c => c.ok);

    // keep the generated blocks in step with the plan (so the Blocks tab always shows what would really be built)
    useEffect(() => {
        let live = true;
        if (!cur) return setOutline([]);
        buildBotXml(planToSpec(cur) as any).then(x => live && setOutline(outlineXml(x))).catch(() => live && setOutline([]));
        return () => { live = false; };
    }, [cur]);

    // save the project in this browser whenever it changes
    useEffect(() => {
        if (!cur) return;
        const t = setTimeout(() => {
            const p: Project = { id: pid, name: botName || cur.plan.name, session, messages: log.slice(-80), updatedAt: Date.now() };
            projects.save(p).then(() => projects.list().then(setList)).catch(() => {});
        }, 400);
        return () => clearTimeout(t);
    }, [session, log, botName]); // eslint-disable-line

    const botSays = (lines: string[], c: any[]) => {
        setLog(l => [...l, ...lines.filter(Boolean).map(t => msg('bot', t))]);
        setChips(c);
        if (speak) say(lines.filter(Boolean).join(' ').slice(0, 400));
    };

    const create = async (s = session) => {
        if (!s.cur) return;
        if (!checks(s.cur.plan).every(c => c.ok)) return botSays(['I will not create it yet. The Validation tab shows what to fix.'], []);
        try {
            const spec = planToSpec(s.cur, botName);
            await buildBotXml(spec as any);
            const saved = myBots.add({ name: spec.name, source: 'studio', spec: spec as any });
            if (!saved) return botSays(['Your browser has no room left to store another bot. Delete one in My Bots and try again.'], []);
            setCreated({ id: saved.id, name: saved.name });
            botSays([`Created "${saved.name}" and saved it in My Bots. Open it in Bot Builder to see the blocks, then run it on your demo account first. Every scan, trade, win, loss and switch will appear in the Journal.`], []);
        } catch (e) {
            console.error(e);
            botSays(["The bot couldn't be built. Check the Validation tab."], []);
        }
    };

    const runTest = async () => {
        if (!plan) return;
        setTab('test');
        setSim({ busy: true });
        try {
            const m = await hub.call({ ticks_history: plan.symbol, end: 'latest', count: 5000, style: 'ticks' });
            const prices = (m.history?.prices ?? []).map(Number);
            let pip = typeof m.pip_size === 'number' ? m.pip_size : 2;
            if (pip > 0 && pip < 1) pip = Math.round(-Math.log10(pip));
            if (prices.length < 300) throw new Error('Not enough recent ticks came back for this market.');
            // real payout figure for each trade type, from Deriv itself
            let ratio: Record<string, number> | null = {};
            for (const s of sidesUsed(plan)) {
                try {
                    const leg = [plan.stages.flatMap(x => [x.choice.a, x.choice.b, x.fallback?.a, x.fallback?.b])].flat().flat().find(l => l?.side === s);
                    const r = await hub.call({ proposal: 1, amount: 1, basis: 'stake', contract_type: s, currency: 'USD', duration: plan.duration, duration_unit: 't', underlying_symbol: plan.symbol, ...(leg?.barrier !== undefined && /MATCH|DIFF|OVER|UNDER/.test(s) ? { barrier: String(leg.barrier) } : {}) });
                    const pay = Number(r?.proposal?.payout);
                    if (!(pay > 1)) throw new Error('no payout');
                    ratio[s] = pay;
                } catch { ratio = null; break; }
            }
            setSim({ res: simulate(plan, prices, pip, ratio) });
        } catch (e) {
            setSim({ err: `Could not get recent ticks: ${e?.message || 'the market connection is not ready'}. Sign in and try again.` });
        }
    };

    const send = (raw: string, shown?: string) => {
        const t = raw.trim();
        if (!t || thinking) return;
        setLog(l => [...l, msg('user', shown ?? t)]);
        setChips([]);
        setCreated(null);
        if (awaitName) {
            const n = nameFrom(t);
            setAwaitName(false);
            if (n) {
                setName(n, acct); setNameState(n);
                return botSays([`Nice to meet you, ${n}. What bot shall we build?`], EXAMPLES.map(e => ({ label: e.slice(0, 48) + '…', text: e })));
            }
            if (/^(?:skip|no|later|nothing)\b/i.test(t)) return botSays(['No problem. What bot shall we build?'], EXAMPLES.map(e => ({ label: e.slice(0, 48) + '…', text: e })));
        }
        if (/\b(?:d'?alembert|oscar|1[\s-]?3[\s-]?2[\s-]?6|reverse martingale)\b/i.test(t)) {
            return botSays(['Those stake plans are in Classic guided mode, which is still here. Press "Classic guided mode" at the top. For the smart bot I build with martingale or a flat stake.'], []);
        }
        setThinking(true);
        setTimeout(() => {
            const r = respond(session, t);
            setThinking(false);
            setSession(r.session);
            botSays(r.say, r.chips);
            if (r.ready && /^\s*(?:yes|yep|yeah|create|create it|create bot|build|build it|go ahead|do it|make it|ok|okay|looks good|confirm|save)\b/i.test(t)) create(r.session);
        }, 220);
    };
    const voice = useVoice(t => send(t));
    const onChip = (c: any) => {
        if (c.action === 'create') return create();
        if (c.action === 'test') return runTest();
        if (c.action === 'undo') return send('undo', c.label);
        if (c.action === 'restart') return send('start over', c.label);
        send(c.text ?? c.label, c.label);
    };
    const openProject = (p: Project) => { setPid(p.id); setSession(p.session); setLog(p.messages.length ? p.messages : hello(name)); setChips([]); setCreated(null); setSim(null); setBotName(p.name === p.session.cur?.plan.name ? '' : p.name); };
    const newProject = () => { setPid(newId()); setSession(newSession()); setLog(hello(name)); setChips([]); setCreated(null); setSim(null); setBotName(''); };
    const openIt = async () => { const s = myBots.bots.find(b => b.id === created?.id); if (s) await openXmlInBotBuilder(await myBots.xmlOf(s), s.name); };

    if (classic) return (<><div className='studio__head'><button className='studio__link' onClick={() => setClassic(false)}>← Back to the AI-style Studio</button></div><ClassicStudio /></>);

    return (
        <>
            <div className='studio__head'>
                <h2>Bot Studio{name ? ` · ${name}` : ''}</h2>
                <p>Describe any bot in your own words, typed or spoken. It remembers the bot as you go, asks only what it needs, checks it, tests it on real ticks, and builds it in Bot Builder blocks. Works fully in your browser, no key or account setup needed.</p>
                <p className='studio__small'>
                    <button className='studio__link' onClick={() => setClassic(true)}>Classic guided mode</button> · <button className='studio__link' onClick={() => { const n = window.prompt('What should I call you?', name); if (n !== null) { setName(n, acct); setNameState(n.trim()); } }}>Change my name</button> ·{' '}
                    <label><input type='checkbox' checked={speak} onChange={e => setSpeak(e.target.checked)} /> Speak replies</label>
                </p>
            </div>
            <div className='studio__grid studio__grid--3'>
                <aside className='studio__panel studio__projects'>
                    <h3>Projects</h3>
                    <button className='studio__btn' onClick={newProject}>+ New bot</button>
                    {list.length === 0 && <p className='studio__small'>Your bots and chats are saved in this browser, for your account only. Clearing site data or using another device starts empty.</p>}
                    <ul>{list.map(p => <li key={p.id} className={p.id === pid ? 'is-on' : ''}><button onClick={() => openProject(p)}>{p.name}</button><button className='studio__x' aria-label='Delete' onClick={async () => { await projects.remove(p.id); setList(await projects.list()); if (p.id === pid) newProject(); }}>×</button></li>)}</ul>
                </aside>
                <section className='studio__chat'>
                    <div className='studio__log' role='log' aria-live='polite'>
                        {log.map(m => <div key={m.id} className={`studio__msg studio__msg--${m.role}`}>{m.text}</div>)}
                        {voice.listening && <div className='studio__msg studio__msg--user studio__msg--live'>{voice.heard || 'Listening…'}</div>}
                        {thinking && <div className='studio__msg studio__msg--bot studio__typing'><span /><span /><span /></div>}
                        {created ? (
                            <div className='studio__chips'>
                                <button className='studio__btn studio__btn--primary' onClick={openIt}>Open in Bot Builder</button>
                                <button className='studio__btn' onClick={() => nexus.goTab(DBOT_TABS.MY_BOTS)}>Go to My Bots</button>
                                <button className='studio__btn' onClick={newProject}>Make another bot</button>
                            </div>
                        ) : <div className='studio__chips'>{(chips.length || cur ? chips : EXAMPLES.map(e => ({ label: e.slice(0, 52) + '…', text: e }))).map((c, i) => <button key={i} className='studio__chip' onClick={() => onChip(c)}>{c.label}</button>)}</div>}
                        <div ref={end} />
                    </div>
                    {voice.error && <div className='studio__error'>{voice.error}</div>}
                    <form className='studio__input' onSubmit={e => { e.preventDefault(); const t = text; setText(''); send(t); }}>
                        <input value={text} onChange={e => setText(e.target.value)} placeholder={voice.listening ? 'Listening…' : 'Describe a bot, answer a question, or change something'} aria-label='Describe your bot' />
                        <button type='button' className={`studio__mic ${voice.listening ? 'is-on' : ''}`} onClick={voice.listening ? voice.stop : voice.start} disabled={!voice.supported} aria-label='Speak' title={voice.supported ? (voice.listening ? 'Stop' : 'Speak') : 'Voice input needs Chrome, Edge or Safari.'}>🎤</button>
                        <button type='submit' className='studio__btn studio__btn--primary' disabled={!text.trim() || thinking}>Send</button>
                    </form>
                </section>
                <aside className='studio__panel'>
                    <div className='studio__tabs'>{[['logic', 'Logic'], ['check', 'Validation'], ['blocks', 'Blocks'], ['test', 'Test']].map(([k, l]) => <button key={k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}{k === 'check' && cur ? (allOk ? ' ✓' : ' !') : ''}</button>)}</div>
                    {!cur && <p className='studio__small'>Nothing yet. Tell me about the bot you want.</p>}
                    {cur && tab === 'logic' && <ol className='studio__rules'>{cur.rules.map((r, i) => <li key={i}>{r}</li>)}</ol>}
                    {cur && tab === 'check' && <ul className='studio__checks'>{checkList.map((c, i) => <li key={i} className={c.ok ? 'ok' : 'bad'}><b>{c.ok ? '✓' : '✗'} {c.label}</b>{c.detail && <span>{c.detail}</span>}</li>)}</ul>}
                    {cur && tab === 'blocks' && <><pre className='studio__outline'>{outline.join('\n') || 'Building…'}</pre><p className='studio__small'>This is the block stack that will be built. Open it in Bot Builder to edit the blocks by hand.</p></>}
                    {cur && tab === 'test' && (
                        <div>
                            <button className='studio__btn' onClick={runTest} disabled={sim?.busy}>{sim?.busy ? 'Testing…' : 'Test on recent ticks'}</button>
                            {sim?.err && <p className='studio__error'>{sim.err}</p>}
                            {sim?.res && <dl className='studio__sim'>
                                <div><dt>Trades</dt><dd>{sim.res.trades} ({sim.res.wins} won, {sim.res.losses} lost)</dd></div>
                                <div><dt>Win rate</dt><dd>{sim.res.winRate.toFixed(1)}%</dd></div>
                                <div><dt>Longest losing run</dt><dd>{sim.res.longestLossRun}</dd></div>
                                <div><dt>Highest stake</dt><dd>{sim.res.maxStake}</dd></div>
                                <div><dt>Profit (real payout)</dt><dd>{sim.res.profit === null ? 'not available' : sim.res.profit}</dd></div>
                                <div><dt>Ended by</dt><dd>{sim.res.stoppedBy}</dd></div>
                                {sim.res.notes.map((n, i) => <p key={i} className='studio__small'>{n}</p>)}
                            </dl>}
                            <p className='studio__small'>For live behaviour, create the bot and run it on your demo account in Bot Builder first.</p>
                        </div>
                    )}
                    {cur && <>
                        <label className='studio__name'>Name<input value={botName} onChange={e => setBotName(e.target.value)} placeholder={cur.plan.name} maxLength={40} /></label>
                        <button className='studio__btn studio__btn--primary studio__create' disabled={!allOk} onClick={() => create()}>Create bot</button>
                    </>}
                </aside>
            </div>
        </>
    );
};
