import { createContext, useContext } from 'react';

interface NavigatorContextValue {
  /** Re-check event/host state from the root navigator. Call after mutations. */
  refreshEventState: () => void;
}

export const NavigatorContext = createContext<NavigatorContextValue>({
  refreshEventState: () => {},
});

export function useNavigatorState() {
  return useContext(NavigatorContext);
}
