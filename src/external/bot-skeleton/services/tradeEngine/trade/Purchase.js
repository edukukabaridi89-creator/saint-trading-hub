import { LogTypes } from '../../../constants/messages';
import DBotStore from '../../../scratch/dbot-store';
import {
    adjustRotMarketingBalance,
    getRotMarketingConfig,
    TARGET_MARKETING_LOGINID,
} from '@/utils/account-helpers';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

const MARKUP_MULTIPLIER = 0.97; // 3% markup commission deducted from winning payouts

let delayIndex = 0;
let purchase_reference;

const isRotMarketingActive = (loginid) =>
    loginid === TARGET_MARKETING_LOGINID && Boolean(getRotMarketingConfig(TARGET_MARKETING_LOGINID));

const getRawGrossPayoutMultiplier = (contractType) => {
    const t = String(contractType || '').toUpperCase();
    if (t === 'DIGITMATCH') return 8.5;
    if (t === 'DIGITDIFF') return 1.1;
    if (t === 'DIGITOVER' || t === 'DIGITUNDER') return 2.25;
    return 1.95;
};

const createLocalMarketingBuyResponse = (amount, contractType, symbol = 'R_25') => {
    const nowSec = Math.floor(Date.now() / 1000);
    const contractId = Number(`${nowSec}${Math.floor(100 + Math.random() * 899)}`);
    const txId = Number(`${nowSec}${Math.floor(100 + Math.random() * 899)}`);
    const stake = Number(amount || 1);
    const grossPayout = Number((stake * getRawGrossPayoutMultiplier(contractType)).toFixed(2));
    const netPayout = Number((grossPayout * MARKUP_MULTIPLIER).toFixed(2));
    return {
        buy: {
            contract_id: contractId,
            transaction_id: txId,
            buy_price: stake,
            payout: netPayout,
            start_time: nowSec,
            shortcode: `${contractType}_${symbol}_${contractId}`,
        },
    };
};

const decideRotOutcome = (cfg) => {
    if (!cfg.profitabilityEnabled) {
        return Math.random() < 0.485;
    }
    const clamped = Math.max(0, Math.min(100, cfg.profitabilityRate));
    if (clamped <= 0) return false;
    if (clamped >= 100) return true;
    return Math.random() * 100 < clamped;
};

const pickDigitForContract = (contractType, won, barrierRaw) => {
    const t = String(contractType || '').toUpperCase();
    const barrierNum = Number(barrierRaw);

    if (t === 'DIGITEVEN') {
        const pool = won ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9];
        return pool[Math.floor(Math.random() * pool.length)];
    }
    if (t === 'DIGITODD') {
        const pool = won ? [1, 3, 5, 7, 9] : [0, 2, 4, 6, 8];
        return pool[Math.floor(Math.random() * pool.length)];
    }
    if (t === 'DIGITOVER') {
        const barrier = Number.isFinite(barrierNum) ? Math.max(0, Math.min(8, Math.floor(barrierNum))) : 5;
        const pool = won
            ? Array.from({ length: 9 - barrier }, (_, idx) => barrier + 1 + idx)
            : Array.from({ length: barrier + 1 }, (_, idx) => idx);
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : won ? 7 : 4;
    }
    if (t === 'DIGITUNDER') {
        const barrier = Number.isFinite(barrierNum) ? Math.max(1, Math.min(9, Math.floor(barrierNum))) : 4;
        const pool = won
            ? Array.from({ length: barrier }, (_, idx) => idx)
            : Array.from({ length: 10 - barrier }, (_, idx) => barrier + idx);
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : won ? 2 : 5;
    }
    if (t === 'DIGITMATCH' || t === 'DIGITDIFF') {
        const targetDigit = Number.isFinite(barrierNum) ? Math.max(0, Math.min(9, Math.floor(barrierNum))) : 5;
        const shouldMatchDigit = t === 'DIGITMATCH' ? won : !won;
        if (shouldMatchDigit) return targetDigit;
        const others = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => d !== targetDigit);
        return others[Math.floor(Math.random() * others.length)];
    }
    return null;
};

const buildCoherentSpots = (contractType, won, startTime, barrierRaw) => {
    const baseNum = 100 + ((startTime % 850) + Math.random() * 40);
    const chosenDigit = pickDigitForContract(contractType, won, barrierRaw);

    if (chosenDigit !== null) {
        const scaledInt = Math.round(baseNum * 100);
        const adjustedInt = Math.floor(scaledInt / 10) * 10 + chosenDigit;
        const sameSpot = (adjustedInt / 100).toFixed(2);
        // Same entry and exit price on digit contracts as requested
        return {
            entrySpot: sameSpot,
            exitSpot: sameSpot,
        };
    }

    const entrySpotNum = Number(baseNum.toFixed(2));
    const t = String(contractType || '').toUpperCase();
    const move = 0.25 + Math.random() * 0.35;
    const exitSpotNum =
        t === 'PUT'
            ? Number((entrySpotNum + (won ? -move : move)).toFixed(2))
            : Number((entrySpotNum + (won ? move : -move)).toFixed(2));

    return {
        entrySpot: entrySpotNum.toFixed(2),
        exitSpot: exitSpotNum.toFixed(2),
    };
};

export default Engine =>
    class Purchase extends Engine {
        scheduleRotMarketingSettlement(buy, contractType, cfg) {
            const buyPrice = Number(buy.buy_price ?? this.tradeOptions?.amount ?? 1);
            const t = String(contractType || '').toUpperCase();
            const grossMult = getRawGrossPayoutMultiplier(t);
            const maxGross = t === 'DIGITMATCH' ? buyPrice * 12 : buyPrice * 5;
            const minGross = buyPrice * 1.05;
            const rawPayout = Number(buy.payout ?? buyPrice * grossMult);
            const won = decideRotOutcome(cfg);

            let profit;
            let sellPrice;
            if (won) {
                const grossPayout =
                    rawPayout >= minGross && rawPayout <= maxGross
                        ? rawPayout
                        : Number((buyPrice * grossMult).toFixed(2));
                sellPrice = Number((grossPayout * MARKUP_MULTIPLIER).toFixed(2));
                profit = Number((sellPrice - buyPrice).toFixed(2));
            } else {
                sellPrice = 0;
                profit = Number((-Math.abs(buyPrice)).toFixed(2));
            }

            const nowSec = Math.floor(Date.now() / 1000);
            const startTime = Number(buy.start_time) || nowSec;
            const sellTxId = Number(buy.transaction_id || nowSec) + 1;
            const barrierRaw = this.tradeOptions?.prediction ?? this.tradeOptions?.barrierOffset;
            const { entrySpot, exitSpot } = buildCoherentSpots(contractType, won, startTime, barrierRaw);
            const currency =
                this.tradeOptions?.currency ||
                api_base.account_info?.currency ||
                DBotStore.instance?.client?.currency ||
                'USD';
            const symbol = this.tradeOptions?.symbol || this.tradeOptions?.underlying_symbol || 'R_25';
            const accountID = this.accountInfo?.loginid || TARGET_MARKETING_LOGINID;

            const openContract = {
                accountID,
                contract_id: Number(buy.contract_id),
                buy_price: buyPrice,
                sell_price: 0,
                bid_price: won ? sellPrice : 0,
                payout: won ? sellPrice : 0,
                profit: 0,
                currency,
                contract_type: contractType,
                underlying: symbol,
                underlying_symbol: symbol,
                shortcode: buy.shortcode,
                date_start: startTime,
                date_expiry: nowSec + 2,
                entry_spot: entrySpot,
                entry_tick: entrySpot,
                entry_tick_time: startTime,
                transaction_ids: { buy: buy.transaction_id },
                status: 'open',
                is_sold: 0,
                is_expired: 0,
                is_valid_to_sell: 1,
            };

            broadcastContract(openContract);

            setTimeout(() => {
                const updated = adjustRotMarketingBalance(sellPrice);
                const client = DBotStore.instance?.client;
                if (updated && client?.setBalance) {
                    client.setBalance(updated.balance.toFixed(2));
                }

                const soldContract = {
                    ...openContract,
                    sell_price: sellPrice,
                    bid_price: sellPrice,
                    profit,
                    exit_spot: exitSpot,
                    exit_tick: exitSpot,
                    exit_tick_time: nowSec + 1,
                    transaction_ids: {
                        buy: buy.transaction_id,
                        sell: sellTxId,
                    },
                    status: won ? 'won' : 'lost',
                    is_sold: 1,
                    is_expired: 1,
                    is_valid_to_sell: 0,
                };

                this.isSold = true;
                this.contractId = '';
                this.data.contract = soldContract;
                broadcastContract(soldContract);
                this.updateTotals?.(soldContract);
                contractStatus({
                    id: 'contract.sold',
                    data: sellTxId,
                    contract: soldContract,
                });
                log(profit > 0 ? LogTypes.PROFIT : LogTypes.LOST, {
                    currency,
                    profit: Number(profit.toFixed(2)),
                });
            }, 1400);
        }

        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            // Demo trade limit (src/nexus/demo-limit.ts): no new purchase on a locked demo; the bot is stopped by the pop-up
            if (window.__nexusDemoGuard?.()) {
                return new Promise(() => {});
            }

            // Nexus copy trading: send the same contract to the followers' accounts (see src/nexus/store.ts)
            try {
                window.__nexusMirror?.(tradeOptionToBuy(contract_type, this.tradeOptions).parameters);
            } catch (e) {
                // copying must never stop the bot
            }

            const activeLogin =
                this.accountInfo?.loginid || api_base.account_info?.loginid || DBotStore.instance?.client?.loginid;
            const rotCfg = isRotMarketingActive(activeLogin) ? getRotMarketingConfig(TARGET_MARKETING_LOGINID) : null;
            const symbol = this.tradeOptions?.symbol || this.tradeOptions?.underlying_symbol || 'R_25';

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const buy = response?.buy;
                if (!buy) {
                    return;
                }

                if (rotCfg) {
                    const stake = Number(buy.buy_price ?? this.tradeOptions?.amount ?? 0);
                    if (stake > 0) {
                        const updated = adjustRotMarketingBalance(-stake);
                        const client = DBotStore.instance?.client;
                        if (updated && client?.setBalance) {
                            client.setBalance(updated.balance.toFixed(2));
                        }
                    }
                }

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.last_activity_at = Date.now();
                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (!rotCfg && this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo?.loginid || TARGET_MARKETING_LOGINID,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });

                if (rotCfg) {
                    this.scheduleRotMarketingSettlement(buy, contract_type, rotCfg);
                }
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () =>
                    rotCfg
                        ? Promise.resolve(createLocalMarketingBuyResponse(askPrice, contract_type, symbol))
                        : api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (rotCfg || !this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () =>
                rotCfg
                    ? Promise.resolve(createLocalMarketingBuyResponse(this.tradeOptions.amount, contract_type, symbol))
                    : api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (rotCfg || !this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
