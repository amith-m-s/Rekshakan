const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Parse an OSRM coordinate pair in `longitude,latitude` order.
 * @param {string | null} value
 * @returns {[longitude: number, latitude: number] | null}
 */
export function parseLngLat(value) {
  if (value === null) return null;

  const parts = value.split(',');
  if (parts.length !== 2) return null;

  const [longitudeText, latitudeText] = parts.map((part) => part.trim());
  if (!longitudeText || !latitudeText || !NUMBER.test(longitudeText) || !NUMBER.test(latitudeText)) {
    return null;
  }

  const longitude = Number(longitudeText);
  const latitude = Number(latitudeText);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;

  return [longitude, latitude];
}
