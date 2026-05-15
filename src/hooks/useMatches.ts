// =============================================================================
// Beacon MVP — useMatches Hook
// =============================================================================
import { useState, useCallback } from 'react';
import { MatchRow } from '../types/database';
import * as matchService from '../services/match.service';
import * as connectionService from '../services/connection.service';

export function useMatches() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMatches = useCallback(async (eventId: string, userId: string) => {
    setLoading(true);
    const { data, error } = await matchService.listMatches(eventId, userId);
    setLoading(false);

    if (error) {
      return { error };
    }

    setMatches(data);
    return { data };
  }, []);

  const sendConnectionRequest = async (
    eventId: string,
    requesterId: string,
    recipientId: string
  ) => {
    const { request, match, error } = await connectionService.sendConnectionRequest(
      eventId,
      requesterId,
      recipientId
    );

    if (error) {
      return { error };
    }

    // If a match was created, add it to local state
    if (match) {
      setMatches((prev) => [match, ...prev]);
    }

    return { request, match };
  };

  return {
    matches,
    loading,
    loadMatches,
    sendConnectionRequest,
  };
}
