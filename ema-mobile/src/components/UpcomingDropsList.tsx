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

  const visible = drops.slice(0, 2);
  const remaining = Math.max(0, drops.length - visible.length);

  return (
    <View style={styles.list}>
      {visible.map((drop, index) => {
        const key = drop.id || drop.previewKey || `drop-${index}`;
        return (
          <View key={key} style={styles.row}>
            <Text style={styles.dropTitle}>Drop #{drop.dropIndex + 1}</Text>
            <Text style={styles.due}>{formatDueLabel(drop.dueAt)}</Text>
            <Text style={styles.range}>
              Required: {formatUsd(drop.minBalance)} – {formatUsd(drop.maxBalance)}
            </Text>
            <Text style={styles.countdown}>
              {drop.percentLocked ? 'Drop window open' : `In ${formatDropCountdown(drop.secondsRemaining)}`}
            </Text>
          </View>
        );
      })}
      {remaining > 0 ? (
        <Text style={styles.moreText}>
          {remaining} more {remaining === 1 ? 'drop is' : 'drops are'} coming
        </Text>
      ) : null}
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
  dropTitle: { color: palette.textPrimary, fontWeight: '700', fontSize: 15 },
  due: { color: palette.textSecondary, fontSize: 12, marginBottom: 6 },
  range: { color: palette.textPrimary, fontSize: 13, fontWeight: '600' },
  countdown: { color: palette.textSecondary, fontSize: 12, marginTop: 6 },
  moreText: { color: palette.primary, fontSize: 12, fontWeight: '700', marginTop: 2 },
});
