import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '../theme/colors';

type OptionGridProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  formatLabel?: (value: T) => string;
};

export function OptionGrid<T extends string>({
  options,
  value,
  onChange,
  formatLabel = (v) => v,
}: OptionGridProps<T>) {
  return (
    <View style={styles.grid}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable
            key={opt}
            style={[styles.cell, active && styles.cellActive]}
            onPress={() => onChange(opt)}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={2}>
              {formatLabel(opt)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  cell: {
    width: '48%',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: {
    borderColor: palette.primary,
    backgroundColor: '#1f2937',
  },
  label: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  labelActive: {
    color: palette.primary,
  },
});
