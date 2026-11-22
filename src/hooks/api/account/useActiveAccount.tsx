import { useEffect, useMemo, useState } from 'react';
/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import {
    getRotMarketingConfig,
    isVirtualAccount,
    ROT_MARKETING_EVENT_NAME,
    TARGET_MARKETING_LOGINID,
} from '@/utils/account-helpers';
/* [/AI] */
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { useApiBase } from '@/hooks/useApiBase';
import { Balance } from '@deriv/api-types';

/** A custom hook that returns the account object for the current active account. */
const useActiveAccount = ({
    allBalanceData,
    directBalance,
}: {
    allBalanceData: Balance | null;
    directBalance?: string;
}) => {
    const { accountList, activeLoginid } = useApiBase();
    const [marketingTick, setMarketingTick] = useState(0);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onUpdate = () => setMarketingTick(n => n + 1);
        window.addEventListener(ROT_MARKETING_EVENT_NAME, onUpdate);
        return () => window.removeEventListener(ROT_MARKETING_EVENT_NAME, onUpdate);
    }, []);

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    const currentBalanceData = allBalanceData?.accounts?.[activeAccount?.loginid ?? ''];

    const modifiedAccount = useMemo(() => {
        if (!activeAccount) return undefined;

        // Use centralized utility to determine if demo account
        const isVirtual = isVirtualAccount(activeAccount.loginid);
        const marketingCfg =
            activeAccount.loginid === TARGET_MARKETING_LOGINID
                ? getRotMarketingConfig(activeAccount.loginid)
                : null;

        const rawBalanceNumber = marketingCfg
            ? marketingCfg.balance
            : currentBalanceData?.balance !== undefined
              ? Number(currentBalanceData.balance)
              : directBalance !== undefined
                ? parseFloat(directBalance)
                : 0;

        const safeNumericBalance = Number.isFinite(rawBalanceNumber) ? rawBalanceNumber : 0;

        return {
            ...activeAccount,
            balance: addComma(safeNumericBalance.toFixed(getDecimalPlaces(activeAccount.currency))),
            currencyLabel: isVirtual ? 'Demo' : activeAccount?.currency,
            icon: <CurrencyIcon currency={activeAccount?.currency?.toLowerCase()} isVirtual={isVirtual} />,
            isVirtual: isVirtual,
            isActive: activeAccount?.loginid === activeLoginid,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount, activeLoginid, allBalanceData, directBalance, marketingTick]);

    return {
        /** User's current active account. */
        data: modifiedAccount,
    };
};

export default useActiveAccount;
