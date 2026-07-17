// =============================================================================
// Beacon MVP — useEvent Hook (with Context Provider)
// =============================================================================
import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { ActiveEventContext } from '../types/database';
import { getEventByCode } from '../services/event.service';
import { requestToJoinEvent } from '../services/participant.service';

interface EventContextValue {
  activeEvent: ActiveEventContext | null;
  loading: boolean;
  error: string | null;
  joinEventByCode: (joinCode: string, userId: string) => Promise<{ data?: ActiveEventContext; error?: string }>;
  clearEvent: () => void;
}

const EventContext = createContext<EventContextValue | undefined>(undefined);

interface EventProviderProps {
  children: ReactNode;
}

export function EventProvider({ children }: EventProviderProps) {
  const [activeEvent, setActiveEvent] = useState<ActiveEventContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinEventByCode = async (joinCode: string, userId: string) => {
    setLoading(true);
    setError(null);

    try {
      const event = await getEventByCode(joinCode);
      if (!event) {
        const message = 'Event not found';
        setError(message);
        return { error: message };
      }

      const participant = await requestToJoinEvent(event.id, userId);
      const data: ActiveEventContext = { event, participant };
      setActiveEvent(data);
      return { data };
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : 'Failed to join event';
      setError(message);
      return { error: message };
    } finally {
      setLoading(false);
    }
  };

  const clearEvent = () => {
    setActiveEvent(null);
    setError(null);
  };

  return (
    <EventContext.Provider value={{ activeEvent, loading, error, joinEventByCode, clearEvent }}>
      {children}
    </EventContext.Provider>
  );
}

export function useEvent(): EventContextValue {
  const context = useContext(EventContext);
  if (context === undefined) {
    throw new Error('useEvent must be used within an EventProvider');
  }
  return context;
}
