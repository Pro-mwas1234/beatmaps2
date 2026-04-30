# BeatMaps - Rhythmic GPS Navigation

Navigate to the rhythm. BeatMaps pairs live location, destination search, turn-by-turn routing, Spotify playback state, track tempo, beat-synced spoken cues, and a music visualizer.

## Features

- MapLibre GL rendering with OpenFreeMap vector maps, no API key required
- Pitched vector-map styling with high-contrast navigation route overlays
- Spotify OAuth and Web Playback SDK integration
- Tempo lookup from Spotify audio features when available
- Beat-scheduled voice navigation cues
- Selectable browser/system voice guidance with pace control
- Real-time Geolocation API tracking
- Destination search with OpenStreetMap Nominatim
- OSRM route calculation with live alternatives from the GPS position
- Route choice cards with ETA, distance, and turn list
- Nearby travel stops for fuel, food, hotels, and EV charging via Overpass
- Spotify audio ducking while spoken directions play
- BPM-based playlist suggestions
- Service worker caching for the app shell, route responses, and map tiles where supported
- Animated tempo visualizer
- Large, dark, car-optimized controls
- Optional Express proxy for Spotify tempo requests

## Prerequisites

- Node.js 16 or newer
- Spotify Developer app
- Spotify Premium account for Web Playback SDK playback

## Setup

Create an environment file:

```bash
cp .env.example .env
```

Add your Spotify client ID:

```env
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
```

In the Spotify Developer Dashboard, add this redirect URI for local development:

```text
http://localhost:3000
```

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Enhanced Driving Controls

- Search box: find a destination and select a result.
- Crosshair button: starts live location tracking. The browser will ask for location permission.
- Route cards: pick among OSRM route alternatives when available.
- Speaker button: toggles audio ducking for spoken directions.
- Cloud download button: refreshes BPM-based playlist suggestions.
- Travel Stops: finds nearby fuel, food, hotels, or charging stations around your GPS position or selected destination.
- Offline cache status: shows whether the service worker has registered. Cached maps only work after tiles have been viewed once.

## Optional Backend

The frontend can call Spotify directly. The optional Express server exposes a small proxy endpoint:

```bash
npm run server
```

Health check:

```text
http://localhost:5000/health
```

Tempo proxy:

```text
GET /api/spotify/audio-features/:trackId
Authorization: Bearer <spotify_access_token>
```

## Notes

- Spotify Web Playback requires Premium.
- Spotify redirect URLs must exactly match the app URL.
- Production Spotify callbacks must use HTTPS.
- Live routing requires browser location permission and public OpenStreetMap/OSRM/Overpass connectivity.

## Scripts

- `npm run dev` starts the Vite dev server on port 3000.
- `npm run build` creates a production build in `dist`.
- `npm run preview` previews the production build.
- `npm run server` starts the optional Express server.
