import { api_base } from '@/external/bot-skeleton';
import { LogTypes } from '@/external/bot-skeleton/constants/messages';
import { observer as bus } from '@/external/bot-skeleton/utils/observer';
import {
    adjustRotMarketingBalance,
    getRotMarketingConfig,
    TARGET_MARKETING_LOGINID,
} from '@/utils/account-helpers';
import { buyParameters, type BuyRequest } from './buy-params';
import { demoGuard } from './demo-limit';
import { positions } from './positions';
import { nexus } from './store';

export type TradeReq = BuyRequest & { source: string }; // source: hedge | bulk | manual | auto | ...
export type TradeResult = { contract_id?: number; profit?: number; won?: boolean; error?: string };

type SimulatedContractState = {
    contract_id: number;
    buy_id: number;
    sell_id: number;
    buy_price: number;
    payout: number;
    sell_price: number;
    profit: number;
    won: boolean;
    currency: string;
    contract_type: string;
    underlying: string;
    shortcode: string;
    date_start: number;
    entry_spot: string;
    exit_spot: string;
    settled: boolean;
};

const open = new Map<number, (r: TradeResult) => void>();
const simulatedContracts = new Map<number, SimulatedContractState>();
let wired_api: unknown = null;

const send = (payload: object): Promise<any> =>
    Promise.resolve(api_base.api.send(payload)).catch((e: any) => ({ error: e?.error ?? { message: e?.message ?? 'Request failed' } }));

const syncMarketingClientBalance = (nextBalance: number | null) => {
    if (nextBalance === null || !Number.isFinite(nextBalance)) return;
    const client = nexus.root?.client;
    if (client && typeof client.setBalance === 'function' && client.loginid === TARGET_MARKETING_LOGINID) {
        client.setBalance(nextBalance.toFixed(2));
    }
};

const isRotMarketingActive = (): boolean => {
    const loginid = nexus.getLoginid() || (api_base.account_info as any)?.loginid;
    return loginid === TARGET_MARKETING_LOGINID && Boolean(getRotMarketingConfig(TARGET_MARKETING_LOGINID));
};

const shouldWinFromProfitability = (rate: number): boolean => {
    const clamped = Math.max(0, Math.min(100, rate));
    if (clamped <= 0) return false;
    if (clamped >= 100) return true;
    return Math.random() * 100 < clamped;
};

const buildSimulatedContractPayload = (sim: SimulatedContractState, isSold: boolean) => {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        accountID: TARGET_MARKETING_LOGINID,
        contract_id: sim.contract_id,
        buy_price: sim.buy_price,
        sell_price: isSold ? sim.sell_price : 0,
        bid_price: isSold ? sim.sell_price : Number((sim.buy_price * (sim.won ? 1.35 : 0.65)).toFixed(2)),
        payout: sim.payout,
        profit: isSold ? sim.profit : 0,
        currency: sim.currency,
        contract_type: sim.contract_type,
        underlying: sim.underlying,
        underlying_symbol: sim.underlying,
        shortcode: sim.shortcode,
        date_start: sim.date_start,
        date_expiry: nowSec + 2,
        entry_spot: sim.entry_spot,
        entry_tick: sim.entry_spot,
        entry_tick_time: sim.date_start,
        exit_spot: isSold ? sim.exit_spot : undefined,
        exit_tick: isSold ? sim.exit_spot : undefined,
        exit_tick_time: isSold ? nowSec : undefined,
        transaction_ids: {
            buy: sim.buy_id,
            ...(isSold ? { sell: sim.sell_id } : {}),
        },
        status: isSold ? (sim.won ? 'won' : 'lost') : 'open',
        is_sold: isSold ? 1 : 0,
        is_expired: isSold ? 1 : 0,
        is_valid_to_sell: isSold ? 0 : 1,
    };
};

const settleSimulatedContract = (sim: SimulatedContractState) => {
    if (sim.settled) return;
    sim.settled = true;

    const done = open.get(sim.contract_id);
    if (!done) return;
    open.delete(sim.contract_id);
    simulatedContracts.delete(sim.contract_id);

    const updatedCfg = adjustRotMarketingBalance(sim.sell_price);
    if (updatedCfg) {
        syncMarketingClientBalance(updatedCfg.balance);
    }

    const soldPayload = buildSimulatedContractPayload(sim, true);
    bus.emit('bot.contract', soldPayload);
    positions.upsert(soldPayload);
    bus.emit('contract.status', { id: 'contract.sold', data: sim.sell_id, contract: soldPayload });
    bus.emit('ui.log.success', {
        log_type: sim.profit > 0 ? LogTypes.PROFIT : LogTypes.LOST,
        extra: { currency: sim.currency, profit: Number(sim.profit.toFixed(2)) },
    });
    nexus.endTrade();
    done({ contract_id: sim.contract_id, profit: sim.profit, won: sim.won });
};

/** Same payload shape the trade engine broadcasts for every proposal_open_contract update. */
const onContractUpdate = ({ data }: any) => {
    const c = data?.proposal_open_contract;
    if (data?.msg_type !== 'proposal_open_contract' || !c) return;
    const done = open.get(c.contract_id);
    if (!done) return;

    const sim = simulatedContracts.get(c.contract_id);
    if (sim) {
        if (!c.is_sold) {
            const livePayload = buildSimulatedContractPayload(sim, false);
            bus.emit('bot.contract', {
                ...livePayload,
                entry_spot: c.entry_spot ?? livePayload.entry_spot,
                entry_tick: c.entry_tick ?? livePayload.entry_tick,
            });
            positions.upsert(livePayload);
            return;
        }
        if (c.entry_spot) sim.entry_spot = String(c.entry_spot);
        if (c.exit_spot) sim.exit_spot = String(c.exit_spot);
        settleSimulatedContract(sim);
        return;
    }

    bus.emit('bot.contract', { accountID: nexus.getLoginid(), ...c }); // -> Summary + Transactions
    positions.upsert(c);
    if (!c.is_sold) return;

    open.delete(c.contract_id);
    if (data.subscription?.id) send({ forget: data.subscription.id });
    const profit = Number(c.sell_price) - Number(c.buy_price);
    bus.emit('contract.status', { id: 'contract.sold', data: c.transaction_ids?.sell, contract: c });
    bus.emit('ui.log.success', { log_type: profit > 0 ? LogTypes.PROFIT : LogTypes.LOST, extra: { currency: c.currency, profit: Number(profit.toFixed(2)) } }); // -> Journal
    nexus.endTrade();
    done({ contract_id: c.contract_id, profit, won: profit > 0 });
};

/**
 * THE single entry point for every trade placed outside Bot Builder. It follows the exact event sequence the
 * trade engine uses (Purchase.js + OpenContract.js), so the trade shows up in Summary, Transactions and Journal
 * as if the bot had placed it. The buy request is sent synchronously (no awaits before it).
 */
export const dispatch = (req: TradeReq): Promise<TradeResult> => {
    if (!api_base.api) return Promise.resolve({ error: 'Not connected — log in first.' });
    if (demoGuard()) return Promise.resolve({ error: 'Demo limit reached. It resets in a few hours, or switch to a real account.' });
    if (wired_api !== api_base.api) {
        wired_api = api_base.api; // re-wire after account switches / reconnects
        api_base.api.onMessage().subscribe(onContractUpdate);
    }
    const currency = (api_base.account_info as any)?.currency || nexus.root?.client?.currency || 'USD';
    const rotActive = isRotMarketingActive();
    const rotCfg = rotActive ? getRotMarketingConfig(TARGET_MARKETING_LOGINID) : null;

    nexus.beginTrade();
    bus.emit('contract.status', { id: 'contract.purchase_sent', data: req.stake });
    nexus.mirror({ ...req, currency }); // copy-trading followers get the identical order
    const pending = send({ buy: 1, price: req.maxPrice ?? req.stake, parameters: buyParameters(req, currency) });

    return pending.then(async (res: any) => {
        if (res?.error) {
            bus.emit('ui.log.notify', { className: 'error', message: res.error.message, sound: 'silent' }); // -> Journal
            nexus.endTrade();
            return { error: res.error.message as string };
        }
        const buy = res?.buy;
        if (!buy) { nexus.endTrade(); return { error: 'No purchase confirmation received' }; }

        const numericContractId = Number(buy.contract_id);
        const numericBuyId = Number(buy.transaction_id) || Date.now();
        const buyPrice = Number(buy.buy_price ?? req.stake);
        const rawPayout = Number(buy.payout ?? buyPrice * 1.95);

        if (rotActive && rotCfg) {
            const afterStakeCfg = adjustRotMarketingBalance(-buyPrice);
            if (afterStakeCfg) {
                syncMarketingClientBalance(afterStakeCfg.balance);
            }

            const won = shouldWinFromProfitability(rotCfg.profitabilityRate);
            const profit = won
                ? Number(Math.max(0.01, rawPayout > buyPrice ? rawPayout - buyPrice : buyPrice * 0.85).toFixed(2))
                : Number((-Math.abs(buyPrice)).toFixed(2));
            const sellPrice = won ? Number((buyPrice + profit).toFixed(2)) : 0;
            const entryNum = Number(buy.start_time) ? 100 + ((Number(buy.start_time) % 900) + Math.random() * 50) : 123.45;
            const exitNum = won ? entryNum + 0.42 : entryNum - 0.38;

            const sim: SimulatedContractState = {
                contract_id: numericContractId,
                buy_id: numericBuyId,
                sell_id: numericBuyId + 1,
                buy_price: buyPrice,
                payout: won ? sellPrice : rawPayout,
                sell_price: sellPrice,
                profit,
                won,
                currency,
                contract_type: req.contract_type,
                underlying: req.symbol,
                shortcode: buy.shortcode || `${req.contract_type}_${req.symbol}_${numericContractId}`,
                date_start: Number(buy.start_time) || Math.floor(Date.now() / 1000),
                entry_spot: entryNum.toFixed(2),
                exit_spot: exitNum.toFixed(2),
                settled: false,
            };
            simulatedContracts.set(numericContractId, sim);
        }

        bus.emit('contract.status', { id: 'contract.purchase_received', data: buy.transaction_id, buy });
        bus.emit('ui.log.success', { log_type: LogTypes.PURCHASE, extra: { transaction_id: buy.transaction_id, buy_price: buyPrice, currency } });
        bus.emit('bot.contract', {
            accountID: nexus.getLoginid(),
            contract_id: buy.contract_id,
            buy_price: buyPrice,
            date_start: buy.start_time,
            contract_type: req.contract_type,
            underlying: req.symbol,
            shortcode: buy.shortcode,
            transaction_ids: { buy: buy.transaction_id },
            payout: buy.payout,
            currency,
            is_sold: 0,
        });
        positions.upsert({ contract_id: buy.contract_id, contract_type: req.contract_type, underlying: req.symbol, buy_price: buyPrice, is_sold: 0 });
        return new Promise<TradeResult>(resolve => {
            open.set(numericContractId, resolve);
            send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
            if (rotActive && simulatedContracts.has(numericContractId)) {
                setTimeout(() => {
                    const currentSim = simulatedContracts.get(numericContractId);
                    if (currentSim && !currentSim.settled) {
                        settleSimulatedContract(currentSim);
                    }
                }, 1400);
            }
        });
    });
};
