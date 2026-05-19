import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PIN_LENGTH } from '../utils/pin';
import { palette } from '../theme/colors';

type PinPadMode = 'setup' | 'confirm' | 'unlock';

type PinPadProps = {
  mode: PinPadMode;
  title: string;
  subtitle?: string;
  error?: string | null;
  onComplete: (pin: string) => void;
  onCancel?: () => void;
};

export function PinPad({ mode, title, subtitle, error, onComplete, onCancel }: PinPadProps) {
  const [digits, setDigits] = useState<string[]>([]);

  const masked = useMemo(() => {
    const filled = digits.map(() => '•').join(' ');
    const empty = Array(PIN_LENGTH - digits.length)
      .fill('○')
      .join(' ');
    return `${filled}${digits.length ? ' ' : ''}${empty}`.trim();
  }, [digits]);

  const pushDigit = (d: string) => {
    if (digits.length >= PIN_LENGTH) return;
    const next = [...digits, d];
    setDigits(next);
    if (next.length === PIN_LENGTH) {
      onComplete(next.join(''));
      setTimeout(() => setDigits([]), 150);
    }
  };

  const backspace = () => setDigits((prev) => prev.slice(0, -1));

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <Text style={styles.dots}>{masked || '○ ○ ○ ○'}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.grid}>
        {keys.map((k, i) => {
          if (k === '') {
            return <View key={`sp-${i}`} style={styles.keySpacer} />;
          }
          const isBack = k === '⌫';
          return (
            <Pressable
              key={k + i}
              style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
              onPress={() => (isBack ? backspace() : pushDigit(k))}
            >
              <Text style={styles.keyText}>{k}</Text>
            </Pressable>
          );
        })}
      </View>
      {onCancel ? (
        <Pressable onPress={onCancel} style={styles.cancelWrap}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      ) : null}
      {mode === 'setup' ? (
        <Text style={styles.hint}>You will confirm this PIN once.</Text>
      ) : mode === 'confirm' ? (
        <Text style={styles.hint}>Re-enter the same PIN.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', width: '100%' },
  title: { color: palette.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  subtitle: { color: palette.textSecondary, textAlign: 'center', marginBottom: 12, lineHeight: 20 },
  dots: {
    color: palette.primary,
    fontSize: 28,
    letterSpacing: 8,
    marginVertical: 16,
    fontVariant: ['tabular-nums'],
  },
  error: { color: palette.danger, marginBottom: 8, textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 264,
    justifyContent: 'center',
    gap: 10,
  },
  key: {
    width: 76,
    height: 56,
    borderRadius: 12,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keySpacer: { width: 76, height: 56 },
  keyPressed: { opacity: 0.75 },
  keyText: { color: palette.textPrimary, fontSize: 22, fontWeight: '700' },
  cancelWrap: { marginTop: 16 },
  cancel: { color: palette.textSecondary, fontSize: 15 },
  hint: { color: palette.textSecondary, fontSize: 12, marginTop: 12, textAlign: 'center' },
});
