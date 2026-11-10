import { useEffect, useRef } from 'react';

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function EventLog({ entries }) {
  const listRef = useRef(null);

  // Keep the newest entry in view
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className="panel event-log">
      <h2>Battle Log</h2>
      <ol className="log-list" ref={listRef} aria-live="polite">
        {entries.length === 0 && <li className="log-empty">No events yet.</li>}
        {entries.map((e) => (
          <li key={e.id} className={`log-entry ${e.kind}`}>
            <time>{time(e.at)}</time>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
