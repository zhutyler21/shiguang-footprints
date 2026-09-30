import exifr from 'exifr';
export function validPoint(lng, lat) { return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90; }
export function metadataFromTags(tags = {}) {
  const { longitude, latitude } = tags;
  // Reject malformed hemisphere references as well as invalid coordinate ranges.
  const refsValid = ['N','S'].includes(tags.GPSLatitudeRef) && ['E','W'].includes(tags.GPSLongitudeRef);
  const dmsValid = [tags.GPSLatitude, tags.GPSLongitude].every(values => Array.isArray(values) && values.length === 3 && values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) && values[1] < 60 && values[2] < 60);
  const gps = refsValid && dmsValid && validPoint(longitude, latitude) ? { lng: longitude, lat: latitude, coordinateSystem: 'WGS84' } : null;
  const raw = tags.DateTimeOriginal;
  const match = typeof raw === 'string' && raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  let capturedAt = null, capturedTimezone = null;
  if (match) {
    const [,y,m,d,h,min,s] = match;
    const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
    if (Number(y) >= 1 && Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31 && Number(h) <= 23 && Number(min) <= 59 && Number(s) <= 59 && Number.isFinite(date.getTime()) && date.toISOString().slice(0,19) === `${y}-${m}-${d}T${h}:${min}:${s}`) {
      const offset = tags.OffsetTimeOriginal;
      if (typeof offset === 'string' && /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset) && (!/^[+-]14:/.test(offset) || offset.endsWith(':00'))) capturedTimezone = offset;
      capturedAt = `${y}-${m}-${d}T${h}:${min}:${s}${capturedTimezone || ''}`;
    }
  }
  return { gps, capturedAt, capturedTimezone, capturedAtRaw: typeof raw === 'string' ? raw : null,
    gpsStatus: gps ? 'valid' : ('GPSLatitude' in tags || 'GPSLongitude' in tags || 'latitude' in tags) ? 'invalid' : 'missing' };
}
export async function parseMetadata(buffer) {
  try { return metadataFromTags(await exifr.parse(buffer, { reviveValues: false, translateValues: true })); }
  catch { return { ...metadataFromTags(), gpsStatus: 'unreadable' }; }
}
