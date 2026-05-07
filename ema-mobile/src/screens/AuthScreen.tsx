import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { palette } from '../theme/colors';
import { PrimaryButton } from '../components/PrimaryButton';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async () => {
    try {
      if (!email || password.length < 6) {
        Alert.alert('Validation', 'Enter valid credentials (min 6-char password).');
        return;
      }
      if (isRegister) {
        await register(email, password);
      } else {
        await login(email, password);
      }
    } catch (error: any) {
      Alert.alert('Auth Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>EMA</Text>
      <Text style={styles.subtitle}>{isRegister ? 'Create account' : 'Sign in'}</Text>
      <TextInput style={styles.input} placeholder='Email' placeholderTextColor={palette.textSecondary} value={email} onChangeText={setEmail} autoCapitalize='none' />
      <TextInput style={styles.input} placeholder='Password' placeholderTextColor={palette.textSecondary} secureTextEntry value={password} onChangeText={setPassword} />
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
  input: { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1, borderRadius: 10, color: palette.textPrimary, padding: 12 },
  switch: { color: palette.textSecondary, textAlign: 'center', marginTop: 8 },
});
