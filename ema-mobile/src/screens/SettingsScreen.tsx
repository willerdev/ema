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
import { palette } from '../theme/colors';

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
    await Promise.all([loadProfile(), loadTotpStatus()]);
  }, [loadProfile, loadTotpStatus]);

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
              <PrimaryButton label='Turn off authenticator' onPress={() => setShowDisableForm(true)} variant='danger' />
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
                <PrimaryButton label={totpBusy ? 'Working…' : 'Confirm disable'} onPress={submitDisableTotp} disabled={totpBusy} variant='danger' />
                <PrimaryButton label='Cancel' onPress={() => { setShowDisableForm(false); setDisablePassword(''); setDisableCode(''); }} />
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
            {setupSecret ? (
              <PrimaryButton label='Copy secret key' onPress={copySecret} />
            ) : null}
            <TextInput
              style={styles.input}
              placeholder='6-digit code'
              placeholderTextColor={palette.textSecondary}
              value={totpConfirmCode}
              onChangeText={setTotpConfirmCode}
              keyboardType='number-pad'
            />
            <PrimaryButton label={totpBusy ? 'Working…' : 'Confirm and enable'} onPress={confirmTotpSetup} disabled={totpBusy} />
            <PrimaryButton label='Cancel setup' onPress={cancelTotpSetup} disabled={totpBusy} />
            {!showQr && !setupSecret ? (
              <PrimaryButton label='Start setup again (new QR)' onPress={startTotpSetup} disabled={totpBusy} />
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.value}>Add a second step at sign-in with any TOTP app.</Text>
            <PrimaryButton label={totpBusy ? 'Working…' : 'Set up authenticator'} onPress={startTotpSetup} disabled={totpBusy} />
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
});
