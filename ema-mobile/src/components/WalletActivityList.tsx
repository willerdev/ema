import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WalletActivityRow } from '../types';
import { palette } from '../theme/colors';
import {
  activityAmountPlain,
  activityAmountText,
  activityHeadline,
  activityIsCompleted,
  activityListTitle,
  activityStatusLabel,
  activityTimestamp,
  activityTypeLine,
} from '../utils/walletActivity';

type Props = {
  rows: WalletActivityRow[];
  emptyMessage?: string;
  onPressRow?: (row: WalletActivityRow) => void;
  variant?: 'default' | 'compact';
};

export function WalletActivityList({
  rows,
  emptyMessage = 'No activity yet',
  onPressRow,
  variant = 'default',
}: Props) {
  if (!rows.length) {
    return <Text style={styles.empty}>{emptyMessage}</Text>;
  }

  if (variant === 'compact') {
    return (
      <View>
        {rows.map((row, index) => {
          const completed = activityIsCompleted(row);
          const content = (
            <>
              <View style={styles.compactMain}>
                <Text style={styles.compactAsset}>{activityListTitle(row)}</Text>
                <Text style={styles.compactTime}>{activityTimestamp(row.createdAt)}</Text>
              </View>
              <View style={styles.compactRight}>
                <Text style={styles.compactAmount}>{activityAmountPlain(row)}</Text>
                <View style={styles.statusRow}>
                  {completed ? <View style={styles.statusDot} /> : null}
                  <Text style={styles.compactStatus} numberOfLines={1}>
                    {activityStatusLabel(row)}
                  </Text>
                </View>
              </View>
              {onPressRow ? <Ionicons name='chevron-forward' size={18} color={palette.textSecondary} /> : null}
            </>
          );
          const rowStyle = [styles.compactRow, index < rows.length - 1 && styles.compactBorder];
          if (onPressRow) {
            return (
              <Pressable key={row.id} style={rowStyle} onPress={() => onPressRow(row)}>
                {content}
              </Pressable>
            );
          }
          return (
            <View key={row.id} style={rowStyle}>
              {content}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      {rows.map((row, index) => {
        const { text: amountText, color: amountColor } = activityAmountText(row);
        const inner = (
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
            {onPressRow ? <Ionicons name='chevron-forward' size={18} color={palette.textSecondary} /> : null}
          </View>
        );
        if (onPressRow) {
          return (
            <View key={row.id}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <Pressable onPress={() => onPressRow(row)}>{inner}</Pressable>
            </View>
          );
        }
        return (
          <View key={row.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            {inner}
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
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2, gap: 8 },
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
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  compactBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  compactMain: { flex: 1 },
  compactAsset: { color: palette.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 6 },
  compactTime: { color: palette.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  compactRight: { alignItems: 'flex-end', marginRight: 4 },
  compactAmount: { color: palette.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.success },
  compactStatus: { color: palette.textSecondary, fontSize: 12, flexShrink: 1 },
});
