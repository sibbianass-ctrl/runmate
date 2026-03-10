import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { deletePhotoFromRun, deleteRun, fetchRuns, isCloudEnabled, saveRun, updateRun } from './data/runStore';

const stats = [
  { label: 'Distance', value: '8.4 km' },
  { label: 'Pace', value: "4'52" },
];

const initialRuns = [];

function getCurrentTimeValue() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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

function calculatePace(distanceValue, durationValue) {
  const distanceKm = parseDistanceKm(distanceValue);
  const durationMinutes = parseDurationMinutes(durationValue);

  if (!distanceKm || !durationMinutes) {
    return null;
  }

  const rawPace = durationMinutes / distanceKm;
  const wholeMinutes = Math.floor(rawPace);
  const roundedSeconds = Math.round((rawPace - wholeMinutes) * 60);
  const minutes = roundedSeconds === 60 ? wholeMinutes + 1 : wholeMinutes;
  const seconds = roundedSeconds === 60 ? 0 : roundedSeconds;

  return `${minutes}:${String(seconds).padStart(2, '0')} /km`;
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
    date: '',
    distance: '',
    duration: '',
    location: '',
    note: '',
    photos: [],
  });
  const [formError, setFormError] = useState('');
  const [isSavingRun, setIsSavingRun] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [isDeletingRun, setIsDeletingRun] = useState(false);
  const [isDeletingPhoto, setIsDeletingPhoto] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(-1);
  const [isPhotoZoomed, setIsPhotoZoomed] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

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

  const isFormValid =
    Boolean(newRun.title.trim()) &&
    Boolean(newRun.date) &&
    Boolean(newRun.distance.trim()) &&
    Boolean(newRun.duration.trim()) &&
    (editingRun ? true : newRun.photos.length > 0);

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      try {
        setIsLoadingRuns(true);
        const loadedRuns = await fetchRuns();
        if (cancelled) {
          return;
        }

        setRuns(loadedRuns);
        setSelectedRunId((current) =>
          loadedRuns.some((run) => run.id === current) ? current : (loadedRuns[0]?.id ?? ''),
        );
        setSyncMessage(isCloudEnabled() ? 'Shared cloud sync is active.' : 'Local-only mode is active.');
      } catch {
        if (!cancelled) {
          setSyncMessage('Runs could not be loaded. The app is still available.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRuns(false);
        }
      }
    }

    loadRuns();

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
    setNewRun({
      title: '',
      date: '',
      distance: '',
      duration: '',
      location: '',
      note: '',
      photos: [],
    });
    setFormError('');
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
      photos: [],
    });
    setFormError('');
    navigateTo('create', 'forward');
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
    } catch {
      setSyncMessage('Runs could not be refreshed right now.');
    } finally {
      setIsLoadingRuns(false);
    }
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

  function handleFieldChange(event) {
    const { name, value } = event.target;
    setFormError('');
    setNewRun((current) => ({ ...current, [name]: value }));
  }

  function handlePhotoChange(event) {
    const files = Array.from(event.target.files ?? []);
    setFormError('');
    setNewRun((current) => ({ ...current, photos: files }));
  }

  async function handleAddRun(event) {
    event.preventDefault();

    if (!isFormValid) {
      setFormError('Complete title, date, distance in km, duration in minutes, and photos.');
      return;
    }

    const pace = calculatePace(newRun.distance, newRun.duration);

    if (!pace) {
      setFormError('Use a valid distance and duration so pace can be calculated.');
      return;
    }

    try {
      setIsSavingRun(true);
      const runPayload = {
        title: newRun.title.trim(),
        date: newRun.date,
        time: editingRun?.time ?? getCurrentTimeValue(),
        distance: formatDistance(newRun.distance),
        duration: formatDuration(newRun.duration),
        pace,
        location: newRun.location.trim() || 'No location',
        note: newRun.note.trim() || 'No note',
        createdAtMs: editingRun?.createdAtMs ?? Date.now(),
        photos: editingRun?.photos ?? [],
      };

      const savedRun = editingRun
        ? await updateRun(editingRun.id, runPayload, newRun.photos)
        : await saveRun({ ...runPayload, photos: newRun.photos });

      setRuns((current) =>
        editingRun
          ? current.map((run) => (run.id === savedRun.id ? savedRun : run))
          : [savedRun, ...current],
      );
      setSelectedRunId(savedRun.id);
      navigateTo(editingRun ? 'details' : 'home', 'backward');
      setEditingRunId('');
      setNewRun({
        title: '',
        date: '',
        distance: '',
        duration: '',
        location: '',
        note: '',
        photos: [],
      });
      setFormError('');
      setSyncMessage(
        editingRun
          ? isCloudEnabled()
            ? 'Run updated in shared storage.'
            : 'Run updated on this device.'
          : isCloudEnabled()
            ? 'Run saved and shared across devices.'
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

  return (
    <>
      <div className="desktop-blocker">
        <div className="desktop-card">
          <p className="desktop-eyebrow">Phone only</p>
          <h1>Runmate is designed for mobile screens.</h1>
          <p>Open this app on a phone-sized viewport to use the running journal.</p>
        </div>
      </div>

      <main className="app-shell">
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
                <p className="hero-subtitle">Build a soft little archive for every run you keep.</p>
              </div>
              <div className="topbar-actions">
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

            <section className="stats-grid" aria-label="Run stats">
              {stats.map((stat) => (
                <article className="stat-card" key={stat.label}>
                  <p className="label">{stat.label}</p>
                  <strong>{stat.value}</strong>
                </article>
              ))}
            </section>

            <section className="run-list">
              {isLoadingRuns ? (
                <section className="empty-state">
                  <p className="topbar-label">Loading</p>
                  <h2>Fetching runs</h2>
                  <p>Your journal is loading.</p>
                </section>
              ) : runs.length ? (
                runs.map((run) => {
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
                            }
                          : undefined
                      }
                    >
                      <div className="run-card-chips">
                        <span className="run-chip">{run.distance}</span>
                        <span className="run-chip">{run.duration}</span>
                      </div>

                      <div className="run-card-body">
                        <h2>{run.title}</h2>
                        <p>{formatRunDate(run.date, run.time)} - {run.time}</p>
                      </div>
                    </button>
                  );
                })
              ) : (
                <section className="empty-state">
                  <p className="topbar-label">No runs yet</p>
                  <h2>Add your first run</h2>
                  <p>Create a run with photos from the button below.</p>
                </section>
              )}
            </section>

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

            <section className="form-card">
              <h2>{editingRun ? 'Update your run' : 'Create a run with photos'}</h2>
              <form className="run-form" onSubmit={handleAddRun}>
                <input
                  className="run-input"
                  name="title"
                  placeholder="Run title"
                  value={newRun.title}
                  onChange={handleFieldChange}
                  required
                />
                <div className="run-form-grid">
                  <input
                    className="run-input"
                    name="distance"
                    placeholder="Distance (km)"
                    inputMode="decimal"
                    value={newRun.distance}
                    onChange={handleFieldChange}
                    required
                  />
                  <input
                    className="run-input"
                    name="duration"
                    placeholder="Duration (min)"
                    inputMode="decimal"
                    value={newRun.duration}
                    onChange={handleFieldChange}
                    required
                  />
                </div>
                <input
                  className="run-input"
                  name="date"
                  type="date"
                  value={newRun.date}
                  onChange={handleFieldChange}
                  required
                />
                <input
                  className="run-input"
                  name="location"
                  placeholder="Location"
                  value={newRun.location}
                  onChange={handleFieldChange}
                />
                <textarea
                  className="run-input run-textarea"
                  name="note"
                  placeholder="Notes about this run"
                  value={newRun.note}
                  onChange={handleFieldChange}
                />
                <label className="upload-button">
                  {editingRun ? 'Add more photos' : 'Choose photos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoChange}
                    required={!editingRun}
                  />
                </label>
                <p className="photo-count">
                  {editingRun
                    ? newRun.photos.length
                      ? `${newRun.photos.length} new photo(s) selected`
                      : `${editingRun.photos.length} existing photo(s)`
                    : newRun.photos.length
                      ? `${newRun.photos.length} photo(s) selected`
                      : 'No photos selected'}
                </p>
                <p className="photo-count">Creation time is added automatically when you submit.</p>
                {formError ? <p className="form-error">{formError}</p> : null}
                <button className="primary-button" type="submit" disabled={!isFormValid || isSavingRun}>
                  {isSavingRun ? 'Saving...' : editingRun ? 'Save changes' : 'Add run'}
                </button>
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
              </header>

              <div className="details-hero-copy">
                <h2>{selectedRun.title}</h2>
                <div className="details-chips">
                  <span className="run-chip">{selectedRun.distance}</span>
                  <span className="run-chip">{selectedRun.duration}</span>
                  <span className="run-chip">{selectedRun.pace}</span>
                  <span className="run-chip">{selectedRun.photos.length} photos</span>
                </div>
              </div>
            </section>

            <section className="details-card">
              <div className="details-card-header">
                <h3>Details</h3>
                <div className="details-actions">
                  <button className="secondary-button" type="button" onClick={openEditRun}>
                    <Pencil size={16} strokeWidth={2.2} />
                    <span>Edit run</span>
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={handleDeleteRun}
                    disabled={isDeletingRun}
                  >
                    <Trash2 size={16} strokeWidth={2.2} />
                    <span>{isDeletingRun ? 'Deleting...' : 'Delete run'}</span>
                  </button>
                </div>
              </div>
              <div className="details-grid">
                <p>Created</p>
                <strong>{formatRunDate(selectedRun.date, selectedRun.time)} - {selectedRun.time}</strong>
                <p>Distance</p>
                <strong>{selectedRun.distance}</strong>
                <p>Duration</p>
                <strong>{selectedRun.duration}</strong>
                <p>Pace</p>
                <strong>{selectedRun.pace}</strong>
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
                      <img src={photo.src} alt={photo.title} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="details-empty">No photos for this run.</p>
              )}
            </section>
          </section>
        ) : null}

        {selectedRun && activePhotoIndex >= 0 ? (
          <div className="gallery-overlay" role="dialog" aria-modal="true">
            <button className="gallery-backdrop" type="button" onClick={closeGallery} aria-label="Close gallery" />
            <div className="gallery-panel">
              <div className="gallery-header">
                <p>
                  {activePhotoIndex + 1} / {selectedRun.photos.length}
                </p>
                <button className="icon-button gallery-close" type="button" onClick={closeGallery} aria-label="Close gallery">
                  <X size={18} strokeWidth={2.5} />
                </button>
              </div>
              <img
                className={`gallery-image ${isPhotoZoomed ? 'gallery-image-zoomed' : ''}`}
                src={selectedRun.photos[activePhotoIndex]?.src}
                alt={selectedRun.photos[activePhotoIndex]?.title ?? selectedRun.title}
                onClick={() => setIsPhotoZoomed((current) => !current)}
              />
              <div className="gallery-controls">
                <button
                  className="secondary-button gallery-button"
                  type="button"
                  onClick={() => setIsPhotoZoomed((current) => !current)}
                >
                  {isPhotoZoomed ? <ZoomOut size={16} strokeWidth={2.2} /> : <ZoomIn size={16} strokeWidth={2.2} />}
                  <span>{isPhotoZoomed ? 'Fit' : 'Zoom'}</span>
                </button>
                <button className="secondary-button gallery-button" type="button" onClick={showPreviousPhoto}>
                  <ChevronLeft size={16} strokeWidth={2.2} />
                  <span>Prev</span>
                </button>
                <button className="secondary-button gallery-button" type="button" onClick={showNextPhoto}>
                  <ChevronRight size={16} strokeWidth={2.2} />
                  <span>Next</span>
                </button>
                <button
                  className="danger-button gallery-button"
                  type="button"
                  onClick={handleDeletePhoto}
                  disabled={isDeletingPhoto}
                >
                  <Trash2 size={16} strokeWidth={2.2} />
                  <span>{isDeletingPhoto ? 'Deleting...' : 'Delete'}</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
