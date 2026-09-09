import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { internalGraphToGraphML, internalGraphToNeo4jCypher } from './InternalGraphExportEngine';
import { loadInternalGraphExportPayload } from './internalGraph.service';

export type InternalGraphExportFormat = 'graphml' | 'cypher';

export interface InternalGraphExportResult {
  format: InternalGraphExportFormat;
  uri: string;
  bytes: number;
  nodeCount: number;
  edgeCount: number;
}

function safeScope(eventId: string | null | undefined): string {
  return eventId ? eventId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) : 'global';
}

/**
 * Writes a deterministic operator export to the app cache and opens the native
 * share sheet with the serialized content. The server independently requires
 * graph_export (and graph_restricted when requested).
 */
export async function exportInternalGraph(input: {
  format: InternalGraphExportFormat;
  eventId?: string | null;
  includeRestricted?: boolean;
}): Promise<InternalGraphExportResult> {
  const payload = await loadInternalGraphExportPayload({
    eventId: input.eventId ?? null,
    includeRestricted: input.includeRestricted ?? false,
    limit: 1800,
  });
  const content = input.format === 'graphml'
    ? internalGraphToGraphML(payload)
    : internalGraphToNeo4jCypher(payload);
  const extension = input.format === 'graphml' ? 'graphml' : 'cypher';
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error('No writable cache directory is available for graph export.');
  const uri = `${cacheDirectory}beacon_constellation_${safeScope(input.eventId)}_${Date.now()}.${extension}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });

  // React Native's built-in Share API is dependency-free and keeps this export
  // usable on current mobile builds. The file URI is preserved for a later
  // native document-share adapter; message fallback works on both platforms.
  await Share.share({
    title: `Beacon Constellation ${input.format.toUpperCase()} export`,
    message: content,
    url: uri,
  });

  return {
    format: input.format,
    uri,
    bytes: new TextEncoder().encode(content).byteLength,
    nodeCount: payload.nodeCount,
    edgeCount: payload.edgeCount,
  };
}
