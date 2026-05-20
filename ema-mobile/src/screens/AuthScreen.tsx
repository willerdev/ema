import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { securityStorage } from '../services/securityStorage';
import { canUseBiometrics, biometricLabel } from '../utils/biometrics';
import { palette } from '../theme/colors';
import { PrimaryButton } from '../components/PrimaryButton';
import { authService } from '../services/authService';

type AuthMode = 'signin' | 'register' | 'forgot' | 'reset';

type ResetRegion = { countryCode: string; countryName: string; dialCode: string };

export function AuthScreen() {
  const { login, register, completeTotpLogin, loginWithBiometric } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('UG');
  const [regions, setRegions] = useState<ResetRegion[]>([]);
  const [resetCode, setResetCode] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpPreAuthToken, setTotpPreAuthToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [showBiometricLogin, setShowBiometricLogin] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.countryCode === countryCode) ?? null,
    [regions, countryCode]
  );

  useEffect(() => {
    (async () => {
      const [enabled, token, hardware] = await Promise.all([
        securityStorage.isBiometricLoginEnabled(),
        securityStorage.getSecureAuthToken(),
        canUseBiometrics(),
      ]);
      setShowBiometricLogin(Boolean(enabled && token && hardware));
    })();
  }, []);

  useEffect(() => {
    if (mode !== 'forgot' && mode !== 'reset') return;
    (async () => {
      try {
        const res = await authService.getPasswordResetRegions();
        const list = res.regions ?? [];
        setRegions(list);
        if (list.length && !list.some((r) => r.countryCode === countryCode)) {
          setCountryCode(list[0].countryCode);
        }
      } catch {
        setRegions([
          { countryCode: 'UG', countryName: 'Uganda', dialCode: '256' },
          { countryCode: 'RW', countryName: 'Rwanda', dialCode: '250' },
        ]);
      }
    })();
  }, [mode]);

  const submit = async () => {
    try {
      if (!email || password.length < 6) {
        Alert.alert('Validation', 'Enter valid credentials (min 6-char password).');
        return;
      }
      if (mode === 'register') {
        await register(email, password);
        return;
      }
      const result = await login(email, password);
      if (result.kind === 'needs_totp') {
        setTotpPreAuthToken(result.preAuthToken);
        setTotpCode('');
        return;
      }
    } catch (error: any) {
      Alert.alert('Auth Error', error.message);
    }
  };

  const submitBiometric = async () => {
    setBioBusy(true);
    try {
      const ok = await loginWithBiometric();
      if (!ok) {
        Alert.alert('Sign in failed', 'Biometric sign-in could not be completed. Use your email and password.');
      }
    } finally {
      setBioBusy(false);
    }
  };

  const submitTotp = async () => {
    if (!totpPreAuthToken || totpCode.replace(/\s/g, '').length < 6) {
      Alert.alert('Validation', 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    try {
      await completeTotpLogin(totpPreAuthToken, totpCode);
      setTotpPreAuthToken(null);
      setTotpCode('');
    } catch (error: any) {
      Alert.alert('Verification failed', error.message);
    }
  };

  const backToPassword = () => {
    setTotpPreAuthToken(null);
    setTotpCode('');
  };

  const submitForgot = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Validation', 'Enter the email for your account.');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Validation', 'Enter the mobile number on your Ema profile.');
      return;
    }
    setResetBusy(true);
    try {
      const res = await authService.requestPasswordReset({
        email: trimmed,
        countryCode,
        phone: phone.trim(),
      });
      Alert.alert('Check your phone', res.message);
      setMode('reset');
      setResetCode('');
      setPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      Alert.alert('Reset request failed', error.message);
    } finally {
      setResetBusy(false);
    }
  };

  const submitReset = async () => {
    const trimmed = email.trim();
    const code = resetCode.replace(/\s/g, '');
    if (!trimmed || code.length < 6) {
      Alert.alert('Validation', 'Enter your email and the 6-digit SMS code.');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Validation', 'Enter the same mobile number you used to request the code.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Validation', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Validation', 'Passwords do not match.');
      return;
    }
    setResetBusy(true);
    try {
      const res = await authService.resetPassword({
        email: trimmed,
        countryCode,
        phone: phone.trim(),
        code,
        password,
      });
      Alert.alert('Password updated', res.message);
      setMode('signin');
      setResetCode('');
      setPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      Alert.alert('Reset failed', error.message);
    } finally {
      setResetBusy(false);
    }
  };

  const countryPicker = (
    <View style={styles.countryRow}>
      {regions.map((r) => {
        const active = r.countryCode === countryCode;
        return (
          <Pressable
            key={r.countryCode}
            style={[styles.countryChip, active && styles.countryChipActive]}
            onPress={() => setCountryCode(r.countryCode)}
          >
            <Text style={[styles.countryChipText, active && styles.countryChipTextActive]}>
              {r.countryName} (+{r.dialCode})
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const phoneHint = selectedRegion
    ? `Mobile number without + or 0 — we send SMS as ${selectedRegion.dialCode}XXXXXXXXX`
    : 'Mobile number without + or leading 0';

  if (totpPreAuthToken) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>EMA</Text>
        <Text style={styles.subtitle}>Authenticator code</Text>
        <Text style={styles.hint}>Open your authenticator app and enter the 6-digit code.</Text>
        <TextInput
          style={styles.input}
          placeholder='123456'
          placeholderTextColor={palette.textSecondary}
          value={totpCode}
          onChangeText={setTotpCode}
          keyboardType='number-pad'
          maxLength={10}
          autoFocus
        />
        <PrimaryButton label='Verify' onPress={submitTotp} />
        <Text style={styles.switch} onPress={backToPassword}>
          Back to sign in
        </Text>
      </View>
    );
  }

  if (mode === 'forgot') {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps='handled'>
        <Text style={styles.title}>EMA</Text>
        <Text style={styles.subtitle}>Forgot password</Text>
        <Text style={styles.hint}>
          Enter your account email and the mobile number saved on your profile. We text a 6-digit code (not email).
        </Text>
        <TextInput
          style={styles.input}
          placeholder='Email'
          placeholderTextColor={palette.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize='none'
          keyboardType='email-address'
        />
        {countryPicker}
        <TextInput
          style={styles.input}
          placeholder={selectedRegion?.dialCode === '256' ? '766532251' : '788123456'}
          placeholderTextColor={palette.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType='phone-pad'
        />
        <Text style={styles.phoneHint}>{phoneHint}</Text>
        <PrimaryButton
          label={resetBusy ? 'Sending SMS…' : 'Send reset code'}
          onPress={() => void submitForgot()}
          disabled={resetBusy}
        />
        <Text style={styles.switch} onPress={() => setMode('signin')}>
          Back to sign in
        </Text>
      </ScrollView>
    );
  }

  if (mode === 'reset') {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps='handled'>
        <Text style={styles.title}>EMA</Text>
        <Text style={styles.subtitle}>Set new password</Text>
        <Text style={styles.hint}>Enter the SMS code and choose a new password.</Text>
        <TextInput
          style={styles.input}
          placeholder='Email'
          placeholderTextColor={palette.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize='none'
          keyboardType='email-address'
        />
        {countryPicker}
        <TextInput
          style={styles.input}
          placeholder='Mobile number'
          placeholderTextColor={palette.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType='phone-pad'
        />
        <TextInput
          style={styles.input}
          placeholder='SMS reset code'
          placeholderTextColor={palette.textSecondary}
          value={resetCode}
          onChangeText={setResetCode}
          keyboardType='number-pad'
          maxLength={8}
        />
        <TextInput
          style={styles.input}
          placeholder='New password'
          placeholderTextColor={palette.textSecondary}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={styles.input}
          placeholder='Confirm password'
          placeholderTextColor={palette.textSecondary}
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />
        <PrimaryButton
          label={resetBusy ? 'Updating…' : 'Update password'}
          onPress={() => void submitReset()}
          disabled={resetBusy}
        />
        <Text style={styles.switch} onPress={() => setMode('forgot')}>
          Resend code
        </Text>
        <Text style={styles.switch} onPress={() => setMode('signin')}>
          Back to sign in
        </Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>EMA</Text>
      <Text style={styles.subtitle}>{mode === 'register' ? 'Create account' : 'Sign in'}</Text>
      {showBiometricLogin && mode === 'signin' ? (
        <>
          <PrimaryButton
            label={bioBusy ? 'Checking…' : `Sign in with ${biometricLabel()}`}
            onPress={() => void submitBiometric()}
            disabled={bioBusy}
          />
          <Text style={styles.or}>or use email</Text>
        </>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder='Email'
        placeholderTextColor={palette.textSecondary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize='none'
      />
      <TextInput
        style={styles.input}
        placeholder='Password'
        placeholderTextColor={palette.textSecondary}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <PrimaryButton label={mode === 'register' ? 'Create Account' : 'Login'} onPress={submit} />
      {mode === 'signin' ? (
        <Text style={styles.switch} onPress={() => setMode('forgot')}>
          Forgot password?
        </Text>
      ) : null}
      <Text
        style={styles.switch}
        onPress={() => {
          setMode(mode === 'register' ? 'signin' : 'register');
          setPassword('');
        }}
      >
        {mode === 'register' ? 'Already registered? Sign in' : 'Need an account? Register'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background, justifyContent: 'center', padding: 20, gap: 10 },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: palette.background,
    justifyContent: 'center',
    padding: 20,
    gap: 10,
  },
  title: { color: palette.primary, fontSize: 32, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: palette.textPrimary, fontSize: 18, textAlign: 'center', marginBottom: 10 },
  hint: { color: palette.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 4 },
  phoneHint: { color: palette.textSecondary, fontSize: 12, textAlign: 'center', marginTop: -4 },
  or: { color: palette.textSecondary, textAlign: 'center', fontSize: 13 },
  countryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  countryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  countryChipActive: { borderColor: palette.primary, backgroundColor: 'rgba(0,200,5,0.12)' },
  countryChipText: { color: palette.textSecondary, fontSize: 13, fontWeight: '600' },
  countryChipTextActive: { color: palette.primary },
  input: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 10,
    color: palette.textPrimary,
    padding: 12,
  },
  switch: { color: palette.textSecondary, textAlign: 'center', marginTop: 8 },
});
