// =============================================================================
// Beacon MVP — useEvent Hook (with Context Provider)
// =============================================================================
import React, { createContext, useContext, useState, ReactNode } from 'react';
import { ActiveEventContext } from '../types/database';
import * as eventService from '../services/event.service';

// ─── Context Types ────────────────────────────────────────────────────────────

interface EventContextValue {
  activeEvent: ActiveEventContext | null;
  loading: boolean;
  error: string | null;
  joinEventByCode: (joinCode: string, userId: string) => Promise<{ data?: ActiveEventContext; error?: string }>;
  clearEvent: () => void;
}

// ─── Context Creation ─────────────────────────────────────────────────────────

const EventContext = createContext<EventContextValue | undefined>(undefined);

// ─── Provider Component ───────────────────────────────────────────────────────

interface EventProviderProps {
  children: ReactNode;
}

export function EventProvider({ children }: EventProviderProps) {
  const [activeEvent, setActiveEvent] = useState<ActiveEventContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinEventByCode = async (joinCode: string, userId: string) => {
    console.log('[EventProvider] joinEventByCode called:', { joinCode, userId });
    setLoading(true);
    setError(null);

    const { data, error: joinError } = await eventService.joinEventByCode(
      joinCode,
      userId
    );

    console.log('[EventProvider] Service result:', { data, error: joinError });
    setLoading(false);

    if (joinError || !data) {
      const errorMsg =
        joinError && typeof joinError === 'object' && 'message' in joinError
          ? joinError.message
          : 'Failed to join event';
      console.log('[EventProvider] Error:', errorMsg);
      setError(errorMsg);
      return { error: errorMsg };
    }

    console.log('[EventProvider] Setting activeEvent:', data);
    setActiveEvent(data);
    return { data };
  };

  const clearEvent = () => {
    setActiveEvent(null);
    setError(null);
  };

  const value: EventContextValue = {
    activeEvent,
    loading,
    error,
    joinEventByCode,
    clearEvent,
  };

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEvent(): EventContextValue {
  const context = useContext(EventContext);

  if (context === undefined) {
    throw new Error('useEvent must be used within an EventProvider');
  }

  return context;
}
