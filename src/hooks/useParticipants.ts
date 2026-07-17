// =============================================================================
// Beacon MVP — useParticipants Hook
// =============================================================================
import { useState, useCallback } from 'react';
import type { DiscoverableParticipant } from '../types/database';
import { getApprovedParticipants } from '../services/participant.service';
import { setDiscoverable } from '../services/premium.service';

export function useParticipants() {
  const [participants, setParticipants] = useState<DiscoverableParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDiscoverable, setIsDiscoverable] = useState(false);

  const loadDiscoverableParticipants = useCallback(
    async (eventId: string, callerUserId: string) => {
      setLoading(true);
      try {
        const data = await getApprovedParticipants(eventId, callerUserId);
        setParticipants(data);
        return { data };
      } catch (error) {
        return { error };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const toggleDiscoverable = async (
    _eventId: string,
    userId: string,
    discoverable: boolean
  ) => {
    try {
      await setDiscoverable(userId, discoverable);
      setIsDiscoverable(discoverable);
      return { data: discoverable };
    } catch (error) {
      return { error };
    }
  };

  return {
    participants,
    loading,
    isDiscoverable,
    loadDiscoverableParticipants,
    toggleDiscoverable,
  };
}
