import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useIsFocused } from '@react-navigation/native';
import { Card } from '../components/Card';
import { FormModal } from '../components/FormModal';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { useToast } from '../hooks/useToast';
import { authService } from '../services/authService';
import { complianceService, isComplianceRequiredError } from '../services/complianceService';
import { walletService } from '../services/walletService';
import { palette } from '../theme/colors';
import { sanitizeUserFacingError } from '../utils/userFacingError';

export function SendByIdScreen() {
  const { showToast } = useToast();
  const isFocused = useIsFocused();

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [tradingBalance, setTradingBalance] = useState<number | null>(null);
  const [transferCode, setTransferCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [complianceComplete, setComplianceComplete] = useState(false);

  const [peerModalOpen, setPeerModalOpen] = useState(false);
  const [peerRecipient, setPeerRecipient] = useState('');
  const [peerAmount, setPeerAmount] = useState('');
  const [peerTotpCode, setPeerTotpCode] = useState('');
  const [peerSubmitting, setPeerSubmitting] = useState(false);
  const [recipientFirstName, setRecipientFirstName] = useState<string | null>(null);
  const [recipientLookupPending, setRecipientLookupPending] = useState(false);
  const [recipientLookupError, setRecipientLookupError] = useState<string | null>(null);
  const peerIdempotencyKeyRef = useRef<string | null>(null);
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alertComplianceRequired = () => {
    Alert.alert(
      'Profile required',
      'Complete your compliance profile in Settings before sending to other members.',
      [{ text: 'OK' }]
    );
  };

  const loadCompliance = useCallback(async () => {
    try {
      const data = await complianceService.getProfile();
      setComplianceComplete(Boolean(data.complete));
    } catch {
      setComplianceComplete(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const cash = await walletService.getWallet();
      setTradingBalance(cash.balance);
    } catch {
      setTradingBalance(null);
    }
    try {
      const codeRes = await walletService.getTransferCode();
      setTransferCode(codeRes.transferCode || null);
    } catch {
      setTransferCode(null);
    }
    try {
      const totp = await authService.getTotpStatus();
      setTotpEnabled(Boolean(totp.enabled));
    } catch {
      setTotpEnabled(false);
    }
    await loadCompliance();
  }, [loadCompliance]);

  usePolling(refresh, 60000, isFocused && !peerModalOpen);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const openPeerModal = () => {
    if (!complianceComplete) {
      alertComplianceRequired();
      return;
    }
    peerIdempotencyKeyRef.current =
      globalThis.crypto?.randomUUID?.() ?? `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPeerRecipient('');
    setPeerAmount('');
    setPeerTotpCode('');
    setRecipientFirstName(null);
    setRecipientLookupError(null);
    setPeerSubmitting(false);
    setPeerModalOpen(true);
  };

  useEffect(() => {
    if (!peerModalOpen) return;
    const code = peerRecipient.trim();
    if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current);
    if (code.length < 6) {
      setRecipientFirstName(null);
      setRecipientLookupError(null);
      setRecipientLookupPending(false);
      return;
    }
    setRecipientLookupPending(true);
    setRecipientLookupError(null);
    lookupTimerRef.current = setTimeout(() => {
      void walletService
        .lookupTransferCode(code)
        .then((res) => {
          if (res.self) {
            setRecipientFirstName(null);
            setRecipientLookupError('You cannot send to your own transfer ID.');
            return;
          }
          if (!res.found) {
            setRecipientFirstName(null);
            setRecipientLookupError('No member found with this transfer ID.');
            return;
          }
          setRecipientLookupError(null);
          setRecipientFirstName(res.recipientFirstName?.trim() || null);
        })
        .catch(() => {
          setRecipientFirstName(null);
          setRecipientLookupError(null);
        })
        .finally(() => setRecipientLookupPending(false));
    }, 400);
    return () => {
      if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current);
    };
  }, [peerRecipient, peerModalOpen]);

  const onCopyTransferId = async () => {
    if (!transferCode) return;
    try {
      await Clipboard.setStringAsync(transferCode);
      showToast('Transfer ID copied');
    } catch {
      Alert.alert('Copy failed', 'Could not copy.');
    }
  };

  function sanitizeError(raw: string) {
    return sanitizeUserFacingError(raw, 'Service temporarily unavailable. Please try again.');
  }

  const onPeerTransfer = async () => {
    const n = Number(peerAmount);
    if (!Number.isFinite(n) || n <= 0) return;
    const bal = tradingBalance ?? 0;
    if (n > bal) {
      Alert.alert('Insufficient balance', 'Amount exceeds your trading USD balance.');
      return;
    }
    const rc = peerRecipient.trim();
    if (!rc) return;
    const totpOk = !totpEnabled || peerTotpCode.replace(/\s/g, '').length >= 6;
    if (!totpOk) return;
    try {
      setPeerSubmitting(true);
      const idem = peerIdempotencyKeyRef.current || undefined;
      const res = await walletService.transferToCode(rc, Math.round(n * 100) / 100, {
        totpCode: totpEnabled ? peerTotpCode.replace(/\s/g, '') : undefined,
        idempotencyKey: idem,
      });
      setTradingBalance(res.balance);
      setPeerRecipient('');
      setPeerAmount('');
      setPeerTotpCode('');
      setPeerModalOpen(false);
      showToast(res.idempotent ? 'Transfer already processed' : 'Transfer sent');
      await refresh();
    } catch (e: any) {
      if (isComplianceRequiredError(e)) alertComplianceRequired();
      else Alert.alert('Transfer failed', sanitizeError(e?.message || 'Could not send'));
    } finally {
      setPeerSubmitting(false);
    }
  };

  const peerNum = Number(peerAmount);
  const peerTotpOk = !totpEnabled || peerTotpCode.replace(/\s/g, '').length >= 6;
  const peerReady =
    peerRecipient.trim().length > 0 &&
    Number.isFinite(peerNum) &&
    peerNum > 0 &&
    (tradingBalance ?? 0) >= peerNum &&
    peerTotpOk;

  const inputStyle = {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  } as const;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        {!complianceComplete ? (
          <Card style={styles.complianceBanner}>
            <Text style={styles.complianceBannerText}>
              Complete your compliance profile in Settings before you can send USD to other members.
            </Text>
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Send by transfer ID</Text>
          <Text style={styles.hint}>
            Moves your trading balance (airfarming / contracts). Not crypto. The recipient shares their transfer ID with you.
          </Text>
          <Text style={styles.balanceLabel}>Trading USD balance</Text>
          <Text style={styles.balanceValue}>{tradingBalance != null ? `$${tradingBalance.toFixed(2)}` : '—'}</Text>
          <Text style={styles.fieldLabel}>Your transfer ID</Text>
          {transferCode ? (
            <View style={styles.copyRow}>
              <Text style={[styles.mono, { flex: 1 }]} selectable>
                {transferCode}
              </Text>
              <PrimaryButton label='Copy' onPress={() => void onCopyTransferId()} />
            </View>
          ) : (
            <Text style={styles.hint}>Pull to refresh to load your transfer ID.</Text>
          )}
          <PrimaryButton
            label='Send to member'
            onPress={openPeerModal}
            disabled={!complianceComplete || tradingBalance == null || tradingBalance <= 0}
            style={{ marginTop: 10 }}
          />
        </Card>
      </ScrollView>

      <FormModal visible={peerModalOpen} title='Send to member' avoidKeyboard={false} onClose={() => setPeerModalOpen(false)}>
        <Text style={styles.hint}>Recipient transfer ID (e.g. AIRFARMS-XXXXXXXX).</Text>
        <TextInput
          style={inputStyle}
          value={peerRecipient}
          onChangeText={setPeerRecipient}
          placeholder='AIRFARMS-XXXXXXXX'
          placeholderTextColor={palette.textSecondary}
          autoCapitalize='characters'
        />
        {recipientLookupPending ? (
          <Text style={styles.recipientHint}>Looking up recipient…</Text>
        ) : recipientLookupError ? (
          <Text style={styles.recipientError}>{recipientLookupError}</Text>
        ) : recipientFirstName ? (
          <Text style={styles.recipientHint}>
            Sending to <Text style={styles.recipientName}>{recipientFirstName}</Text>
          </Text>
        ) : peerRecipient.trim().length >= 6 ? (
          <Text style={styles.recipientHint}>Member found</Text>
        ) : null}
        <Text style={styles.fieldLabel}>Amount (USD)</Text>
        <TextInput
          style={inputStyle}
          value={peerAmount}
          onChangeText={setPeerAmount}
          placeholder='0.00'
          placeholderTextColor={palette.textSecondary}
          keyboardType='decimal-pad'
        />
        {totpEnabled ? (
          <TextInput
            style={inputStyle}
            value={peerTotpCode}
            onChangeText={setPeerTotpCode}
            placeholder='Authenticator code'
            placeholderTextColor={palette.textSecondary}
            keyboardType='number-pad'
            maxLength={10}
          />
        ) : null}
        <PrimaryButton
          label={peerSubmitting ? 'Sending…' : 'Send'}
          onPress={() => void onPeerTransfer()}
          disabled={!peerReady || peerSubmitting}
        />
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  sectionTitle: { color: palette.textPrimary, marginBottom: 14, fontSize: 17, fontWeight: '700' },
  hint: { color: palette.textSecondary, marginTop: 4, marginBottom: 8, fontSize: 12 },
  fieldLabel: { color: palette.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 6, fontWeight: '600' },
  mono: { color: palette.textPrimary, fontFamily: 'Menlo', fontSize: 12, marginBottom: 8 },
  card: { marginBottom: 12 },
  complianceBanner: { marginBottom: 12, borderColor: '#f59e0b' },
  complianceBannerText: { color: palette.textPrimary, fontSize: 13, lineHeight: 18 },
  balanceLabel: { color: palette.textSecondary, fontSize: 12, marginTop: 8, marginBottom: 4 },
  balanceValue: { color: palette.textPrimary, fontSize: 20, fontWeight: '700' },
  copyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  recipientHint: { color: palette.textSecondary, fontSize: 13, marginBottom: 8, marginTop: -4 },
  recipientName: { color: palette.textPrimary, fontWeight: '700' },
  recipientError: { color: '#f87171', fontSize: 13, marginBottom: 8, marginTop: -4 },
});
