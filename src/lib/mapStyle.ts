// Custom dark map style for react-native-maps (Google provider).
// Tuned to recede so neon overlays/markers carry the visual weight.
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0A0E1A' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5A6584' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#05070D' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#1E2A44' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#8A97B8' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#121826' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#1A2236' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1E2A44' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#00E5FF' }, { weight: 0.15 }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#05070D' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2A3A5C' }] },
] as const;
