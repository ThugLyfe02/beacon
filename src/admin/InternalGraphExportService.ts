import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  internalGraphToGraphML,
  internalGraphToNeo4jCypher,
  type InternalGraphExportPersonMode,
} from './InternalGraphExportEngine';
import { loadInternalGraphExportPayload } from './internalGraph.service';

export type InternalGraphExportFormat = 'graphml' | 'cypher';

export interface InternalGraphExportResult {
  format: InternalGraphExportFormat;
  personMode: InternalGraphExportPersonMode;
  restricted: boolean;
  graphVersion: string;
  uri: string;
  bytes: number;
  nodeCount: number;
  edgeCount: number;
}

function safeScope(eventId: string | null | undefined): string {
  return eventId ? eventId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) : 'global';
}

function freshExportSalt(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    const values = new Uint32Array(4);
    cryptoObject.getRandomValues(values);
    return [...values].map((value) => value.toString(16).padStart(8, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Writes an operator export to the app cache and opens the native share sheet.
 *
 * The server independently requires graph_export and graph_restricted when
 * requested. Portable exports pseudonymize person labels/IDs by default with a
 * fresh per-export salt so two exported files cannot casually correlate people by
 * Constellation alias. Labeled mode is an explicit operator choice for controlled
 * forensic workflows, never the default.
 */
export async function exportInternalGraph(input: {
  format: InternalGraphExportFormat;
  eventId?: string | null;
  includeRestricted?: boolean;
  personMode?: InternalGraphExportPersonMode;
}): Promise<InternalGraphExportResult> {
  const personMode = input.personMode ?? 'pseudonymous';
  const restricted = input.includeRestricted ?? false;
  const payload = await loadInternalGraphExportPayload({
    eventId: input.eventId ?? null,
    includeRestricted: restricted,
    limit: 1800,
  });
  const serialization = {
    personMode,
    exportSalt: personMode === 'pseudonymous' ? freshExportSalt() : 'labeled-internal-export',
  } as const;
  const content = input.format === 'graphml'
    ? internalGraphToGraphML(payload, serialization)
    : internalGraphToNeo4jCypher(payload, serialization);
  const extension = input.format === 'graphml' ? 'graphml' : 'cypher';
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error('No writable cache directory is available for graph export.');
  const privacySuffix = personMode === 'pseudonymous' ? 'pseudo' : 'labeled';
  const uri = `${cacheDirectory}beacon_constellation_${safeScope(input.eventId)}_${privacySuffix}_${Date.now()}.${extension}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });

  await Share.share({
    title: `Beacon Constellation ${input.format.toUpperCase()} export · ${personMode}`,
    message: content,
    url: uri,
  });

  return {
    format: input.format,
    personMode,
    restricted,
    graphVersion: payload.graphVersion,
    uri,
    bytes: new TextEncoder().encode(content).byteLength,
    nodeCount: payload.nodeCount,
    edgeCount: payload.edgeCount,
  };
}
