import { useEffect } from "react";
import { shouldRecordMissedOpportunity } from "./RegretEngine";
import { supabase } from "../lib/supabase";

export function useRegretRecorder({
  signals,
  eventId,
  userId
}: {
  signals: any[];
  eventId: string;
  userId: string;
}) {

  useEffect(() => {
    signals.forEach(async (signal) => {
      if (
        shouldRecordMissedOpportunity(signal.bucket, signal.mutual)
      ) {
        await supabase.from("missed_opportunities").insert({
          event_id: eventId,
          user_id: userId,
          target_id: signal.targetId,
          closest_bucket: signal.bucket
        });
      }
    });
  }, [signals]);
}
