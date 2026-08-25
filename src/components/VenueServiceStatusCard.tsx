import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  getLiveVenueServiceGuidance,
  type LiveVenueServiceGuidance,
  type LiveVenueServiceTrend,
} from '../services/venue-participant-guide.service';
import { buildVenueParticipantGuide } from '../spatial/VenueParticipantGuide';

interface Props {
  eventId: string;
}

function label(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusColor(status: LiveVenueServiceGuidance['status']): string {
  if (status === 'busy') return '#FCA5A5';
  if (status === 'clear') return '#86EFAC';
  if (status === 'steady') return '#93C5FD';
  return '#94A3B8';
}

function trendGlyph(trend: LiveVenueServiceTrend): string {
  if (trend === 'easing') return '↘';
  if (trend === 'building') return '↗';
  if (trend === 'stable') return '→';
  return '·';
}

function trendLabel(trend: LiveVenueServiceTrend): string {
  if (trend === 'easing') return 'EASING';
  if (trend === 'building') return 'BUILDING';
  if (trend === 'stable') return 'STEADY';
  return 'NEW';
}

function freshnessLabel(observedAt: string | null): string {
  if (!observedAt) return 'LIVE';
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return 'LIVE';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'JUST UPDATED';
  if (seconds < 60) return `${seconds}S AGO`;
  return `${Math.max(1, Math.round(seconds / 60))}M AGO`;
}

/**
 * Participant utility surface for live venue service conditions. The server
 * suppresses stale, weak-support, and low-confidence samples before they reach
 * this component. The UI then ranks only coarse status, coarse wait bands, and
 * coarse trend evidence; raw queue counts and raw service history never enter
 * this participant surface.
 */
export default function VenueServiceStatusCard({ eventId }: Readonly<Props>) {
  const [services, setServices] = useState<LiveVenueServiceGuidance[]>([]);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const result = await getLiveVenueServiceGuidance(eventId);
    if (result.error) {
      setAvailable(false);
      setServices([]);
      return;
    }
    setAvailable(true);
    setServices(result.data);
  }, [eventId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const guide = useMemo(() => buildVenueParticipantGuide(services), [services]);

  if (!available || guide.services.length === 0) return null;

  const primary = guide.primary;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>LIVE VENUE GUIDE</Text>
          <Text style={styles.title}>Useful right now</Text>
        </View>
        <View style={styles.liveBlock}>
          <Text style={styles.live}>OBSERVED</Text>
          <Text style={styles.freshness}>{freshnessLabel(guide.newestObservedAt)}</Text>
        </View>
      </View>

      <Text style={styles.narrative}>{guide.narrative}</Text>

      <View style={styles.signalRail}>
        <View style={styles.railMetric}>
          <Text style={styles.railValue}>{guide.clearCount}</Text>
          <Text style={styles.railLabel}>CLEAR</Text>
        </View>
        <View style={styles.railDivider} />
        <View style={styles.railMetric}>
          <Text style={styles.railValue}>{guide.steadyCount}</Text>
          <Text style={styles.railLabel}>STEADY</Text>
        </View>
        <View style={styles.railDivider} />
        <View style={styles.railMetric}>
          <Text style={[styles.railValue, guide.busyCount > 0 && styles.railValueBusy]}>{guide.busyCount}</Text>
          <Text style={styles.railLabel}>BUSY</Text>
        </View>
        <View style={styles.railDivider} />
        <View style={styles.railMetric}>
          <Text style={styles.railValue}>{guide.easingCount}</Text>
          <Text style={styles.railLabel}>EASING</Text>
        </View>
      </View>

      {primary ? (
        <View style={styles.primaryCard}>
          <View style={styles.primaryCopy}>
            <Text style={styles.primaryEyebrow}>CLEAREST OBSERVED OPTION</Text>
            <Text style={styles.primaryName}>{label(primary.service_point_id)}</Text>
            <Text style={styles.primaryMeta}>{label(primary.kind)} · {label(primary.zone_id)}</Text>
          </View>
          <View style={styles.primaryValue}>
            <Text style={[styles.primaryStatus, { color: statusColor(primary.status) }]}>
              {primary.status.toUpperCase()}
            </Text>
            <Text style={styles.primaryWait}>{primary.wait_band}</Text>
            <Text style={styles.primaryTrend}>{trendGlyph(primary.trend)} {trendLabel(primary.trend)}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.rows}>
        {guide.services.slice(0, 6).map((service) => (
          <View key={`${service.service_point_id}:${service.zone_id}`} style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.name}>{label(service.service_point_id)}</Text>
              <Text style={styles.meta}>{label(service.kind)} · {label(service.zone_id)}</Text>
            </View>
            <View style={styles.valueBlock}>
              <Text style={[styles.status, { color: statusColor(service.status) }]}>{service.status.toUpperCase()}</Text>
              <Text style={styles.wait}>{service.wait_band}</Text>
              <Text style={styles.trend}>{trendGlyph(service.trend)} {trendLabel(service.trend)}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.footnote}>
        This guide uses recent aggregate service evidence and coarse wait bands. “Easing” and “building” describe the latest coarse queue direction; they are not predictions. Raw queue counts and service history remain host-private.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 22,
    padding: 17,
    backgroundColor: '#0C1420',
    borderWidth: 1,
    borderColor: 'rgba(34, 227, 158, 0.18)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#86EFAC', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 4, color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  liveBlock: { alignItems: 'flex-end' },
  live: { color: '#86EFAC', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  freshness: { marginTop: 3, color: '#64748B', fontSize: 8, fontWeight: '800' },
  narrative: { marginTop: 11, color: '#CBD5E1', fontSize: 13, lineHeight: 19 },
  signalRail: {
    marginTop: 14,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.10)',
  },
  railMetric: { flex: 1, alignItems: 'center' },
  railValue: { color: '#F8FAFC', fontSize: 16, fontWeight: '900' },
  railValueBusy: { color: '#FCA5A5' },
  railLabel: { marginTop: 2, color: '#64748B', fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  railDivider: { width: StyleSheet.hairlineWidth, height: 27, backgroundColor: 'rgba(148,163,184,0.16)' },
  primaryCard: {
    marginTop: 13,
    padding: 13,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    backgroundColor: 'rgba(34, 197, 94, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(134, 239, 172, 0.20)',
  },
  primaryCopy: { flex: 1 },
  primaryEyebrow: { color: '#86EFAC', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  primaryName: { marginTop: 4, color: '#F8FAFC', fontSize: 16, fontWeight: '800' },
  primaryMeta: { marginTop: 2, color: '#64748B', fontSize: 9, textTransform: 'uppercase' },
  primaryValue: { alignItems: 'flex-end' },
  primaryStatus: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  primaryWait: { marginTop: 2, color: '#F8FAFC', fontSize: 14, fontWeight: '800' },
  primaryTrend: { marginTop: 3, color: '#94A3B8', fontSize: 8, fontWeight: '800' },
  rows: { marginTop: 9, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.12)',
  },
  rowCopy: { flex: 1 },
  name: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  meta: { marginTop: 2, color: '#64748B', fontSize: 9, textTransform: 'uppercase' },
  valueBlock: { alignItems: 'flex-end' },
  status: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  wait: { marginTop: 2, color: '#CBD5E1', fontSize: 12, fontWeight: '700' },
  trend: { marginTop: 2, color: '#64748B', fontSize: 8, fontWeight: '800' },
  footnote: { marginTop: 11, color: '#64748B', fontSize: 9, lineHeight: 14 },
});
