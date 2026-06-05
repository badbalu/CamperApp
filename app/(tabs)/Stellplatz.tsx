import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
  Dimensions,
  Pressable,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import * as Location from "expo-location";
import Slider from "@react-native-community/slider";

const { width } = Dimensions.get("window");

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470";

type Filter =
  | "all"
  | "free"
  | "nature"
  | "sanitary"
  | "electric"
  | "water";

type Place = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  description: string;
  distance: number;
  image: string;
};

function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function Stellplatz() {
  const mapRef = useRef<MapView>(null);

  const [loading, setLoading] = useState(true);
  const [places, setPlaces] = useState<Place[]>([]);
  const [region, setRegion] = useState<Region | null>(null);

  const [filter, setFilter] = useState<Filter>("all");
  const [radius, setRadius] = useState(20);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({});

      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;

      setRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      });

      const url = `https://guest.park4night.com/services/V4.1/lieuxGetFilter.php?latitude=${lat}&longitude=${lng}`;

      const res = await fetch(url);
      const json = await res.json();

      const raw = json.lieux || [];

      const mapped: Place[] = raw.map((p: any) => {
        const plat = parseFloat(p.latitude);
        const plng = parseFloat(p.longitude);

        return {
          id: p.id,
          latitude: plat,
          longitude: plng,
          title: p.titre || "Stellplatz",
          description:
            p.description_de ||
            p.description_en ||
            "Keine Beschreibung verfügbar",
          distance: getDistanceKm(lat, lng, plat, plng),
          image:
            p.photo?.url ||
            p.photos?.[0]?.url ||
            p.image ||
            DEFAULT_IMAGE,
        };
      });

      mapped.sort((a, b) => a.distance - b.distance);

      setPlaces(mapped);
    } catch (e) {
      console.log("ERROR:", e);
    } finally {
      setLoading(false);
    }
  }

  function focus(place: Place) {
    mapRef.current?.animateToRegion(
      {
        latitude: place.latitude,
        longitude: place.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      },
      400
    );
  }

  const filteredPlaces = places.filter((p) => {
    if (p.distance > radius) return false;

    const text = (p.description + " " + p.title).toLowerCase();

    let matches = true;

    if (filter === "free") {
      matches =
        text.includes("kostenlos") || text.includes("free");
    }

    if (filter === "nature") {
      matches =
        text.includes("wald") ||
        text.includes("ruhig") ||
        text.includes("forest") ||
        text.includes("nature");
    }

    if (filter === "sanitary") {
      matches =
        text.includes("wc") ||
        text.includes("toilet") ||
        text.includes("shower") ||
        text.includes("sanitär") ||
        text.includes("dixi");
    }

    if (filter === "electric") {
      matches =
        text.includes("strom") || text.includes("electric");
    }

    if (filter === "water") {
      matches =
        text.includes("wasser") ||
        text.includes("water") ||
        text.includes("aqua");
    }

    return matches;
  });

  if (loading || !region) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>Lade Stellplätze...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* MAP */}
      <MapView ref={mapRef} style={styles.map} region={region}>
        {filteredPlaces.map((p) => (
          <Marker
            key={p.id}
            coordinate={{
              latitude: p.latitude,
              longitude: p.longitude,
            }}
            title={p.title}
            description={`${p.distance.toFixed(1)} km`}
          />
        ))}
      </MapView>

      {/* FILTER BAR */}
      <View style={styles.filterBar}>
        <Pressable
          style={[styles.filterBtn, filter === "all" && styles.active]}
          onPress={() => setFilter("all")}
        >
          <Text>🌍 Alle</Text>
        </Pressable>

        <Pressable
          style={[styles.filterBtn, filter === "free" && styles.active]}
          onPress={() => setFilter("free")}
        >
          <Text>💸 Kostenlos</Text>
        </Pressable>

        <Pressable
          style={[styles.filterBtn, filter === "nature" && styles.active]}
          onPress={() => setFilter("nature")}
        >
          <Text>🌲 Natur</Text>
        </Pressable>

        <Pressable
          style={[styles.filterBtn, filter === "sanitary" && styles.active]}
          onPress={() => setFilter("sanitary")}
        >
          <Text>🚾 Sanitär</Text>
        </Pressable>

        <Pressable
          style={[styles.filterBtn, filter === "electric" && styles.active]}
          onPress={() => setFilter("electric")}
        >
          <Text>⚡ Strom</Text>
        </Pressable>

        <Pressable
          style={[styles.filterBtn, filter === "water" && styles.active]}
          onPress={() => setFilter("water")}
        >
          <Text>🚰 Wasser</Text>
        </Pressable>
      </View>

      {/* RADIUS SLIDER */}
      <View style={styles.radiusBox}>
        <Text style={styles.radiusText}>
          📍 Radius: {radius} km
        </Text>

        <Slider
          style={{ width: "100%", height: 40 }}
          minimumValue={5}
          maximumValue={100}
          step={5}
          value={radius}
          onValueChange={setRadius}
          minimumTrackTintColor="#4A90E2"
          maximumTrackTintColor="#ccc"
        />
      </View>

      {/* CARDS */}
      <View style={styles.bottomSheet}>
        {filteredPlaces.length === 0 ? (
          <View style={{ padding: 20 }}>
            <Text>Keine Stellplätze im Filter gefunden 😕</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {filteredPlaces.map((p) => (
              <Pressable
                key={p.id}
                style={styles.card}
                onPress={() => focus(p)}
              >
                <Image
                  source={{ uri: p.image }}
                  style={styles.image}
                />

                <View style={styles.content}>
                  <Text style={styles.title} numberOfLines={1}>
                    {p.title}
                  </Text>

                  <Text style={styles.distance}>
                    📍 {p.distance.toFixed(1)} km
                  </Text>

                  <Text style={styles.desc} numberOfLines={3}>
                    {p.description}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  map: { flex: 1 },

  filterBar: {
    position: "absolute",
    top: 50,
    alignSelf: "center",
    flexDirection: "row",
    backgroundColor: "white",
    padding: 8,
    borderRadius: 20,
    elevation: 5,
  },

  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 4,
    borderRadius: 15,
    backgroundColor: "#eee",
  },

  active: {
    backgroundColor: "#cde8ff",
  },

  radiusBox: {
    position: "absolute",
    top: 110,
    alignSelf: "center",
    width: "55%",
    backgroundColor: "white",
    padding: 12,
    borderRadius: 14,
    elevation: 5,
  },

  radiusText: {
    fontWeight: "600",
    marginBottom: 4,
  },

  bottomSheet: {
    position: "absolute",
    bottom: 20,
  },

  card: {
    width: width * 0.8,
    backgroundColor: "white",
    marginHorizontal: 10,
    borderRadius: 18,
    overflow: "hidden",
    elevation: 6,
  },

  image: {
    width: "100%",
    height: 140,
    backgroundColor: "#ddd",
  },

  content: {
    padding: 12,
  },

  title: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },

  distance: {
    fontSize: 13,
    color: "#444",
    marginBottom: 6,
  },

  desc: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
  },
});