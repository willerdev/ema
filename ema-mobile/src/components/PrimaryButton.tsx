import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { palette } from '../theme/colors';

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'success' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        variant === 'success' && styles.success,
        variant === 'danger' && styles.danger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: palette.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  success: { backgroundColor: palette.success },
  danger: { backgroundColor: palette.danger },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  text: {
    color: '#0B1220',
    fontWeight: '700',
  },
});
