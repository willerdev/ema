import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '../theme/colors';

type NetworkGridCompactProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  formatLabel?: (value: T) => string;
  /** Networks shown with a recommended highlight (e.g. TRC20, ETH). */
  featuredOptions?: readonly T[];
};

export function NetworkGridCompact<T extends string>({
  options,
  value,
  onChange,
  formatLabel = (v) => v,
  featuredOptions = [],
}: NetworkGridCompactProps<T>) {
  const featured = new Set(featuredOptions);
  return (
    <View style={styles.grid}>
      {options.map((opt) => {
        const active = opt === value;
        const featuredCell = featured.has(opt);
        return (
          <Pressable
            key={opt}
            style={[
              styles.cell,
              featuredCell && styles.cellFeatured,
              active && styles.cellActive,
              featuredCell && active && styles.cellFeaturedActive,
            ]}
            onPress={() => onChange(opt)}
          >
            {featuredCell ? <Text style={styles.badge}>Popular</Text> : null}
            <Text
              style={[styles.label, active && styles.labelActive, featuredCell && !active && styles.labelFeatured]}
              numberOfLines={2}
            >
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
    gap: 6,
    marginBottom: 10,
  },
  cell: {
    width: '31%',
    minHeight: 52,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFeatured: {
    borderColor: '#b45309',
  },
  cellActive: {
    borderColor: palette.primary,
    backgroundColor: '#1f2937',
  },
  cellFeaturedActive: {
    borderColor: palette.primary,
    borderWidth: 2,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    fontSize: 7,
    fontWeight: '800',
    color: '#fbbf24',
    textTransform: 'uppercase',
  },
  label: {
    color: palette.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 13,
  },
  labelFeatured: {
    color: '#fcd34d',
  },
  labelActive: {
    color: palette.primary,
    fontSize: 11,
  },
});
