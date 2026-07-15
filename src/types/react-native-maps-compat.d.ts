import 'react-native-maps';

declare module 'react-native-maps' {
  interface MapViewProps {
    /** Compatibility alias used by older native map implementations. */
    showsPointsOfInterest?: boolean;
  }
}
