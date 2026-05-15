import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { authService, TotpStatus } from '../services/authService';
import { alpacaService } from '../services/alpacaService';
import { complianceService } from '../services/complianceService';
import {
  ComplianceProfile,
  PlannedInvestmentDuration,
  SourceOfFunds,
} from '../types';
import { palette } from '../theme/colors';

const SOURCE_LABELS: Record<string, string> = {
  employment: 'Employment income',
  business: 'Business income',
  savings: 'Personal savings',
  investment_returns: 'Investment returns',
  inheritance: 'Inheritance / gift',
  other: 'Other',
};

const DURATION_LABELS: Record<string, string> = {
  under_1y: 'Under 1 year',
  '1_3y': '1–3 years',
  '3_5y': '3–5 years',
  over_5y: 'Over 5 years',
};

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [darkMode, setDarkMode] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [profile, setProfile] = useState<{ username: string; accountStatus: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [totpStatus, setTotpStatus] = useState<TotpStatus | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);
  const [setupOtpauthUrl, setSetupOtpauthUrl] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [totpConfirmCode, setTotpConfirmCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);

  const [complianceComplete, setComplianceComplete] = useState(false);
  const [complianceBusy, setComplianceBusy] = useState(false);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [durationOptions, setDurationOptions] = useState<string[]>([]);
  const [legalFirstName, setLegalFirstName] = useState('');
  const [legalLastName, setLegalLastName] = useState('');
  const [country, setCountry] = useState('');
  const [profession, setProfession] = useState('');
  const [sourceOfFunds, setSourceOfFunds] = useState<SourceOfFunds>('employment');
  const [sourceOfFundsDetail, setSourceOfFundsDetail] = useState('');
  const [plannedInvestmentAmount, setPlannedInvestmentAmount] = useState('');
  const [plannedInvestmentDuration, setPlannedInvestmentDuration] = useState<PlannedInvestmentDuration>('1_3y');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const applyComplianceProfile = (p: ComplianceProfile | null) => {
    if (!p) return;
    setLegalFirstName(p.legalFirstName || '');
    setLegalLastName(p.legalLastName || '');
    setCountry(p.country || '');
    setProfession(p.profession || '');
    setSourceOfFunds((p.sourceOfFunds as SourceOfFunds) || 'employment');
    setSourceOfFundsDetail(p.sourceOfFundsDetail || '');
    setPlannedInvestmentAmount(p.plannedInvestmentAmount != null ? String(p.plannedInvestmentAmount) : '');
    setPlannedInvestmentDuration((p.plannedInvestmentDuration as PlannedInvestmentDuration) || '1_3y');
    setDateOfBirth(p.dateOfBirth || '');
    setPhone(p.phone || '');
    setAddressLine(p.addressLine || '');
    setCity(p.city || '');
    setAcceptedTerms(Boolean(p.acceptedTermsAt));
  };

  const loadCompliance = useCallback(async () => {
    try {
      const data = await complianceService.getProfile();
      setComplianceComplete(Boolean(data.complete));
      if (data.options?.sourceOfFunds?.length) setSourceOptions(data.options.sourceOfFunds);
      if (data.options?.plannedInvestmentDuration?.length) {
        setDurationOptions(data.options.plannedInvestmentDuration);
      }
      applyComplianceProfile(data.profile);
    } catch {
      setComplianceComplete(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const data = await authService.profile();
      setProfile({ username: data.profile.username, accountStatus: data.profile.accountStatus });
    } catch {
      // keep previous data
    }
  }, []);

  const loadTotpStatus = useCallback(async () => {
    try {
      const s = await authService.getTotpStatus();
      setTotpStatus(s);
      if (!s.setupPending) {
        setSetupOtpauthUrl(null);
        setSetupSecret(null);
        setTotpConfirmCode('');
      }
    } catch {
      setTotpStatus(null);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadProfile(), loadTotpStatus(), loadCompliance()]);
  }, [loadProfile, loadTotpStatus, loadCompliance]);

  const saveCompliance = async () => {
    const amount = Number(plannedInvestmentAmount);
    if (!legalFirstName.trim() || !legalLastName.trim() || !country.trim() || !profession.trim()) {
      Alert.alert('Validation', 'Please fill in name, country, and profession.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Validation', 'Enter a valid planned investment amount.');
      return;
    }
    if (sourceOfFunds === 'other' && !sourceOfFundsDetail.trim()) {
      Alert.alert('Validation', 'Describe your source of funds.');
      return;
    }
    if (!acceptedTerms) {
      Alert.alert('Validation', 'Confirm that your information is accurate.');
      return;
    }
    setComplianceBusy(true);
    try {
      const data = await complianceService.saveProfile({
        legalFirstName: legalFirstName.trim(),
        legalLastName: legalLastName.trim(),
        country: country.trim(),
        profession: profession.trim(),
        sourceOfFunds,
        sourceOfFundsDetail: sourceOfFunds === 'other' ? sourceOfFundsDetail.trim() : undefined,
        plannedInvestmentAmount: amount,
        plannedInvestmentCurrency: 'usd',
        plannedInvestmentDuration,
        dateOfBirth: dateOfBirth.trim() || undefined,
        phone: phone.trim() || undefined,
        addressLine: addressLine.trim() || undefined,
        city: city.trim() || undefined,
        acceptedTerms: true,
      });
      setComplianceComplete(Boolean(data.complete));
      applyComplianceProfile(data.profile);
      Alert.alert(
        data.complete ? 'Profile complete' : 'Saved',
        data.complete
          ? 'You can withdraw funds once other requirements are met.'
          : 'Some required fields are still missing.'
      );
    } catch (error: any) {
      Alert.alert('Save failed', String(error?.message || 'Could not save profile'));
    } finally {
      setComplianceBusy(false);
    }
  };

  usePolling(refreshAll, 30000, true);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  }, [refreshAll]);

  const saveKeys = async () => {
    try {
      await alpacaService.updateKeys(apiKey, secretKey);
      try {
        await alpacaService.getAccount();
        Alert.alert('Saved', 'Alpaca keys saved and account access verified.');
      } catch {
        Alert.alert('Saved', 'Keys saved. Verify account access from Home/Trades.');
      }
    } catch (error: any) {
      Alert.alert('API Key Error', String(error?.message || 'Failed to save keys'));
    }
  };

  const startTotpSetup = async () => {
    setTotpBusy(true);
    try {
      const data = await authService.startTotpSetup();
      setSetupOtpauthUrl(data.otpauthUrl);
      setSetupSecret(data.secretBase32);
      setTotpConfirmCode('');
      await loadTotpStatus();
    } catch (error: any) {
      Alert.alert('Setup failed', String(error?.message || 'Could not start authenticator setup'));
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmTotpSetup = async () => {
    const code = totpConfirmCode.replace(/\s/g, '');
    if (code.length < 6) {
      Alert.alert('Validation', 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    setTotpBusy(true);
    try {
      await authService.confirmTotpSetup(code);
      setSetupOtpauthUrl(null);
      setSetupSecret(null);
      setTotpConfirmCode('');
      await loadTotpStatus();
      Alert.alert('Done', 'Two-factor authentication is enabled.');
    } catch (error: any) {
      Alert.alert('Confirm failed', String(error?.message || 'Invalid code'));
    } finally {
      setTotpBusy(false);
    }
  };

  const cancelTotpSetup = async () => {
    setTotpBusy(true);
    try {
      await authService.cancelTotpSetup();
      setSetupOtpauthUrl(null);
      setSetupSecret(null);
      setTotpConfirmCode('');
      await loadTotpStatus();
    } catch (error: any) {
      Alert.alert('Cancel failed', String(error?.message || 'Could not cancel'));
    } finally {
      setTotpBusy(false);
    }
  };

  const submitDisableTotp = async () => {
    if (!disablePassword || disableCode.replace(/\s/g, '').length < 6) {
      Alert.alert('Validation', 'Enter your account password and the current authenticator code.');
      return;
    }
    setTotpBusy(true);
    try {
      await authService.disableTotp(disablePassword, disableCode);
      setDisablePassword('');
      setDisableCode('');
      setShowDisableForm(false);
      await loadTotpStatus();
      Alert.alert('Done', 'Two-factor authentication has been turned off.');
    } catch (error: any) {
      Alert.alert('Disable failed', String(error?.message || 'Check password and code'));
    } finally {
      setTotpBusy(false);
    }
  };

  const copySecret = async () => {
    if (setupSecret) {
      await Clipboard.setStringAsync(setupSecret);
      Alert.alert('Copied', 'Secret key copied to clipboard.');
    }
  };

  const totpEnabled = totpStatus?.enabled ?? false;
  const totpSetupPending = totpStatus?.setupPending ?? false;
  const showQr = Boolean(setupOtpauthUrl && setupSecret);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Card>
        <Text style={styles.label}>Profile</Text>
        <Text style={styles.value}>Email: {user?.email}</Text>
        <Text style={styles.value}>Username: {profile?.username || user?.email.split('@')[0]}</Text>
        <Text style={styles.value}>Status: {profile?.accountStatus || 'active'}</Text>
      </Card>

      <Card>
        <Text style={styles.label}>Withdrawal requirements</Text>
        <Text style={styles.value}>
          Status: {complianceComplete ? 'Complete' : 'Incomplete'} — required before cash or crypto withdrawals.
        </Text>
        <TextInput
          style={styles.input}
          placeholder='Legal first name'
          placeholderTextColor={palette.textSecondary}
          value={legalFirstName}
          onChangeText={setLegalFirstName}
        />
        <TextInput
          style={styles.input}
          placeholder='Legal last name'
          placeholderTextColor={palette.textSecondary}
          value={legalLastName}
          onChangeText={setLegalLastName}
        />
        <TextInput
          style={styles.input}
          placeholder='Country of residence'
          placeholderTextColor={palette.textSecondary}
          value={country}
          onChangeText={setCountry}
        />
        <TextInput
          style={styles.input}
          placeholder='Profession / occupation'
          placeholderTextColor={palette.textSecondary}
          value={profession}
          onChangeText={setProfession}
        />
        <Text style={styles.subLabel}>Source of funds</Text>
        <View style={styles.chipRow}>
          {(sourceOptions.length ? sourceOptions : Object.keys(SOURCE_LABELS)).map((key) => (
            <Text
              key={key}
              style={[styles.chip, sourceOfFunds === key && styles.chipActive]}
              onPress={() => setSourceOfFunds(key as SourceOfFunds)}
            >
              {SOURCE_LABELS[key] || key}
            </Text>
          ))}
        </View>
        {sourceOfFunds === 'other' ? (
          <TextInput
            style={styles.input}
            placeholder='Describe source of funds'
            placeholderTextColor={palette.textSecondary}
            value={sourceOfFundsDetail}
            onChangeText={setSourceOfFundsDetail}
          />
        ) : null}
        <TextInput
          style={styles.input}
          placeholder='Planned investment amount (USD)'
          placeholderTextColor={palette.textSecondary}
          value={plannedInvestmentAmount}
          onChangeText={setPlannedInvestmentAmount}
          keyboardType='numeric'
        />
        <Text style={styles.subLabel}>Planned investment duration</Text>
        <View style={styles.chipRow}>
          {(durationOptions.length ? durationOptions : Object.keys(DURATION_LABELS)).map((key) => (
            <Text
              key={key}
              style={[styles.chip, plannedInvestmentDuration === key && styles.chipActive]}
              onPress={() => setPlannedInvestmentDuration(key as PlannedInvestmentDuration)}
            >
              {DURATION_LABELS[key] || key}
            </Text>
          ))}
        </View>
        <TextInput
          style={styles.input}
          placeholder='Date of birth (YYYY-MM-DD, optional)'
          placeholderTextColor={palette.textSecondary}
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
        />
        <TextInput
          style={styles.input}
          placeholder='Phone (optional)'
          placeholderTextColor={palette.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType='phone-pad'
        />
        <TextInput
          style={styles.input}
          placeholder='Address line (optional)'
          placeholderTextColor={palette.textSecondary}
          value={addressLine}
          onChangeText={setAddressLine}
        />
        <TextInput
          style={styles.input}
          placeholder='City (optional)'
          placeholderTextColor={palette.textSecondary}
          value={city}
          onChangeText={setCity}
        />
        <View style={styles.rowBetween}>
          <Text style={[styles.value, { flex: 1, marginRight: 8 }]}>I confirm this information is accurate</Text>
          <Switch value={acceptedTerms} onValueChange={setAcceptedTerms} thumbColor={acceptedTerms ? palette.primary : '#ccc'} />
        </View>
        <PrimaryButton
          label={complianceBusy ? 'Saving…' : 'Save compliance profile'}
          onPress={saveCompliance}
          disabled={complianceBusy}
        />
      </Card>

      <Card>
        <Text style={styles.label}>Alpaca API Management</Text>
        <TextInput style={styles.input} placeholder='Alpaca API key' placeholderTextColor={palette.textSecondary} value={apiKey} onChangeText={setApiKey} />
        <TextInput style={styles.input} placeholder='Alpaca Secret key' placeholderTextColor={palette.textSecondary} value={secretKey} onChangeText={setSecretKey} secureTextEntry />
        <PrimaryButton label='Validate & Save Keys' onPress={saveKeys} />
      </Card>

      <Card>
        <Text style={styles.label}>Security</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.value}>Enable biometrics</Text>
          <Switch value={biometric} onValueChange={setBiometric} thumbColor={biometric ? palette.primary : '#ccc'} />
        </View>
        <Text style={styles.value}>Face ID / Fingerprint login ready</Text>

        <Text style={[styles.label, { marginTop: 16 }]}>Authenticator app (Google Authenticator)</Text>
        {totpEnabled ? (
          <>
            <Text style={styles.value}>Two-factor authentication is on.</Text>
            {!showDisableForm ? (
              <View style={styles.buttonRowCentered}>
                <PrimaryButton
                  compact
                  label='Turn off 2FA'
                  onPress={() => setShowDisableForm(true)}
                  variant='danger'
                />
              </View>
            ) : (
              <View style={{ gap: 8, marginTop: 8 }}>
                <TextInput
                  style={styles.input}
                  placeholder='Account password'
                  placeholderTextColor={palette.textSecondary}
                  value={disablePassword}
                  onChangeText={setDisablePassword}
                  secureTextEntry
                />
                <TextInput
                  style={styles.input}
                  placeholder='Current 6-digit code'
                  placeholderTextColor={palette.textSecondary}
                  value={disableCode}
                  onChangeText={setDisableCode}
                  keyboardType='number-pad'
                />
                <View style={styles.buttonRow}>
                  <PrimaryButton
                    compact
                    label={totpBusy ? '…' : 'Disable'}
                    onPress={submitDisableTotp}
                    disabled={totpBusy}
                    variant='danger'
                    style={{ flex: 1 }}
                  />
                  <PrimaryButton
                    compact
                    label='Cancel'
                    onPress={() => {
                      setShowDisableForm(false);
                      setDisablePassword('');
                      setDisableCode('');
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            )}
          </>
        ) : totpSetupPending ? (
          <>
            <Text style={styles.value}>
              Setup started. Open your authenticator app and enter the code shown there, or cancel to start over.
            </Text>
            {showQr ? (
              <View style={styles.qrWrap}>
                <QRCode value={setupOtpauthUrl!} size={180} backgroundColor={palette.surface} color={palette.textPrimary} />
              </View>
            ) : null}
            {setupSecret ? (
              <Text style={styles.mono} selectable>
                {setupSecret}
              </Text>
            ) : null}
            <TextInput
              style={styles.input}
              placeholder='6-digit code'
              placeholderTextColor={palette.textSecondary}
              value={totpConfirmCode}
              onChangeText={setTotpConfirmCode}
              keyboardType='number-pad'
            />
            <View style={styles.buttonRow}>
              {setupSecret ? (
                <PrimaryButton compact label='Copy' onPress={copySecret} style={{ flex: 1 }} />
              ) : null}
              <PrimaryButton
                compact
                label={totpBusy ? '…' : 'Enable'}
                onPress={confirmTotpSetup}
                disabled={totpBusy}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                compact
                label='Cancel'
                onPress={cancelTotpSetup}
                disabled={totpBusy}
                variant='danger'
                style={{ flex: 1 }}
              />
            </View>
            {!showQr && !setupSecret ? (
              <View style={[styles.buttonRow, styles.buttonRowCentered]}>
                <PrimaryButton compact label='New QR' onPress={startTotpSetup} disabled={totpBusy} style={{ minWidth: 120 }} />
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.value}>Add a second step at sign-in with any TOTP app.</Text>
            <View style={styles.buttonRowCentered}>
              <PrimaryButton
                compact
                label={totpBusy ? '…' : 'Set up'}
                onPress={startTotpSetup}
                disabled={totpBusy}
                style={{ minWidth: 140 }}
              />
            </View>
          </>
        )}
      </Card>

      <Card>
        <Text style={styles.label}>Theme Settings</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.value}>Dark mode</Text>
          <Switch value={darkMode} onValueChange={setDarkMode} thumbColor={darkMode ? palette.primary : '#ccc'} />
        </View>
        <Text style={styles.value}>Accent color: Gold</Text>
      </Card>

      <PrimaryButton label='Logout' onPress={logout} variant='danger' />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  value: { color: palette.textPrimary, marginBottom: 6 },
  mono: { color: palette.textPrimary, fontFamily: 'monospace', fontSize: 12, marginBottom: 8 },
  input: { backgroundColor: palette.surfaceElevated, borderColor: palette.border, borderWidth: 1, borderRadius: 10, color: palette.textPrimary, padding: 10, marginBottom: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qrWrap: { alignSelf: 'center', marginVertical: 12, padding: 12, backgroundColor: palette.surfaceElevated, borderRadius: 12 },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 8,
  },
  subLabel: { color: palette.textSecondary, fontSize: 12, marginBottom: 6, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    color: palette.textPrimary,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
  },
  chipActive: { borderColor: palette.primary, color: palette.primary },
  buttonRowCentered: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
});
