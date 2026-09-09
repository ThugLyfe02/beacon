import { supabase } from '../lib/supabase';
import type { InternalGraphExportFormat, InternalGraphExportResult } from './InternalGraphExportService';
import type { InternalGraphExportPersonMode } from './InternalGraphExportEngine';

export async function recordInternalGraphExportReceipt(input: {
  eventId?: string | null;
  graphVersion: string;
  format: InternalGraphExportFormat;
  personMode: InternalGraphExportPersonMode;
  restricted: boolean;
  nodeCount: number;
  edgeCount: number;
  bytes: number;
}): Promise<number> {
  const { data, error } = await supabase.rpc('record_internal_graph_export_receipt', {
    p_event_id: input.eventId ?? null,
    p_graph_version: input.graphVersion,
    p_format: input.format,
    p_person_mode: input.personMode,
    p_restricted: input.restricted,
    p_node_count: Math.max(0, Math.floor(input.nodeCount)),
    p_edge_count: Math.max(0, Math.floor(input.edgeCount)),
    p_bytes: Math.max(0, Math.floor(input.bytes)),
  });
  if (error || !Number.isFinite(Number(data))) {
    throw new Error(error?.message ?? 'Unable to seal graph export provenance.');
  }
  return Number(data);
}

export type SealedInternalGraphExportResult = InternalGraphExportResult & { receiptId: number };
