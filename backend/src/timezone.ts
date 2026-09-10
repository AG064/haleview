export class TimezoneValidationError extends Error {
  readonly status = 400;
}

export function defaultTimezone(): string {
  return process.env.DEFAULT_TIMEZONE?.trim() || "Europe/Tallinn";
}

function formatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
  } catch {
    throw new TimezoneValidationError("Choose a valid IANA timezone.");
  }
}

function localValue(format: Intl.DateTimeFormat, instant: number): string {
  const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Reject skipped wall times; when clocks repeat a time, use its earlier instant. */
export function localDateTimeToIso(value: string, timezone: string): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new TimezoneValidationError("Enter a valid local date and time in YYYY-MM-DDTHH:mm format.");
  }
  const wall = Date.parse(`${value}:00.000Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) {
    throw new TimezoneValidationError("Enter a valid calendar date and time.");
  }
  const format = formatter(timezone);
  const offsets = new Set<number>();
  // Sample both sides of timezone transitions, including whole-day offset changes.
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = wall + hours * 3600000;
    offsets.add(Date.parse(`${localValue(format, sample)}Z`) - sample);
  }
  const candidates = [...offsets].map((offset) => wall - offset)
    .filter((instant) => localValue(format, instant) === `${value}:00`)
    .sort((left, right) => left - right);
  if (!candidates.length) {
    throw new TimezoneValidationError(`This local time does not exist in ${timezone} because the clocks change. Choose another time.`);
  }
  return new Date(candidates[0]).toISOString();
}
