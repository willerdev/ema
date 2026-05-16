import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTransactionFeed } from '../hooks/useTransactionFeed';
import { authService } from '../services/authService';
import { supportService, SupportCategory, SupportTicket } from '../services/supportService';
import type { RootStackParamList, WalletActivityRow } from '../types';
import { palette } from '../theme/colors';
import { formatNetworkLabel } from '../utils/userFacingError';
import { activityAmountPlain } from '../utils/walletActivity';

type Route = RouteProp<RootStackParamList, 'Support'>;
type Nav = NativeStackNavigationProp<RootStackParamList, 'Support'>;

const CATEGORIES: { key: SupportCategory; title: string; subtitle: string }[] = [
  { key: 'withdraw', title: 'Withdrawal issue', subtitle: 'Crypto or wallet payout problems' },
  { key: 'deposit', title: 'Deposit issue', subtitle: 'Payment not credited or wrong amount' },
  { key: 'daily_earning', title: 'Daily earning issue', subtitle: 'Airfarming, contracts, or yields' },
  { key: 'transfer', title: 'Transfer issue', subtitle: 'Send by ID or member transfers' },
];

function RecentRow({ row, onPress }: { row: WalletActivityRow; onPress: () => void }) {
  return (
    <Pressable style={styles.recentRow} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.recentTitle}>{row.methodLabel || row.category}</Text>
        <Text style={styles.recentSub} numberOfLines={1}>
          {activityAmountPlain(row)} · {new Date(row.createdAt).toLocaleString()}
        </Text>
      </View>
      <Text style={styles.recentPick}>Use</Text>
    </Pressable>
  );
}

export function SupportScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const initialCategory = route.params?.category;

  const { rows, loading: feedLoading, refresh: refreshFeed } = useTransactionFeed(true);
  const [step, setStep] = useState<'pick' | 'form' | 'done'>(initialCategory ? 'form' : 'pick');
  const [category, setCategory] = useState<SupportCategory | null>(initialCategory ?? null);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [pastTickets, setPastTickets] = useState<SupportTicket[]>([]);

  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [amountInvested, setAmountInvested] = useState('');
  const [dateInvested, setDateInvested] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [recipientTransferId, setRecipientTransferId] = useState('');
  const [relatedActivityId, setRelatedActivityId] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const totp = await authService.getTotpStatus();
      setTotpEnabled(Boolean(totp.enabled));
    } catch {
      setTotpEnabled(false);
    }
    try {
      const data = await supportService.listTickets();
      setPastTickets(data.tickets || []);
    } catch {
      setPastTickets([]);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const recentDeposits = useMemo(
    () => rows.filter((r) => r.category === 'deposit').slice(0, 10),
    [rows]
  );
  const recentWithdrawals = useMemo(
    () => rows.filter((r) => r.category === 'withdraw').slice(0, 10),
    [rows]
  );
  const recentTransfers = useMemo(
    () => rows.filter((r) => r.category === 'transfer' || r.source?.includes('peer')).slice(0, 10),
    [rows]
  );

  const pickCategory = (c: SupportCategory) => {
    setCategory(c);
    setStep('form');
    setRelatedActivityId(null);
  };

  const applyRecent = (row: WalletActivityRow, c: SupportCategory) => {
    setRelatedActivityId(row.id);
    if (c === 'withdraw') {
      setAddress(row.address || '');
      setAmount(String(row.amount ?? ''));
      setNetwork(formatNetworkLabel(row.asset));
    } else if (c === 'deposit') {
      setTransactionId(row.id.replace(/^payment-/, ''));
      setAmount(String(row.amount ?? ''));
    } else if (c === 'transfer') {
      setAmount(String(row.amount ?? ''));
    }
  };

  const submit = async () => {
    if (!category) return;
    if (category === 'withdraw' && !totpEnabled) {
      Alert.alert(
        '2FA required',
        'Enable two-factor authentication in Settings before submitting a withdrawal support request.'
      );
      return;
    }

    let payload: Record<string, unknown> = {};
    if (category === 'withdraw') {
      payload = { address: address.trim(), amount: Number(amount), network: network.trim() || undefined };
    } else if (category === 'deposit') {
      payload = { transactionId: transactionId.trim(), amount: Number(amount) };
    } else if (category === 'daily_earning') {
      payload = {
        amountInvested: Number(amountInvested),
        dateInvested: dateInvested.trim(),
        additionalInfo: additionalInfo.trim(),
      };
    } else if (category === 'transfer') {
      payload = {
        recipientTransferId: recipientTransferId.trim(),
        amount: Number(amount),
      };
    }

    setSubmitting(true);
    try {
      const res = await supportService.createTicket({
        category,
        payload,
        relatedActivityId: relatedActivityId || undefined,
      });
      setTicketId(res.ticket.id);
      setStep('done');
      void loadMeta();
    } catch (e: any) {
      Alert.alert('Could not submit', String(e?.message || 'Please try again'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = styles.input;

  if (step === 'done') {
    return (
      <View style={styles.container}>
        <Card>
          <Text style={styles.doneTitle}>Request submitted</Text>
          <Text style={styles.doneSub}>Status: Under review</Text>
          {ticketId ? <Text style={styles.ref}>Reference: {ticketId}</Text> : null}
          <Text style={styles.hint}>
            We will review your request and contact you if we need more information.
          </Text>
          <PrimaryButton label='Done' onPress={() => navigation.goBack()} style={{ marginTop: 16 }} />
        </Card>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {step === 'pick' ? (
        <Card>
          <Text style={styles.heading}>What can we help you with?</Text>
          {CATEGORIES.map((c) => (
            <Pressable key={c.key} style={styles.categoryCard} onPress={() => pickCategory(c.key)}>
              <Text style={styles.categoryTitle}>{c.title}</Text>
              <Text style={styles.categorySub}>{c.subtitle}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {step === 'form' && category ? (
        <Card>
          <Pressable onPress={() => setStep('pick')} style={styles.backLink}>
            <Text style={styles.backText}>← Change issue type</Text>
          </Pressable>
          <Text style={styles.heading}>
            {CATEGORIES.find((c) => c.key === category)?.title || 'Support'}
          </Text>
          <Text style={styles.statusChip}>Will be submitted as: Under review</Text>

          {feedLoading ? <ActivityIndicator color={palette.primary} style={{ marginVertical: 12 }} /> : null}

          {category === 'withdraw' ? (
            <>
              {!totpEnabled ? (
                <Text style={styles.warn}>
                  Two-factor authentication must be enabled for withdrawal support. Turn it on under Settings →
                  Security.
                </Text>
              ) : null}
              {recentWithdrawals.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>Recent withdrawals</Text>
                  {recentWithdrawals.map((row) => (
                    <RecentRow key={row.id} row={row} onPress={() => applyRecent(row, 'withdraw')} />
                  ))}
                </>
              ) : null}
              <Text style={styles.fieldLabel}>Withdrawal address</Text>
              <TextInput
                style={inputStyle}
                value={address}
                onChangeText={setAddress}
                placeholder='Whitelisted address'
                placeholderTextColor={palette.textSecondary}
                autoCapitalize='none'
              />
              <Text style={styles.fieldLabel}>Amount</Text>
              <TextInput
                style={inputStyle}
                value={amount}
                onChangeText={setAmount}
                placeholder='Amount'
                placeholderTextColor={palette.textSecondary}
                keyboardType='decimal-pad'
              />
              <Text style={styles.fieldLabel}>Network (optional)</Text>
              <TextInput
                style={inputStyle}
                value={network}
                onChangeText={setNetwork}
                placeholder='e.g. USDT TRC20'
                placeholderTextColor={palette.textSecondary}
              />
            </>
          ) : null}

          {category === 'deposit' ? (
            <>
              {recentDeposits.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>Recent deposits</Text>
                  {recentDeposits.map((row) => (
                    <RecentRow key={row.id} row={row} onPress={() => applyRecent(row, 'deposit')} />
                  ))}
                </>
              ) : null}
              <Text style={styles.fieldLabel}>Transaction ID or TXID</Text>
              <TextInput
                style={inputStyle}
                value={transactionId}
                onChangeText={setTransactionId}
                placeholder='Payment / order / blockchain TXID'
                placeholderTextColor={palette.textSecondary}
                autoCapitalize='none'
              />
              <Text style={styles.fieldLabel}>Amount</Text>
              <TextInput
                style={inputStyle}
                value={amount}
                onChangeText={setAmount}
                placeholder='Amount'
                placeholderTextColor={palette.textSecondary}
                keyboardType='decimal-pad'
              />
            </>
          ) : null}

          {category === 'daily_earning' ? (
            <>
              <Text style={styles.fieldLabel}>Amount invested (USD)</Text>
              <TextInput
                style={inputStyle}
                value={amountInvested}
                onChangeText={setAmountInvested}
                placeholder='Amount'
                placeholderTextColor={palette.textSecondary}
                keyboardType='decimal-pad'
              />
              <Text style={styles.fieldLabel}>Date invested</Text>
              <TextInput
                style={inputStyle}
                value={dateInvested}
                onChangeText={setDateInvested}
                placeholder='e.g. 2026-01-15'
                placeholderTextColor={palette.textSecondary}
              />
              <Text style={styles.fieldLabel}>Additional information</Text>
              <TextInput
                style={[inputStyle, styles.multiline]}
                value={additionalInfo}
                onChangeText={setAdditionalInfo}
                placeholder='Product, expected yield, anything else we should know'
                placeholderTextColor={palette.textSecondary}
                multiline
              />
            </>
          ) : null}

          {category === 'transfer' ? (
            <>
              {recentTransfers.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>Recent transfers</Text>
                  {recentTransfers.map((row) => (
                    <RecentRow key={row.id} row={row} onPress={() => applyRecent(row, 'transfer')} />
                  ))}
                </>
              ) : null}
              <Text style={styles.fieldLabel}>Recipient transfer ID</Text>
              <TextInput
                style={inputStyle}
                value={recipientTransferId}
                onChangeText={setRecipientTransferId}
                placeholder='EMA-XXXXXXXX'
                placeholderTextColor={palette.textSecondary}
                autoCapitalize='characters'
              />
              <Text style={styles.fieldLabel}>Amount (USD)</Text>
              <TextInput
                style={inputStyle}
                value={amount}
                onChangeText={setAmount}
                placeholder='Amount'
                placeholderTextColor={palette.textSecondary}
                keyboardType='decimal-pad'
              />
            </>
          ) : null}

          <PrimaryButton
            label={submitting ? 'Submitting…' : 'Submit request'}
            onPress={() => void submit()}
            disabled={submitting || (category === 'withdraw' && !totpEnabled)}
            style={{ marginTop: 16 }}
          />
        </Card>
      ) : null}

      {pastTickets.length > 0 ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.fieldLabel}>Your requests</Text>
          {pastTickets.slice(0, 8).map((t) => (
            <View key={t.id} style={styles.ticketRow}>
              <Text style={styles.ticketTitle}>{t.category.replace('_', ' ')}</Text>
              <Text style={styles.ticketSub}>
                {t.status.replace('_', ' ')} · {new Date(t.createdAt).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <PrimaryButton
        label='Refresh activity'
        onPress={() => void refreshFeed()}
        style={{ marginTop: 12, marginBottom: 24 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { padding: 16, paddingBottom: 32 },
  heading: { color: palette.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  categoryCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
    marginBottom: 8,
  },
  categoryTitle: { color: palette.textPrimary, fontSize: 15, fontWeight: '600' },
  categorySub: { color: palette.textSecondary, fontSize: 12, marginTop: 4 },
  backLink: { marginBottom: 8 },
  backText: { color: palette.primary, fontSize: 13, fontWeight: '600' },
  statusChip: {
    alignSelf: 'flex-start',
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  fieldLabel: { color: palette.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 6 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    color: palette.textPrimary,
    padding: 10,
    marginBottom: 4,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  hint: { color: palette.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 8 },
  warn: { color: '#fbbf24', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  recentTitle: { color: palette.textPrimary, fontSize: 13, fontWeight: '600' },
  recentSub: { color: palette.textSecondary, fontSize: 11, marginTop: 2 },
  recentPick: { color: palette.primary, fontSize: 12, fontWeight: '700' },
  ticketRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
  ticketTitle: { color: palette.textPrimary, fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
  ticketSub: { color: palette.textSecondary, fontSize: 12, marginTop: 2 },
  doneTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '700' },
  doneSub: { color: '#fbbf24', fontSize: 14, fontWeight: '600', marginTop: 8 },
  ref: { color: palette.textSecondary, fontSize: 12, marginTop: 8, fontFamily: 'Menlo' },
});
