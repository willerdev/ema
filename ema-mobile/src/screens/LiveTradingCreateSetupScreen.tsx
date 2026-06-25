import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

  const programName = botType === 'synthetix_ea' ? 'Synthetix' : 'Quantix';

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={['#1A2A44', palette.background]} style={styles.hero}>
        <Text style={styles.step}>Step 2 of 2</Text>
        <Text style={styles.title}>Account setup</Text>
        <Text style={styles.sub}>
          {programName} program · min. deposit ${LIVE_TRADING_MIN_DEPOSIT[botType].toLocaleString()} after creation.
        </Text>
      </LinearGradient>

      <View style={styles.formCard}>
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Ionicons name='person-outline' size={16} color={palette.primary} />
            <Text style={styles.label}>Nickname (optional)</Text>
          </View>
          <TextInput
            style={styles.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder='My trading account'
            placeholderTextColor={palette.textSecondary}
          />
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Ionicons name='lock-closed-outline' size={16} color={palette.primary} />
            <Text style={styles.label}>Trading password</Text>
          </View>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder='8+ chars, upper, lower, number'
            placeholderTextColor={palette.textSecondary}
          />
        </View>

        <View style={styles.note}>
          <Ionicons name='shield-checkmark-outline' size={16} color={palette.textSecondary} />
          <Text style={styles.noteText}>Use a strong password. You will fund the account from your cash wallet after it is created.</Text>
        </View>

        <PrimaryButton label={busy ? 'Creating…' : 'Create account'} onPress={() => void onCreate()} disabled={busy} style={{ marginTop: 14 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { paddingBottom: 24 },
  hero: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 },
  step: { color: palette.primary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  title: { color: palette.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: 6 },
  sub: { color: palette.textSecondary, lineHeight: 20 },
  formCard: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  field: { marginBottom: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { color: palette.textSecondary, fontWeight: '600' },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  noteText: { color: palette.textSecondary, flex: 1, lineHeight: 18, fontSize: 13 },
});
