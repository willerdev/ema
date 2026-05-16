import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { palette } from '../theme/colors';

type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width = '100%', height = 14, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        { width, height, borderRadius, opacity },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function BalanceSkeleton() {
  return (
    <SkeletonCard>
      <Skeleton width={100} height={12} style={{ marginBottom: 14 }} />
      <Skeleton width={80} height={12} style={{ marginBottom: 8 }} />
      <Skeleton width='55%' height={32} style={{ marginBottom: 16 }} />
      <Skeleton width={80} height={12} style={{ marginBottom: 8 }} />
      <Skeleton width='45%' height={32} />
    </SkeletonCard>
  );
}

export function ActivityListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonCard>
      <Skeleton width={140} height={14} style={{ marginBottom: 16 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={i > 0 ? styles.activityGap : undefined}>
          <View style={styles.activityRow}>
            <View style={{ flex: 1 }}>
              <Skeleton width='40%' height={14} style={{ marginBottom: 8 }} />
              <Skeleton width='65%' height={11} />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Skeleton width={56} height={14} style={{ marginBottom: 8 }} />
              <Skeleton width={88} height={11} />
            </View>
          </View>
        </View>
      ))}
    </SkeletonCard>
  );
}

export function MenuListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <SkeletonCard style={{ paddingVertical: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[styles.menuRow, i < rows - 1 && styles.menuBorder]}>
          <Skeleton width={40} height={40} borderRadius={12} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Skeleton width='50%' height={14} style={{ marginBottom: 8 }} />
            <Skeleton width='75%' height={11} />
          </View>
        </View>
      ))}
    </SkeletonCard>
  );
}

export function SettingsSkeleton() {
  return (
    <View>
      <Skeleton width={120} height={22} style={{ marginBottom: 16 }} />
      <MenuListSkeleton rows={5} />
      <View style={{ height: 12 }} />
      <SkeletonCard>
        <Skeleton width='60%' height={14} style={{ marginBottom: 12 }} />
        <Skeleton width='100%' height={44} style={{ marginBottom: 10 }} />
        <Skeleton width='100%' height={44} />
      </SkeletonCard>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: palette.surfaceElevated },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    marginBottom: 12,
  },
  activityGap: { marginTop: 18, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  menuBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
});
