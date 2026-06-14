// =============================================================================
// meshy.service.ts
// Client wrapper around the backend-agnostic avatar edge functions.
// The server decides which backend to use (self-hosted TripoSR GPU, or Meshy
// fallback) based on which secrets are set. The taskId carries a 'gpu:' or
// 'meshy:' prefix so polling routes back to the same backend.
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
    'avatar-generate',
    { body: { imageDataUri } }
  );
  if (error || !data?.taskId) {
    throw new Error(error?.message ?? 'Could not start avatar generation');
  }
  return data.taskId;
}

export async function getMeshyAvatarStatus(taskId: string): Promise<MeshyStatusResult> {
  const { data, error } = await supabase.functions.invoke<MeshyStatusResult>(
    'avatar-status',
    { body: { taskId } }
  );
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not poll avatar status');
  }
  return data;
}
