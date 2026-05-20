import { useState, type FormEvent } from 'react';

const TIMEZONES = [
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
];

const ALL_TAGS = ['design', 'engineering', 'product', 'marketing', 'ops', 'finance', 'legal', 'hr'];

type Visibility = 'public' | 'private' | 'invite-only';

interface EventDraft {
  name: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  tags: string[];
  capacity: number;
  priority: number;
  visibility: Visibility;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyPush: boolean;
  requireApproval: boolean;
  coverImageName: string | null;
}

const initial: EventDraft = {
  name: '',
  description: '',
  date: '',
  startTime: '',
  endTime: '',
  timezone: 'America/Los_Angeles',
  tags: [],
  capacity: 50,
  priority: 3,
  visibility: 'public',
  notifyEmail: true,
  notifySms: false,
  notifyPush: false,
  requireApproval: false,
  coverImageName: null,
};

function validate(draft: EventDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Event name is required');
  if (!draft.date) errors.push('Date is required');
  if (!draft.startTime) errors.push('Start time is required');
  if (!draft.endTime) errors.push('End time is required');
  if (draft.startTime && draft.endTime && draft.endTime <= draft.startTime) {
    errors.push('End time must be after start time');
  }
  if (draft.tags.length === 0) errors.push('Pick at least one tag');
  if (draft.capacity < 1) errors.push('Capacity must be at least 1');
  return errors;
}

export default function App() {
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<EventDraft | null>(null);

  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  function toggleTag(tag: string) {
    setDraft(d => ({
      ...d,
      tags: d.tags.includes(tag) ? d.tags.filter(t => t !== tag) : [...d.tags, tag],
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate(draft);
    setErrors(errs);
    if (errs.length === 0) setCreated(draft);
  }

  function reset() {
    setDraft(initial);
    setErrors([]);
    setCreated(null);
  }

  if (created) {
    return (
      <main className="page">
        <h1>event-form</h1>
        <section className="success" data-testid="success">
          <h2>Event created</h2>
          <p>Name: <strong data-testid="result-name">{created.name}</strong></p>
          <p>When: {created.date} {created.startTime}–{created.endTime} ({created.timezone})</p>
          <p>Visibility: {created.visibility}</p>
          <p>Tags: {created.tags.join(', ') || '(none)'}</p>
          <p>Capacity: {created.capacity} · Priority: {created.priority}</p>
          <p>Cover image: {created.coverImageName ?? '(none)'}</p>
          <button onClick={reset}>Create another</button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>event-form</h1>
      <p className="subtitle">
        One screen, eleven controls: text, textarea, date, time × 2, select,
        multi-select chips, number, range slider, radio group, checkbox group,
        toggle, file input. Stress-test for AI form filling.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <section>
          <h2>Basics</h2>
          <label>
            Event name
            <input
              type="text"
              value={draft.name}
              onChange={e => update('name', e.target.value)}
              aria-label="event name"
              required
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              value={draft.description}
              onChange={e => update('description', e.target.value)}
              aria-label="description"
            />
          </label>
        </section>

        <section>
          <h2>When</h2>
          <div className="row">
            <label>
              Date
              <input
                type="date"
                value={draft.date}
                onChange={e => update('date', e.target.value)}
                aria-label="date"
              />
            </label>
            <label>
              Start time
              <input
                type="time"
                value={draft.startTime}
                onChange={e => update('startTime', e.target.value)}
                aria-label="start time"
              />
            </label>
            <label>
              End time
              <input
                type="time"
                value={draft.endTime}
                onChange={e => update('endTime', e.target.value)}
                aria-label="end time"
              />
            </label>
          </div>
          <label>
            Timezone
            <select
              value={draft.timezone}
              onChange={e => update('timezone', e.target.value)}
              aria-label="timezone"
            >
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>
        </section>

        <section>
          <h2>Tagging</h2>
          <div className="chips" role="group" aria-label="tags">
            {ALL_TAGS.map(tag => (
              <label
                key={tag}
                className={`chip ${draft.tags.includes(tag) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={draft.tags.includes(tag)}
                  onChange={() => toggleTag(tag)}
                  aria-label={`tag ${tag}`}
                />
                {tag}
              </label>
            ))}
          </div>
          <div data-testid="selected-tags" className="muted">
            Selected: {draft.tags.length ? draft.tags.join(', ') : '(none)'}
          </div>
        </section>

        <section>
          <h2>Capacity & priority</h2>
          <div className="row">
            <label>
              Max attendees
              <input
                type="number"
                min={1}
                max={10000}
                value={draft.capacity}
                onChange={e => update('capacity', Number(e.target.value))}
                aria-label="capacity"
              />
            </label>
            <label>
              Priority (1 = low, 5 = urgent)
              <input
                type="range"
                min={1}
                max={5}
                value={draft.priority}
                onChange={e => update('priority', Number(e.target.value))}
                aria-label="priority"
              />
              <span data-testid="priority-value">{draft.priority}</span>
            </label>
          </div>
        </section>

        <section>
          <h2>Visibility</h2>
          <div role="radiogroup" aria-label="visibility" className="radios">
            {(['public', 'private', 'invite-only'] as Visibility[]).map(v => (
              <label key={v}>
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={draft.visibility === v}
                  onChange={() => update('visibility', v)}
                  aria-label={`visibility ${v}`}
                />
                {v}
              </label>
            ))}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.requireApproval}
              onChange={e => update('requireApproval', e.target.checked)}
              aria-label="require approval"
            />
            <span>Require my approval for each RSVP</span>
          </label>
        </section>

        <section>
          <h2>Notifications</h2>
          <div className="checks" role="group" aria-label="notifications">
            <label>
              <input
                type="checkbox"
                checked={draft.notifyEmail}
                onChange={e => update('notifyEmail', e.target.checked)}
                aria-label="notify email"
              />
              Email
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.notifySms}
                onChange={e => update('notifySms', e.target.checked)}
                aria-label="notify sms"
              />
              SMS
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.notifyPush}
                onChange={e => update('notifyPush', e.target.checked)}
                aria-label="notify push"
              />
              Push notification
            </label>
          </div>
        </section>

        <section>
          <h2>Cover image</h2>
          <label>
            <input
              type="file"
              accept="image/*"
              onChange={e =>
                update('coverImageName', e.target.files?.[0]?.name ?? null)
              }
              aria-label="cover image"
            />
          </label>
          {draft.coverImageName && (
            <div className="muted" data-testid="cover-name">Selected: {draft.coverImageName}</div>
          )}
        </section>

        {errors.length > 0 && (
          <section className="errors" data-testid="errors">
            <strong>Please fix:</strong>
            <ul>{errors.map(e => <li key={e}>{e}</li>)}</ul>
          </section>
        )}

        <div className="actions">
          <button type="button" onClick={reset}>Reset</button>
          <button type="submit" className="primary">Create event</button>
        </div>
      </form>
    </main>
  );
}
