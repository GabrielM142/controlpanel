// Timezone helpers without dependencies (Intl). Used for collection schedules.

function partsIn(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return p;
}

/** Offset (ms) of tz at instant `date`: local wall clock - UTC. */
export function tzOffsetMs(date, tz) {
  const p = partsIn(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

export function localDate(date, tz) {
  const p = partsIn(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function localMinutes(date, tz) {
  const p = partsIn(date, tz);
  return p.hour * 60 + p.minute;
}

/** Next instant (> now) where local time in tz equals hh:mm, plus jitter seconds. */
export function nextLocalTime(now, tz, hhmm, jitterSeconds = 0) {
  const [h, m] = String(hhmm).split(':').map(Number);
  for (let addDays = 0; addDays < 3; addDays++) {
    const base = new Date(now.getTime() + addDays * 86400000);
    const p = partsIn(base, tz);
    const guess = Date.UTC(p.year, p.month - 1, p.day, h, m, 0);
    const candidate = new Date(guess - tzOffsetMs(new Date(guess), tz));
    if (candidate.getTime() > now.getTime()) return new Date(candidate.getTime() + jitterSeconds * 1000);
  }
  throw new Error('No se pudo calcular la próxima ejecución');
}
