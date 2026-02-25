// =============================================================================
// Beacon MVP — useParticipants Hook
// =============================================================================
import { useState, useCallback } from 'react';
import { DiscoverableParticipant } from '../types/database';
import * as participantService from '../services/participant.service';

export function useParticipants() {
  const [participants, setParticipants] = useState<DiscoverableParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDiscoverable, setIsDiscoverable] = useState(false);

  const loadDiscoverableParticipants = useCallback(
    async (eventId: string, callerUserId: string) => {
      setLoading(true);
      const { data, error } = await participantService.listDiscoverableParticipants(
        eventId,
        callerUserId
      );
      setLoading(false);

      if (error) {
        return { error };
      }

      setParticipants(data);
      return { data };
    },
    []
  );

  const toggleDiscoverable = async (
    eventId: string,
    userId: string,
    discoverable: boolean
  ) => {
    const { data, error } = await participantService.toggleDiscoverable(
      eventId,
      userId,
      discoverable
    );

    if (error) {
      return { error };
    }

    setIsDiscoverable(discoverable);
    return { data };
  };

  return {
    participants,
    loading,
    isDiscoverable,
    loadDiscoverableParticipants,
    toggleDiscoverable,
  };
}
