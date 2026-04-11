type DateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second?: string;
};

function getDateTimeParts(date: Date, timeZone: string, includeSeconds = false): DateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hourCycle: 'h23',
  });

  const mappedParts = formatter
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});

  return {
    year: mappedParts.year,
    month: mappedParts.month,
    day: mappedParts.day,
    hour: mappedParts.hour,
    minute: mappedParts.minute,
    second: mappedParts.second,
  };
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string) {
  const parts = getDateTimeParts(date, timeZone, true);
  const offsetTimestamp = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second ?? '0'),
  );

  return offsetTimestamp - date.getTime();
}

export function toDateTimeInputValue(value: string, timeZone = 'UTC') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  try {
    const parts = getDateTimeParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }
}

export function parseDateTimeInputValue(value: string, timeZone = 'UTC') {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    const timestamp = Date.parse(trimmed);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  const [, year, month, day, hour, minute] = match;
  const utcGuess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));

  try {
    let resolvedTimestamp = utcGuess;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const offset = getTimeZoneOffsetMilliseconds(new Date(resolvedTimestamp), timeZone);
      resolvedTimestamp = utcGuess - offset;
    }

    return new Date(resolvedTimestamp).toISOString();
  } catch {
    const timestamp = Date.parse(trimmed);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }
}
