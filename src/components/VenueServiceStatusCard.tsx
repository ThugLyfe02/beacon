import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  getPublicVenueServiceStatus,
  type PublicVenueServiceStatus,
} from '../services/venue-operations.service';

interface Props {
  eventId: string;
}

function label(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusColor(status: PublicVenueServiceStatus['status']): string {
  if (status === 'busy') return '#FCA5A5';
  if (status === 'clear') return '#86EFAC';
  if (status === 'steady') return '#93C5FD';
  return '#94A3B8';
}

/**
 * Participant utility surface for aggregate service conditions. The server RPC
 * already suppresses stale, weak-support, and low-confidence samples; this card
 * deliberately shows coarse wait bands rather than raw queue counts.
 */
export default function VenueServiceStatusCard({ eventId }: Readonly<Props>) {
  const [services, setServices] = useState<PublicVenueServiceStatus[]>([]);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const result = await getPublicVenueServiceStatus(eventId);
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
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!available || services.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>VENUE STATUS</Text>
          <Text style={styles.title}>Useful right now</Text>
        </View>
        <Text style={styles.live}>LIVE</Text>
      </View>

      <View style={styles.rows}>
        {services.slice(0, 6).map((service) => (
          <View key={`${service.service_point_id}:${service.zone_id}`} style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.name}>{label(service.service_point_id)}</Text>
              <Text style={styles.meta}>{label(service.kind)} · {label(service.zone_id)}</Text>
            </View>
            <View style={styles.valueBlock}>
              <Text style={[styles.status, { color: statusColor(service.status) }]}>{service.status.toUpperCase()}</Text>
              <Text style={styles.wait}>{service.wait_band}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.footnote}>
        Service conditions use recent aggregate observations and are withheld when support or confidence is too weak. Raw queue history is not shown.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#0F1521',
    borderWidth: 1,
    borderColor: 'rgba(34, 227, 158, 0.16)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { color: '#86EFAC', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  title: { marginTop: 4, color: '#F8FAFC', fontSize: 17, fontWeight: '800' },
  live: { color: '#86EFAC', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  rows: { marginTop: 12, gap: 8 },
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
  meta: { marginTop: 2, color: '#64748B', fontSize: 10, textTransform: 'uppercase' },
  valueBlock: { alignItems: 'flex-end' },
  status: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  wait: { marginTop: 2, color: '#CBD5E1', fontSize: 12, fontWeight: '700' },
  footnote: { marginTop: 10, color: '#64748B', fontSize: 10, lineHeight: 15 },
});
