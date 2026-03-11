import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  MessageCircle,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  addCommentToRun,
  deletePhotoFromRun,
  deleteRun,
  fetchRuns,
  isCloudEnabled,
  isOnline,
  saveRun,
  subscribeToRuns,
  syncPendingRuns,
  updateRunComments,
  updateRun,
} from './data/runStore';

const initialRuns = [];
const ACCESS_CODE = '0104';
const ACCESS_STORAGE_KEY = 'runmate:access';
const ACCESS_USER_STORAGE_KEY = 'runmate:user';
const ACCESS_USERS = ['Mariame', 'Anass'];
const RUNS_PAGE_SIZE = 6;
const CREATE_STEPS = ['Details', 'Photos', 'Route'];
const MIN_RUN_DATE = '2025-01-01';
const MAX_TITLE_LENGTH = 60;
const MAX_LOCATION_LENGTH = 80;
const MAX_NOTE_LENGTH = 280;
const MAX_DISTANCE_KM = 500;
const MAX_DURATION_MINUTES = 1440;
const MAX_PHOTOS = 12;
const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAP_CENTER = [34.0209, -6.8416];
const DEFAULT_WEATHER_LOCATION = {
  name: 'Current area',
  latitude: DEFAULT_MAP_CENTER[0],
  longitude: DEFAULT_MAP_CENTER[1],
};
const mapPinIcon = L.divIcon({
  className: 'map-pin-icon',
  html: '<span class="map-pin-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const mapEndPinIcon = L.divIcon({
  className: 'map-pin-icon map-pin-icon-end',
  html: '<span class="map-pin-dot map-pin-dot-end"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function parseCoordinate(value) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCoordinate(value) {
  const numeric = parseCoordinate(value);
  return numeric == null ? '' : String(numeric);
}

function isValidLatitude(value) {
  return value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return value >= -180 && value <= 180;
}

function calculateRouteDistanceKm(start, end) {
  if (!start || !end) {
    return null;
  }

  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(end[0] - start[0]);
  const deltaLng = toRadians(end[1] - start[1]);
  const lat1 = toRadians(start[0]);
  const lat2 = toRadians(end[0]);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return earthRadiusKm * arc;
}

function formatRouteDistance(distanceKm) {
  return distanceKm == null ? '--' : `${distanceKm.toFixed(2)} km`;
}

function getRouteFromInputs(startLat, startLng, endLat, endLng) {
  const parsedStartLat = parseCoordinate(startLat);
  const parsedStartLng = parseCoordinate(startLng);
  const parsedEndLat = parseCoordinate(endLat);
  const parsedEndLng = parseCoordinate(endLng);
  const start =
    parsedStartLat != null && parsedStartLng != null ? [parsedStartLat, parsedStartLng] : null;
  const end = parsedEndLat != null && parsedEndLng != null ? [parsedEndLat, parsedEndLng] : null;

  const hasAnyStart = parsedStartLat != null || parsedStartLng != null;
  const hasAnyEnd = parsedEndLat != null || parsedEndLng != null;

  if (!hasAnyStart && !hasAnyEnd) {
    return null;
  }

  if (
    parsedStartLat == null ||
    parsedStartLng == null ||
    parsedEndLat == null ||
    parsedEndLng == null
  ) {
    return {
      status: 'partial',
      start,
      end,
      distanceKm: null,
    };
  }

  if (!isValidLatitude(parsedStartLat) || !isValidLatitude(parsedEndLat)) {
    return {
      status: 'invalid-latitude',
      start: null,
      end: null,
      distanceKm: null,
    };
  }

  if (!isValidLongitude(parsedStartLng) || !isValidLongitude(parsedEndLng)) {
    return {
      status: 'invalid-longitude',
      start: null,
      end: null,
      distanceKm: null,
    };
  }

  return {
    status: 'ready',
    start,
    end,
    distanceKm: calculateRouteDistanceKm(start, end),
  };
}

function getCurrentTimeValue() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getTodayDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatRunDate(dateString, timeString) {
  if (!dateString) {
    return '';
  }

  const date = new Date(`${dateString}T${timeString || '00:00'}`);
  if (Number.isNaN(date.getTime())) {
    return `${dateString} ${timeString}`.trim();
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatMonthLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatCalendarKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function buildCalendarDays(monthDate) {
  const firstDay = startOfMonth(monthDate);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const days = [];

  for (let index = 0; index < startWeekday; index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function getUserTone(name) {
  if (name === 'Mariame') {
    return 'tone-mariame';
  }

  if (name === 'Anass') {
    return 'tone-anass';
  }

  return 'tone-shared';
}

function getWeatherRecommendation({ temperature, apparentTemperature, precipitation, windSpeed }) {
  const feltTemperature = apparentTemperature ?? temperature;

  if (feltTemperature == null) {
    return {
      tone: 'weather-card-neutral',
      title: 'Weather is loading',
      message: 'Runmate is still checking the conditions for today.',
    };
  }

  if (feltTemperature >= 31) {
    return {
      tone: 'weather-card-hot',
      title: 'Too hot to push hard',
      message: 'Try an easy run early or later in the evening and bring water.',
    };
  }

  if (feltTemperature <= 5) {
    return {
      tone: 'weather-card-cold',
      title: 'Too cold for a light outfit',
      message: 'Layer up well before going out today.',
    };
  }

  if ((precipitation ?? 0) >= 4 || (windSpeed ?? 0) >= 30) {
    return {
      tone: 'weather-card-alert',
      title: 'Conditions feel rough today',
      message: 'Rain or strong wind may make this run harder than usual.',
    };
  }

  return {
    tone: 'weather-card-good',
    title: 'Beautiful weather to run',
    message: 'Conditions look comfortable for a smooth run today.',
  };
}

function parseDistanceKm(distanceValue) {
  const normalized = String(distanceValue).replace(',', '.').trim().toLowerCase();
  const numeric = parseFloat(normalized.replace('km', '').trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDurationMinutes(durationValue) {
  const normalized = String(durationValue).trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const numericMinutes = parseFloat(normalized);
    return Number.isFinite(numericMinutes) ? numericMinutes : null;
  }

  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = normalized.match(/(\d+(?:\.\d+)?)\s*m/);
  const secondMatch = normalized.match(/(\d+(?:\.\d+)?)\s*s/);

  if (hourMatch || minuteMatch || secondMatch) {
    const hours = hourMatch ? parseFloat(hourMatch[1]) : 0;
    const minutes = minuteMatch ? parseFloat(minuteMatch[1]) : 0;
    const seconds = secondMatch ? parseFloat(secondMatch[1]) : 0;
    return hours * 60 + minutes + seconds / 60;
  }

  const parts = normalized.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] + parts[1] / 60;
  }

  if (parts.length === 3) {
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }

  return null;
}

function calculateSpeed(distanceValue, durationValue) {
  const distanceKm = parseDistanceKm(distanceValue);
  const durationMinutes = parseDurationMinutes(durationValue);

  if (!distanceKm || !durationMinutes) {
    return null;
  }

  const speedKmh = distanceKm / (durationMinutes / 60);
  return `${speedKmh.toFixed(1)} km/h`;
}

function getRunSpeedDisplay(run) {
  return calculateSpeed(run.distance, run.duration) ?? run.speed ?? run.pace ?? '--';
}

function useLocationCoordinates(locationName) {
  const [state, setState] = useState({
    status: 'idle',
    coordinates: null,
  });

  useEffect(() => {
    if (!locationName || locationName === 'No location') {
      setState({
        status: 'idle',
        coordinates: null,
      });
      return undefined;
    }

    let cancelled = false;

    async function geocodeLocation() {
      try {
        setState({
          status: 'loading',
          coordinates: null,
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(locationName)}`,
        );

        if (!response.ok) {
          throw new Error('Geocoding failed');
        }

        const results = await response.json();
        const match = results[0];

        if (!match || cancelled) {
          setState({
            status: 'empty',
            coordinates: null,
          });
          return;
        }

        setState({
          status: 'ready',
          coordinates: [Number(match.lat), Number(match.lon)],
        });
      } catch {
        if (!cancelled) {
          setState({
            status: 'error',
            coordinates: null,
          });
        }
      }
    }

    geocodeLocation();

    return () => {
      cancelled = true;
    };
  }, [locationName]);

  return state;
}

function FitMapToCoordinates({ coordinates, route }) {
  const map = useMap();

  useEffect(() => {
    if (route?.start && route?.end) {
      map.fitBounds([route.start, route.end], {
        padding: [28, 28],
        animate: true,
      });
      return;
    }

    if (!coordinates) {
      return;
    }

    map.setView(coordinates, 15, {
      animate: true,
    });
  }, [coordinates, map, route]);

  return null;
}

function EditableRouteLayer({ route, onRouteChange }) {
  useMapEvents({
    contextmenu(event) {
      if (!onRouteChange) {
        return;
      }

      const point = [event.latlng.lat, event.latlng.lng];

      if (!route?.start) {
        onRouteChange({
          start: point,
          end: route?.end ?? null,
        });
        return;
      }

      if (!route?.end) {
        onRouteChange({
          start: route.start,
          end: point,
        });
        return;
      }

      onRouteChange({
        start: route.start,
        end: point,
      });
    },
  });

  return null;
}

function RunLocationMap({ locationName, coordinates, route, editable = false, onRouteChange }) {
  const center = route?.start ?? coordinates ?? DEFAULT_MAP_CENTER;
  const routePoints = route?.start && route?.end ? [route.start, route.end] : [];

  return (
    <div className="map-canvas-shell">
      <MapContainer
        className="map-frame live-map-frame"
        center={center}
        zoom={coordinates ? 15 : 12}
        scrollWheelZoom={false}
        dragging
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitMapToCoordinates coordinates={route?.end ?? route?.start ?? coordinates} route={route} />
        {editable ? <EditableRouteLayer route={route} onRouteChange={onRouteChange} /> : null}
        {routePoints.length ? (
          <>
            <Polyline positions={routePoints} pathOptions={{ color: '#00a86b', weight: 5, opacity: 0.85 }} />
            <Marker
              position={route.start}
              icon={mapPinIcon}
              draggable={editable}
              eventHandlers={
                editable
                  ? {
                      dragend: (event) => {
                        const nextPoint = event.target.getLatLng();
                        onRouteChange?.({
                          start: [nextPoint.lat, nextPoint.lng],
                          end: route.end,
                        });
                      },
                    }
                  : undefined
              }
            />
            <Marker
              position={route.end}
              icon={mapEndPinIcon}
              draggable={editable}
              eventHandlers={
                editable
                  ? {
                      dragend: (event) => {
                        const nextPoint = event.target.getLatLng();
                        onRouteChange?.({
                          start: route.start,
                          end: [nextPoint.lat, nextPoint.lng],
                        });
                      },
                    }
                  : undefined
              }
            />
            <CircleMarker
              center={route.start}
              radius={14}
              pathOptions={{ color: 'rgba(0,168,107,0.24)', fillColor: '#00a86b', fillOpacity: 0.15, weight: 6 }}
            />
            <CircleMarker
              center={route.end}
              radius={14}
              pathOptions={{ color: 'rgba(36,72,59,0.22)', fillColor: '#24483b', fillOpacity: 0.12, weight: 6 }}
            />
          </>
        ) : route?.start ? (
          <Marker
            position={route.start}
            icon={mapPinIcon}
            draggable={editable}
            eventHandlers={
              editable
                ? {
                    dragend: (event) => {
                      const nextPoint = event.target.getLatLng();
                      onRouteChange?.({
                        start: [nextPoint.lat, nextPoint.lng],
                        end: route.end ?? null,
                      });
                    },
                  }
                : undefined
            }
          />
        ) : coordinates ? (
          <Marker position={coordinates} icon={mapPinIcon} />
        ) : null}
      </MapContainer>
      <div className="map-overlay-card">
        <span className="map-overlay-label">{routePoints.length ? 'Route preview' : 'Run spot'}</span>
        <strong>{locationName}</strong>
        {route?.distanceKm != null ? <small>{formatRouteDistance(route.distanceKm)}</small> : null}
        {editable ? <small>Long press map: start, then end. Drag pins to refine.</small> : null}
      </div>
    </div>
  );
}

function findReplyNotifications(previousRuns, nextRuns, currentUser) {
  if (!currentUser) {
    return [];
  }

  const previousById = new Map(previousRuns.map((run) => [run.id, run]));
  const notifications = [];

  nextRuns.forEach((run) => {
    const previousRun = previousById.get(run.id);
    const previousComments = previousRun?.comments ?? [];

    (run.comments ?? []).forEach((comment) => {
      const previousComment = previousComments.find((item) => item.id === comment.id);
      const previousReplyIds = new Set((previousComment?.replies ?? []).map((reply) => reply.id));
      const shouldNotify =
        comment.author === currentUser ||
        (comment.replies ?? []).some((reply) => reply.author === currentUser);

      if (!shouldNotify) {
        return;
      }

      (comment.replies ?? []).forEach((reply) => {
        if (!previousReplyIds.has(reply.id) && reply.author !== currentUser) {
          notifications.push({
            runTitle: run.title,
            author: reply.author,
          });
        }
      });
    });
  });

  return notifications;
}

function updateCommentThread(comments, target, updater) {
  return comments.map((comment) => {
    if (target.type === 'comment' && comment.id === target.commentId) {
      return updater(comment);
    }

    if (target.type === 'reply' && comment.id === target.commentId) {
      return {
        ...comment,
        replies: (comment.replies ?? []).map((reply) =>
          reply.id === target.replyId ? updater(reply) : reply,
        ),
      };
    }

    return comment;
  });
}

function deleteCommentThread(comments, target) {
  if (target.type === 'comment') {
    return comments.filter((comment) => comment.id !== target.commentId);
  }

  return comments.map((comment) => {
    if (comment.id !== target.commentId) {
      return comment;
    }

    return {
      ...comment,
      replies: (comment.replies ?? []).filter((reply) => reply.id !== target.replyId),
    };
  });
}

function findCommentThreadItem(comments, target) {
  if (target?.type === 'comment') {
    return comments.find((comment) => comment.id === target.commentId) ?? null;
  }

  const parent = comments.find((comment) => comment.id === target?.commentId);
  return parent?.replies?.find((reply) => reply.id === target?.replyId) ?? null;
}

function toggleReactionThread(comments, target, reactionKey, author) {
  return updateCommentThread(comments, target, (item) => {
    const currentUsers = item.reactions?.[reactionKey] ?? [];
    const hasReacted = currentUsers.includes(author);
    const nextUsers = hasReacted
      ? currentUsers.filter((name) => name !== author)
      : [...currentUsers, author];

    return {
      ...item,
      reactions: {
        ...(item.reactions ?? {}),
        [reactionKey]: nextUsers,
      },
    };
  });
}

function togglePinnedComment(comments, commentId) {
  return comments.map((comment) => ({
    ...comment,
    pinned: comment.id === commentId ? !comment.pinned : false,
  }));
}

function formatCommentTimestamp(timestamp) {
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDistance(distanceValue) {
  const numericDistance = parseDistanceKm(distanceValue);

  if (!numericDistance) {
    return distanceValue;
  }

  return `${numericDistance.toFixed(2)} km`;
}

function formatDuration(durationValue) {
  const durationMinutes = parseDurationMinutes(durationValue);

  if (!durationMinutes) {
    return durationValue;
  }

  if (durationMinutes < 60) {
    return `${Math.round(durationMinutes)} min`;
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = Math.round(durationMinutes % 60);

  if (!minutes) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function getEditableDistanceValue(distanceValue) {
  const numericDistance = parseDistanceKm(distanceValue);
  return numericDistance ? String(numericDistance) : '';
}

function getEditableDurationValue(durationValue) {
  const durationMinutes = parseDurationMinutes(durationValue);
  return durationMinutes ? String(Math.round(durationMinutes)) : '';
}

function getRunFormErrors({
  title,
  date,
  distance,
  duration,
  location,
  note,
  photos,
  startLat,
  startLng,
  endLat,
  endLng,
  editingRun,
}) {
  const errors = {};
  const trimmedTitle = title.trim();
  const trimmedLocation = location.trim();
  const trimmedNote = note.trim();
  const today = getTodayDateValue();
  const distanceInput = String(distance).trim();
  const durationInput = String(duration).trim();

  if (!trimmedTitle) {
    errors.title = 'Run title is required.';
  } else if (trimmedTitle.length < 2) {
    errors.title = 'Title must contain at least 2 characters.';
  } else if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    errors.title = `Title must stay under ${MAX_TITLE_LENGTH} characters.`;
  }

  if (!date) {
    errors.date = 'Choose a date.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.date = 'Use a valid date.';
  } else if (date < MIN_RUN_DATE) {
    errors.date = 'Date must be on or after January 1, 2025.';
  } else if (date > today) {
    errors.date = 'Date cannot be in the future.';
  }

  if (!distanceInput) {
    errors.distance = 'Distance is required.';
  } else if (!/^\d+(?:[.,]\d+)?$/.test(distanceInput)) {
    errors.distance = 'Distance must be a number in km.';
  } else {
    const numericDistance = parseDistanceKm(distanceInput);
    if (!numericDistance || numericDistance <= 0) {
      errors.distance = 'Distance must be greater than 0 km.';
    } else if (numericDistance > MAX_DISTANCE_KM) {
      errors.distance = `Distance must stay under ${MAX_DISTANCE_KM} km.`;
    }
  }

  if (!durationInput) {
    errors.duration = 'Time in minutes is required.';
  } else if (!/^\d+(?:[.,]\d+)?$/.test(durationInput)) {
    errors.duration = 'Time must be a number of minutes.';
  } else {
    const numericDuration = parseDurationMinutes(durationInput);
    if (!numericDuration || numericDuration <= 0) {
      errors.duration = 'Time must be greater than 0 minutes.';
    } else if (numericDuration > MAX_DURATION_MINUTES) {
      errors.duration = `Time must stay under ${MAX_DURATION_MINUTES} minutes.`;
    }
  }

  if (trimmedLocation.length > MAX_LOCATION_LENGTH) {
    errors.location = `Location must stay under ${MAX_LOCATION_LENGTH} characters.`;
  }

  if (trimmedNote.length > MAX_NOTE_LENGTH) {
    errors.note = `Notes must stay under ${MAX_NOTE_LENGTH} characters.`;
  }

  const route = getRouteFromInputs(startLat, startLng, endLat, endLng);
  if (route?.status === 'partial') {
    errors.route = 'Add full start and end coordinates, or leave them all empty.';
  } else if (route?.status === 'invalid-latitude') {
    errors.route = 'Latitude must stay between -90 and 90.';
  } else if (route?.status === 'invalid-longitude') {
    errors.route = 'Longitude must stay between -180 and 180.';
  }

  if (!editingRun && !photos.length) {
    errors.photos = 'Choose at least one photo.';
  } else if (photos.length > MAX_PHOTOS) {
    errors.photos = `You can upload up to ${MAX_PHOTOS} photos at once.`;
  } else if (photos.some((file) => !file.type.startsWith('image/'))) {
    errors.photos = 'Only image files are allowed.';
  } else if (photos.some((file) => file.size > MAX_PHOTO_SIZE_BYTES)) {
    errors.photos = 'Each photo must stay under 15 MB before compression.';
  }

  return errors;
}

export default function App() {
  const [runs, setRuns] = useState(initialRuns);
  const [page, setPage] = useState('home');
  const [displayPage, setDisplayPage] = useState('home');
  const [transitionStage, setTransitionStage] = useState('entered');
  const [pageDirection, setPageDirection] = useState('forward');
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [selectedRunId, setSelectedRunId] = useState('');
  const [editingRunId, setEditingRunId] = useState('');
  const [newRun, setNewRun] = useState({
    title: '',
    date: getTodayDateValue(),
    distance: '',
    duration: '',
    location: '',
    note: '',
    startLat: '',
    startLng: '',
    endLat: '',
    endLng: '',
    photos: [],
  });
  const [formError, setFormError] = useState('');
  const [isSavingRun, setIsSavingRun] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [isDeletingRun, setIsDeletingRun] = useState(false);
  const [isDeletingPhoto, setIsDeletingPhoto] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(-1);
  const [isPhotoZoomed, setIsPhotoZoomed] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [accessUser, setAccessUser] = useState(
    () => window.localStorage.getItem(ACCESS_USER_STORAGE_KEY) ?? '',
  );
  const [isUnlocked, setIsUnlocked] = useState(
    () =>
      window.localStorage.getItem(ACCESS_STORAGE_KEY) === ACCESS_CODE &&
      ACCESS_USERS.includes(window.localStorage.getItem(ACCESS_USER_STORAGE_KEY) ?? ''),
  );
  const [accessError, setAccessError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyingToCommentId, setReplyingToCommentId] = useState('');
  const [commentActionTarget, setCommentActionTarget] = useState(null);
  const [commentEditText, setCommentEditText] = useState('');
  const [activityInbox, setActivityInbox] = useState([]);
  const [visibleRunCount, setVisibleRunCount] = useState(RUNS_PAGE_SIZE);
  const [isRemindersEnabled, setIsRemindersEnabled] = useState(
    () => window.localStorage.getItem('runmate:reminders') === 'enabled',
  );
  const [ripples, setRipples] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [syncMessage, setSyncMessage] = useState('');
  const [touchedFields, setTouchedFields] = useState({});
  const [isDetailsMenuOpen, setIsDetailsMenuOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [isGalleryMenuOpen, setIsGalleryMenuOpen] = useState(false);
  const [weatherState, setWeatherState] = useState({
    status: 'idle',
    location: DEFAULT_WEATHER_LOCATION,
    temperature: null,
    apparentTemperature: null,
    windSpeed: null,
    precipitation: null,
  });
  const galleryTouchRef = useRef({ x: 0, y: 0 });
  const galleryTapRef = useRef({ time: 0 });
  const commentPressTimerRef = useRef(null);
  const previousRunsRef = useRef([]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );
  const editingRun = useMemo(
    () => runs.find((run) => run.id === editingRunId) ?? null,
    [runs, editingRunId],
  );
  const runsByDate = useMemo(() => {
    return runs.reduce((accumulator, run) => {
      const key = run.date;
      if (!key) {
        return accumulator;
      }

      if (!accumulator[key]) {
        accumulator[key] = [];
      }

      accumulator[key].push(run);
      return accumulator;
    }, {});
  }, [runs]);
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const paginatedRuns = useMemo(() => runs.slice(0, visibleRunCount), [runs, visibleRunCount]);
  const formErrors = useMemo(
    () =>
      getRunFormErrors({
        ...newRun,
        editingRun,
      }),
    [editingRun, newRun],
  );
  const isFormValid = Object.keys(formErrors).length === 0;
  const activeCommentTargetItem = useMemo(
    () => findCommentThreadItem(selectedRun?.comments ?? [], commentActionTarget),
    [commentActionTarget, selectedRun],
  );
  const formRoute = useMemo(
    () => getRouteFromInputs(newRun.startLat, newRun.startLng, newRun.endLat, newRun.endLng),
    [newRun.endLat, newRun.endLng, newRun.startLat, newRun.startLng],
  );
  const featuredRun = runs[0] ?? null;
  const journalRuns = useMemo(
    () => (featuredRun ? paginatedRuns.slice(1) : paginatedRuns),
    [featuredRun, paginatedRuns],
  );
  const memoryPhotos = useMemo(
    () =>
      runs
        .flatMap((run) =>
          run.photos.slice(0, 2).map((photo) => ({
            id: photo.id,
            src: photo.src,
            title: photo.title,
            runTitle: run.title,
          })),
        )
        .slice(0, 6),
    [runs],
  );
  const recentComments = useMemo(
    () =>
      runs
        .flatMap((run) =>
          (run.comments ?? []).map((comment) => ({
            id: comment.id,
            author: comment.author,
            text: comment.text,
            runTitle: run.title,
          })),
        )
        .slice(0, 4),
    [runs],
  );
  const orderedComments = useMemo(() => {
    const comments = [...(selectedRun?.comments ?? [])];
    return comments.sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)));
  }, [selectedRun]);
  const weatherRecommendation = useMemo(
    () => getWeatherRecommendation(weatherState),
    [weatherState],
  );
  const stats = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weeklyDistance = runs.reduce((total, run) => {
      const runDate = new Date(`${run.date}T00:00:00`);
      return runDate >= weekStart ? total + (parseDistanceKm(run.distance) ?? 0) : total;
    }, 0);
    const monthlyTotal = runs.reduce((total, run) => {
      const runDate = new Date(`${run.date}T00:00:00`);
      return runDate >= monthStart ? total + (parseDistanceKm(run.distance) ?? 0) : total;
    }, 0);
    const averageSpeed = runs.length
      ? runs.reduce((total, run) => {
          const numericSpeed = Number.parseFloat(String(getRunSpeedDisplay(run)).replace('km/h', '').trim());
          return total + (Number.isFinite(numericSpeed) ? numericSpeed : 0);
        }, 0) / runs.length
      : 0;
    const longestRun = runs.reduce((longest, run) => {
      const distance = parseDistanceKm(run.distance) ?? 0;
      return distance > longest ? distance : longest;
    }, 0);

    return [
      { label: 'Weekly', value: `${weeklyDistance.toFixed(1)} km` },
      { label: 'Monthly', value: `${monthlyTotal.toFixed(1)} km` },
      { label: 'Avg speed', value: `${averageSpeed.toFixed(1)} km/h` },
      { label: 'Longest', value: `${longestRun.toFixed(1)} km` },
    ];
  }, [runs]);

  useEffect(() => {
    if (!newRun.photos.length) {
      setPhotoPreviews([]);
      return undefined;
    }

    const previews = newRun.photos.map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      url: URL.createObjectURL(file),
      name: file.name,
    }));

    setPhotoPreviews(previews);

    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [newRun.photos]);

  useEffect(() => {
    return () => {
      clearCommentActionTimer();
    };
  }, []);

  useEffect(() => {
    if (!isUnlocked) {
      return undefined;
    }

    setIsLoadingRuns(true);

    const unsubscribe = subscribeToRuns(
      (loadedRuns) => {
        setRuns(loadedRuns);
        setSelectedRunId((current) =>
          loadedRuns.some((run) => run.id === current) ? current : (loadedRuns[0]?.id ?? ''),
        );
        setSyncMessage(isCloudEnabled() ? 'Shared cloud sync is active.' : 'Local-only mode is active.');

        const notifications = findReplyNotifications(previousRunsRef.current, loadedRuns, accessUser);
        if (
          notifications.length &&
          isRemindersEnabled &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          const latest = notifications[notifications.length - 1];
          new Notification('New reply in Runmate', {
            body: `${latest.author} replied on ${latest.runTitle}.`,
          });
        }

        if (notifications.length) {
          setActivityInbox((current) => [
            ...notifications.map((item, index) => ({
              id: `${Date.now()}-${index}`,
              ...item,
              createdAt: new Date().toISOString(),
            })),
            ...current,
          ].slice(0, 6));
        }

        previousRunsRef.current = loadedRuns;
        setIsLoadingRuns(false);
      },
      () => {
        setSyncMessage('Runs could not be loaded. The app is still available.');
        setIsLoadingRuns(false);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [accessUser, isRemindersEnabled, isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) {
      return undefined;
    }

    async function handleReconnect() {
      try {
        const syncResult = await syncPendingRuns();
        if (syncResult.syncedRuns.length || syncResult.syncedComments) {
          const loadedRuns = await fetchRuns();
          setRuns(loadedRuns);
          setSyncMessage('Pending offline changes were synced.');
        }
      } catch {
        setSyncMessage('Offline changes are still waiting to sync.');
      }
    }

    window.addEventListener('online', handleReconnect);
    return () => {
      window.removeEventListener('online', handleReconnect);
    };
  }, [isUnlocked]);

  useEffect(() => {
    return undefined;
  }, [isRemindersEnabled, isUnlocked]);

  useEffect(() => {
    setIsDetailsMenuOpen(false);
  }, [displayPage, selectedRunId]);

  useEffect(() => {
    setIsGalleryMenuOpen(false);
  }, [activePhotoIndex]);

  useEffect(() => {
    let cancelled = false;

    async function loadWeather(latitude, longitude, locationName) {
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,wind_speed_10m&daily=precipitation_sum&timezone=auto&forecast_days=1`,
        );

        if (!response.ok) {
          throw new Error('weather-failed');
        }

        const payload = await response.json();
        if (cancelled) {
          return;
        }

        setWeatherState({
          status: 'ready',
          location: {
            name: locationName,
            latitude,
            longitude,
          },
          temperature: payload.current?.temperature_2m ?? null,
          apparentTemperature: payload.current?.apparent_temperature ?? null,
          windSpeed: payload.current?.wind_speed_10m ?? null,
          precipitation: payload.daily?.precipitation_sum?.[0] ?? null,
        });
      } catch {
        if (!cancelled) {
          setWeatherState((current) => ({
            ...current,
            status: 'error',
          }));
        }
      }
    }

    if (!('geolocation' in navigator)) {
      loadWeather(
        DEFAULT_WEATHER_LOCATION.latitude,
        DEFAULT_WEATHER_LOCATION.longitude,
        DEFAULT_WEATHER_LOCATION.name,
      );
      return () => {
        cancelled = true;
      };
    }

    setWeatherState((current) => ({
      ...current,
      status: 'loading',
    }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        loadWeather(position.coords.latitude, position.coords.longitude, 'Your location');
      },
      () => {
        loadWeather(
          DEFAULT_WEATHER_LOCATION.latitude,
          DEFAULT_WEATHER_LOCATION.longitude,
          DEFAULT_WEATHER_LOCATION.name,
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 15 * 60 * 1000,
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (page === displayPage) {
      setTransitionStage('entered');
      return undefined;
    }

    setTransitionStage('leaving');

    const swapTimer = window.setTimeout(() => {
      setDisplayPage(page);
      setTransitionStage('entering');
    }, 170);

    const settleTimer = window.setTimeout(() => {
      setTransitionStage('entered');
    }, 340);

    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(settleTimer);
    };
  }, [displayPage, page]);

  function navigateTo(nextPage, direction = 'forward') {
    setPageDirection(direction);
    setPage(nextPage);
  }

  function openRunDetails(runId) {
    setSelectedRunId(runId);
    navigateTo('details', 'forward');
  }

  function openCreateRun() {
    setEditingRunId('');
    setCreateStep(0);
    setNewRun({
      title: '',
      date: getTodayDateValue(),
      distance: '',
      duration: '',
      location: '',
      note: '',
      startLat: '',
      startLng: '',
      endLat: '',
      endLng: '',
      photos: [],
    });
    setFormError('');
    setTouchedFields({});
    navigateTo('create', 'forward');
  }

  function openEditRun() {
    if (!selectedRun) {
      return;
    }

    setEditingRunId(selectedRun.id);
    setNewRun({
      title: selectedRun.title,
      date: selectedRun.date,
      distance: getEditableDistanceValue(selectedRun.distance),
      duration: getEditableDurationValue(selectedRun.duration),
      location: selectedRun.location === 'No location' ? '' : selectedRun.location,
      note: selectedRun.note === 'No note' ? '' : selectedRun.note,
      startLat: formatCoordinate(selectedRun.route?.start?.[0]),
      startLng: formatCoordinate(selectedRun.route?.start?.[1]),
      endLat: formatCoordinate(selectedRun.route?.end?.[0]),
      endLng: formatCoordinate(selectedRun.route?.end?.[1]),
      photos: [],
    });
    setFormError('');
    setTouchedFields({});
    setCreateStep(0);
    navigateTo('create', 'forward');
  }

  function handleCreateStepChange(nextStep) {
    setCreateStep(nextStep);
    setFormError('');
  }

  function handleContinueCreate() {
    if (createStep === 0) {
      const detailKeys = ['title', 'distance', 'duration', 'date', 'location', 'note'];
      setTouchedFields((current) => ({
        ...current,
        title: true,
        distance: true,
        duration: true,
        date: true,
        location: true,
        note: true,
      }));

      const detailErrorKey = detailKeys.find((key) => formErrors[key]);
      if (detailErrorKey) {
        setFormError(formErrors[detailErrorKey]);
        return;
      }
    }

    if (createStep === 1) {
      setTouchedFields((current) => ({
        ...current,
        photos: true,
      }));

      if (formErrors.photos) {
        setFormError(formErrors.photos);
        return;
      }
    }

    setFormError('');
    setCreateStep((current) => Math.min(current + 1, CREATE_STEPS.length - 1));
  }

  function openDateRuns(dateKey) {
    const runsForDate = runsByDate[dateKey] ?? [];
    if (!runsForDate.length) {
      return;
    }

    setSelectedRunId(runsForDate[0].id);
    navigateTo('details', 'forward');
  }

  async function refreshRuns() {
    try {
      setIsLoadingRuns(true);
      const loadedRuns = await fetchRuns();
      setRuns(loadedRuns);
      setSelectedRunId((current) =>
        loadedRuns.some((run) => run.id === current) ? current : (loadedRuns[0]?.id ?? ''),
      );
      setSyncMessage(isCloudEnabled() ? 'Runs refreshed from cloud.' : 'Runs refreshed from this device.');
      setVisibleRunCount(RUNS_PAGE_SIZE);
    } catch {
      setSyncMessage('Runs could not be refreshed right now.');
    } finally {
      setIsLoadingRuns(false);
    }
  }

  function handleUnlock(event) {
    event.preventDefault();

    if (accessCode.trim() !== ACCESS_CODE) {
      setAccessError('Wrong code.');
      return;
    }

    if (!ACCESS_USERS.includes(accessUser)) {
      setAccessError('Choose Mariame or Anass.');
      return;
    }

    window.localStorage.setItem(ACCESS_STORAGE_KEY, ACCESS_CODE);
    window.localStorage.setItem(ACCESS_USER_STORAGE_KEY, accessUser);
    setAccessError('');
    setIsUnlocked(true);
  }

  async function handleReminderToggle() {
    if (!('Notification' in window)) {
      setSyncMessage('Notifications are not supported on this device.');
      return;
    }

    if (!isRemindersEnabled) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setSyncMessage('Notification permission was not granted.');
        return;
      }
      window.localStorage.setItem('runmate:reminders', 'enabled');
      setIsRemindersEnabled(true);
      setSyncMessage('Reply notifications are enabled.');
      return;
    }

    window.localStorage.removeItem('runmate:reminders');
    setIsRemindersEnabled(false);
    setSyncMessage('Reply notifications are disabled.');
  }

  async function handleDeleteRun() {
    if (!selectedRun) {
      return;
    }

    const confirmed = window.confirm(`Delete "${selectedRun.title}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setIsDeletingRun(true);
      await deleteRun(selectedRun);
      const nextRuns = runs.filter((run) => run.id !== selectedRun.id);
      setRuns(nextRuns);
      setSelectedRunId(nextRuns[0]?.id ?? '');
      navigateTo('home', 'backward');
      setSyncMessage(
        isCloudEnabled() ? 'Run deleted from shared storage.' : 'Run deleted from this device.',
      );
    } catch {
      setSyncMessage('Run could not be deleted right now.');
    } finally {
      setIsDeletingRun(false);
    }
  }

  function closeGallery() {
    setActivePhotoIndex(-1);
    setIsPhotoZoomed(false);
  }

  function showNextPhoto() {
    if (!selectedRun?.photos?.length) {
      return;
    }

    setActivePhotoIndex((current) => (current + 1) % selectedRun.photos.length);
    setIsPhotoZoomed(false);
  }

  function showPreviousPhoto() {
    if (!selectedRun?.photos?.length) {
      return;
    }

    setActivePhotoIndex((current) =>
      current <= 0 ? selectedRun.photos.length - 1 : current - 1,
    );
    setIsPhotoZoomed(false);
  }

  async function handleDeletePhoto() {
    const activePhoto = selectedRun?.photos?.[activePhotoIndex];

    if (!selectedRun || !activePhoto) {
      return;
    }

    const confirmed = window.confirm(`Delete photo "${activePhoto.title}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setIsDeletingPhoto(true);
      const updatedRun = await deletePhotoFromRun(selectedRun, activePhoto.id);
      setRuns((current) => current.map((run) => (run.id === updatedRun.id ? updatedRun : run)));
      if (!updatedRun.photos.length) {
        closeGallery();
      } else {
        setActivePhotoIndex((current) => Math.min(current, updatedRun.photos.length - 1));
      }
      setSyncMessage(
        isCloudEnabled() ? 'Photo deleted from shared storage.' : 'Photo deleted from this device.',
      );
    } catch {
      setSyncMessage('Photo could not be deleted right now.');
    } finally {
      setIsDeletingPhoto(false);
    }
  }

  function handleGalleryTouchStart(event) {
    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    galleryTouchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleGalleryTouchEnd(event) {
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - galleryTouchRef.current.x;
    const deltaY = touch.clientY - galleryTouchRef.current.y;

    if (Math.abs(deltaX) < 36 || Math.abs(deltaX) < Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0) {
      showNextPhoto();
      return;
    }

    showPreviousPhoto();
  }

  function handleGalleryStageClick(event) {
    const stage = event.currentTarget;
    const bounds = stage.getBoundingClientRect();
    const relativeX = event.clientX - bounds.left;
    const now = Date.now();

    if (now - galleryTapRef.current.time < 250) {
      setIsPhotoZoomed((current) => !current);
      galleryTapRef.current.time = 0;
      return;
    }

    galleryTapRef.current.time = now;

    if (relativeX < bounds.width * 0.35) {
      showPreviousPhoto();
      return;
    }

    if (relativeX > bounds.width * 0.65) {
      showNextPhoto();
      return;
    }

    setIsPhotoZoomed((current) => !current);
  }

  async function handleAddComment(event) {
    event.preventDefault();

    if (!selectedRun || !commentText.trim()) {
      return;
    }

    try {
      const updatedRun = await addCommentToRun(selectedRun, commentText, accessUser || 'Guest');
      setRuns((current) => current.map((run) => (run.id === updatedRun.id ? updatedRun : run)));
      setCommentText('');
      setSyncMessage(
        isOnline() ? 'Comment added.' : 'Comment saved offline and will sync later.',
      );
    } catch {
      setSyncMessage('Comment could not be added right now.');
    }
  }

  async function handleAddReply(event, parentCommentId) {
    event.preventDefault();

    if (!selectedRun || !replyText.trim() || !parentCommentId) {
      return;
    }

    try {
      const updatedRun = await addCommentToRun(
        selectedRun,
        replyText,
        accessUser || 'Guest',
        parentCommentId,
      );
      setRuns((current) => current.map((run) => (run.id === updatedRun.id ? updatedRun : run)));
      setReplyText('');
      setReplyingToCommentId('');
      setSyncMessage(
        isOnline() ? 'Reply added.' : 'Reply saved offline and will sync later.',
      );
    } catch {
      setSyncMessage('Reply could not be added right now.');
    }
  }

  function clearCommentActionTimer() {
    if (commentPressTimerRef.current) {
      window.clearTimeout(commentPressTimerRef.current);
      commentPressTimerRef.current = null;
    }
  }

  function startCommentLongPress(target, author, text) {
    clearCommentActionTimer();

    if (author !== accessUser) {
      return;
    }

    commentPressTimerRef.current = window.setTimeout(() => {
      setCommentActionTarget(target);
      setCommentEditText(text);
    }, 1500);
  }

  function stopCommentLongPress() {
    clearCommentActionTimer();
  }

  async function handleSaveCommentEdit() {
    if (!selectedRun || !commentActionTarget || !commentEditText.trim()) {
      return;
    }

    try {
      const nextComments = updateCommentThread(selectedRun.comments ?? [], commentActionTarget, (item) => ({
        ...item,
        text: commentEditText.trim(),
        editedAt: new Date().toISOString(),
      }));
      const updatedRun = await updateRunComments(selectedRun, nextComments);
      setRuns((current) => current.map((run) => (run.id === updatedRun.id ? updatedRun : run)));
      setCommentActionTarget(null);
      setCommentEditText('');
      setSyncMessage('Comment updated.');
    } catch {
      setSyncMessage('Comment could not be updated right now.');
    }
  }

  async function handleToggleReaction(target, reactionKey) {
    if (!selectedRun || !accessUser) {
      return;
    }

    try {
      const nextComments = toggleReactionThread(selectedRun.comments ?? [], target, reactionKey, accessUser);
      const updatedRun = await updateRunComments(selectedRun, nextComments);
      setRuns((current) => current.map((run) => (run.id === updatedRun.id ? updatedRun : run)));
    } catch {
      setSyncMessage('Reaction could not be saved right now.');
    }
  }

  async function handleTogglePinnedComment(commentId) {
    if (!selectedRun) {
      return;
    }

    try {
      const nextComments = togglePinnedComment(selectedRun.comments ?? [], commentId);
      const updatedRun = await updateRunComments(selectedRun, nextComments);
      setRuns((current) => current.map((run) => (run.id === updatedRun.id ? updatedRun : run)));
      setCommentActionTarget(null);
      setSyncMessage('Pinned comment updated.');
    } catch {
      setSyncMessage('Pinned comment could not be updated right now.');
    }
  }

  async function handleDeleteCommentTarget() {
    if (!selectedRun || !commentActionTarget) {
      return;
    }

    try {
      const nextComments = deleteCommentThread(selectedRun.comments ?? [], commentActionTarget);
      const updatedRun = await updateRunComments(selectedRun, nextComments);
      setRuns((current) => current.map((run) => (run.id === updatedRun.id ? updatedRun : run)));
      setCommentActionTarget(null);
      setCommentEditText('');
      setSyncMessage('Comment deleted.');
    } catch {
      setSyncMessage('Comment could not be deleted right now.');
    }
  }

  function handleFieldChange(event) {
    const { name, value } = event.target;
    setFormError('');
    setTouchedFields((current) => ({ ...current, [name]: true }));
    setNewRun((current) => ({ ...current, [name]: value }));
  }

  function handlePhotoChange(event) {
    const files = Array.from(event.target.files ?? []);
    setFormError('');
    setTouchedFields((current) => ({ ...current, photos: true }));
    setNewRun((current) => ({ ...current, photos: files }));
  }

  function handleRouteChange(nextRoute) {
    setFormError('');
    setTouchedFields((current) => ({
      ...current,
      route: true,
    }));
    setNewRun((current) => ({
      ...current,
      startLat: formatCoordinate(nextRoute?.start?.[0]),
      startLng: formatCoordinate(nextRoute?.start?.[1]),
      endLat: formatCoordinate(nextRoute?.end?.[0]),
      endLng: formatCoordinate(nextRoute?.end?.[1]),
    }));
  }

  async function handleAddRun(event) {
    event.preventDefault();

    setTouchedFields({
      title: true,
      date: true,
      distance: true,
      duration: true,
      location: true,
      note: true,
      photos: true,
    });

    const validationError = Object.values(formErrors)[0];

    if (validationError) {
      setFormError(validationError);
      return;
    }

    const speed = calculateSpeed(newRun.distance, newRun.duration);

    if (!speed) {
      setFormError('Use a valid distance and time so speed can be calculated.');
      return;
    }

    try {
      setIsSavingRun(true);
      const shouldOptimisticallyUpdateRuns = !isCloudEnabled() || !isOnline();
      const routePayload =
        formRoute?.status === 'ready'
          ? {
              start: formRoute.start,
              end: formRoute.end,
              distanceKm: formRoute.distanceKm,
            }
          : null;
      const runPayload = {
        title: newRun.title.trim(),
        date: newRun.date,
        time: editingRun?.time ?? getCurrentTimeValue(),
        distance: formatDistance(newRun.distance),
        duration: formatDuration(newRun.duration),
        speed,
        pace: speed,
        location: newRun.location.trim() || 'No location',
        note: newRun.note.trim() || 'No note',
        owner: editingRun?.owner ?? accessUser ?? 'Shared',
        route: routePayload,
        createdAtMs: editingRun?.createdAtMs ?? Date.now(),
        photos: editingRun?.photos ?? [],
      };

      const savedRun = editingRun
        ? await updateRun(editingRun.id, runPayload, newRun.photos)
        : await saveRun({ ...runPayload, photos: newRun.photos });

      if (editingRun || shouldOptimisticallyUpdateRuns) {
        setRuns((current) =>
          editingRun
            ? current.map((run) => (run.id === savedRun.id ? savedRun : run))
            : [savedRun, ...current],
        );
      }
      setSelectedRunId(savedRun.id);
      navigateTo(editingRun ? 'details' : 'home', 'backward');
      setEditingRunId('');
      setVisibleRunCount(RUNS_PAGE_SIZE);
      setNewRun({
        title: '',
        date: getTodayDateValue(),
        distance: '',
        duration: '',
        location: '',
        note: '',
        startLat: '',
        startLng: '',
        endLat: '',
        endLng: '',
        photos: [],
      });
      setFormError('');
      setTouchedFields({});
      setCreateStep(0);
      setSyncMessage(
        editingRun
          ? isCloudEnabled()
            ? 'Run updated in shared storage.'
            : 'Run updated on this device.'
          : isCloudEnabled()
            ? isOnline()
              ? 'Run saved and shared across devices.'
              : 'Run saved offline and will sync later.'
            : 'Run saved on this device only.',
      );
      event.target.reset();
    } catch {
      setFormError(
        isCloudEnabled()
          ? editingRun
            ? 'Run could not be updated. Check the Firebase config and rules.'
            : 'Run could not be uploaded. Check the Firebase config and rules.'
          : editingRun
            ? 'Run could not be updated on this device.'
            : 'Photos could not be saved on this device.',
      );
    } finally {
      setIsSavingRun(false);
    }
  }

  function handleAppPointerDown(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const interactiveTarget = target.closest('button, a, input, textarea, label');
    if (!interactiveTarget) {
      return;
    }

    const bounds = interactiveTarget.getBoundingClientRect();
    const ripple = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      x: event.clientX,
      y: event.clientY,
      size: Math.max(bounds.width, bounds.height) * 1.15,
    };

    setRipples((current) => [...current, ripple]);
    window.setTimeout(() => {
      setRipples((current) => current.filter((item) => item.id !== ripple.id));
    }, 520);
  }

  if (!isUnlocked) {
    return (
      <>
        <div className="desktop-blocker">
          <div className="desktop-card">
            <p className="desktop-eyebrow">Phone only</p>
            <h1>Runmate is designed for mobile screens.</h1>
            <p>Open this app on a phone-sized viewport to use the running journal.</p>
          </div>
        </div>
        <main className="app-shell" onPointerDown={handleAppPointerDown}>
          <div className="tap-feedback-layer" aria-hidden="true">
            {ripples.map((ripple) => (
              <span
                className="tap-ripple"
                key={ripple.id}
                style={{
                  left: ripple.x,
                  top: ripple.y,
                  width: ripple.size,
                  height: ripple.size,
                }}
              />
            ))}
          </div>
          <div className="app-backdrop" aria-hidden="true">
            <div className="ambient ambient-one" />
            <div className="ambient ambient-two" />
            <div className="ambient ambient-three" />
            <div className="mesh mesh-one" />
            <div className="mesh mesh-two" />
          </div>
          <section className="screen gate-screen">
            <div className="gate-card">
              <div className="gate-icon">
                <LockKeyhole size={26} strokeWidth={2.2} />
              </div>
              <p className="topbar-label">Access code</p>
              <h1>Unlock Runmate</h1>
              <p className="hero-subtitle">Enter the shared code, then choose who is using the journal.</p>
              <form className="gate-form" onSubmit={handleUnlock}>
                <input
                  className="run-input gate-input"
                  value={accessCode}
                  onChange={(event) => {
                    setAccessCode(event.target.value);
                    setAccessError('');
                  }}
                  inputMode="numeric"
                  placeholder="Enter code"
                  maxLength={4}
                />
                <div className="user-choice-group">
                  {ACCESS_USERS.map((user) => (
                    <button
                      className={`user-choice-button ${accessUser === user ? 'user-choice-button-active' : ''}`}
                      key={user}
                      type="button"
                      onClick={() => {
                        setAccessUser(user);
                        setAccessError('');
                      }}
                    >
                      {user}
                    </button>
                  ))}
                </div>
                {accessError ? <p className="form-error">{accessError}</p> : null}
                <button className="primary-button" type="submit">
                  Enter
                </button>
              </form>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <div className="desktop-blocker">
        <div className="desktop-card">
          <p className="desktop-eyebrow">Phone only</p>
          <h1>Runmate is designed for mobile screens.</h1>
          <p>Open this app on a phone-sized viewport to use the running journal.</p>
        </div>
      </div>

      <main className="app-shell" onPointerDown={handleAppPointerDown}>
        <div className="tap-feedback-layer" aria-hidden="true">
          {ripples.map((ripple) => (
            <span
              className="tap-ripple"
              key={ripple.id}
              style={{
                left: ripple.x,
                top: ripple.y,
                width: ripple.size,
                height: ripple.size,
              }}
            />
          ))}
        </div>
        <div className="app-backdrop" aria-hidden="true">
          <div className="ambient ambient-one" />
          <div className="ambient ambient-two" />
          <div className="ambient ambient-three" />
          <div className="mesh mesh-one" />
          <div className="mesh mesh-two" />
        </div>
        {displayPage === 'home' ? (
          <section
            className={`screen page-shell page-${transitionStage} page-${pageDirection} home-screen`}
          >
            <header className="topbar">
              <div>
                <p className="topbar-label">Journal</p>
                <h1>Run Journal</h1>
                <p className="hero-subtitle">
                  Build a soft little archive for every run you keep.
                  {accessUser ? ` Logged in as ${accessUser}.` : ''}
                </p>
                {accessUser ? (
                  <div className="identity-pill">
                    <span className={`avatar-badge ${getUserTone(accessUser)}`}>{accessUser.slice(0, 1)}</span>
                    <strong>{accessUser}</strong>
                  </div>
                ) : null}
              </div>
              <div className="topbar-actions">
                <button className="icon-button icon-button-badged" type="button" onClick={handleReminderToggle}>
                  <Bell size={18} strokeWidth={2.3} />
                  {activityInbox.length ? <span className="icon-badge">{activityInbox.length}</span> : null}
                </button>
                <button className="icon-button" type="button" onClick={() => navigateTo('calendar', 'forward')}>
                  <CalendarDays size={18} strokeWidth={2.3} />
                </button>
                <button className="icon-button" type="button" onClick={refreshRuns}>
                  <RefreshCw
                    size={18}
                    strokeWidth={2.3}
                    className={isLoadingRuns ? 'spin-icon' : ''}
                  />
                </button>
              </div>
            </header>

            {syncMessage ? <p className="sync-banner">{syncMessage}</p> : null}

            <section className={`weather-card ${weatherRecommendation.tone}`}>
              <div>
                <p className="topbar-label">Weather today</p>
                <h2 className="weather-title">{weatherRecommendation.title}</h2>
                <p className="weather-copy">{weatherRecommendation.message}</p>
              </div>
              <div className="weather-meta">
                <strong>
                  {weatherState.temperature != null ? `${Math.round(weatherState.temperature)}°C` : '--'}
                </strong>
                <span>{weatherState.location.name}</span>
              </div>
            </section>

            {activityInbox.length ? (
              <section className="inbox-card">
                <div className="section-header">
                  <div>
                    <p className="topbar-label">Inbox</p>
                    <h2 className="section-title">New reply activity</h2>
                  </div>
                </div>
                <div className="inbox-list">
                  {activityInbox.slice(0, 3).map((item) => (
                    <article className="inbox-item" key={item.id}>
                      <span className={`avatar-badge ${getUserTone(item.author)}`}>{item.author?.slice(0, 1) || 'S'}</span>
                      <div>
                        <strong>{item.author} replied</strong>
                        <p>{item.runTitle}</p>
                      </div>
                      <small>{formatCommentTimestamp(item.createdAt)}</small>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="stats-grid" aria-label="Run stats">
              {stats.map((stat) => (
                <article className="stat-card" key={stat.label}>
                  <p className="label">{stat.label}</p>
                  <strong>{stat.value}</strong>
                </article>
              ))}
            </section>

            {featuredRun ? (
              <section className="editorial-section">
                <div className="section-header">
                  <div>
                    <p className="topbar-label">Latest run</p>
                    <h2 className="section-title">A fresh memory</h2>
                  </div>
                </div>
                <button
                  className="run-card run-card-featured"
                  type="button"
                  onClick={() => openRunDetails(featuredRun.id)}
                  style={
                    featuredRun.photos[0]?.src
                      ? {
                          backgroundImage: `linear-gradient(180deg, rgba(4, 16, 26, 0.08), rgba(4, 16, 26, 0.84)), url(${featuredRun.photos[0].src})`,
                          backgroundPosition: 'center 46%',
                        }
                      : undefined
                  }
                >
                  <div className="run-card-chips">
                    <span className="run-chip run-chip-animated">{featuredRun.distance}</span>
                    <span className="run-chip run-chip-animated">{featuredRun.duration}</span>
                    <span className="run-chip run-chip-animated">{getRunSpeedDisplay(featuredRun)}</span>
                  </div>

                  <div className="run-card-body">
                    <span className={`card-owner-badge ${getUserTone(featuredRun.owner)}`}>{featuredRun.owner || 'Shared'}</span>
                    <h2>{featuredRun.title}</h2>
                    <p>{featuredRun.note === 'No note' ? `${featuredRun.photos.length} photos waiting inside.` : featuredRun.note}</p>
                  </div>
                </button>
              </section>
            ) : null}

            <section className="editorial-section">
              {isLoadingRuns ? (
                <section className="empty-state">
                  <p className="topbar-label">Loading</p>
                  <h2>Fetching runs</h2>
                  <p>Your journal is loading.</p>
                </section>
              ) : runs.length ? (
                <>
                  <div className="section-header">
                    <div>
                      <p className="topbar-label">This week</p>
                      <h2 className="section-title">Journal entries</h2>
                    </div>
                  </div>
                  <div className="run-list">
                {journalRuns.map((run) => {
                  const coverPhoto = run.photos[0]?.src;

                  return (
                    <button
                      className="run-card"
                      key={run.id}
                      type="button"
                      onClick={() => openRunDetails(run.id)}
                      style={
                        coverPhoto
                          ? {
                              backgroundImage: `linear-gradient(180deg, rgba(4, 16, 26, 0.12), rgba(4, 16, 26, 0.78)), url(${coverPhoto})`,
                              backgroundPosition: 'center 44%',
                            }
                          : undefined
                      }
                    >
                      <div className="run-card-chips">
                        <span className="run-chip run-chip-animated">{run.distance}</span>
                        <span className="run-chip run-chip-animated">{run.duration}</span>
                      </div>

                      <div className="run-card-body">
                        <span className={`card-owner-badge ${getUserTone(run.owner)}`}>{run.owner || 'Shared'}</span>
                        <h2>{run.title}</h2>
                        <p>{formatRunDate(run.date, run.time)} - {run.time}</p>
                        {run.pendingSync ? <span className="pending-pill">Pending sync</span> : null}
                      </div>
                    </button>
                  );
                })
                  }</div>
                </>
              ) : (
                <section className="empty-state">
                  <p className="topbar-label">No runs yet</p>
                  <h2>Add your first run</h2>
                  <p>Start with one beautiful memory, then let the journal grow naturally.</p>
                  <button className="secondary-button empty-state-action" type="button" onClick={openCreateRun}>
                    Create first run
                  </button>
                </section>
              )}
            </section>

            {memoryPhotos.length ? (
              <section className="editorial-section">
                <div className="section-header">
                  <div>
                    <p className="topbar-label">Memories</p>
                    <h2 className="section-title">Recent photo moments</h2>
                  </div>
                </div>
                <div className="memory-strip">
                  {memoryPhotos.map((photo) => (
                    <article className="memory-card" key={photo.id}>
                      <img src={photo.src} alt={photo.title} loading="lazy" />
                      <span>{photo.runTitle}</span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {recentComments.length ? (
              <section className="editorial-section">
                <div className="section-header">
                  <div>
                    <p className="topbar-label">Comments</p>
                    <h2 className="section-title">Little notes between runs</h2>
                  </div>
                </div>
                <div className="comment-preview-list">
                  {recentComments.map((comment) => (
                    <article className={`comment-preview-card ${getUserTone(comment.author)}`} key={comment.id}>
                      <div className="comment-preview-head">
                        <span className={`avatar-badge ${getUserTone(comment.author)}`}>{comment.author?.slice(0, 1) || 'S'}</span>
                        <strong>{comment.author}</strong>
                      </div>
                      <p>{comment.text}</p>
                      <span>{comment.runTitle}</span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {runs.length > visibleRunCount ? (
              <button className="secondary-button load-more-button" type="button" onClick={() => setVisibleRunCount((current) => current + RUNS_PAGE_SIZE)}>
                Load more
              </button>
            ) : null}
            <button className="fab fab-icon-only" type="button" onClick={openCreateRun} aria-label="Add run">
              <Plus size={24} strokeWidth={2.6} />
            </button>
          </section>
        ) : null}

        {displayPage === 'create' ? (
          <section
            className={`screen page-shell page-${transitionStage} page-${pageDirection} create-screen`}
          >
            <header className="topbar">
              <button className="icon-button" type="button" onClick={() => navigateTo('home', 'backward')} aria-label="Back">
                <ArrowLeft size={18} strokeWidth={2.5} />
              </button>
              <div className="topbar-copy">
                <p className="topbar-label">{editingRun ? 'Edit run' : 'Add run'}</p>
                <h1>{editingRun ? 'Edit run' : 'New run'}</h1>
                <p className="hero-subtitle">
                  {editingRun
                    ? 'Refine the memory, keep the same atmosphere.'
                    : 'Shape the moment with distance, notes, and photos.'}
                </p>
              </div>
            </header>

            <section className="form-card premium-form-card">
              <div className="stepper-strip">
                {CREATE_STEPS.map((step, index) => (
                  <button
                    className={`step-pill ${index === createStep ? 'step-pill-active' : ''} ${index < createStep ? 'step-pill-complete' : ''}`}
                    key={step}
                    type="button"
                    onClick={() => {
                      if (index <= createStep) {
                        handleCreateStepChange(index);
                      }
                    }}
                  >
                    <span>{index + 1}</span>
                    <strong>{step}</strong>
                  </button>
                ))}
              </div>
              <h2>{editingRun ? 'Update your run' : 'Create a run with photos'}</h2>
              <form className="run-form" onSubmit={handleAddRun}>
                <div className="form-meta-row">
                  <span className="form-meta-pill">Date {newRun.date || getTodayDateValue()}</span>
                  <span className="form-meta-pill">Time {editingRun?.time ?? getCurrentTimeValue()}</span>
                </div>
                {createStep === 0 ? (
                  <section className="step-section">
                    <div className={`floating-field ${newRun.title ? 'floating-field-filled' : ''}`}>
                      <input
                        className={`run-input floating-input ${touchedFields.title && formErrors.title ? 'run-input-invalid' : ''}`}
                        name="title"
                        placeholder=" "
                        value={newRun.title}
                        onChange={handleFieldChange}
                        maxLength={MAX_TITLE_LENGTH}
                        required
                      />
                      <label className="floating-label">Run title</label>
                      {touchedFields.title && formErrors.title ? (
                        <p className="field-error">{formErrors.title}</p>
                      ) : null}
                    </div>
                    <div className="run-form-grid">
                      <div className={`floating-field ${newRun.distance ? 'floating-field-filled' : ''}`}>
                        <input
                          className={`run-input floating-input ${touchedFields.distance && formErrors.distance ? 'run-input-invalid' : ''}`}
                          name="distance"
                          placeholder=" "
                          inputMode="decimal"
                          type="number"
                          min="0.1"
                          max={MAX_DISTANCE_KM}
                          step="0.1"
                          value={newRun.distance}
                          onChange={handleFieldChange}
                          required
                        />
                        <label className="floating-label">Distance (km)</label>
                        {touchedFields.distance && formErrors.distance ? (
                          <p className="field-error">{formErrors.distance}</p>
                        ) : null}
                      </div>
                      <div className={`floating-field ${newRun.duration ? 'floating-field-filled' : ''}`}>
                        <input
                          className={`run-input floating-input ${touchedFields.duration && formErrors.duration ? 'run-input-invalid' : ''}`}
                          name="duration"
                          placeholder=" "
                          inputMode="decimal"
                          type="number"
                          min="1"
                          max={MAX_DURATION_MINUTES}
                          step="1"
                          value={newRun.duration}
                          onChange={handleFieldChange}
                          required
                        />
                        <label className="floating-label">Time (min)</label>
                        {touchedFields.duration && formErrors.duration ? (
                          <p className="field-error">{formErrors.duration}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className={`floating-field ${newRun.date ? 'floating-field-filled' : ''}`}>
                      <input
                        className={`run-input floating-input ${touchedFields.date && formErrors.date ? 'run-input-invalid' : ''}`}
                        name="date"
                        placeholder=" "
                        type="date"
                        min={MIN_RUN_DATE}
                        max={getTodayDateValue()}
                        value={newRun.date}
                        onChange={handleFieldChange}
                        required
                      />
                      <label className="floating-label">Date</label>
                      {touchedFields.date && formErrors.date ? (
                        <p className="field-error">{formErrors.date}</p>
                      ) : null}
                    </div>
                    <div className={`floating-field ${newRun.location ? 'floating-field-filled' : ''}`}>
                      <input
                        className={`run-input floating-input ${touchedFields.location && formErrors.location ? 'run-input-invalid' : ''}`}
                        name="location"
                        placeholder=" "
                        value={newRun.location}
                        onChange={handleFieldChange}
                        maxLength={MAX_LOCATION_LENGTH}
                      />
                      <label className="floating-label">Location</label>
                      {touchedFields.location && formErrors.location ? (
                        <p className="field-error">{formErrors.location}</p>
                      ) : null}
                    </div>
                    <div className={`floating-field floating-field-textarea ${newRun.note ? 'floating-field-filled' : ''}`}>
                      <textarea
                        className={`run-input run-textarea floating-input ${touchedFields.note && formErrors.note ? 'run-input-invalid' : ''}`}
                        name="note"
                        placeholder=" "
                        value={newRun.note}
                        onChange={handleFieldChange}
                        maxLength={MAX_NOTE_LENGTH}
                      />
                      <label className="floating-label">Notes about this run</label>
                      {touchedFields.note && formErrors.note ? (
                        <p className="field-error">{formErrors.note}</p>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {createStep === 1 ? (
                  <section className="step-section">
                    <label className="upload-button upload-button-large">
                      {editingRun ? 'Add more photos' : 'Choose photos'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handlePhotoChange}
                        required={!editingRun}
                      />
                    </label>
                    {touchedFields.photos && formErrors.photos ? (
                      <p className="field-error">{formErrors.photos}</p>
                    ) : null}
                    {(photoPreviews.length || editingRun?.photos.length) ? (
                      <section className="photo-preview-panel">
                        <div className="photo-preview-header">
                          <p className="label">Photos preview</p>
                          <span className="preview-badge">
                            {photoPreviews.length || editingRun?.photos.length || 0}
                          </span>
                        </div>
                        {photoPreviews.length ? (
                          <div className="photo-preview-grid">
                            {photoPreviews.map((preview) => (
                              <article className="photo-preview-card" key={preview.id}>
                                <img src={preview.url} alt={preview.name} loading="lazy" />
                              </article>
                            ))}
                          </div>
                        ) : editingRun?.photos.length ? (
                          <div className="photo-preview-grid">
                            {editingRun.photos.slice(0, 6).map((photo) => (
                              <article className="photo-preview-card" key={photo.id}>
                                <img src={photo.src} alt={photo.title} loading="lazy" />
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </section>
                ) : null}
                {createStep === 2 ? (
                  <section className="step-section">
                    <article className="route-step-card">
                      <p className="topbar-label">Route</p>
                      <h3>Finish this memory gently</h3>
                      <p className="route-step-note">
                        Route tools are intentionally hidden right now, but the route code is still saved for future updates.
                      </p>
                      <div className="route-summary-grid">
                        <div>
                          <span>Location</span>
                          <strong>{newRun.location.trim() || 'No location yet'}</strong>
                        </div>
                        <div>
                          <span>Date</span>
                          <strong>{newRun.date || getTodayDateValue()}</strong>
                        </div>
                      </div>
                    </article>
                  </section>
                ) : null}
                {formError ? <p className="form-error">{formError}</p> : null}
                <div className="form-action-bar">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleCreateStepChange(Math.max(createStep - 1, 0))}
                    disabled={createStep === 0}
                  >
                    Back
                  </button>
                  {createStep < CREATE_STEPS.length - 1 ? (
                    <button className="primary-button" type="button" onClick={handleContinueCreate}>
                      Continue
                    </button>
                  ) : (
                    <button className="primary-button" type="submit" disabled={!isFormValid || isSavingRun}>
                      {isSavingRun ? 'Saving...' : editingRun ? 'Save changes' : 'Add run'}
                    </button>
                  )}
                </div>
              </form>
            </section>
          </section>
        ) : null}

        {displayPage === 'calendar' ? (
          <section
            className={`screen page-shell page-${transitionStage} page-${pageDirection} calendar-screen`}
          >
            <header className="topbar">
              <button className="icon-button" type="button" onClick={() => navigateTo('home', 'backward')} aria-label="Back">
                <ArrowLeft size={18} strokeWidth={2.5} />
              </button>
              <div className="topbar-copy">
                <p className="topbar-label">Calendar</p>
                <h1>{formatMonthLabel(calendarMonth)}</h1>
                <p className="hero-subtitle">Browse your runs month by month and jump back into them.</p>
              </div>
            </header>

            <section className="calendar-card">
              <div className="calendar-nav">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setCalendarMonth((current) => shiftMonth(current, -1))}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={18} strokeWidth={2.5} />
                </button>
                <p>{formatMonthLabel(calendarMonth)}</p>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setCalendarMonth((current) => shiftMonth(current, 1))}
                  aria-label="Next month"
                >
                  <ChevronRight size={18} strokeWidth={2.5} />
                </button>
              </div>

              <div className="calendar-weekdays">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className="calendar-grid">
                {calendarDays.map((day, index) => {
                  if (!day) {
                    return <div className="calendar-cell calendar-cell-empty" key={`empty-${index}`} />;
                  }

                  const dateKey = formatCalendarKey(day);
                  const runsForDate = runsByDate[dateKey] ?? [];
                  const isToday = dateKey === formatCalendarKey(new Date());

                  return (
                    <button
                      className={`calendar-cell ${runsForDate.length ? 'calendar-cell-has-runs' : ''} ${isToday ? 'calendar-cell-today' : ''}`}
                      key={dateKey}
                      type="button"
                      onClick={() => openDateRuns(dateKey)}
                    >
                      <span>{day.getDate()}</span>
                      {runsForDate.length ? <strong>{runsForDate.length}</strong> : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="details-card">
              <h3>Runs this month</h3>
              {runs.filter((run) => {
                const runDate = new Date(`${run.date}T00:00:00`);
                return (
                  runDate.getFullYear() === calendarMonth.getFullYear() &&
                  runDate.getMonth() === calendarMonth.getMonth()
                );
              }).length ? (
                <div className="calendar-run-list">
                  {runs
                    .filter((run) => {
                      const runDate = new Date(`${run.date}T00:00:00`);
                      return (
                        runDate.getFullYear() === calendarMonth.getFullYear() &&
                        runDate.getMonth() === calendarMonth.getMonth()
                      );
                    })
                    .map((run) => (
                      <button
                        className="calendar-run-row"
                        key={run.id}
                        type="button"
                        onClick={() => openRunDetails(run.id)}
                      >
                        <div>
                          <p className="topbar-label">{formatRunDate(run.date, run.time)}</p>
                          <h3>{run.title}</h3>
                          <p>{run.distance} - {run.duration}</p>
                        </div>
                        <span className="session-count">{run.photos.length}</span>
                      </button>
                    ))}
                </div>
              ) : (
                <p className="details-empty calendar-empty">No runs in this month.</p>
              )}
            </section>
          </section>
        ) : null}

        {displayPage === 'details' && selectedRun ? (
          <section
            className={`screen page-shell page-${transitionStage} page-${pageDirection} details-screen`}
          >
            <section
              className="details-hero"
              style={
                selectedRun.photos[0]?.src
                  ? {
                      backgroundImage: `linear-gradient(180deg, rgba(4, 16, 26, 0.2), rgba(4, 16, 26, 0.82)), url(${selectedRun.photos[0].src})`,
                    }
                  : undefined
              }
            >
              <header className="topbar topbar-overlay">
                <button
                  className="icon-button icon-button-overlay"
                  type="button"
                  onClick={() => navigateTo('home', 'backward')}
                  aria-label="Back"
                >
                  <ArrowLeft size={18} strokeWidth={2.5} />
                </button>
                <div className="topbar-copy">
                  <h1>{formatRunDate(selectedRun.date, selectedRun.time)} - {selectedRun.time}</h1>
                </div>
                <div className="hero-menu-shell">
                  <button
                    className="icon-button icon-button-overlay"
                    type="button"
                    onClick={() => setIsDetailsMenuOpen((current) => !current)}
                    aria-label="Open run menu"
                    aria-expanded={isDetailsMenuOpen}
                  >
                    <MoreVertical size={18} strokeWidth={2.5} />
                  </button>
                  {isDetailsMenuOpen ? (
                    <div className="hero-menu">
                      <button
                        className="hero-menu-item"
                        type="button"
                        onClick={() => {
                          setIsDetailsMenuOpen(false);
                          openEditRun();
                        }}
                      >
                        <Pencil size={16} strokeWidth={2.2} />
                        <span>Edit run</span>
                      </button>
                      <button
                        className="hero-menu-item hero-menu-item-danger"
                        type="button"
                        onClick={() => {
                          setIsDetailsMenuOpen(false);
                          handleDeleteRun();
                        }}
                        disabled={isDeletingRun}
                      >
                        <Trash2 size={16} strokeWidth={2.2} />
                        <span>{isDeletingRun ? 'Deleting...' : 'Delete run'}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </header>

              <div className="details-hero-copy">
                <h2>{selectedRun.title}</h2>
                <div className="details-chips">
                  <span className="run-chip">{selectedRun.distance}</span>
                  <span className="run-chip">{selectedRun.duration}</span>
                  <span className="run-chip">{getRunSpeedDisplay(selectedRun)}</span>
                  <span className="run-chip">{selectedRun.photos.length} photos</span>
                </div>
              </div>
            </section>

            <section className="details-card">
              <div className="details-card-header">
                <h3>Details</h3>
              </div>
              <div className="details-grid">
                <p>Created</p>
                <strong>{formatRunDate(selectedRun.date, selectedRun.time)} - {selectedRun.time}</strong>
                <p>Distance</p>
                <strong>{selectedRun.distance}</strong>
                <p>Duration</p>
                <strong>{selectedRun.duration}</strong>
                <p>Speed</p>
                <strong>{getRunSpeedDisplay(selectedRun)}</strong>
                <p>Location</p>
                <strong>{selectedRun.location}</strong>
              </div>
              <p className="details-note">{selectedRun.note}</p>
            </section>

            <section className="details-card">
              <h3>Photos</h3>
              {selectedRun.photos.length ? (
                <div className="photo-grid">
                  {selectedRun.photos.map((photo, index) => (
                    <button
                    className="photo-thumb"
                    key={photo.id}
                    type="button"
                    onClick={() => setActivePhotoIndex(index)}
                  >
                      <img src={photo.src} alt={photo.title} loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="details-empty">No photos for this run.</p>
              )}
            </section>

            <section className="details-card">
              <div className="details-card-header">
                <h3>Comments</h3>
                <div className="details-actions">
                  <MessageCircle size={16} strokeWidth={2.2} />
                </div>
              </div>
              <form className="comment-form" onSubmit={handleAddComment}>
                <textarea
                  className="run-input comment-input"
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder={`Write a comment as ${accessUser || 'Guest'}`}
                />
                <button className="secondary-button" type="submit">
                  Add comment
                </button>
              </form>
              {orderedComments.length ? (
                <div className="comment-list">
                  {orderedComments.map((comment) => (
                    <article
                      className="comment-item"
                      key={comment.id}
                      onPointerDown={() =>
                        startCommentLongPress(
                          { type: 'comment', commentId: comment.id },
                          comment.author,
                          comment.text,
                        )
                      }
                      onPointerUp={stopCommentLongPress}
                      onPointerLeave={stopCommentLongPress}
                      onPointerCancel={stopCommentLongPress}
                    >
                      <div className={`comment-surface ${getUserTone(comment.author)} ${comment.author === accessUser ? 'comment-surface-owned' : ''}`}>
                      <div className="comment-head">
                        <div className="comment-author">
                          <span className={`avatar-badge ${getUserTone(comment.author)}`}>{comment.author?.slice(0, 1) || 'S'}</span>
                          <strong>{comment.author}</strong>
                        </div>
                        <div className="comment-head-actions">
                          {comment.pinned ? <span className="pinned-badge">Pinned</span> : null}
                          <button
                            className="comment-reply-button"
                            type="button"
                            onClick={() => {
                              setReplyingToCommentId((current) => (current === comment.id ? '' : comment.id));
                              setReplyText('');
                            }}
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                      <div className="comment-meta-row">
                        <span>{formatCommentTimestamp(comment.createdAt)}</span>
                        {comment.editedAt ? <span>edited</span> : null}
                      </div>
                      <p>{comment.text}</p>
                      <div className="reaction-row">
                        {[
                          { key: 'love', label: 'Love', icon: '♡' },
                          { key: 'fire', label: 'Fire', icon: '✦' },
                          { key: 'clap', label: 'Clap', icon: '👏' },
                        ].map((reaction) => {
                          const reactionCount = comment.reactions?.[reaction.key]?.length ?? 0;
                          const active = comment.reactions?.[reaction.key]?.includes(accessUser);

                          return (
                            <button
                              className={`reaction-chip ${active ? 'reaction-chip-active' : ''}`}
                              key={reaction.key}
                              type="button"
                              onClick={() => handleToggleReaction({ type: 'comment', commentId: comment.id }, reaction.key)}
                            >
                              <span>{reaction.icon}</span>
                              {reactionCount ? <strong>{reactionCount}</strong> : null}
                            </button>
                          );
                        })}
                      </div>
                      {commentActionTarget?.type === 'comment' && commentActionTarget.commentId === comment.id ? (
                        <div className="comment-action-sheet">
                          <p className="comment-action-meta">
                            {formatCommentTimestamp(activeCommentTargetItem?.createdAt)}
                            {activeCommentTargetItem?.editedAt ? ' • edited' : ''}
                          </p>
                          <textarea
                            className="run-input comment-input reply-input"
                            value={commentEditText}
                            onChange={(event) => setCommentEditText(event.target.value)}
                            placeholder="Edit your comment"
                          />
                          <div className="reply-form-actions">
                            <button className="secondary-button" type="button" onClick={handleSaveCommentEdit}>
                              Save
                            </button>
                            <button className="danger-button" type="button" onClick={handleDeleteCommentTarget}>
                              Delete
                            </button>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => handleTogglePinnedComment(comment.id)}
                            >
                              {comment.pinned ? 'Unpin' : 'Pin'}
                            </button>
                            <button
                              className="comment-reply-button"
                              type="button"
                              onClick={() => {
                                setCommentActionTarget(null);
                                setCommentEditText('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {comment.replies?.length ? (
                        <div className="reply-list">
                          {comment.replies.map((reply) => (
                            <article
                              className={`reply-item ${getUserTone(reply.author)}`}
                              key={reply.id}
                              onPointerDown={() =>
                                startCommentLongPress(
                                  { type: 'reply', commentId: comment.id, replyId: reply.id },
                                  reply.author,
                                  reply.text,
                                )
                              }
                              onPointerUp={stopCommentLongPress}
                              onPointerLeave={stopCommentLongPress}
                              onPointerCancel={stopCommentLongPress}
                            >
                              <div className="comment-author">
                                <span className={`avatar-badge ${getUserTone(reply.author)}`}>{reply.author?.slice(0, 1) || 'S'}</span>
                                <strong>{reply.author}</strong>
                              </div>
                              <div className="comment-meta-row">
                                <span>{formatCommentTimestamp(reply.createdAt)}</span>
                                {reply.editedAt ? <span>edited</span> : null}
                              </div>
                              <p>{reply.text}</p>
                              <div className="reaction-row reaction-row-reply">
                                {[
                                  { key: 'love', label: 'Love', icon: '♡' },
                                  { key: 'fire', label: 'Fire', icon: '✦' },
                                  { key: 'clap', label: 'Clap', icon: '👏' },
                                ].map((reaction) => {
                                  const reactionCount = reply.reactions?.[reaction.key]?.length ?? 0;
                                  const active = reply.reactions?.[reaction.key]?.includes(accessUser);

                                  return (
                                    <button
                                      className={`reaction-chip ${active ? 'reaction-chip-active' : ''}`}
                                      key={reaction.key}
                                      type="button"
                                      onClick={() =>
                                        handleToggleReaction(
                                          { type: 'reply', commentId: comment.id, replyId: reply.id },
                                          reaction.key,
                                        )
                                      }
                                    >
                                      <span>{reaction.icon}</span>
                                      {reactionCount ? <strong>{reactionCount}</strong> : null}
                                    </button>
                                  );
                                })}
                              </div>
                              {commentActionTarget?.type === 'reply' &&
                              commentActionTarget.commentId === comment.id &&
                              commentActionTarget.replyId === reply.id ? (
                                <div className="comment-action-sheet reply-action-sheet">
                                  <p className="comment-action-meta">
                                    {formatCommentTimestamp(activeCommentTargetItem?.createdAt)}
                                    {activeCommentTargetItem?.editedAt ? ' • edited' : ''}
                                  </p>
                                  <textarea
                                    className="run-input comment-input reply-input"
                                    value={commentEditText}
                                    onChange={(event) => setCommentEditText(event.target.value)}
                                    placeholder="Edit your reply"
                                  />
                                  <div className="reply-form-actions">
                                    <button className="secondary-button" type="button" onClick={handleSaveCommentEdit}>
                                      Save
                                    </button>
                                    <button className="danger-button" type="button" onClick={handleDeleteCommentTarget}>
                                      Delete
                                    </button>
                                    <button
                                      className="comment-reply-button"
                                      type="button"
                                      onClick={() => {
                                        setCommentActionTarget(null);
                                        setCommentEditText('');
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : null}
                      {replyingToCommentId === comment.id ? (
                        <form className="reply-form" onSubmit={(event) => handleAddReply(event, comment.id)}>
                          <p className="replying-label">Replying to {comment.author}</p>
                          <textarea
                            className="run-input comment-input reply-input"
                            value={replyText}
                            onChange={(event) => setReplyText(event.target.value)}
                            placeholder={`Write something back as ${accessUser || 'Guest'}`}
                          />
                          <div className="reply-form-actions">
                            <button className="secondary-button" type="submit">
                              Send reply
                            </button>
                            <button
                              className="comment-reply-button"
                              type="button"
                              onClick={() => {
                                setReplyingToCommentId('');
                                setReplyText('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="details-empty">Start the story of this run.</p>
              )}
            </section>
          </section>
        ) : null}

        {selectedRun && activePhotoIndex >= 0 ? (
          <div className="gallery-overlay" role="dialog" aria-modal="true">
            <button className="gallery-backdrop" type="button" onClick={closeGallery} aria-label="Close gallery" />
            <div className="gallery-panel">
              <div className="gallery-header">
                <div className="gallery-meta">
                  <p>
                    {activePhotoIndex + 1} / {selectedRun.photos.length}
                  </p>
                </div>
                <div className="gallery-header-actions">
                  <div className="hero-menu-shell">
                    <button
                      className="icon-button gallery-close"
                      type="button"
                      onClick={() => setIsGalleryMenuOpen((current) => !current)}
                      aria-label="Open photo menu"
                      aria-expanded={isGalleryMenuOpen}
                    >
                      <MoreVertical size={18} strokeWidth={2.3} />
                    </button>
                    {isGalleryMenuOpen ? (
                      <div className="hero-menu gallery-menu">
                        <button
                          className="hero-menu-item hero-menu-item-danger"
                          type="button"
                          onClick={() => {
                            setIsGalleryMenuOpen(false);
                            handleDeletePhoto();
                          }}
                          disabled={isDeletingPhoto}
                        >
                          <Trash2 size={16} strokeWidth={2.2} />
                          <span>{isDeletingPhoto ? 'Deleting...' : 'Delete photo'}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button className="icon-button gallery-close" type="button" onClick={closeGallery} aria-label="Close gallery">
                    <X size={18} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
              <div
                className="gallery-stage"
                onClick={handleGalleryStageClick}
                onTouchStart={handleGalleryTouchStart}
                onTouchEnd={handleGalleryTouchEnd}
              >
                <div className="gallery-touch-zone gallery-touch-zone-left" aria-hidden="true">
                  <ChevronLeft size={20} strokeWidth={2.3} />
                </div>
                <img
                  className={`gallery-image ${isPhotoZoomed ? 'gallery-image-zoomed' : ''}`}
                  src={selectedRun.photos[activePhotoIndex]?.src}
                  alt={selectedRun.photos[activePhotoIndex]?.title ?? selectedRun.title}
                  loading="lazy"
                />
                <div className="gallery-touch-zone gallery-touch-zone-right" aria-hidden="true">
                  <ChevronRight size={20} strokeWidth={2.3} />
                </div>
              </div>
              <div className="gallery-footer">
                <p>Swipe or tap the sides to change photo.</p>
                <span>{isPhotoZoomed ? 'Double tap to fit' : 'Double tap to zoom'}</span>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
