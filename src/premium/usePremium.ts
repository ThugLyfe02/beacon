import { useAuth } from '../hooks/useAuth';
import { usePremium } from '../hooks/usePremium';

export function usePremiumStatus(): boolean {
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id ?? null);
  return isPremium;
}
