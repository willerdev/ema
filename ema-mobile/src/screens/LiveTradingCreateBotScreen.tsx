import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LIVE_TRADING_MIN_DEPOSIT, type LiveTradingBotType } from '../services/liveTradingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LiveTradingCreateBot'>;

const BOTS: {
  id: LiveTradingBotType;
  title: string;
  desc: string;
  perks: string[];
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}[] = [
  {
    id: 'synthetix_ea',
    title: 'Synthetix program',
    desc: 'Higher minimum with broader market access.',
    perks: ['Wider symbol coverage', 'Built for larger allocations'],
    icon: 'pulse',
    tint: '#38BDF8',
  },
  {
    id: 'quantix_ea',
    title: 'Quantix program',
    desc: 'Lower minimum with focused execution.',
    perks: ['Lower entry threshold', 'Streamlined execution'],
    icon: 'flash',
    tint: '#A78BFA',
  },
];

export function LiveTradingCreateBotScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <LinearGradient colors={['#1A2A44', palette.background]} style={styles.hero}>
        <Text style={styles.step}>Step 1 of 2</Text>
        <Text style={styles.title}>Choose program</Text>
        <Text style={styles.sub}>Pick the live trading program that matches your deposit size and strategy.</Text>
      </LinearGradient>

      {BOTS.map((b) => (
        <Pressable
          key={b.id}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => navigation.navigate('LiveTradingCreateSetup', { botType: b.id })}
        >
          <View style={styles.cardTop}>
            <View style={[styles.iconWrap, { backgroundColor: b.tint + '22', borderColor: b.tint + '44' }]}>
              <Ionicons name={b.icon} size={22} color={b.tint} />
            </View>
            <Ionicons name='chevron-forward' size={18} color={palette.textSecondary} />
          </View>
          <Text style={styles.cardTitle}>{b.title}</Text>
          <Text style={styles.meta}>{b.desc}</Text>
          <View style={styles.perkList}>
            {b.perks.map((perk) => (
              <View key={perk} style={styles.perkRow}>
                <Ionicons name='checkmark-circle' size={14} color={b.tint} />
                <Text style={styles.perkText}>{perk}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.minPill, { borderColor: b.tint + '55', backgroundColor: b.tint + '14' }]}>
            <Text style={[styles.min, { color: b.tint }]}>Min. deposit ${LIVE_TRADING_MIN_DEPOSIT[b.id].toLocaleString()}</Text>
          </View>
        </Pressable>
      ))}
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
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardPressed: { opacity: 0.92 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  meta: { color: palette.textSecondary, fontSize: 13, lineHeight: 18 },
  perkList: { marginTop: 12, gap: 6 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perkText: { color: palette.textSecondary, fontSize: 13 },
  minPill: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  min: { fontWeight: '800', fontSize: 13 },
});
