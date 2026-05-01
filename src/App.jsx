import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BluetoothConnected,
  Car,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  DownloadCloud,
  Flag,
  Fuel,
  Hotel,
  LocateFixed,
  MapPin,
  Music2,
  Navigation,
  Pause,
  Play,
  Radio,
  Route,
  RotateCw,
  Search,
  Utensils,
  Volume2,
  Zap,
} from 'lucide-react';
import './App.css';

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = window.location.origin;
const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return hash;
}

function generateRandomString(length = 64) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => ('0' + byte.toString(16)).slice(-2)).join('');
}

async function buildAuthUrl() {
  const codeVerifier = generateRandomString(64);
  const codeChallengeBuffer = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(codeChallengeBuffer);
  const state = generateRandomString(16);

  localStorage.setItem('spotify_code_verifier', codeVerifier);
  localStorage.setItem('spotify_auth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID || '',
    scope: SPOTIFY_SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
    show_dialog: 'true',
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const codeVerifier = localStorage.getItem('spotify_code_verifier');
  if (!codeVerifier) {
    return null;
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: SPOTIFY_CLIENT_ID || '',
    code_verifier: codeVerifier,
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

const MAP_START = [20, 0];
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ROUTE_COLORS = ['#1a73e8', '#188038', '#f9ab00'];
const VOICE_SCORE_HINTS = ['natural', 'online', 'google', 'microsoft', 'zira', 'aria', 'jenny', 'samantha'];
const PLACE_CATEGORIES = {
  fuel: { label: 'Fuel', icon: Fuel, query: 'node["amenity"="fuel"]' },
  food: { label: 'Food', icon: Utensils, query: 'node["amenity"~"restaurant|fast_food|cafe"]' },
  hotel: { label: 'Hotels', icon: Hotel, query: 'node["tourism"="hotel"]' },
  charge: { label: 'Charge', icon: Zap, query: 'node["amenity"="charging_station"]' },
};

const emptyTrack = {
  name: 'No track playing',
  artist: 'Connect Spotify to sync tempo',
  albumArt: '/beat.svg',
  tempo: null,
};

function readTokenFromHash() {
  return null;
}

async function processSpotifyRedirect() {
  const query = new URLSearchParams(window.location.search);
  const code = query.get('code');
  const state = query.get('state');

  if (!code) {
    return null;
  }

  const storedState = localStorage.getItem('spotify_auth_state');
  if (!storedState || storedState !== state) {
    return null;
  }

  const tokenPayload = await exchangeCodeForToken(code);
  if (!tokenPayload) {
    return null;
  }

  window.history.replaceState(null, document.title, window.location.pathname);
  return tokenPayload;
}

function formatDistance(meters = 0) {
  if (meters < 1000) {
    return `${Math.max(20, Math.round(meters / 10) * 10)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds = 0) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }

  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function formatEta(seconds = 0) {
  const eta = new Date(Date.now() + seconds * 1000);
  return eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function cleanRoadName(name) {
  return name?.trim() || '';
}

function roadPhrase(name) {
  const road = cleanRoadName(name);
  return road ? ` onto ${road}` : '';
}

function modifierPhrase(modifier = '') {
  return modifier.replace('slight ', 'slightly ').replace('sharp ', 'sharply ');
}

function instructionFromManeuver(step, index, destinationLabel) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || 'continue';
  const modifier = maneuver.modifier || '';
  const road = roadPhrase(step.name);
  const destinations = step.destinations ? ` toward ${step.destinations.replace(/,/g, ', ')}` : '';
  const exit = maneuver.exit ? `, exit ${maneuver.exit}` : '';

  if (type === 'depart') {
    return `Head ${modifier || 'out'}${road}`.trim();
  }

  if (index === 0) {
    return `Start${road || ' your route'}`;
  }

  if (type === 'arrive') {
    return `Arrive near ${destinationLabel}`;
  }

  if (type === 'turn' || type === 'end of road') {
    return `Turn ${modifierPhrase(modifier)}${road}`;
  }

  if (type === 'new name') {
    return `Continue${road}`;
  }

  if (type === 'continue') {
    return modifier ? `Continue ${modifierPhrase(modifier)}${road}` : `Continue${road || ' straight'}`;
  }

  if (type === 'merge') {
    return `Merge ${modifierPhrase(modifier)}${road}${destinations}`;
  }

  if (type === 'on ramp') {
    return `Take the ramp${road}${destinations}`;
  }

  if (type === 'off ramp') {
    return `Take the exit${road}${destinations}`;
  }

  if (type === 'fork') {
    return `Keep ${modifierPhrase(modifier)}${road}${destinations}`;
  }

  if (type === 'roundabout' || type === 'rotary') {
    return `At the roundabout, take${exit}${road}`;
  }

  if (type === 'roundabout turn') {
    return `Enter the roundabout and turn ${modifierPhrase(modifier)}${road}`;
  }

  if (type === 'notification') {
    return `Continue${road}${destinations}`;
  }

  return `${type} ${modifierPhrase(modifier)}${road}${destinations}`.trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function voiceInstruction(step) {
  if (!step) {
    return '';
  }

  const distance = step.distance ? `In ${step.distance}, ` : '';
  return `${distance}${step.cue}`;
}

function maneuverIconName(step) {
  const type = step.maneuver?.type || 'continue';
  const modifier = step.maneuver?.modifier || '';

  if (type === 'arrive') return 'arrive';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return 'roundabout';
  if (type === 'on ramp' || type === 'off ramp') return modifier.includes('left') ? 'ramp-left' : 'ramp-right';
  if (type === 'fork' || type === 'merge') return modifier.includes('left') ? 'keep-left' : 'keep-right';
  if (modifier.includes('left')) return 'left';
  if (modifier.includes('right')) return 'right';
  if (modifier.includes('uturn')) return 'uturn';
  return 'straight';
}

function ManeuverIcon({ name, size = 20 }) {
  const icons = {
    arrive: Flag,
    roundabout: RotateCw,
    left: ArrowLeft,
    right: ArrowRight,
    'ramp-left': CornerUpLeft,
    'ramp-right': CornerUpRight,
    'keep-left': CornerUpLeft,
    'keep-right': CornerUpRight,
    uturn: ArrowDown,
    straight: ArrowUp,
  };
  const Icon = icons[name] || ArrowUp;
  return <Icon size={size} />;
}

function lngLat([lat, lon]) {
  return [lon, lat];
}

function boundsFromCoords(coords) {
  const bounds = new maplibregl.LngLatBounds();
  coords.forEach((coord) => bounds.extend(lngLat(coord)));
  return bounds;
}

function makeMarker(className) {
  const element = document.createElement('div');
  element.className = `route-pin ${className}`;
  element.innerHTML = '<span></span>';
  return element;
}

function pointFeature(coords, properties = {}) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates: lngLat(coords),
    },
  };
}

function featureCollection(features = []) {
  return {
    type: 'FeatureCollection',
    features,
  };
}

function rankVoice(voice) {
  const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  return VOICE_SCORE_HINTS.reduce((score, hint) => score + (name.includes(hint) ? 3 : 0), 0) + (voice.localService ? 1 : 0);
}

function App() {
  const mapElement = useRef(null);
  const map = useRef(null);
  const locationMarker = useRef(null);
  const destinationMarker = useRef(null);
  const nearbyMarkers = useRef([]);
  const playerRef = useRef(null);
  const beatTimer = useRef(null);
  const locationWatch = useRef(null);
  const routeCoordsRef = useRef([]);
  const volumeRestoreTimer = useRef(null);

  const [spotifyToken, setSpotifyToken] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [beatSync, setBeatSync] = useState(false);
  const [tempo, setTempo] = useState(null);
  const [beatCount, setBeatCount] = useState(0);
  const [bars, setBars] = useState(() => Array(18).fill(16));
  const [track, setTrack] = useState(emptyTrack);
  const [status, setStatus] = useState('Use GPS and search for a destination');
  const [activeStep, setActiveStep] = useState(0);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [locationStatus, setLocationStatus] = useState('GPS idle');
  const [destination, setDestination] = useState(null);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeSteps, setRouteSteps] = useState([]);
  const [routeSummary, setRouteSummary] = useState({ distance: '--', duration: '--', eta: '--' });
  const [isNavigating, setIsNavigating] = useState(false);
  const [duckingEnabled, setDuckingEnabled] = useState(true);
  const [playlistSuggestions, setPlaylistSuggestions] = useState([]);
  const [nearbyCategory, setNearbyCategory] = useState('fuel');
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [offlineReady, setOfflineReady] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState('');
  const [voiceRate, setVoiceRate] = useState(0.98);

  const effectiveTempo = tempo || 112;
  const secondsPerBeat = useMemo(() => 60 / effectiveTempo, [effectiveTempo]);
  const clientConfigured = Boolean(SPOTIFY_CLIENT_ID);
  const currentStep = routeSteps[Math.min(activeStep, routeSteps.length - 1)];
  const upcomingStep = routeSteps[Math.min(activeStep + 1, routeSteps.length - 1)] || currentStep;

  const enterNavigationMode = useCallback(() => {
    if (!routeCoordsRef.current.length) {
      setStatus('Calculate a route before starting');
      return;
    }

    setIsNavigating(true);
    setStatus('Navigation started');

    const anchor = currentPosition || routeCoordsRef.current[0];
    map.current?.flyTo({
      center: lngLat(anchor),
      zoom: 17,
      pitch: 68,
      bearing: -18,
      offset: [0, 170],
      duration: 900,
    });
  }, [currentPosition]);

  const exitNavigationMode = useCallback(() => {
    setIsNavigating(false);
    setStatus('Navigation stopped');
    if (routes[selectedRouteIndex]) {
      map.current?.fitBounds(boundsFromCoords(routes[selectedRouteIndex].coords), {
        padding: { top: 140, right: 470, bottom: 80, left: 70 },
        pitch: 58,
        bearing: -18,
        duration: 700,
      });
    }
  }, [routes, selectedRouteIndex]);

  const drawRoutes = useCallback((nextRoutes, activeIndex) => {
    if (!map.current?.getSource('routes')) {
      return;
    }

    const routeFeatures = nextRoutes.map((route, index) => ({
      type: 'Feature',
      properties: {
        color: ROUTE_COLORS[index % ROUTE_COLORS.length],
        active: index === activeIndex,
        sort: index === activeIndex ? 2 : 1,
      },
      geometry: {
        type: 'LineString',
        coordinates: route.coords.map(lngLat),
      },
    }));

    map.current.getSource('routes').setData(featureCollection(routeFeatures));

    if (nextRoutes[activeIndex]) {
      routeCoordsRef.current = nextRoutes[activeIndex].coords;
      map.current.fitBounds(boundsFromCoords(nextRoutes[activeIndex].coords), {
        padding: { top: 140, right: 470, bottom: 80, left: 70 },
        pitch: 58,
        bearing: -18,
        duration: 700,
      });
    }
  }, []);

  const selectRoute = useCallback((index, nextRoutes = routes) => {
    const route = nextRoutes[index];
    if (!route) {
      return;
    }

    setSelectedRouteIndex(index);
    setRouteSteps(route.steps);
    setRouteSummary(route.summary);
    setActiveStep(0);
    drawRoutes(nextRoutes, index);
    setStatus(`${route.label} selected`);
  }, [drawRoutes, routes]);

  const duckVolume = useCallback(async () => {
    if (!duckingEnabled || !playerRef.current?.setVolume) {
      return;
    }

    window.clearTimeout(volumeRestoreTimer.current);
    await playerRef.current.setVolume(0.24);
    volumeRestoreTimer.current = window.setTimeout(() => {
      playerRef.current?.setVolume?.(0.75);
    }, 3400);
  }, [duckingEnabled]);

  const speakOnBeat = useCallback(async (message) => {
    if (!('speechSynthesis' in window)) {
      return;
    }

    await duckVolume();
    const utterance = new SpeechSynthesisUtterance(message);
    const selectedVoice = voices.find((voice) => voice.name === selectedVoiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    utterance.rate = voiceRate;
    utterance.pitch = 1;
    utterance.volume = 0.9;
    utterance.onend = () => {
      window.clearTimeout(volumeRestoreTimer.current);
      if (duckingEnabled) {
        playerRef.current?.setVolume?.(0.75);
      }
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [duckVolume, duckingEnabled, selectedVoiceName, voiceRate, voices]);

  const calculateRoute = useCallback(async (origin = currentPosition, target = destination) => {
    if (!origin || !target) {
      setStatus(!origin ? 'Start GPS to route from here' : 'Search and pick a destination');
      return;
    }

    const coordinates = `${origin[1]},${origin[0]};${target.coords[1]},${target.coords[0]}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?alternatives=3&overview=full&geometries=geojson&steps=true`;

    try {
      setStatus('Calculating live routes');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Routing failed');
      }

      const data = await response.json();
      const parsedRoutes = (data.routes || []).slice(0, 3).map((route, routeIndex) => {
        const steps = route.legs
          .flatMap((leg) => leg.steps)
          .filter((step) => step.distance > 12 || step.maneuver?.type === 'arrive')
          .slice(0, 12)
          .map((step, index) => ({
            distance: formatDistance(step.distance),
            cue: instructionFromManeuver(step, index, target.label),
            road: cleanRoadName(step.name),
            destinations: step.destinations || '',
            mode: maneuverIconName(step),
            detail: [cleanRoadName(step.name), step.destinations].filter(Boolean).join(' · '),
            beat: (index + 1) * 8,
          }));

        return {
          label: routeIndex === 0 ? 'Best route' : `Alternative ${routeIndex}`,
          coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
          steps,
          summary: {
            distance: formatDistance(route.distance),
            duration: formatDuration(route.duration),
            eta: formatEta(route.duration),
          },
        };
      });

      if (!parsedRoutes.length) {
        throw new Error('No route returned');
      }

      setRoutes(parsedRoutes);
      selectRoute(0, parsedRoutes);
      setStatus('Routes ready');
    } catch {
      setStatus('Could not calculate a route from the current position');
      setRoutes([]);
      setRouteSteps([]);
    }
  }, [currentPosition, destination, selectRoute]);

  const searchDestination = useCallback(async (event) => {
    event?.preventDefault();
    if (!destinationQuery.trim()) {
      setStatus('Enter a destination');
      return;
    }

    try {
      setStatus('Searching places');
      const params = new URLSearchParams({
        q: destinationQuery.trim(),
        format: 'jsonv2',
        limit: '5',
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const results = await response.json();
      setSearchResults(
        results.map((result) => ({
          id: result.place_id,
          label: result.display_name,
          coords: [Number(result.lat), Number(result.lon)],
        })),
      );
      setStatus(results.length ? 'Pick a destination' : 'No places found');
    } catch {
      setStatus('Destination search failed');
    }
  }, [destinationQuery]);

  const chooseDestination = useCallback((place) => {
    setDestination(place);
    setDestinationQuery(place.label.split(',')[0]);
    setSearchResults([]);

    if (destinationMarker.current) {
      destinationMarker.current.setLngLat(lngLat(place.coords));
    } else if (map.current) {
      destinationMarker.current = new maplibregl.Marker({ element: makeMarker('end-pin'), anchor: 'center' })
        .setLngLat(lngLat(place.coords))
        .addTo(map.current);
    }

    if (map.current) {
      map.current.flyTo({
        center: lngLat(place.coords),
        zoom: Math.max(map.current.getZoom(), 13),
        pitch: 58,
        bearing: -18,
      });
    }

    calculateRoute(currentPosition, place);
  }, [calculateRoute, currentPosition]);

  const startLocationTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus('Geolocation unavailable');
      setStatus('Browser location unavailable');
      return;
    }

    if (locationWatch.current) {
      navigator.geolocation.clearWatch(locationWatch.current);
    }

    setLocationStatus('Locating...');
    locationWatch.current = navigator.geolocation.watchPosition(
      (position) => {
        const coords = [position.coords.latitude, position.coords.longitude];
        setCurrentPosition(coords);
        setLocationStatus(`GPS +/- ${Math.round(position.coords.accuracy)}m`);

        if (locationMarker.current) {
          locationMarker.current.setLngLat(lngLat(coords));
        } else if (map.current) {
          locationMarker.current = new maplibregl.Marker({ element: makeMarker('start-pin'), anchor: 'center' })
            .setLngLat(lngLat(coords))
            .addTo(map.current);
        }

        if (map.current?.getSource('accuracy')) {
          map.current.getSource('accuracy').setData(pointFeature(coords, { radius: position.coords.accuracy || 0 }));
        }

        if (!routes.length) {
          map.current?.flyTo({ center: lngLat(coords), zoom: 15, pitch: 58, bearing: -18 });
        }

        if (isNavigating) {
          map.current?.easeTo({
            center: lngLat(coords),
            zoom: 17,
            pitch: 68,
            bearing: position.coords.heading || map.current.getBearing(),
            offset: [0, 170],
            duration: 650,
          });
        }

        if (destination) {
          calculateRoute(coords, destination);
        }
      },
      () => {
        setLocationStatus('Location blocked');
        setStatus('Allow browser location to route from GPS');
      },
      { enableHighAccuracy: true, maximumAge: 6000, timeout: 12000 },
    );
  }, [calculateRoute, destination, isNavigating, routes.length]);

  const recenter = () => {
    if (currentPosition && map.current) {
      map.current.flyTo({
        center: lngLat(currentPosition),
        zoom: isNavigating ? 17 : 16,
        pitch: isNavigating ? 68 : 62,
        bearing: isNavigating ? map.current.getBearing() : -18,
        offset: isNavigating ? [0, 170] : [0, 0],
      });
      setStatus('Centered on your location');
    } else {
      startLocationTracking();
    }
  };

  const loadNearbyPlaces = useCallback(async (category = nearbyCategory) => {
    const anchor = currentPosition || destination?.coords;
    if (!anchor) {
      setStatus('Use GPS or choose a destination first');
      return;
    }

    const categoryConfig = PLACE_CATEGORIES[category];
    const query = `
      [out:json][timeout:12];
      (
        ${categoryConfig.query}(around:5000,${anchor[0]},${anchor[1]});
      );
      out body 12;
    `;

    try {
      setStatus(`Finding nearby ${categoryConfig.label.toLowerCase()}`);
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
      });
      const data = await response.json();
      const places = (data.elements || []).slice(0, 8).map((place) => ({
        id: place.id,
        label: place.tags?.name || categoryConfig.label,
        coords: [place.lat, place.lon],
        category,
      }));

      setNearbyPlaces(places);
      nearbyMarkers.current.forEach((marker) => marker.remove());
      nearbyMarkers.current = [];
      places.forEach((place) => {
        const marker = new maplibregl.Marker({ element: makeMarker('poi-pin'), anchor: 'center' })
          .setLngLat(lngLat(place.coords))
          .setPopup(new maplibregl.Popup({ offset: 18 }).setText(place.label))
          .addTo(map.current);
        nearbyMarkers.current.push(marker);
      });
      setStatus(places.length ? `${categoryConfig.label} nearby` : `No ${categoryConfig.label.toLowerCase()} found nearby`);
    } catch {
      setStatus('Nearby search failed');
    }
  }, [currentPosition, destination, nearbyCategory]);

  const fetchCurrentTrack = useCallback(async () => {
    if (!spotifyToken) {
      setStatus('Connect Spotify to sync tempo');
      return;
    }

    const currentResponse = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${spotifyToken}` },
    });

    if (currentResponse.status === 204) {
      setStatus('Start Spotify playback to fetch tempo');
      return;
    }

    if (!currentResponse.ok) {
      setStatus('Could not read current Spotify track');
      return;
    }

    const current = await currentResponse.json();
    const trackId = current.item?.id;
    if (!trackId) {
      setStatus('No playable track detected');
      return;
    }

    setTrack({
      name: current.item.name,
      artist: current.item.artists.map((artist) => artist.name).join(', '),
      albumArt: current.item.album.images?.[0]?.url || emptyTrack.albumArt,
      id: trackId,
      tempo,
    });

    const featuresResponse = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
      headers: { Authorization: `Bearer ${spotifyToken}` },
    });

    if (!featuresResponse.ok) {
      setStatus('Tempo unavailable for this track');
      return;
    }

    const features = await featuresResponse.json();
    const roundedTempo = Math.round(features.tempo || effectiveTempo);
    setTempo(roundedTempo);
    setTrack((currentTrack) => ({ ...currentTrack, tempo: roundedTempo }));
    setStatus(`Locked to ${roundedTempo} BPM`);
  }, [effectiveTempo, spotifyToken, tempo]);

  const refreshPlaylistSuggestions = useCallback(async () => {
    if (!spotifyToken || !tempo) {
      setPlaylistSuggestions([]);
      setStatus('Connect Spotify and load a track first');
      return;
    }

    try {
      const query = encodeURIComponent(`${tempo} bpm driving`);
      const response = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=playlist&limit=3`, {
        headers: { Authorization: `Bearer ${spotifyToken}` },
      });

      if (!response.ok) {
        throw new Error('Spotify search failed');
      }

      const data = await response.json();
      const playlists = data.playlists?.items?.filter(Boolean) || [];
      setPlaylistSuggestions(
        playlists.map((playlist, index) => ({
          name: playlist.name,
          artist: playlist.owner?.display_name || 'Spotify playlist',
          tempo: tempo + [-3, 0, 4][index],
          note: 'Spotify playlist match',
          url: playlist.external_urls?.spotify,
        })),
      );
      setStatus(playlists.length ? 'Spotify playlist suggestions ready' : 'No playlist matches found');
    } catch {
      setStatus('Playlist search failed');
    }
  }, [spotifyToken, tempo]);

  const connectSpotify = () => {
    if (!clientConfigured) {
      setStatus('Add VITE_SPOTIFY_CLIENT_ID to .env first');
      return;
    }
    window.location.href = buildAuthUrl();
  };

  const togglePlayback = async () => {
    if (!spotifyToken || !deviceId) {
      setStatus('Connect Spotify playback first');
      return;
    }

    const endpoint = isPlaying ? 'pause' : 'play';
    await fetch(`https://api.spotify.com/v1/me/player/${endpoint}?device_id=${deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${spotifyToken}` },
    });
    setIsPlaying((playing) => !playing);
  };

  const toggleBeatSync = async () => {
    if (!routeSteps.length) {
      setStatus('Calculate a route before beat sync');
      return;
    }

    if (!beatSync) {
      await fetchCurrentTrack();
      setBeatCount(0);
      setActiveStep(0);
      setStatus('Beat sync enabled');
    } else {
      setStatus('Beat sync paused');
    }

    setBeatSync((enabled) => !enabled);
  };

  useEffect(() => {
    const tokenPayload = readTokenFromHash();
    if (tokenPayload) {
      localStorage.setItem('beatmaps_spotify_token', JSON.stringify(tokenPayload));
      setSpotifyToken(tokenPayload.token);
      setStatus('Spotify connected');
      return;
    }

    const stored = localStorage.getItem('beatmaps_spotify_token');
    if (!stored) {
      return;
    }

    try {
      const payload = JSON.parse(stored);
      if (payload.expiresAt > Date.now()) {
        setSpotifyToken(payload.token);
        setStatus('Spotify session restored');
      } else {
        localStorage.removeItem('beatmaps_spotify_token');
      }
    } catch {
      localStorage.removeItem('beatmaps_spotify_token');
    }
  }, []);

  useEffect(() => {
    if (!mapElement.current || map.current) {
      return;
    }

    const initializedMap = new maplibregl.Map({
      container: mapElement.current,
      style: OPENFREEMAP_STYLE,
      center: lngLat(MAP_START),
      zoom: 2.2,
      pitch: 45,
      bearing: -12,
      attributionControl: false,
      antialias: true,
    });

    initializedMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    initializedMap.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
      'bottom-left',
    );

    initializedMap.on('load', () => {
      initializedMap.addSource('routes', {
        type: 'geojson',
        data: featureCollection(),
      });

      initializedMap.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'routes',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          'line-sort-key': ['get', 'sort'],
        },
        paint: {
          'line-color': ['case', ['get', 'active'], '#ffffff', '#7a8699'],
          'line-width': ['case', ['get', 'active'], 12, 8],
          'line-opacity': ['case', ['get', 'active'], 0.95, 0.38],
        },
      });

      initializedMap.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'routes',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          'line-sort-key': ['get', 'sort'],
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'active'], 7, 4],
          'line-opacity': ['case', ['get', 'active'], 0.98, 0.58],
        },
      });

      initializedMap.addSource('accuracy', {
        type: 'geojson',
        data: pointFeature(MAP_START, { radius: 0 }),
      });

      initializedMap.addLayer({
        id: 'accuracy-circle',
        type: 'circle',
        source: 'accuracy',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 16, 16, 44],
          'circle-color': '#1a73e8',
          'circle-opacity': 0.12,
          'circle-stroke-color': '#1a73e8',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.35,
        },
      });
    });

    map.current = initializedMap;

    return () => {
      nearbyMarkers.current.forEach((marker) => marker.remove());
      locationMarker.current?.remove();
      destinationMarker.current?.remove();
      initializedMap.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      return undefined;
    }

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis
        .getVoices()
        .filter((voice) => voice.lang.toLowerCase().startsWith('en'))
        .sort((first, second) => rankVoice(second) - rankVoice(first));

      setVoices(availableVoices);
      setSelectedVoiceName((current) => current || availableVoices[0]?.name || '');
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setOfflineReady(false);
      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        setOfflineReady(Boolean(registration.active || registration.installing || registration.waiting));
      })
      .catch(() => setOfflineReady(false));
  }, []);

  useEffect(() => {
    if (!spotifyToken || window.Spotify) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);
  }, [spotifyToken]);

  useEffect(() => {
    if (!spotifyToken) {
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'BeatMaps Cockpit',
        getOAuthToken: (callback) => callback(spotifyToken),
        volume: 0.75,
      });

      player.addListener('ready', ({ device_id }) => {
        setDeviceId(device_id);
        setIsReady(true);
        setStatus('Playback device ready');
      });

      player.addListener('not_ready', () => {
        setIsReady(false);
        setStatus('Playback device went offline');
      });

      player.addListener('player_state_changed', (state) => {
        if (!state) {
          return;
        }

        const current = state.track_window.current_track;
        setIsPlaying(!state.paused);
        setTrack({
          name: current.name,
          artist: current.artists.map((artist) => artist.name).join(', '),
          albumArt: current.album.images?.[0]?.url || emptyTrack.albumArt,
          id: current.id,
          tempo,
        });
      });

      player.connect();
      playerRef.current = player;
    };

    if (window.Spotify && !playerRef.current) {
      window.onSpotifyWebPlaybackSDKReady();
    }

    return () => {
      window.onSpotifyWebPlaybackSDKReady = null;
    };
  }, [spotifyToken, tempo]);

  useEffect(() => {
    if (!beatSync) {
      window.clearInterval(beatTimer.current);
      return;
    }

    beatTimer.current = window.setInterval(() => {
      setBeatCount((count) => count + 1);
      setBars(
        Array.from({ length: 18 }, (_, index) => {
          const phase = (index % 4) * 14;
          return Math.round(28 + Math.random() * 44 + phase);
        }),
      );
    }, secondsPerBeat * 1000);

    return () => window.clearInterval(beatTimer.current);
  }, [beatSync, secondsPerBeat]);

  useEffect(() => {
    if (!beatSync) {
      return;
    }

    const nextCueIndex = routeSteps.findIndex((step) => step.beat === beatCount);
    if (nextCueIndex >= 0) {
      setActiveStep(nextCueIndex);
      speakOnBeat(voiceInstruction(routeSteps[nextCueIndex]));
      setStatus(`Cue fired on beat ${beatCount}`);
    }

    if (locationMarker.current && routeCoordsRef.current.length) {
      const routeIndex = Math.min(routeCoordsRef.current.length - 1, Math.floor((beatCount / 64) * routeCoordsRef.current.length));
      locationMarker.current.setLngLat(lngLat(routeCoordsRef.current[routeIndex]));
      if (isNavigating) {
        map.current?.easeTo({
          center: lngLat(routeCoordsRef.current[routeIndex]),
          zoom: 17,
          pitch: 68,
          bearing: -18,
          offset: [0, 170],
          duration: 500,
        });
      }
    }
  }, [beatCount, beatSync, isNavigating, routeSteps, speakOnBeat]);

  useEffect(() => () => {
    if (locationWatch.current) {
      navigator.geolocation.clearWatch(locationWatch.current);
    }
  }, []);

  return (
    <main className={`app-shell ${isNavigating ? 'navigation-mode' : ''}`}>
      <section className="map-stage" aria-label="Navigation map">
        <div ref={mapElement} className="map-canvas" />
        <div className="drive-overlay">
          <div className="route-banner">
            <div className="maneuver-icon">
              {currentStep ? <ManeuverIcon name={currentStep.mode} size={34} /> : <Navigation size={34} />}
            </div>
            <div>
              <span className="eyebrow">{routeSteps.length ? 'Next turn' : 'Trip planner'}</span>
              <h1>{currentStep?.cue || 'Choose a destination'}</h1>
              <p>{currentStep ? `${currentStep.distance} before maneuver` : 'Start GPS, search a place, then route'}</p>
            </div>
          </div>
          <div className="speed-pill">
            <Activity size={18} />
            <span>{routeSummary.duration} · ETA {routeSummary.eta}</span>
          </div>
        </div>
        {routeSteps.length > 0 && (
          <div className="nav-action-bar">
            <button className="start-nav-button" onClick={isNavigating ? exitNavigationMode : enterNavigationMode}>
              {isNavigating ? <Pause size={22} /> : <Navigation size={22} />}
              <span>{isNavigating ? 'Stop' : 'Start'}</span>
            </button>
          </div>
        )}
        <button className="map-action" onClick={recenter} title="Recenter map">
          <LocateFixed size={24} />
        </button>
      </section>

      <aside className="cockpit" aria-label="BeatMaps controls">
        <header className="brand-row">
          <img src="/beat.svg" alt="" />
          <div>
            <span className="eyebrow">BeatMaps</span>
            <strong>Travel Navigator</strong>
          </div>
        </header>

        <form className="search-panel" onSubmit={searchDestination}>
          <label>
            <Search size={19} />
            <input
              value={destinationQuery}
              onChange={(event) => setDestinationQuery(event.target.value)}
              placeholder="Search destination"
            />
          </label>
          <button type="submit">Search</button>
        </form>

        {searchResults.length > 0 && (
          <section className="result-list">
            {searchResults.map((place) => (
              <button key={place.id} onClick={() => chooseDestination(place)}>
                <MapPin size={17} />
                <span>{place.label}</span>
              </button>
            ))}
          </section>
        )}

        <section className="trip-summary">
          <div>
            <strong>{routeSummary.duration}</strong>
            <span>Drive time</span>
          </div>
          <div>
            <strong>{routeSummary.distance}</strong>
            <span>Distance</span>
          </div>
          <div>
            <strong>{routeSummary.eta}</strong>
            <span>Arrival</span>
          </div>
        </section>

        {routes.length > 0 && (
          <section className="route-modes" aria-label="Route options">
            {routes.map((route, index) => (
              <button
                key={`${route.label}-${route.summary.duration}`}
                className={selectedRouteIndex === index ? 'selected' : ''}
                onClick={() => selectRoute(index)}
              >
                <strong>{route.label}</strong>
                <span>{route.summary.duration} · {route.summary.distance}</span>
              </button>
            ))}
          </section>
        )}

        <section className="controls">
          <button className="primary-button" onClick={connectSpotify}>
            <BluetoothConnected size={22} />
            <span>{spotifyToken ? 'Spotify Connected' : 'Connect Spotify'}</span>
          </button>
          <div className="button-grid">
            <button className="icon-button" onClick={togglePlayback} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause size={26} /> : <Play size={26} />}
            </button>
            <button className={`icon-button ${beatSync ? 'active' : ''}`} onClick={toggleBeatSync} title="Beat sync">
              <Radio size={26} />
            </button>
            <button className="icon-button" onClick={fetchCurrentTrack} title="Refresh tempo">
              <Music2 size={26} />
            </button>
            <button className="icon-button" onClick={startLocationTracking} title="Use current location">
              <LocateFixed size={26} />
            </button>
            <button
              className={`icon-button ${duckingEnabled ? 'active' : ''}`}
              onClick={() => setDuckingEnabled((enabled) => !enabled)}
              title="Audio ducking"
            >
              <Volume2 size={26} />
            </button>
            <button className="icon-button" onClick={refreshPlaylistSuggestions} title="Find BPM playlists">
              <DownloadCloud size={26} />
            </button>
          </div>
        </section>

        <section className="status-strip">
          <div>
            <Compass size={19} />
            <span>{status}</span>
          </div>
          <div>
            <LocateFixed size={19} />
            <span>{locationStatus}</span>
          </div>
          <div>
            <Volume2 size={19} />
            <span>{duckingEnabled ? 'Ducking on' : 'Ducking off'}</span>
          </div>
          <div>
            <DownloadCloud size={19} />
            <span>{offlineReady ? 'Offline cache armed' : 'Cache pending'}</span>
          </div>
        </section>

        <section className="track-card compact">
          <img src={track.albumArt} alt="" className="album-art" />
          <div className="track-copy">
            <span className="eyebrow">Music sync</span>
            <h2>{track.name}</h2>
            <p>{tempo ? `${track.artist} · ${tempo} BPM` : track.artist}</p>
          </div>
        </section>

        <section className="voice-panel">
          <div className="section-title">
            <Volume2 size={20} />
            <span>Voice Guidance</span>
          </div>
          <label>
            <span>Voice</span>
            <select value={selectedVoiceName} onChange={(event) => setSelectedVoiceName(event.target.value)}>
              {voices.length === 0 ? (
                <option value="">System default</option>
              ) : (
                voices.map((voice) => (
                  <option value={voice.name} key={voice.voiceURI}>
                    {voice.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            <span>Pace</span>
            <input
              type="range"
              min="0.82"
              max="1.18"
              step="0.02"
              value={voiceRate}
              onChange={(event) => setVoiceRate(Number(event.target.value))}
            />
          </label>
          <button type="button" onClick={() => speakOnBeat(currentStep ? voiceInstruction(currentStep) : 'Voice guidance ready')}>
            Test Voice
          </button>
        </section>

        <section className="visualizer" aria-label="Tempo visualizer">
          {bars.map((height, index) => (
            <span
              key={index}
              className={beatCount % 4 === 0 ? 'beat-hot' : ''}
              style={{ height: `${height}%` }}
            />
          ))}
        </section>

        <section className="nearby-panel">
          <div className="section-title">
            <MapPin size={20} />
            <span>Travel Stops</span>
          </div>
          <div className="category-grid">
            {Object.entries(PLACE_CATEGORIES).map(([key, category]) => {
              const Icon = category.icon;
              return (
                <button
                  key={key}
                  className={nearbyCategory === key ? 'selected' : ''}
                  onClick={() => {
                    setNearbyCategory(key);
                    loadNearbyPlaces(key);
                  }}
                >
                  <Icon size={18} />
                  <span>{category.label}</span>
                </button>
              );
            })}
          </div>
          {nearbyPlaces.length > 0 && (
            <div className="nearby-list">
              {nearbyPlaces.map((place) => (
                <button key={place.id} onClick={() => chooseDestination(place)}>
                  <span>{place.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="route-list">
          <div className="section-title">
            <Route size={20} />
            <span>Turns</span>
          </div>
          {routeSteps.length === 0 ? (
            <div className="empty-state">No route yet</div>
          ) : (
            routeSteps.map((step, index) => (
              <div className={`route-step ${index === activeStep ? 'current' : ''}`} key={`${step.cue}-${step.beat}`}>
                <ManeuverIcon name={step.mode} size={20} />
                <div>
                  <strong>{step.cue}</strong>
                  <span>{step.distance}{step.detail ? ` · ${step.detail}` : ''} · beat {step.beat}</span>
                </div>
              </div>
            ))
          )}
        </section>

        {playlistSuggestions.length > 0 && (
          <section className="playlist-list">
            <div className="section-title">
              <Music2 size={20} />
              <span>BPM Suggestions</span>
            </div>
            {playlistSuggestions.map((suggestion) => (
              <a
                className="playlist-item"
                href={suggestion.url}
                target="_blank"
                rel="noreferrer"
                key={`${suggestion.name}-${suggestion.tempo}`}
              >
                <strong>{suggestion.name}</strong>
                <span>{suggestion.artist} · {suggestion.tempo} BPM · {suggestion.note}</span>
              </a>
            ))}
          </section>
        )}

        <footer className="drive-footer">
          <Car size={20} />
          <span>{upcomingStep ? `Next: ${upcomingStep.cue}` : 'Ready for a real trip'}</span>
          <LocateFixed size={20} />
        </footer>
      </aside>
    </main>
  );
}

export default App;
