import { getFormattedText } from '@/components/shared';
import DBotStore from '../../../scratch/dbot-store';
import { getRotMarketingConfig, TARGET_MARKETING_LOGINID } from '@/utils/account-helpers';
import { api_base } from '../../api/api-base';
import { info } from '../utils/broadcast';

let balance_string = '';

export default Engine =>
    class Balance extends Engine {
        observeBalance() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data?.msg_type === 'balance' && data?.balance) {
                    const {
                        balance: { balance: b, currency, loginid },
                    } = data;
                    const cfg =
                        (loginid || api_base.account_info?.loginid) === TARGET_MARKETING_LOGINID
                            ? getRotMarketingConfig(TARGET_MARKETING_LOGINID)
                            : null;
                    const effectiveBalance = cfg ? cfg.balance : b;

                    balance_string = getFormattedText(effectiveBalance, currency);

                    if (this.accountInfo) info({ accountID: this.accountInfo.loginid, balance: balance_string });
                }
            });
            api_base.pushSubscription(subscription);
        }

        // eslint-disable-next-line class-methods-use-this
        getBalance(type) {
            const { client } = DBotStore.instance;
            const cfg =
                client?.loginid === TARGET_MARKETING_LOGINID
                    ? getRotMarketingConfig(TARGET_MARKETING_LOGINID)
                    : null;
            const balance = cfg ? cfg.balance : (client && client.balance) || 0;

            balance_string = getFormattedText(balance, client.currency, false);
            return type === 'STR' ? balance_string : balance;
        }
    };
