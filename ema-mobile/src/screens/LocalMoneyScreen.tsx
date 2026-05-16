import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { FormModal } from '../components/FormModal';
import { LocationGateCard } from '../components/LocationGateCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { useLocalMoneyRegion } from '../hooks/useLocalMoneyRegion';
import { useToast } from '../hooks/useToast';
import { authService } from '../services/authService';
import { complianceService } from '../services/complianceService';
import { isTotpRequiredError, localMoneyService } from '../services/localMoneyService';
import { nowpaymentsService } from '../services/nowpaymentsService';
import { ExtraStackParamList } from '../types';
import { palette } from '../theme/colors';
import { sanitizeUserFacingError } from '../utils/userFacingError';
import {
  MIN_MOMO_USDT,
  maxWithdrawableAmount,
  minFiatForMomo,
  sumUsdtFamilyAvailable,
} from '../utils/walletDisplay';

type Nav = NativeStackNavigationProp<ExtraStackParamList, 'LocalMoney'>;

type Tab = 'deposit' | 'withdraw';

export function LocalMoneyScreen() {
  const navigation = useNavigation<Nav>();
  const { showToast } = useToast();
  const {
    countryCode,
    region,
    supported,
    loading: regionLoading,
    locationStatus,
    locationReady,
    bootstrapComplete,
    detectLocation,
    usdtPairLabel,
    error,
  } = useLocalMoneyRegion();

  const [tab, setTab] = useState<Tab>('deposit');
  const [phone, setPhone] = useState('');
  const [fiatAmount, setFiatAmount] = useState('');
  const [cryptoAmount, setCryptoAmount] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [complianceComplete, setComplianceComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [maxUsdt, setMaxUsdt] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const [profileRes, totpRes, np] = await Promise.all([
        complianceService.getProfile(),
        authService.getTotpStatus(),
        nowpaymentsService.getSummary().catch(() => null),
      ]);
      setComplianceComplete(profileRes.complete);
      setPhone(profileRes.profile?.phone || '');
      setTotpEnabled(Boolean(totpRes.enabled));
      const usdt = sumUsdtFamilyAvailable(np?.balances, np?.cashWalletUsd);
      setMaxUsdt(maxWithdrawableAmount(usdt));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const inputStyle = {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
  };

  const minFiat = region ? minFiatForMomo(region.usdtToFiatRate) : 0;

  const onDeposit = async () => {
    if (!countryCode || !supported) return;
    const amount = Number(fiatAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (amount < minFiat) {
      Alert.alert(
        'Amount too low',
        `Minimum deposit is ${MIN_MOMO_USDT} USDT (~${minFiat.toLocaleString()} ${region?.fiatLabel}).`
      );
      return;
    }
    setBusy(true);
    try {
      const res = await localMoneyService.deposit({
        countryCode,
        phone: phone.trim(),
        fiatAmount: amount,
      });
      setFiatAmount('');
      setConfirmOpen(false);
      showToast(res.message || 'Deposit initiated');
    } catch (e: any) {
      Alert.alert('Deposit failed', sanitizeUserFacingError(e?.message));
    } finally {
      setBusy(false);
    }
  };

  const onWithdraw = async () => {
    if (!countryCode || !supported) return;
    if (!totpEnabled) {
      Alert.alert(
        'Two-factor required',
        'Enable two-factor authentication in Settings before withdrawing to mobile money.',
        [{ text: 'Open Settings', onPress: () => navigation.navigate('Settings') }]
      );
      return;
    }
    const amount = Number(cryptoAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (amount < MIN_MOMO_USDT) {
      Alert.alert('Amount too low', `Minimum withdrawal is ${MIN_MOMO_USDT} USDT.`);
      return;
    }
    if (maxUsdt > 0 && amount > maxUsdt) {
      Alert.alert(
        'Insufficient balance',
        `Maximum withdrawable: ${Math.floor(maxUsdt)} USDT (fee reserve applied).`
      );
      return;
    }
    const code = totpCode.replace(/\s/g, '');
    if (code.length < 6) return;
    setBusy(true);
    try {
      const res = await localMoneyService.withdraw({
        countryCode,
        phone: phone.trim(),
        cryptoAmount: amount,
        totpCode: code,
      });
      setCryptoAmount('');
      setTotpCode('');
      setConfirmOpen(false);
      showToast(res.message || 'Withdrawal initiated');
      await loadProfile();
    } catch (e: any) {
      if (isTotpRequiredError(e)) {
        Alert.alert('Two-factor required', 'Enable 2FA in Settings to use mobile withdrawals.', [
          { text: 'Settings', onPress: () => navigation.navigate('Settings') },
        ]);
      } else {
        Alert.alert('Withdraw failed', sanitizeUserFacingError(e?.message));
      }
    } finally {
      setBusy(false);
    }
  };

  const estimatedFiat =
    region && cryptoAmount.trim()
      ? Math.round(Number(cryptoAmount) * region.usdtToFiatRate)
      : null;

  if (!bootstrapComplete) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          <ActivityIndicator color={palette.primary} style={{ marginVertical: 16 }} />
          <Text style={styles.meta}>Loading region…</Text>
        </Card>
      </ScrollView>
    );
  }

  if (!locationReady) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.sub}>
          Deposit or withdraw using mobile money. Enable location to see rates for where you are.
        </Text>
        <LocationGateCard locationStatus={locationStatus} error={error} onEnableLocation={detectLocation} />
      </ScrollView>
    );
  }

  if (!supported || !region) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          <Text style={styles.emptyTitle}>Not available in your region</Text>
          <Text style={styles.meta}>Mobile money is not offered where you are located.</Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.sub}>
        Rates for {region.countryName}: {usdtPairLabel}. Deposit or withdraw with mobile money.
      </Text>

      {regionLoading ? (
        <Text style={styles.meta}>Loading rates…</Text>
      ) : (
        <Card style={styles.rateCard}>
          <Text style={styles.rateLabel}>{usdtPairLabel}</Text>
          <Text style={styles.rateValue}>
            1 USDT ≈ {region.usdtToFiatRate.toLocaleString()} {region.fiatLabel}
          </Text>
        </Card>
      )}

      {supported ? (
        <>
          <View style={styles.tabRow}>
            {(['deposit', 'withdraw'] as Tab[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.tabChip, tab === t && styles.tabChipActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'deposit' ? 'Deposit' : 'Withdraw'}
                </Text>
              </Pressable>
            ))}
          </View>

          {!complianceComplete ? (
            <Card style={styles.banner}>
              <Text style={styles.bannerText}>Complete your profile in Settings before using mobile money.</Text>
            </Card>
          ) : null}

          {tab === 'deposit' ? (
            <Card>
              <Text style={styles.fieldLabel}>Mobile number</Text>
              <TextInput
                style={inputStyle}
                value={phone}
                onChangeText={setPhone}
                keyboardType='phone-pad'
                placeholder='Enter mobile number'
                placeholderTextColor={palette.textSecondary}
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>
                Amount ({region?.fiatLabel})
              </Text>
              <TextInput
                style={inputStyle}
                value={fiatAmount}
                onChangeText={setFiatAmount}
                keyboardType='decimal-pad'
                placeholder='Enter amount'
                placeholderTextColor={palette.textSecondary}
              />
              <Text style={styles.hint}>
                Minimum {MIN_MOMO_USDT} USDT (~{minFiat.toLocaleString()} {region?.fiatLabel}). You will receive a payment
                prompt on your phone. We will text you when the deposit is initiated or complete.
              </Text>
              <PrimaryButton
                label={busy ? 'Starting…' : 'Deposit with mobile money'}
                onPress={() => setConfirmOpen(true)}
                disabled={busy || !complianceComplete || !phone.trim() || !fiatAmount.trim()}
                style={{ marginTop: 14 }}
              />
            </Card>
          ) : (
            <Card>
              {!totpEnabled ? (
                <Text style={styles.warn}>
                  Enable two-factor authentication in Settings to withdraw to mobile money.
                </Text>
              ) : null}
              <Text style={styles.fieldLabel}>USDT amount (from wallet)</Text>
              <TextInput
                style={inputStyle}
                value={cryptoAmount}
                onChangeText={setCryptoAmount}
                keyboardType='decimal-pad'
                placeholder='How much USDT to withdraw'
                placeholderTextColor={palette.textSecondary}
              />
              {estimatedFiat != null && Number.isFinite(estimatedFiat) ? (
                <Text style={styles.meta}>
                  ≈ {estimatedFiat.toLocaleString()} {region?.fiatLabel}
                </Text>
              ) : null}
              <Text style={styles.meta}>Minimum withdrawal: {MIN_MOMO_USDT} USDT</Text>
              {maxUsdt > 0 ? (
                <Text style={styles.meta}>Max withdrawable: {Math.floor(maxUsdt)} USDT</Text>
              ) : null}
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Mobile number</Text>
              <TextInput
                style={inputStyle}
                value={phone}
                onChangeText={setPhone}
                keyboardType='phone-pad'
                placeholder='From your profile — edit if needed'
                placeholderTextColor={palette.textSecondary}
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Authenticator code</Text>
              <TextInput
                style={inputStyle}
                value={totpCode}
                onChangeText={setTotpCode}
                keyboardType='number-pad'
                placeholder='6-digit code'
                placeholderTextColor={palette.textSecondary}
                maxLength={8}
              />
              <PrimaryButton
                label={busy ? 'Submitting…' : 'Confirm withdrawal'}
                onPress={() => setConfirmOpen(true)}
                disabled={
                  busy ||
                  !complianceComplete ||
                  !totpEnabled ||
                  !phone.trim() ||
                  !cryptoAmount.trim() ||
                  totpCode.replace(/\s/g, '').length < 6
                }
                style={{ marginTop: 14 }}
              />
            </Card>
          )}
        </>
      ) : null}

      <FormModal
        visible={confirmOpen}
        title={tab === 'deposit' ? 'Confirm deposit' : 'Confirm withdrawal'}
        onClose={() => setConfirmOpen(false)}
        footer={
          <View style={{ gap: 8 }}>
            <PrimaryButton
              label={busy ? 'Please wait…' : 'Confirm'}
              onPress={tab === 'deposit' ? onDeposit : onWithdraw}
              disabled={busy}
            />
            <PrimaryButton label='Cancel' onPress={() => setConfirmOpen(false)} />
          </View>
        }
      >
        {tab === 'deposit' ? (
          <Text style={styles.confirmText}>
            Deposit {fiatAmount} {region?.fiatLabel} from mobile number {phone}? Approve the request on your phone when
            it arrives.
          </Text>
        ) : (
          <Text style={styles.confirmText}>
            Withdraw {cryptoAmount} USDT
            {estimatedFiat != null ? ` (~${estimatedFiat} ${region?.fiatLabel})` : ''} to {phone}? You will receive an
            SMS when it is initiated.
          </Text>
        )}
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  sub: { color: palette.textSecondary, lineHeight: 20, marginBottom: 14, fontSize: 13 },
  banner: { marginBottom: 12, borderColor: '#f59e0b' },
  bannerText: { color: palette.textPrimary, fontSize: 13, lineHeight: 18 },
  rateCard: { marginBottom: 14 },
  rateLabel: { color: palette.textSecondary, fontSize: 12 },
  rateValue: { color: palette.primary, fontSize: 22, fontWeight: '800', marginTop: 4 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tabChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
  },
  tabChipActive: { borderColor: palette.primary, backgroundColor: '#1f2937' },
  tabText: { color: palette.textSecondary, fontWeight: '600' },
  tabTextActive: { color: palette.primary },
  fieldLabel: { color: palette.textSecondary, fontSize: 12, fontWeight: '600' },
  hint: { color: palette.textSecondary, fontSize: 11, marginTop: 10, lineHeight: 16 },
  warn: { color: '#f59e0b', fontSize: 13, marginBottom: 10, lineHeight: 18 },
  meta: { color: palette.textSecondary, fontSize: 12, marginTop: 4 },
  emptyTitle: { color: palette.textPrimary, fontWeight: '700', marginBottom: 4 },
  confirmText: { color: palette.textPrimary, lineHeight: 20 },
});
