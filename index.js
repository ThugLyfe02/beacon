import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import App from './App';

// Guard against libraries calling console.error with undefined,
// which can trigger a Metro/LogBox nullthrows crash in dev.
const originalConsoleError = console.error;
console.error = (...args) => {
  if (!args.length || args[0] == null) {
    originalConsoleError('[console.error] called with no message', ...args);
    return;
  }
  originalConsoleError(...args);
};

registerRootComponent(App);
