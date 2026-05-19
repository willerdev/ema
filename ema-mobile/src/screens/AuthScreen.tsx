import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { securityStorage } from '../services/securityStorage';
import { canUseBiometrics, biometricLabel } from '../utils/biometrics';
import { palette } from '../theme/colors';
import { PrimaryButton } from '../components/PrimaryButton';

export function AuthScreen() {
  const { login, register, completeTotpLogin, loginWithBiometric } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpPreAuthToken, setTotpPreAuthToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [showBiometricLogin, setShowBiometricLogin] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

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

  const submit = async () => {
    try {
      if (!email || password.length < 6) {
        Alert.alert('Validation', 'Enter valid credentials (min 6-char password).');
        return;
      }
      if (isRegister) {
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>EMA</Text>
      <Text style={styles.subtitle}>{isRegister ? 'Create account' : 'Sign in'}</Text>
      {showBiometricLogin && !isRegister ? (
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
      <PrimaryButton label={isRegister ? 'Create Account' : 'Login'} onPress={submit} />
      <Text style={styles.switch} onPress={() => setIsRegister((p) => !p)}>
        {isRegister ? 'Already registered? Sign in' : 'Need an account? Register'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background, justifyContent: 'center', padding: 20, gap: 10 },
  title: { color: palette.primary, fontSize: 32, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: palette.textPrimary, fontSize: 18, textAlign: 'center', marginBottom: 10 },
  hint: { color: palette.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 4 },
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
