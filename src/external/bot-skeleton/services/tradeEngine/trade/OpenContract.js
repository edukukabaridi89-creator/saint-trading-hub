import { getRoundedNumber } from '@/components/shared';
import DBotStore from '../../../scratch/dbot-store';
import { adjustRotMarketingBalance, getRotMarketingConfig, TARGET_MARKETING_LOGINID } from '@/utils/account-helpers';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

const applyRotOutcomeToContract = contract => {
    const activeLogin = api_base.account_info?.loginid || DBotStore.instance?.client?.loginid;
    const cfg = activeLogin === TARGET_MARKETING_LOGINID ? getRotMarketingConfig(TARGET_MARKETING_LOGINID) : null;
    if (!cfg || !contract) return contract;

    const buyPrice = Number(contract.buy_price ?? 0);
    const shouldWin = Math.random() * 100 < Math.max(0, Math.min(100, cfg.profitabilityRate));
    const currentProfit = Number(contract.profit ?? Number(contract.sell_price ?? 0) - buyPrice);

    if (shouldWin && currentProfit <= 0) {
        const targetProfit = Number(
            Math.max(0.01, Number(contract.payout ?? buyPrice * 1.95) - buyPrice || buyPrice * 0.85).toFixed(2)
        );
        const sellPrice = Number((buyPrice + targetProfit).toFixed(2));
        return {
            ...contract,
            sell_price: sellPrice,
            bid_price: sellPrice,
            profit: targetProfit,
            status: contract.is_sold ? 'won' : contract.status,
        };
    }

    if (!shouldWin && currentProfit >= 0 && buyPrice > 0) {
        const lossProfit = Number((-Math.abs(buyPrice)).toFixed(2));
        return {
            ...contract,
            sell_price: 0,
            bid_price: 0,
            profit: lossProfit,
            status: contract.is_sold ? 'lost' : contract.status,
        };
    }

    return contract;
};

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const handleMessage = ({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const rawContract = data.proposal_open_contract;
                    const contract = applyRotOutcomeToContract(rawContract);

                    // Turbo mode: contracts released from the engine's single-contract lock are tracked here.
                    if (contract && this.turbo_contracts?.has(contract.contract_id)) {
                        broadcastContract({ accountID: api_base.account_info.loginid, ...contract });
                        if (contract.is_sold) {
                            this.turbo_contracts.delete(contract.contract_id);
                            this.updateTotals(contract);
                            contractStatus({ id: 'contract.sold', data: contract.transaction_ids.sell, contract });
                        }
                        return;
                    }

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                    if (this.isSold) {
                        const activeLogin = api_base.account_info?.loginid || DBotStore.instance?.client?.loginid;
                        if (activeLogin === TARGET_MARKETING_LOGINID && getRotMarketingConfig(TARGET_MARKETING_LOGINID)) {
                            const proceeds = Number(contract.sell_price ?? 0);
                            const updated = adjustRotMarketingBalance(proceeds);
                            const client = DBotStore.instance?.client;
                            if (updated && client?.setBalance) {
                                client.setBalance(updated.balance.toFixed(2));
                            }
                        }

                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);
                        contractStatus({
                            id: 'contract.sold',
                            data: contract.transaction_ids.sell,
                            contract,
                        });

                        if (this.afterPromise) {
                            this.afterPromise();
                        }

                        this.store.dispatch(sell());
                    } else {
                        this.store.dispatch(openContractReceived());
                    }
                }
            };
            const subscription = api_base.api.onMessage().subscribe(handleMessage);
            api_base.pushSubscription(subscription);
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
