import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/nexus/ticks-hub', () => ({ hub: { call: jest.fn() } }));
jest.mock('@/nexus/open-bot', () => ({ openXmlInBotBuilder: jest.fn() }));
jest.mock('@/nexus/store', () => ({ nexus: { goTab: jest.fn() } }));
jest.mock('@/nexus/voice', () => ({ useVoice: () => ({ listening: false, heard: '', error: '', start: jest.fn(), stop: jest.fn(), supported: false }) }));
jest.mock('@/nexus/voice-say', () => ({ say: jest.fn() }));
jest.mock('@/constants/bot-contents', () => ({ DBOT_TABS: { MY_BOTS: 1 } }));
jest.mock('@/nexus/studio/studio.scss', () => ({}), { virtual: true });
import { BotStudio } from '../index';

(window.HTMLElement.prototype as any).scrollIntoView = jest.fn();
it('greets, builds a bot from a typed sentence, validates and creates it', async () => {
    jest.useFakeTimers();
    render(<BotStudio />);
    expect(screen.getByText(/what should I call you/i)).toBeTruthy();
    const input = screen.getByLabelText('Describe your bot');
    const sendText = async (t: string) => { fireEvent.change(input, { target: { value: t } }); fireEvent.submit(input.closest('form')!); await act(async () => { jest.advanceTimersByTime(400); }); };
    await sendText('Edwin');
    expect(screen.getByText(/Nice to meet you, Edwin/)).toBeTruthy();
    await sendText('even on vol 50 after 3 consecutive odd, stake 1, take profit 10, stop loss 30');
    expect(screen.getByText(/Here is the bot as I understand it/)).toBeTruthy();
    fireEvent.click(screen.getByText('Validation ✓'));
    expect(screen.getAllByText(/✓/).length).toBeGreaterThan(2);
    fireEvent.click(screen.getByText('Create bot', { selector: 'button.studio__create' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByText(/Open in Bot Builder/)).toBeTruthy();
    expect(localStorage.getItem('nx_studio_name:guest')).toBe('Edwin');
});
