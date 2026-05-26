import { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppLock } from '../context/AppLockContext';
import { useAuth } from '../context/AuthContext';
import { PinPad } from './PinPad';
import { PrimaryButton } from './PrimaryButton';
import { biometricLabel } from '../utils/biometrics';
import { palette } from '../theme/colors';

export function AppLockOverlay() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const { locked, biometricLoginEnabled, biometricAvailable, unlockWithPin, unlockWithBiometric } = useAppLock();
  const [error, setError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);

  useEffect(() => {
    if (!locked) {
      setPinAttempts(0);
      setError(null);
    }
  }, [locked]);

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
    if (ok) {
      setPinAttempts(0);
      return;
    }
    const nextAttempts = pinAttempts + 1;
    setPinAttempts(nextAttempts);
    if (nextAttempts >= 3) {
      await logout();
      Alert.alert('Session ended', 'Too many incorrect PIN attempts. Please sign in with your password.');
      return;
    }
    setError(`Incorrect PIN. ${3 - nextAttempts} attempt${3 - nextAttempts === 1 ? '' : 's'} left.`);
  };

  return (
    <Modal visible transparent animationType='fade' statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.brand}>Airfarms</Text>
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
