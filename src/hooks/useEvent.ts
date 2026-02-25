// =============================================================================
// Beacon MVP — useEvent Hook
// =============================================================================
import { useState } from 'react';
import { ActiveEventContext } from '../types/database';
import * as eventService from '../services/event.service';

export function useEvent() {
  const [activeEvent, setActiveEvent] = useState<ActiveEventContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinEventByCode = async (joinCode: string, userId: string) => {
    setLoading(true);
    setError(null);

    const { data, error: joinError } = await eventService.joinEventByCode(
      joinCode,
      userId
    );

    setLoading(false);

    if (joinError || !data) {
      const errorMsg =
        typeof joinError === 'object' && 'message' in joinError
          ? joinError.message
          : 'Failed to join event';
      setError(errorMsg);
      return { error: errorMsg };
    }

    setActiveEvent(data);
    return { data };
  };

  const clearEvent = () => {
    setActiveEvent(null);
    setError(null);
  };

  return {
    activeEvent,
    loading,
    error,
    joinEventByCode,
    clearEvent,
  };
}
