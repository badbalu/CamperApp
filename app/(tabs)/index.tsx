import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Polyline, LatLng } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';

type CoordInput = { lat: string; lng: string };

const DEFAULT_START: CoordInput = { lat: '49.28444', lng: '12.70033' };
const DEFAULT_DEST: CoordInput = { lat: '49.26170', lng: '12.76425' };
const RE_ROUTE_THRESHOLD_METERS = 40;
const NEXT_STEP_THRESHOLD_METERS = 60;

export default function Index() {
  const mapRef = useRef<MapView | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  const [start, setStart] = useState<CoordInput>(DEFAULT_START);
  const [dest, setDest] = useState<CoordInput>(DEFAULT_DEST);

  const [route, setRoute] = useState<LatLng[]>([]);
  const [steps, setSteps] = useState<any[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [elevationM, setElevationM] = useState<number | null>(null);
  const [speedLimitKmh, setSpeedLimitKmh] = useState<number | null>(null);
  const [totalDistanceKM, setTotalDistanceKM] = useState<string | null>(null);
  const [totalDurationMin, setTotalDurationMin] = useState<string | null>(null);

  const [currentPos, setCurrentPos] = useState<LatLng | null>(null);
  const [nextStep, setNextStep] = useState<any | null>(null);

  const nextStepIndexRef = useRef<number>(0);

  const startCoord = useMemo<LatLng>(
    () => ({
      latitude: parseFloat(start.lat) || 0,
      longitude: parseFloat(start.lng) || 0,
    }),
    [start]
  );

  const destCoord = useMemo<LatLng>(
    () => ({
      latitude: parseFloat(dest.lat) || 0,
      longitude: parseFloat(dest.lng) || 0,
    }),
    [dest]
  );

  const haversineMeters = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) => {
    const R = 6371000;
    const toRad = (n: number) => (n * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const distanceToRoute = (pos: LatLng, line: LatLng[]) => {
    if (line.length === 0) return Infinity;
    let min = Infinity;
    for (const p of line) {
      const d = haversineMeters(pos.latitude, pos.longitude, p.latitude, p.longitude);
      if (d < min) min = d;
    }
    return min;
  };

  const recalcRoute = async (from: LatLng, to: LatLng) => {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
      `?overview=full&geometries=geojson&steps=true`;

    const res = await fetch(url);
    const json = await res.json();

    const coords = json?.routes?.[0]?.geometry?.coordinates ?? [];
    setRoute(coords.map(([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng })));

    const newSteps = json?.routes?.[0]?.legs?.[0]?.steps ?? [];
    setSteps(newSteps);
    setNextStep(newSteps[0] ?? null);
    nextStepIndexRef.current = 0;
    setSpeedLimitKmh(extractSpeedLimit(newSteps));

    // Gesamtdistanz und -dauer aus OSRM lesen
    const totalDistanceMeters = json?.routes?.[0]?.distance ?? 0;
    const totalDurationSeconds = json?.routes?.[0]?.duration ?? 0;

    setTotalDistanceKM((totalDistanceMeters / 1000).toFixed(2));
    setTotalDurationMin(`${Math.round(totalDurationSeconds / 60)} min`);
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!mounted || status !== 'granted') return;

      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        async (loc) => {
          const next: LatLng = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };

          setCurrentPos(next);
          setSpeedKmh(
            typeof loc.coords.speed === 'number' && loc.coords.speed >= 0
              ? loc.coords.speed * 3.6
              : null
          );

          const elev = await fetchElevation(next.latitude, next.longitude);
          setElevationM(elev);

          if (route.length > 0) {
            const dist = distanceToRoute(next, route);
            if (dist > RE_ROUTE_THRESHOLD_METERS) {
              await recalcRoute(next, destCoord);
            }
          }

          if (steps.length > 0 && nextStep) {
            updateNextStep(next);
          }
        }
      );
    })();

    return () => {
      mounted = false;
      watchRef.current?.remove();
    };
  }, [destCoord, route, nextStep]);

  const updateNextStep = (pos: LatLng) => {
    let idx = nextStepIndexRef.current;

    if (idx >= steps.length - 1) return;

    const currentStep = steps[idx];

    const loc = currentStep?.maneuver?.location;
    if (!loc) return;

    const [lng, lat] = loc;
    const dist = haversineMeters(pos.latitude, pos.longitude, lat, lng);

    if (dist < NEXT_STEP_THRESHOLD_METERS) {
      idx++;
      const newStep = steps[idx];
      nextStepIndexRef.current = idx;
      setNextStep(newStep);
      speakStep(newStep);
    }
  };

  const speakStep = (step: any) => {
    if (!step) return;
    const text = buildInstructionText(step);
    Speech.speak(text, {
      language: 'de',
      pitch: 1,
      rate: 1,
    });
  };

  const buildInstructionText = (step: any) => {
    const name = step?.name || '';
    const modifier = step?.maneuver?.modifier || '';
    const type = step?.maneuver?.type || '';
    const dist = step?.distance || 0;
    const distM = Math.round(dist);
    const distKm = Number((distM / 1000).toFixed(2));

    if (type === 'depart') {
      return name ? `Fahre auf ${name}` : 'Fahre los';
    }

    if (type === 'arrive') {
      return 'Du bist am Ziel';
    }

    let text = '';
    if (distKm > 0) {
      text += `In ${distKm} km`;
    } else {
      text += 'Jetzt';
    }

    if (modifier === 'left') text += ' links abbiegen';
    else if (modifier === 'right') text += ' rechts abbiegen';
    else if (modifier === 'slight left') text += ' leicht links abbiegen';
    else if (modifier === 'slight right') text += ' leicht rechts abbiegen';
    else if (modifier === 'uturn') text += ' Kehrtwende';
    else text += ' ab';

    if (name) text += ` in ${name}`;

    return text;
  };

  const buildRoute = async () => {
    if (
      !Number.isFinite(startCoord.latitude) ||
      !Number.isFinite(startCoord.longitude) ||
      !Number.isFinite(destCoord.latitude) ||
      !Number.isFinite(destCoord.longitude)
    ) {
      return;
    }

    setLoadingRoute(true);
    try {
      await recalcRoute(startCoord, destCoord);
      mapRef.current?.animateCamera({ center: startCoord, zoom: 12 });
      const firstStep = steps[0];
      if (firstStep) {
        speakStep(firstStep);
      }
    } finally {
      setLoadingRoute(false);
    }
  };

  const fetchElevation = async (lat: number, lng: number) => {
    try {
      const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;
      const res = await fetch(url);
      const json = await res.json();
      return typeof json?.results?.[0]?.elevation === 'number' ? json.results[0].elevation : null;
    } catch {
      return null;
    }
  };

  const extractSpeedLimit = (steps: any[]) => {
    for (const step of steps) {
      if (typeof step?.speed_limit === 'number') return step.speed_limit;
      if (typeof step?.maneuver?.speed_limit === 'number') return step.maneuver.speed_limit;
      if (typeof step?.annotation?.speed_limit === 'number') return step.annotation.speed_limit;
    }
    return null;
  };

  const mapCenter = currentPos ?? startCoord;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        <View style={styles.leftPanel}>
          <ScrollView
            style={styles.leftScroll}
            contentContainerStyle={styles.leftContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>Navigation</Text>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Start</Text>
              <Text style={styles.label}>Latitude</Text>
              <TextInput
                style={styles.input}
                value={start.lat}
                onChangeText={(v) => setStart((s) => ({ ...s, lat: v }))}
                keyboardType="decimal-pad"
                placeholder="49.485"
                placeholderTextColor="#8e8e8e"
              />
              <Text style={styles.label}>Longitude</Text>
              <TextInput
                style={styles.input}
                value={start.lng}
                onChangeText={(v) => setStart((s) => ({ ...s, lng: v }))}
                keyboardType="decimal-pad"
                placeholder="12.483"
                placeholderTextColor="#8e8e8e"
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ziel</Text>
              <Text style={styles.label}>Latitude</Text>
              <TextInput
                style={styles.input}
                value={dest.lat}
                onChangeText={(v) => setDest((s) => ({ ...s, lat: v }))}
                keyboardType="decimal-pad"
                placeholder="49.600"
                placeholderTextColor="#8e8e8e"
              />
              <Text style={styles.label}>Longitude</Text>
              <TextInput
                style={styles.input}
                value={dest.lng}
                onChangeText={(v) => setDest((s) => ({ ...s, lng: v }))}
                keyboardType="decimal-pad"
                placeholder="12.700"
                placeholderTextColor="#8e8e8e"
              />
            </View>

            <Pressable style={styles.button} onPress={buildRoute}>
              <Text style={styles.buttonText}>
                {loadingRoute ? 'Berechne…' : 'Route berechnen'}
              </Text>
            </Pressable>

            {loadingRoute && <ActivityIndicator style={styles.loader} color="#2f80ed" />}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Live-Daten</Text>
              <Text style={styles.info}>
                Geschwindigkeit: {speedKmh != null ? `${speedKmh.toFixed(1)} km/h` : '—'}
              </Text>
              <Text style={styles.info}>
                Höhe: {elevationM != null ? `${elevationM.toFixed(0)} m` : '—'}
              </Text>
              <Text style={styles.info}>
                Tempolimit: {speedLimitKmh != null ? `${speedLimitKmh} km/h` : '—'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Route</Text>
              <Text style={styles.info}>
                Streckenlänge: {totalDistanceKM != null ? `${totalDistanceKM} km` : '-'}
              </Text>
              <Text style={styles.info}>
                Geschätzte Zeit: {totalDurationMin != null ? totalDurationMin : '-'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Position</Text>
              <Text style={styles.info}>
                {currentPos
                  ? `${currentPos.latitude.toFixed(6)}, ${currentPos.longitude.toFixed(6)}`
                  : 'Keine Live-Position'}
              </Text>
            </View>
          </ScrollView>
        </View>

        <View style={styles.mapPanel}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={{
              latitude: mapCenter.latitude,
              longitude: mapCenter.longitude,
              latitudeDelta: 0.08,
              longitudeDelta: 0.08,
            }}
            showsUserLocation={true}
            followsUserLocation={true}
          >
            <Marker coordinate={startCoord} title="Start" />
            <Marker coordinate={destCoord} title="Ziel" />
            {route.length > 0 && <Polyline coordinates={route} strokeWidth={5} />}
          </MapView>

          {nextStep && (
            <View style={styles.navCard}>
              <Text style={styles.navCardTitle}>Nächste Aktion</Text>
              <Text style={styles.navCardText}>{buildInstructionText(nextStep)}</Text>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#111827',
  },
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#111827',
  },
  leftPanel: {
    flex: 1,
    maxWidth: '22%',
    minWidth: 260,
    backgroundColor: '#0f172a',
    borderRightWidth: 1,
    borderRightColor: '#243044',
  },
  leftScroll: {
    flex: 1,
  },
  leftContent: {
    padding: 12,
    gap: 12,
  },
  mapPanel: {
    flex: 4,
    backgroundColor: '#1f2937',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#172033',
    borderWidth: 1,
    borderColor: '#273449',
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: '#0b1220',
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  loader: {
    marginTop: 2,
  },
  info: {
    color: '#e5e7eb',
    fontSize: 14,
    lineHeight: 20,
  },
  navCard: {
    position: 'absolute',
    bottom: 20,
    left: '5%',
    right: '5%',
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#273449',
  },
  navCardTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  navCardText: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
});