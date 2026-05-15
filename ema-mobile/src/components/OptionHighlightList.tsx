import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette } from '../theme/colors';

type OptionHighlightListProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  formatLabel?: (value: T) => string;
};

export function OptionHighlightList<T extends string>({
  options,
  value,
  onChange,
  formatLabel = (v) => v,
}: OptionHighlightListProps<T>) {
  return (
    <View style={styles.list}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable
            key={opt}
            style={[styles.row, active && styles.rowActive]}
            onPress={() => onChange(opt)}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{formatLabel(opt)}</Text>
            {active ? <Ionicons name='checkmark-circle' size={20} color={palette.primary} /> : <View style={styles.dot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  rowActive: {
    backgroundColor: '#1f2937',
    borderColor: palette.primary,
    borderLeftWidth: 3,
    borderLeftColor: palette.primary,
  },
  label: { color: palette.textSecondary, fontSize: 14, fontWeight: '600', textTransform: 'uppercase' },
  labelActive: { color: palette.textPrimary },
  dot: { width: 20, height: 20 },
});
