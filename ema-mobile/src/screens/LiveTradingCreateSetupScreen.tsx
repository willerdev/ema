import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { LIVE_TRADING_MIN_DEPOSIT, liveTradingService } from '../services/liveTradingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LiveTradingCreateSetup'>;
type R = RouteProp<RootStackParamList, 'LiveTradingCreateSetup'>;

export function LiveTradingCreateSetupScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const botType = route.params.botType;
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    if (!password || password.length < 8) return Alert.alert('Password', 'Use 8–32 characters with upper, lower, and a number.');
    setBusy(true);
    try {
      const res = await liveTradingService.createAccount({
        botType,
        password,
        accountName: nickname.trim() || undefined,
      });
      navigation.replace('LiveTradingAccount', { accountId: res.account.id });
    } catch (e: any) {
      Alert.alert('Live trading', e?.message || 'Could not create account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Account setup</Text>
      <Text style={styles.sub}>Min. deposit ${LIVE_TRADING_MIN_DEPOSIT[botType].toLocaleString()} after creation.</Text>
      <Text style={styles.label}>Nickname (optional)</Text>
      <TextInput style={styles.input} value={nickname} onChangeText={setNickname} placeholder='My trading account' placeholderTextColor={palette.textSecondary} />
      <Text style={styles.label}>Trading password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder='8+ chars, upper, lower, number'
        placeholderTextColor={palette.textSecondary}
      />
      <PrimaryButton label={busy ? 'Creating…' : 'Create account'} onPress={() => void onCreate()} disabled={busy} style={{ marginTop: 12 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 16 },
  label: { color: palette.textSecondary, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 12,
  },
});
