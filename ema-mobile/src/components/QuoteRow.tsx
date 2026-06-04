import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LivePrice } from '../services/liveTradingService';
import { palette } from '../theme/colors';

export const QUOTE_STALE_MS = 3 * 60 * 1000;

type QuoteRowProps = {
  price: LivePrice;
};

export function QuoteRow({ price }: QuoteRowProps) {
  const prevBid = useRef(price.bid);
  const [tick, setTick] = useState<'up' | 'down' | 'flat'>('flat');
  const updatedMs = price.updatedAt ? Date.parse(price.updatedAt) : 0;
  const stale = !updatedMs || Date.now() - updatedMs > QUOTE_STALE_MS;

  useEffect(() => {
    if (price.bid > prevBid.current) setTick('up');
    else if (price.bid < prevBid.current) setTick('down');
    else setTick('flat');
    prevBid.current = price.bid;
  }, [price.bid]);

  const color = stale ? palette.textPrimary : tick === 'up' ? palette.success : tick === 'down' ? palette.danger : palette.textPrimary;

  return (
    <View style={styles.row}>
      <Text style={[styles.symbol, stale && styles.stale]}>{price.symbol}</Text>
      <Text style={[styles.bid, { color }]}>{price.bid.toFixed(5)}</Text>
      <Text style={styles.ask}>{price.ask.toFixed(5)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    gap: 8,
  },
  symbol: { flex: 1, color: palette.textPrimary, fontWeight: '700' },
  stale: { color: palette.textPrimary },
  bid: { width: 88, textAlign: 'right', fontWeight: '700' },
  ask: { width: 88, textAlign: 'right', color: palette.textSecondary },
});
