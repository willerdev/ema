import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { CompositeNavigationProp, RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Card } from '../components/Card';
import { SettingsSkeleton } from '../components/Skeleton';
import { FormModal } from '../components/FormModal';
import { OptionHighlightList } from '../components/OptionHighlightList';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { useAppLock } from '../context/AppLockContext';
import { PinPad } from '../components/PinPad';
import { authStorage } from '../services/storage';
import { securityStorage } from '../services/securityStorage';
import { canUseBiometrics } from '../utils/biometrics';
import { generatePinSalt, hashPin } from '../utils/pin';
import { usePolling } from '../hooks/usePolling';
import { authService, TotpStatus } from '../services/authService';
import { alpacaService } from '../services/alpacaService';
import { complianceService } from '../services/complianceService';
import { whitelistWalletService } from '../services/whitelistWalletService';
import { useToast } from '../hooks/useToast';
import {
  ComplianceProfile,
  ExtraStackParamList,
  PlannedInvestmentDuration,
  RootStackParamList,
  SourceOfFunds,
  WhitelistedWallet,
} from '../types';
import { ABOUT_EMA, AboutSectionKey, PREMIUM_ALERTS_TERMS } from '../content/aboutEma';
import { notificationPreferencesService } from '../services/notificationPreferencesService';
import type { NotificationPreferences } from '../types';
import { palette } from '../theme/colors';
import { formatNetworkLabel } from '../utils/userFacingError';
import { navigateToSupport, navigateToTransactionHistory } from '../utils/navigationHelpers';

const WL_CURRENCY_OPTIONS = ['usdttrc20', 'btc', 'eth', 'ltc', 'trx'];

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

function SettingsRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.settingsRow} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

type SettingsNav = CompositeNavigationProp<
  NativeStackNavigationProp<ExtraStackParamList, 'Settings'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type SettingsRoute = RouteProp<ExtraStackParamList, 'Settings'>;

export function SettingsScreen() {
  const navigation = useNavigation<SettingsNav>();
  const route = useRoute<SettingsRoute>();
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const { suspendLock, refreshSecurityPrefs, pinEnabled, biometricLoginEnabled, biometricAvailable } = useAppLock();
  const [aboutModal, setAboutModal] = useState<AboutSectionKey | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [darkMode, setDarkMode] = useState(true);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
  const [pinSetupError, setPinSetupError] = useState<string | null>(null);
  const pendingPinRef = useRef<string | null>(null);
  const [profile, setProfile] = useState<{ username: string; accountStatus: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [complianceModalOpen, setComplianceModalOpen] = useState(false);
  const [whitelistModalOpen, setWhitelistModalOpen] = useState(false);
  const [alpacaModalOpen, setAlpacaModalOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const [alertPrefs, setAlertPrefs] = useState<NotificationPreferences | null>(null);
  const [alertPrefsBusy, setAlertPrefsBusy] = useState(false);
  const [alertTermsAccepted, setAlertTermsAccepted] = useState(false);

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

  const [whitelistedWallets, setWhitelistedWallets] = useState<WhitelistedWallet[]>([]);
  const [maxWhitelistedWallets, setMaxWhitelistedWallets] = useState(3);
  const [wlBusy, setWlBusy] = useState(false);
  const [wlLabel, setWlLabel] = useState('');
  const [wlCurrency, setWlCurrency] = useState('usdttrc20');
  const [wlAddress, setWlAddress] = useState('');

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

  const loadWhitelistedWallets = useCallback(async () => {
    try {
      const data = await whitelistWalletService.list();
      setWhitelistedWallets(data.wallets || []);
      setMaxWhitelistedWallets(data.maxWallets ?? 3);
    } catch {
      setWhitelistedWallets([]);
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

  const loadAlertPrefs = useCallback(async () => {
    try {
      const data = await notificationPreferencesService.get();
      setAlertPrefs(data.preferences);
      setAlertTermsAccepted(Boolean(data.preferences.premiumTermsAcceptedAt));
    } catch {
      setAlertPrefs(null);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadProfile(),
      loadTotpStatus(),
      loadCompliance(),
      loadWhitelistedWallets(),
      loadAlertPrefs(),
      refreshSecurityPrefs(),
    ]);
    setInitialLoading(false);
  }, [loadProfile, loadTotpStatus, loadCompliance, loadWhitelistedWallets, loadAlertPrefs, refreshSecurityPrefs]);

  useEffect(() => {
    if (route.params?.openSecurity) {
      setSecurityModalOpen(true);
    }
  }, [route.params?.openSecurity]);

  const saveAlertPrefs = async (patch: {
    premiumAlertsEnabled?: boolean;
    notifySms?: boolean;
    notifyEmail?: boolean;
    acceptPremiumTerms?: boolean;
  }) => {
    setAlertPrefsBusy(true);
    try {
      const data = await notificationPreferencesService.save(patch);
      setAlertPrefs(data.preferences);
      if (patch.acceptPremiumTerms) setAlertTermsAccepted(true);
      showToast('Alert preferences saved');
    } catch (error: any) {
      Alert.alert('Save failed', String(error?.message || 'Could not save alert preferences'));
    } finally {
      setAlertPrefsBusy(false);
    }
  };

  const addWhitelistedWallet = async () => {
    if (!wlAddress.trim()) {
      Alert.alert('Validation', 'Enter a wallet address.');
      return;
    }
    if (whitelistedWallets.length >= maxWhitelistedWallets) {
      Alert.alert('Limit reached', `You can register up to ${maxWhitelistedWallets} wallets.`);
      return;
    }
    setWlBusy(true);
    try {
      const data = await whitelistWalletService.add({
        label: wlLabel.trim() || undefined,
        currency: wlCurrency,
        address: wlAddress.trim(),
      });
      setWhitelistedWallets(data.wallets);
      setWlLabel('');
      setWlAddress('');
      showToast('Wallet added to whitelist');
    } catch (error: any) {
      Alert.alert('Add failed', String(error?.message || 'Could not add wallet'));
    } finally {
      setWlBusy(false);
    }
  };

  const removeWhitelistedWallet = async (id: string) => {
    setWlBusy(true);
    try {
      const data = await whitelistWalletService.remove(id);
      setWhitelistedWallets(data.wallets);
      showToast('Wallet removed');
    } catch (error: any) {
      Alert.alert('Remove failed', String(error?.message || 'Could not remove wallet'));
    } finally {
      setWlBusy(false);
    }
  };

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
      showToast(data.complete ? 'Compliance profile complete' : 'Compliance profile saved');
      if (data.complete) setComplianceModalOpen(false);
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
        setAlpacaModalOpen(false);
      } catch {
        Alert.alert('Saved', 'Keys saved. Verify account access from Home/Trades.');
        setAlpacaModalOpen(false);
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
      showToast('Two-factor authentication enabled');
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
      showToast('Two-factor authentication turned off');
    } catch (error: any) {
      Alert.alert('Disable failed', String(error?.message || 'Check password and code'));
    } finally {
      setTotpBusy(false);
    }
  };

  const copySecret = async () => {
    if (setupSecret) {
      await Clipboard.setStringAsync(setupSecret);
      showToast('Secret key copied');
    }
  };

  const totpEnabled = totpStatus?.enabled ?? false;
  const totpSetupPending = totpStatus?.setupPending ?? false;
  const showQr = Boolean(setupOtpauthUrl && setupSecret);

  const complianceSummary = complianceComplete
    ? `${legalFirstName} ${legalLastName} · ${country}`
    : 'Required before withdrawals';

  const whitelistSummary =
    whitelistedWallets.length > 0
      ? `${whitelistedWallets.length}/${maxWhitelistedWallets} wallets registered`
      : 'Add up to 3 withdrawal addresses';

  const securitySummary = totpEnabled
    ? `2FA on · PIN ${pinEnabled ? 'on' : 'off'} · biometrics ${biometricLoginEnabled ? 'on' : 'off'}`
    : totpSetupPending
      ? '2FA setup in progress'
      : `2FA off · PIN ${pinEnabled ? 'on' : 'off'}`;

  const openPinSetup = () => {
    suspendLock(true);
    pendingPinRef.current = null;
    setPinStep('enter');
    setPinSetupError(null);
    setPinModalOpen(true);
  };

  const closePinSetup = () => {
    setPinModalOpen(false);
    suspendLock(false);
    pendingPinRef.current = null;
    setPinSetupError(null);
  };

  const onPinPadComplete = async (pin: string) => {
    if (pinStep === 'enter') {
      pendingPinRef.current = pin;
      setPinStep('confirm');
      setPinSetupError(null);
      return;
    }
    if (pendingPinRef.current !== pin) {
      setPinSetupError('PINs do not match. Try again.');
      setPinStep('enter');
      pendingPinRef.current = null;
      return;
    }
    const salt = generatePinSalt();
    const hash = await hashPin(pin, salt);
    await securityStorage.setPin(hash, salt);
    await refreshSecurityPrefs();
    closePinSetup();
    showToast('App PIN enabled');
  };

  const removePin = () => {
    Alert.alert('Remove app PIN', 'The app will no longer lock after 5 minutes of inactivity.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await securityStorage.clearPin();
            await refreshSecurityPrefs();
            showToast('App PIN removed');
          })();
        },
      },
    ]);
  };

  const onBiometricToggle = async (next: boolean) => {
    if (next) {
      const hw = await canUseBiometrics();
      if (!hw) {
        Alert.alert('Unavailable', 'Set up fingerprint or Face ID on this device first.');
        return;
      }
      const token = await authStorage.getToken();
      if (!token) {
        Alert.alert('Sign in required', 'Sign in with your password before enabling biometrics.');
        return;
      }
      await securityStorage.setBiometricLoginEnabled(true);
      await securityStorage.setSecureAuthToken(token);
      await refreshSecurityPrefs();
      showToast('Biometric sign-in enabled');
      return;
    }
    await securityStorage.setBiometricLoginEnabled(false);
    await refreshSecurityPrefs();
    showToast('Biometric sign-in disabled');
  };

  const alertsSummary = alertPrefs?.premiumAlertsEnabled
    ? `$2/week · ${[alertPrefs.notifySms && 'SMS', alertPrefs.notifyEmail && 'Email'].filter(Boolean).join(' + ') || 'no channels'}`
    : 'Off — enable SMS or email when deposits or withdrawals complete';

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        {initialLoading ? (
          <SettingsSkeleton />
        ) : (
          <>
        <Card>
          <Text style={styles.label}>Profile</Text>
          <Text style={styles.value}>Email: {user?.email}</Text>
          <Text style={styles.value}>Username: {profile?.username || user?.email.split('@')[0]}</Text>
          <Text style={styles.value}>Status: {profile?.accountStatus || 'active'}</Text>
        </Card>

        <Card style={styles.menuCard}>
          <Text style={styles.label}>About Airfarms</Text>
          <SettingsRow
            title='Who we are'
            subtitle='DAO, token holders, and community capital'
            onPress={() => setAboutModal('who')}
          />
          <SettingsRow
            title='What we do'
            subtitle='Wallet, trading, and risk tools'
            onPress={() => setAboutModal('what')}
          />
          <SettingsRow
            title='How we profit'
            subtitle='10% revenue share and disclosed fees'
            onPress={() => setAboutModal('profit')}
          />
          <SettingsRow
            title='Notifications'
            subtitle='Saved messages for you and everyone'
            onPress={() => navigation.navigate('Notifications')}
          />
          <SettingsRow
            title='Asset history'
            subtitle='All deposits, withdrawals, and transfers'
            onPress={() => navigateToTransactionHistory(navigation)}
          />
        </Card>

        <Card style={styles.menuCard}>
          <Text style={styles.label}>Account</Text>
          <SettingsRow
            title='Withdrawal requirements'
            subtitle={complianceSummary}
            onPress={() => setComplianceModalOpen(true)}
          />
          <SettingsRow
            title='Whitelisted wallets'
            subtitle={whitelistSummary}
            onPress={() => setWhitelistModalOpen(true)}
          />
          <SettingsRow title='Trading account keys' subtitle='Link your broker for forex trades' onPress={() => setAlpacaModalOpen(true)} />
          <SettingsRow title='Security' subtitle={securitySummary} onPress={() => setSecurityModalOpen(true)} />
          <SettingsRow
            title='Deposit & withdrawal alerts'
            subtitle={alertsSummary}
            onPress={() => setAlertsModalOpen(true)}
          />
          <SettingsRow
            title='Help & support'
            subtitle='Withdrawal, deposit, earnings, or transfer issues'
            onPress={() => navigateToSupport(navigation)}
          />
        </Card>

        <Card>
          <Text style={styles.label}>Theme</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.value}>Dark mode</Text>
            <Switch value={darkMode} onValueChange={setDarkMode} thumbColor={darkMode ? palette.primary : '#ccc'} />
          </View>
          <Text style={styles.value}>Accent color: Gold</Text>
        </Card>

        <PrimaryButton label='Logout' onPress={logout} variant='danger' />
          </>
        )}
      </ScrollView>

      {aboutModal ? (
        <FormModal
          visible={Boolean(aboutModal)}
          title={ABOUT_EMA[aboutModal].title}
          onClose={() => setAboutModal(null)}
          footer={<PrimaryButton label='Close' onPress={() => setAboutModal(null)} style={{ marginTop: 12 }} />}
        >
          <Text style={styles.modalHint}>{ABOUT_EMA[aboutModal].subtitle}</Text>
          {ABOUT_EMA[aboutModal].paragraphs.map((p) => (
            <Text key={p.slice(0, 40)} style={styles.aboutParagraph}>
              {p}
            </Text>
          ))}
        </FormModal>
      ) : null}

      <FormModal
        visible={complianceModalOpen}
        title='Withdrawal requirements'
        onClose={() => setComplianceModalOpen(false)}
        footer={
          <View style={{ gap: 8, marginTop: 12 }}>
            <PrimaryButton
              label={complianceBusy ? 'Saving…' : 'Save profile'}
              onPress={() => void saveCompliance()}
              disabled={complianceBusy}
            />
            <PrimaryButton label='Close' onPress={() => setComplianceModalOpen(false)} />
          </View>
        }
      >
        <Text style={styles.modalHint}>
          Status: {complianceComplete ? 'Complete' : 'Incomplete'} — required before wallet withdrawals.
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
      </FormModal>

      <FormModal
        visible={whitelistModalOpen}
        title='Whitelisted wallets'
        onClose={() => setWhitelistModalOpen(false)}
        footer={<PrimaryButton label='Done' onPress={() => setWhitelistModalOpen(false)} style={{ marginTop: 12 }} />}
      >
        <Text style={styles.modalHint}>
          Required for withdrawals. {whitelistedWallets.length}/{maxWhitelistedWallets} registered.
        </Text>
        {whitelistedWallets.map((w) => (
          <View key={w.id} style={styles.wlRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.value}>
                {w.label || w.currency.toUpperCase()} · {w.currency}
              </Text>
              <Text style={styles.wlAddress}>
                {w.address.length > 20 ? `${w.address.slice(0, 10)}…${w.address.slice(-8)}` : w.address}
              </Text>
            </View>
            <PrimaryButton
              compact
              label='Remove'
              variant='danger'
              onPress={() => void removeWhitelistedWallet(w.id)}
              disabled={wlBusy}
            />
          </View>
        ))}
        {whitelistedWallets.length < maxWhitelistedWallets ? (
          <>
            <TextInput
              style={styles.input}
              placeholder='Label (optional)'
              placeholderTextColor={palette.textSecondary}
              value={wlLabel}
              onChangeText={setWlLabel}
            />
            <Text style={styles.subLabel}>Network</Text>
            <OptionHighlightList
              options={WL_CURRENCY_OPTIONS}
              value={wlCurrency}
              onChange={setWlCurrency}
              formatLabel={formatNetworkLabel}
            />
            <TextInput
              style={styles.input}
              placeholder='Wallet address'
              placeholderTextColor={palette.textSecondary}
              value={wlAddress}
              onChangeText={setWlAddress}
              autoCapitalize='none'
            />
            <PrimaryButton
              label={wlBusy ? 'Adding…' : 'Add wallet'}
              onPress={() => void addWhitelistedWallet()}
              disabled={wlBusy}
            />
          </>
        ) : (
          <Text style={styles.value}>Maximum wallets registered. Remove one to add another.</Text>
        )}
      </FormModal>

      <FormModal
        visible={alpacaModalOpen}
        title='Trading account keys'
        onClose={() => setAlpacaModalOpen(false)}
        footer={
          <View style={{ gap: 8, marginTop: 12 }}>
            <PrimaryButton label='Validate & save' onPress={() => void saveKeys()} />
            <PrimaryButton label='Close' onPress={() => setAlpacaModalOpen(false)} />
          </View>
        }
      >
        <Text style={styles.modalHint}>Keys are stored securely and used for trading features.</Text>
        <TextInput
          style={styles.input}
          placeholder='API key'
          placeholderTextColor={palette.textSecondary}
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize='none'
        />
        <TextInput
          style={styles.input}
          placeholder='Secret key'
          placeholderTextColor={palette.textSecondary}
          value={secretKey}
          onChangeText={setSecretKey}
          secureTextEntry
          autoCapitalize='none'
        />
      </FormModal>

      <FormModal
        visible={securityModalOpen}
        title='Security'
        onClose={() => {
          setSecurityModalOpen(false);
          setShowDisableForm(false);
          setDisablePassword('');
          setDisableCode('');
        }}
        footer={
          <PrimaryButton
            label='Done'
            onPress={() => {
              setSecurityModalOpen(false);
              setShowDisableForm(false);
              setDisablePassword('');
              setDisableCode('');
            }}
            style={{ marginTop: 12 }}
          />
        }
      >
        <Text style={[styles.label, { marginTop: 4 }]}>App PIN lock</Text>
        <Text style={styles.modalHint}>
          Optional 4-digit PIN. When set, the app locks after 5 minutes without activity.
        </Text>
        {pinEnabled ? (
          <View style={styles.buttonRow}>
            <PrimaryButton compact label='Change PIN' onPress={openPinSetup} style={{ flex: 1 }} />
            <PrimaryButton compact label='Remove PIN' onPress={removePin} variant='danger' style={{ flex: 1 }} />
          </View>
        ) : (
          <PrimaryButton compact label='Set up app PIN' onPress={openPinSetup} style={{ marginTop: 8 }} />
        )}

        <View style={[styles.rowBetween, { marginTop: 16 }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.value}>Biometric sign-in</Text>
            <Text style={styles.modalHint}>Quick sign-in with fingerprint or Face ID on this device.</Text>
          </View>
          <Switch
            value={biometricLoginEnabled}
            onValueChange={(v) => void onBiometricToggle(v)}
            disabled={!biometricAvailable}
            thumbColor={biometricLoginEnabled ? palette.primary : '#ccc'}
          />
        </View>
        {!biometricAvailable ? (
          <Text style={styles.modalHint}>Biometrics are not available on this device.</Text>
        ) : null}

        <Text style={[styles.label, { marginTop: 16 }]}>Authenticator app (2FA)</Text>
        {totpEnabled ? (
          <>
            <Text style={styles.value}>Two-factor authentication is on.</Text>
            {!showDisableForm ? (
              <PrimaryButton compact label='Turn off 2FA' onPress={() => setShowDisableForm(true)} variant='danger' />
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
                    onPress={() => void submitDisableTotp()}
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
            <Text style={styles.value}>Scan the QR code or enter the secret in your authenticator app.</Text>
            {showQr ? (
              <View style={styles.qrWrap}>
                <QRCode value={setupOtpauthUrl!} size={160} backgroundColor={palette.surface} color={palette.textPrimary} />
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
              {setupSecret ? <PrimaryButton compact label='Copy secret' onPress={() => void copySecret()} style={{ flex: 1 }} /> : null}
              <PrimaryButton
                compact
                label={totpBusy ? '…' : 'Enable'}
                onPress={() => void confirmTotpSetup()}
                disabled={totpBusy}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                compact
                label='Cancel'
                onPress={() => void cancelTotpSetup()}
                disabled={totpBusy}
                variant='danger'
                style={{ flex: 1 }}
              />
            </View>
            {!showQr && !setupSecret ? (
              <PrimaryButton compact label='New QR' onPress={() => void startTotpSetup()} disabled={totpBusy} />
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.value}>Add a second step at sign-in with any TOTP app.</Text>
            <PrimaryButton compact label={totpBusy ? '…' : 'Set up 2FA'} onPress={() => void startTotpSetup()} disabled={totpBusy} />
          </>
        )}
      </FormModal>

      <FormModal
        visible={pinModalOpen}
        title={pinStep === 'enter' ? 'Create app PIN' : 'Confirm app PIN'}
        onClose={closePinSetup}
        footer={<PrimaryButton label='Cancel' onPress={closePinSetup} style={{ marginTop: 12 }} />}
      >
        <PinPad
          mode={pinStep === 'enter' ? 'setup' : 'confirm'}
          title=''
          subtitle={pinStep === 'enter' ? 'Choose a 4-digit PIN' : 'Enter the same PIN again'}
          error={pinSetupError}
          onComplete={(pin) => void onPinPadComplete(pin)}
          onCancel={closePinSetup}
        />
      </FormModal>

      <FormModal
        visible={alertsModalOpen}
        title='Deposit & withdrawal alerts'
        onClose={() => setAlertsModalOpen(false)}
        footer={
          <PrimaryButton
            label='Close'
            onPress={() => setAlertsModalOpen(false)}
            style={{ marginTop: 12 }}
          />
        }
      >
        <Text style={styles.modalHint}>{PREMIUM_ALERTS_TERMS}</Text>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.value}>Premium alerts ($2/week)</Text>
            <Text style={styles.rowSubtitle}>SMS and/or email when deposits or withdrawals finish</Text>
          </View>
          <Switch
            value={Boolean(alertPrefs?.premiumAlertsEnabled)}
            onValueChange={(on) => {
              if (on && !alertTermsAccepted && !alertPrefs?.premiumTermsAcceptedAt) {
                Alert.alert(
                  'Subscription terms',
                  PREMIUM_ALERTS_TERMS,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'I agree — $2/week',
                      onPress: () => {
                        setAlertTermsAccepted(true);
                        void saveAlertPrefs({
                          premiumAlertsEnabled: true,
                          acceptPremiumTerms: true,
                        });
                      },
                    },
                  ]
                );
                return;
              }
              void saveAlertPrefs({ premiumAlertsEnabled: on });
            }}
            disabled={alertPrefsBusy}
            thumbColor={alertPrefs?.premiumAlertsEnabled ? palette.primary : '#ccc'}
          />
        </View>
        <View style={[styles.rowBetween, { marginTop: 16, opacity: alertPrefs?.premiumAlertsEnabled ? 1 : 0.45 }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.value}>SMS notifications</Text>
            <Text style={styles.rowSubtitle}>
              {phone.trim() ? `To ${phone}` : 'Add phone in compliance profile'}
            </Text>
          </View>
          <Switch
            value={Boolean(alertPrefs?.notifySms)}
            onValueChange={(on) => void saveAlertPrefs({ notifySms: on, premiumAlertsEnabled: true })}
            disabled={alertPrefsBusy || !alertPrefs?.premiumAlertsEnabled || !phone.trim()}
            thumbColor={alertPrefs?.notifySms ? palette.primary : '#ccc'}
          />
        </View>
        <View style={[styles.rowBetween, { marginTop: 16, opacity: alertPrefs?.premiumAlertsEnabled ? 1 : 0.45 }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.value}>Email notifications</Text>
            <Text style={styles.rowSubtitle}>{user?.email || 'Account email'}</Text>
          </View>
          <Switch
            value={Boolean(alertPrefs?.notifyEmail)}
            onValueChange={(on) => void saveAlertPrefs({ notifyEmail: on, premiumAlertsEnabled: true })}
            disabled={alertPrefsBusy || !alertPrefs?.premiumAlertsEnabled}
            thumbColor={alertPrefs?.notifyEmail ? palette.primary : '#ccc'}
          />
        </View>
      </FormModal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  value: { color: palette.textPrimary, marginBottom: 6 },
  modalHint: { color: palette.textSecondary, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  mono: { color: palette.textPrimary, fontFamily: 'monospace', fontSize: 12, marginBottom: 8 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 10,
    color: palette.textPrimary,
    padding: 10,
    marginBottom: 8,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuCard: { paddingVertical: 4 },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  rowTitle: { color: palette.textPrimary, fontSize: 16, fontWeight: '600' },
  rowSubtitle: { color: palette.textSecondary, fontSize: 13, marginTop: 2 },
  chevron: { color: palette.textSecondary, fontSize: 22, marginLeft: 8 },
  qrWrap: { alignSelf: 'center', marginVertical: 12, padding: 12, backgroundColor: palette.surfaceElevated, borderRadius: 12 },
  buttonRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 8 },
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
  wlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  wlAddress: { color: palette.textSecondary, fontSize: 12, fontFamily: 'Menlo' },
  aboutParagraph: { color: palette.textPrimary, lineHeight: 22, fontSize: 14, marginBottom: 12 },
});
