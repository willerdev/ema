import { useCallback, useEffect, useState } from 'react';
import { nowpaymentsService } from '../services/nowpaymentsService';
import { walletService } from '../services/walletService';
import type { NowpaymentsSummary, WalletActivityRow, WalletTransaction } from '../types';
import { mergeAllWalletActivity } from '../utils/walletActivity';

export function useTransactionFeed(autoLoad = true) {
  const [npSummary, setNpSummary] = useState<NowpaymentsSummary | null>(null);
  const [cashTransactions, setCashTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [summary, cash] = await Promise.all([
        nowpaymentsService.getSummary(),
        walletService.getWallet().catch(() => ({ balance: 0, transactions: [] as WalletTransaction[] })),
      ]);
      setNpSummary(summary);
      setCashTransactions(cash.transactions ?? []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load transactions');
      setNpSummary(null);
      setCashTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  const rows = mergeAllWalletActivity(npSummary, cashTransactions);

  return { npSummary, rows, loading, error, refresh };
}
