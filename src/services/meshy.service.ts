// =============================================================================
// meshy.service.ts
// Client wrapper around the Meshy.ai photo-to-3D edge functions.
// =============================================================================

import { supabase } from '../lib/supabase';

export type MeshyStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED';

export interface MeshyStatusResult {
  status: MeshyStatus;
  progress: number;
  glbUrl: string | null;
}

export async function startMeshyAvatarGeneration(
  imageDataUri: string
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ taskId: string }>(
    'meshy-generate',
    { body: { imageDataUri } }
  );
  if (error || !data?.taskId) {
    throw new Error(error?.message ?? 'Could not start avatar generation');
  }
  return data.taskId;
}

export async function getMeshyAvatarStatus(taskId: string): Promise<MeshyStatusResult> {
  const { data, error } = await supabase.functions.invoke<MeshyStatusResult>(
    'meshy-status',
    { body: { taskId } }
  );
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not poll avatar status');
  }
  return data;
}
