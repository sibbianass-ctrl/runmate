import { useEffect, useMemo, useState } from 'react';
import { deleteRun, fetchRuns, isCloudEnabled, saveRun } from './data/runStore';

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

export default function App() {
  const [runs, setRuns] = useState(initialRuns);
  const [page, setPage] = useState('home');
  const [displayPage, setDisplayPage] = useState('home');
  const [transitionStage, setTransitionStage] = useState('entered');
  const [selectedRunId, setSelectedRunId] = useState('');
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
  const [syncMessage, setSyncMessage] = useState('');

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );

  const isFormValid =
    Boolean(newRun.title.trim()) &&
    Boolean(newRun.date) &&
    Boolean(newRun.distance.trim()) &&
    Boolean(newRun.duration.trim()) &&
    newRun.photos.length > 0;

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

  function openRunDetails(runId) {
    setSelectedRunId(runId);
    setPage('details');
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
      setPage('home');
      setSyncMessage(
        isCloudEnabled() ? 'Run deleted from shared storage.' : 'Run deleted from this device.',
      );
    } catch {
      setSyncMessage('Run could not be deleted right now.');
    } finally {
      setIsDeletingRun(false);
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
      const createdRun = {
        title: newRun.title.trim(),
        date: newRun.date,
        time: getCurrentTimeValue(),
        distance: formatDistance(newRun.distance),
        duration: formatDuration(newRun.duration),
        pace,
        location: newRun.location.trim() || 'No location',
        note: newRun.note.trim() || 'No note',
        createdAtMs: Date.now(),
        photos: newRun.photos,
      };

      const savedRun = await saveRun(createdRun);
      setRuns((current) => [savedRun, ...current]);
      setSelectedRunId(savedRun.id);
      setPage('home');
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
        isCloudEnabled() ? 'Run saved and shared across devices.' : 'Run saved on this device only.',
      );
      event.target.reset();
    } catch {
      setFormError(
        isCloudEnabled()
          ? 'Run could not be uploaded. Check the Firebase config and rules.'
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
        {displayPage === 'home' ? (
          <section className={`screen page-shell page-${transitionStage}`}>
            <header className="topbar">
              <div>
                <p className="topbar-label">Journal</p>
                <h1>Run Journal</h1>
              </div>
              <button className="icon-button" type="button" onClick={refreshRuns}>
                {isLoadingRuns ? '...' : 'R'}
              </button>
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

            <button className="fab" type="button" onClick={() => setPage('create')}>
              <span className="fab-plus">+</span>
              <span>New run</span>
            </button>
          </section>
        ) : null}

        {displayPage === 'create' ? (
          <section className={`screen page-shell page-${transitionStage}`}>
            <header className="topbar">
              <button className="icon-button" type="button" onClick={() => setPage('home')}>
                {'<'}
              </button>
              <div className="topbar-copy">
                <p className="topbar-label">Add run</p>
                <h1>New run</h1>
              </div>
            </header>

            <section className="form-card">
              <h2>Create a run with photos</h2>
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
                  Choose photos
                  <input type="file" accept="image/*" multiple onChange={handlePhotoChange} required />
                </label>
                <p className="photo-count">
                  {newRun.photos.length ? `${newRun.photos.length} photo(s) selected` : 'No photos selected'}
                </p>
                <p className="photo-count">Creation time is added automatically when you submit.</p>
                {formError ? <p className="form-error">{formError}</p> : null}
                <button className="primary-button" type="submit" disabled={!isFormValid || isSavingRun}>
                  {isSavingRun ? 'Saving...' : 'Add run'}
                </button>
              </form>
            </section>
          </section>
        ) : null}

        {displayPage === 'details' && selectedRun ? (
          <section className={`screen page-shell page-${transitionStage}`}>
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
                <button className="icon-button icon-button-overlay" type="button" onClick={() => setPage('home')}>
                  {'<'}
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
                <button
                  className="danger-button"
                  type="button"
                  onClick={handleDeleteRun}
                  disabled={isDeletingRun}
                >
                  {isDeletingRun ? 'Deleting...' : 'Delete run'}
                </button>
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
                  {selectedRun.photos.map((photo) => (
                    <article className="photo-thumb" key={photo.id}>
                      <img src={photo.src} alt={photo.title} />
                    </article>
                  ))}
                </div>
              ) : (
                <p className="details-empty">No photos for this run.</p>
              )}
            </section>
          </section>
        ) : null}
      </main>
    </>
  );
}
