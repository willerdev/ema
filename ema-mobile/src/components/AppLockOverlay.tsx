import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppLock } from '../context/AppLockContext';
import { PinPad } from './PinPad';
import { PrimaryButton } from './PrimaryButton';
import { biometricLabel } from '../utils/biometrics';
import { palette } from '../theme/colors';

export function AppLockOverlay() {
  const insets = useSafeAreaInsets();
  const { locked, biometricLoginEnabled, biometricAvailable, unlockWithPin, unlockWithBiometric } = useAppLock();
  const [error, setError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  if (!locked) return null;

  const tryBiometric = async () => {
    setBioBusy(true);
    setError(null);
    const ok = await unlockWithBiometric();
    if (!ok) setError('Biometric unlock failed. Use your PIN.');
    setBioBusy(false);
  };

  const onPinComplete = async (pin: string) => {
    setError(null);
    const ok = await unlockWithPin(pin);
    if (!ok) setError('Incorrect PIN. Try again.');
  };

  return (
    <Modal visible transparent animationType='fade' statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.brand}>EMA</Text>
        <Text style={styles.title}>App locked</Text>
        <Text style={styles.sub}>Enter your PIN to continue</Text>
        <PinPad mode='unlock' title='' subtitle='' error={error} onComplete={(pin) => void onPinComplete(pin)} />
        {biometricLoginEnabled && biometricAvailable ? (
          <PrimaryButton
            label={bioBusy ? 'Checking…' : `Unlock with ${biometricLabel()}`}
            onPress={() => void tryBiometric()}
            disabled={bioBusy}
            style={{ marginTop: 20, width: '100%' }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.background,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { color: palette.primary, fontSize: 28, fontWeight: '800', marginBottom: 8 },
  title: { color: palette.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 8, textAlign: 'center' },
});
