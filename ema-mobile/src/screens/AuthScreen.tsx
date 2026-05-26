import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { securityStorage } from '../services/securityStorage';
import { canUseBiometrics, biometricLabel } from '../utils/biometrics';
import { palette } from '../theme/colors';
import { PrimaryButton } from '../components/PrimaryButton';
import { authService } from '../services/authService';

type AuthMode = 'signin' | 'register' | 'recover';
type RecoverStep = 'credentials' | 'verifying' | 'password';

export function AuthScreen() {
  const { login, register, completeTotpLogin, loginWithBiometric } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [recoverStep, setRecoverStep] = useState<RecoverStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpPreAuthToken, setTotpPreAuthToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [showBiometricLogin, setShowBiometricLogin] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [verifyDots, setVerifyDots] = useState(0);

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
    if (recoverStep !== 'verifying') return;
    const t = setInterval(() => setVerifyDots((d) => (d + 1) % 4), 400);
    return () => clearInterval(t);
  }, [recoverStep]);

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

  const resetRecoverFlow = () => {
    setRecoverStep('credentials');
    setPassword('');
    setConfirmPassword('');
  };

  const startRecover = () => {
    setMode('recover');
    resetRecoverFlow();
  };

  const verifyRecoverCredentials = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Validation', 'Enter the email for your account.');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Validation', 'Enter the phone number from your compliance profile.');
      return;
    }
    setRecoverStep('verifying');
    try {
      await authService.verifyRecoverPassword({ email: trimmed, phone: phone.trim() });
      setRecoverStep('password');
    } catch (error: any) {
      setRecoverStep('credentials');
      Alert.alert('Could not verify', error.message);
    }
  };

  const submitRecoverPassword = async () => {
    const trimmed = email.trim();
    if (password.length < 6) {
      Alert.alert('Validation', 'New password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Validation', 'Passwords do not match.');
      return;
    }
    setRecoverBusy(true);
    try {
      const res = await authService.recoverPassword({
        email: trimmed,
        phone: phone.trim(),
        password,
      });
      Alert.alert('Password updated', res.message);
      setMode('signin');
      setPhone('');
      resetRecoverFlow();
    } catch (error: any) {
      Alert.alert('Recovery failed', error.message);
    } finally {
      setRecoverBusy(false);
    }
  };

  if (totpPreAuthToken) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Airfarms</Text>
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

  if (mode === 'recover') {
    if (recoverStep === 'verifying') {
      const dots = '.'.repeat(verifyDots);
      return (
        <View style={styles.container}>
          <ActivityIndicator size='large' color={palette.primary} style={{ marginBottom: 24 }} />
          <Text style={styles.title}>Airfarms</Text>
          <Text style={styles.subtitle}>Verifying{dots}</Text>
          <Text style={styles.hint}>
            Checking your email and phone against your compliance profile. This may take a moment.
          </Text>
        </View>
      );
    }

    if (recoverStep === 'password') {
      return (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps='handled'>
          <Text style={styles.title}>Airfarms</Text>
          <Text style={styles.subtitle}>Set new password</Text>
          <Text style={styles.hint}>Your details were verified. Choose a new password for {email.trim()}.</Text>
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
            placeholder='Confirm new password'
            placeholderTextColor={palette.textSecondary}
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
          <PrimaryButton
            label={recoverBusy ? 'Updating…' : 'Update password'}
            onPress={() => void submitRecoverPassword()}
            disabled={recoverBusy}
          />
          <Text style={styles.switch} onPress={() => setRecoverStep('credentials')}>
            Back
          </Text>
        </ScrollView>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps='handled'>
        <Text style={styles.title}>Airfarms</Text>
        <Text style={styles.subtitle}>Recover account</Text>
        <Text style={styles.hint}>
          Enter the email and phone number you used when completing compliance in Settings. We will verify them before
          you set a new password.
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
        <TextInput
          style={styles.input}
          placeholder='Phone (compliance profile)'
          placeholderTextColor={palette.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType='phone-pad'
        />
        <PrimaryButton label='Continue' onPress={() => void verifyRecoverCredentials()} />
        <Text
          style={styles.switch}
          onPress={() => {
            setMode('signin');
            resetRecoverFlow();
          }}
        >
          Back to sign in
        </Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Airfarms</Text>
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
        <Text style={styles.switch} onPress={startRecover}>
          Forgot password?
        </Text>
      ) : null}
      <Text
        style={styles.switch}
        onPress={() => {
          setMode(mode === 'register' ? 'signin' : 'register');
          setPassword('');
          setConfirmPassword('');
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
  hint: { color: palette.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 4, lineHeight: 20 },
  or: { color: palette.textSecondary, textAlign: 'center', fontSize: 13 },
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
