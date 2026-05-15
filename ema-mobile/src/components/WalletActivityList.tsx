import { StyleSheet, Text, View } from 'react-native';
import type { WalletActivityRow } from '../types';
import { palette } from '../theme/colors';
import {
  activityAmountText,
  activityHeadline,
  activityTimestamp,
  activityTypeLine,
} from '../utils/walletActivity';

type Props = {
  rows: WalletActivityRow[];
  emptyMessage?: string;
};

export function WalletActivityList({ rows, emptyMessage = 'No activity yet' }: Props) {
  if (!rows.length) {
    return <Text style={styles.empty}>{emptyMessage}</Text>;
  }

  return (
    <View>
      {rows.map((row, index) => {
        const { text: amountText, color: amountColor } = activityAmountText(row);
        return (
          <View key={row.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <View style={styles.topLine}>
                  <Text style={styles.headline} numberOfLines={1}>
                    {activityHeadline(row)}
                  </Text>
                  <Text style={[styles.amount, { color: amountColor }]}>{amountText}</Text>
                </View>
                <Text style={styles.timestamp}>{activityTimestamp(row.createdAt)}</Text>
                <Text style={styles.typeLine}>{activityTypeLine(row)}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: palette.textSecondary, fontSize: 14 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: 14,
  },
  row: { paddingVertical: 2 },
  rowMain: { flex: 1 },
  topLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  headline: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timestamp: {
    color: palette.textSecondary,
    fontSize: 13,
    marginBottom: 4,
    fontVariant: ['tabular-nums'],
  },
  typeLine: {
    color: palette.textSecondary,
    fontSize: 13,
  },
});
