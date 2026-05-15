import { Linking, Platform, StyleSheet, Text } from 'react-native';
import { Card } from './Card';
import { PrimaryButton } from './PrimaryButton';
import { palette } from '../theme/colors';

type LocationGateCardProps = {
  locationStatus: 'idle' | 'requesting' | 'granted' | 'denied';
  error?: string | null;
  onEnableLocation: () => void;
};

export function LocationGateCard({ locationStatus, error, onEnableLocation }: LocationGateCardProps) {
  const denied = locationStatus === 'denied';

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Location required</Text>
      <Text style={styles.body}>
        We use your device location to show local currency rates and mobile money options for your area. You cannot
        pick a different country manually.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {locationStatus === 'requesting' ? (
        <Text style={styles.meta}>Detecting location…</Text>
      ) : (
        <>
          <PrimaryButton
            label={denied ? 'Try again' : 'Enable location'}
            onPress={onEnableLocation}
            style={{ marginTop: 12 }}
          />
          {denied ? (
            <PrimaryButton
              compact
              label='Open settings'
              onPress={() => {
                if (Platform.OS === 'ios') void Linking.openURL('app-settings:');
                else void Linking.openSettings();
              }}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14, borderColor: palette.primary },
  title: { color: palette.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  body: { color: palette.textSecondary, fontSize: 13, lineHeight: 19 },
  meta: { color: palette.textSecondary, marginTop: 12, fontSize: 13 },
  error: { color: '#f59e0b', marginTop: 8, fontSize: 12, lineHeight: 17 },
});
