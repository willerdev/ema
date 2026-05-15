import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastContext } from '../context/ToastContext';
import { palette } from '../theme/colors';

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const { toast } = useToastContext();

  if (!toast) return null;

  return (
    <View pointerEvents='none' style={[styles.wrap, { bottom: insets.bottom + 16 }]}>
      <View style={[styles.card, toast.variant === 'error' ? styles.cardError : styles.cardSuccess]}>
        <Text style={styles.text}>{toast.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: '100%',
  },
  cardSuccess: {
    backgroundColor: '#0f172a',
    borderColor: palette.primary,
  },
  cardError: {
    backgroundColor: '#1c0f0f',
    borderColor: '#f87171',
  },
  text: {
    color: palette.textPrimary,
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 14,
  },
});
