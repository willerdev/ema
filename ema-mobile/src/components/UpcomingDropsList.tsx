import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AirfarmingUpcomingDrop } from '../services/airfarmingService';
import { formatDropCountdown } from '../services/airfarmingService';
import { palette } from '../theme/colors';

const PREVIEW_TICK_MS = 2000;
const PREVIEW_PERCENT_MAX = 58;

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function previewPercent(seed: string, tick: number): number {
  const h = hash32(`${seed}:${tick}`);
  return 5 + (h % (PREVIEW_PERCENT_MAX - 4));
}

function formatUsd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}

function formatDueLabel(dueAt: string): string {
  const d = new Date(dueAt);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}

export function AnimatedDropPercent({ seed, large }: { seed: string; large?: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), PREVIEW_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const pct = useMemo(() => previewPercent(seed, tick), [seed, tick]);
  return <Text style={large ? styles.previewPercentLarge : styles.previewPercent}>~+{pct}%</Text>;
}

type UpcomingDropsListProps = {
  drops: AirfarmingUpcomingDrop[];
};

export function UpcomingDropsList({ drops }: UpcomingDropsListProps) {
  if (!drops.length) {
    return <Text style={styles.empty}>No upcoming drops scheduled for this week yet.</Text>;
  }

  return (
    <View style={styles.list}>
      {drops.map((drop, index) => {
        const key = drop.id || drop.previewKey || `drop-${index}`;
        const isLive = drop.percentLocked;
        const statusLabel = isLive ? 'Live' : drop.isProjected ? 'Projected' : 'Upcoming';
        return (
          <View key={key} style={[styles.row, isLive && styles.rowLive]}>
            <View style={styles.rowTop}>
              <Text style={styles.dropTitle}>Drop #{drop.dropIndex + 1}</Text>
              <View style={[styles.chip, isLive ? styles.chipLive : drop.isProjected ? styles.chipProjected : styles.chipUpcoming]}>
                <Text style={styles.chipText}>{statusLabel}</Text>
              </View>
            </View>
            <Text style={styles.due}>{formatDueLabel(drop.dueAt)}</Text>
            <Text style={styles.countdown}>
              {isLive ? 'Drop window open' : `In ${formatDropCountdown(drop.secondsRemaining)}`}
            </Text>
            <View style={styles.percentRow}>
              {isLive && drop.percent != null ? (
                <Text style={styles.lockedPercent}>+{drop.percent.toFixed(1)}%</Text>
              ) : (
                <AnimatedDropPercent seed={drop.previewKey} />
              )}
              <Text style={styles.previewHint}>{isLive ? 'Locked rate' : 'Preview rate'}</Text>
            </View>
            <Text style={styles.range}>
              Required: {formatUsd(drop.minBalance)} – {formatUsd(drop.maxBalance)}
            </Text>
            {drop.hasSnapshot ? (
              <Text style={styles.snapshot}>
                Eligibility balance recorded (24h rule): {formatUsd(drop.eligibilitySnapshotBalance ?? 0)}
              </Text>
            ) : null}
            {isLive && drop.eligibleNow === true && drop.projectedProfit != null ? (
              <Text style={styles.profit}>Est. profit: +${drop.projectedProfit.toFixed(2)}</Text>
            ) : null}
            {isLive && drop.eligibleNow === false ? (
              <Text style={styles.missedHint}>Not in range at eligibility snapshot</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  empty: { color: palette.textSecondary, fontSize: 13 },
  row: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: palette.surfaceElevated,
  },
  rowLive: { borderColor: palette.primary, borderLeftWidth: 3 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  dropTitle: { color: palette.textPrimary, fontWeight: '700', fontSize: 15 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipUpcoming: { backgroundColor: 'rgba(148,163,184,0.15)' },
  chipProjected: { backgroundColor: 'rgba(148,163,184,0.2)' },
  chipLive: { backgroundColor: 'rgba(0,200,5,0.15)' },
  chipText: { color: palette.textSecondary, fontSize: 11, fontWeight: '700' },
  due: { color: palette.textSecondary, fontSize: 12, marginBottom: 2 },
  countdown: { color: palette.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  percentRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  previewPercent: { color: palette.textSecondary, fontSize: 22, fontWeight: '800' },
  previewPercentLarge: { color: palette.textSecondary, fontSize: 34, fontWeight: '800' },
  lockedPercent: { color: palette.primary, fontSize: 24, fontWeight: '800' },
  previewHint: { color: palette.textSecondary, fontSize: 11 },
  range: { color: palette.textPrimary, fontSize: 13, fontWeight: '600' },
  snapshot: { color: palette.textSecondary, fontSize: 11, marginTop: 6, lineHeight: 16 },
  profit: { color: palette.primary, fontSize: 12, fontWeight: '700', marginTop: 6 },
  missedHint: { color: '#fbbf24', fontSize: 12, marginTop: 6 },
});
