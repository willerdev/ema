import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { palette } from '../theme/colors';

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  compact = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'success' | 'danger';
  disabled?: boolean;
  /** Smaller padding and type; use in horizontal rows with `flex: 1` or fixed width. */
  compact?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === 'success' && styles.success,
        variant === 'danger' && styles.danger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: palette.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    minHeight: 40,
  },
  success: { backgroundColor: palette.success },
  danger: { backgroundColor: palette.danger },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  text: {
    color: '#0B1220',
    fontWeight: '700',
    fontSize: 15,
  },
  textCompact: {
    fontSize: 13,
    fontWeight: '700',
  },
});
