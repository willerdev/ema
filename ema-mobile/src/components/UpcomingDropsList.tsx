import { StyleSheet, Text, View } from 'react-native';
import type { AirfarmingUpcomingDrop } from '../services/airfarmingService';
import { formatDropCountdown } from '../services/airfarmingService';
import { palette } from '../theme/colors';

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
        const statusLabel = drop.percentLocked ? 'Live' : drop.isProjected ? 'Projected' : 'Upcoming';
        return (
          <View key={key} style={[styles.row, drop.percentLocked && styles.rowLive]}>
            <View style={styles.rowTop}>
              <Text style={styles.dropTitle}>Drop #{drop.dropIndex + 1}</Text>
              <View
                style={[
                  styles.chip,
                  drop.percentLocked ? styles.chipLive : drop.isProjected ? styles.chipProjected : styles.chipUpcoming,
                ]}
              >
                <Text style={styles.chipText}>{statusLabel}</Text>
              </View>
            </View>
            <Text style={styles.due}>{formatDueLabel(drop.dueAt)}</Text>
            <Text style={styles.countdown}>
              {drop.percentLocked ? 'Drop window open' : `In ${formatDropCountdown(drop.secondsRemaining)}`}
            </Text>
            <Text style={styles.percentText}>
              {drop.percent != null ? `+${drop.percent.toFixed(1)}%` : '—'}
            </Text>
            <Text style={styles.range}>
              Required: {formatUsd(drop.minBalance)} – {formatUsd(drop.maxBalance)}
            </Text>
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
  percentText: { color: palette.primary, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  range: { color: palette.textPrimary, fontSize: 13, fontWeight: '600' },
});
