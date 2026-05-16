import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { PrimaryButton } from '../components/PrimaryButton';
import { useToast } from '../hooks/useToast';
import type { RootStackParamList } from '../types';
import { palette } from '../theme/colors';
import {
  activityAmountPlain,
  activityIsCompleted,
  activityStatusLabel,
  activityTimestamp,
  blockchainExplorerUrl,
  formatAssetDisplay,
  formatActivityStatus,
} from '../utils/walletActivity';

type Route = RouteProp<RootStackParamList, 'TransactionDetail'>;

function methodLabelForRow(row: import('../types').WalletActivityRow): string {
  return row.methodLabel || (row.category === 'transfer' ? 'Member transfer' : row.kind === 'payment' ? 'On-chain deposit' : row.kind === 'payout' ? 'On-chain withdrawal' : 'Internal');
}

function DetailRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const { showToast } = useToast();
  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      showToast('Copied');
    } catch {
      Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  };
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueWrap}>
        <Text style={styles.detailValue} selectable>
          {value}
        </Text>
        {copyable ? (
          <Pressable onPress={() => void onCopy()} hitSlop={10} style={styles.copyBtn}>
            <Ionicons name='copy-outline' size={18} color={palette.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function TransactionDetailScreen() {
  const route = useRoute<Route>();
  const row = route.params.row;
  const completed = activityIsCompleted(row);
  const explorer = blockchainExplorerUrl(row);

  const title =
    row.category === 'deposit'
      ? 'Deposit details'
      : row.category === 'withdraw'
        ? 'Withdrawal details'
        : row.category === 'transfer'
          ? 'Transfer details'
          : 'Transaction details';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.caption}>Quantity</Text>
      <Text style={styles.quantity}>{activityAmountPlain(row)}</Text>
      <View style={styles.statusWrap}>
        {completed ? <Ionicons name='checkmark-circle' size={20} color={palette.success} /> : null}
        <Text style={[styles.statusText, completed && styles.statusOk]}>
          {activityStatusLabel(row)}
        </Text>
      </View>

      <View style={styles.card}>
        <DetailRow label='Type' value={title.replace(' details', '')} />
        <DetailRow label='Method' value={methodLabelForRow(row)} />
        <DetailRow label='Account' value='Funding account' />
        {row.fee != null && Number.isFinite(row.fee) ? (
          <DetailRow label='Fees' value={String(row.fee)} />
        ) : (
          <DetailRow label='Fees' value='—' />
        )}
        <DetailRow label='Chain type' value={formatAssetDisplay(row.asset)} />
        <DetailRow label='Time' value={activityTimestamp(row.createdAt)} />
        <DetailRow label='Status' value={formatActivityStatus(row.status)} />
        {row.address ? <DetailRow label='Address' value={row.address} copyable /> : null}
        {row.txHash ? <DetailRow label='Transaction hash' value={row.txHash} copyable /> : null}
        {row.source ? <DetailRow label='Reference' value={row.source} copyable /> : null}
      </View>

      {explorer ? (
        <PrimaryButton
          label='View in blockchain explorer'
          onPress={() => void Linking.openURL(explorer)}
          style={styles.explorerBtn}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, paddingBottom: 40 },
  caption: { color: palette.textSecondary, textAlign: 'center', fontSize: 14, marginBottom: 8 },
  quantity: {
    color: palette.textPrimary,
    textAlign: 'center',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 12,
  },
  statusWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 },
  statusText: { color: palette.textSecondary, fontSize: 15, fontWeight: '600' },
  statusOk: { color: palette.success },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    gap: 16,
  },
  detailLabel: { color: palette.textSecondary, fontSize: 14, flexShrink: 0 },
  detailValueWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 8 },
  detailValue: { color: palette.textPrimary, fontSize: 14, textAlign: 'right', flex: 1 },
  copyBtn: { marginTop: 2 },
  explorerBtn: { marginTop: 8 },
});
