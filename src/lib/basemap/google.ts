// Google Maps basemap for the control room, through Google's Map Tiles API (2D roadmap tiles + live traffic)
// drawn as a raster layer under the app's own layers. Needs NEXT_PUBLIC_GOOGLE_MAPS_KEY with the Map Tiles API
// enabled and billing on; without it the control room keeps the free OpenFreeMap basemap.
// The key travels with every tile request, so restrict it to your domains (HTTP referrers) in Google Cloud.

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const API = "https://tile.googleapis.com";

export const googleAvailable = Boolean(KEY);

// muted night palette so the risk colours stay the brightest thing on the map
const NIGHT = [
  { elementType: "geometry", stylers: [{ color: "#0b1520" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ea2b6" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1520" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#0e1a26" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0f2620" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#24323f" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#2e3e50" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3b4c5f" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1d2935" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b2a45" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#6fa9d6" }] },
];

export interface GoogleSession { tiles: string[]; session: string }

/** Starts a tile session for one theme. Traffic is Google's live traffic, the only real-time data in the app. */
export async function googleSession(dark: boolean): Promise<GoogleSession> {
  const res = await fetch(`${API}/v1/createSession?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mapType: "roadmap", language: "en-IN", region: "IN", scale: "scaleFactor2x", highDpi: true,
      layerTypes: ["layerTraffic"], ...(dark ? { styles: NIGHT } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Google Map Tiles: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { session } = (await res.json()) as { session: string };
  return { session, tiles: [`${API}/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${KEY}`] };
}

/** Google's copyright line for the visible area; Google's terms require showing it with the tiles. */
export async function googleCopyright(session: string, zoom: number, b: { north: number; south: number; east: number; west: number }) {
  const q = new URLSearchParams({ session, key: KEY ?? "", zoom: String(Math.round(zoom)),
    north: String(b.north), south: String(b.south), east: String(b.east), west: String(b.west) });
  const res = await fetch(`${API}/tile/v1/viewport?${q}`);
  if (!res.ok) return "Map data ©Google";
  const { copyright } = (await res.json()) as { copyright?: string };
  return copyright ? `©Google ${copyright}` : "Map data ©Google";
}
