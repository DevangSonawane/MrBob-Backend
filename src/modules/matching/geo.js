const h3 = require('h3-js');

// H3 is Uber's grid of hexagons over the whole map. Resolution 8 cells are
// about 0.74 km² (edge ~460 m) — a few streets — which is what bookings and
// vendors are placed in. Resolution 7 cells (~5 km²) are used for anything
// shown to customers, so a vendor's exact position is never revealed.
const CELL_RESOLUTION = 8;
const PUBLIC_RESOLUTION = 7;

// The rings offers go out in, as grid distance from the booking's cell, with
// roughly how far each reaches: ~0.8, 2.5, 5, 8, 12 km.
const RINGS = [1, 3, 6, 10, 15];

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));
const hasPoint = (lat, lng) => toNumber(lat) !== null && toNumber(lng) !== null;

const cellFor = (lat, lng, resolution = CELL_RESOLUTION) => (hasPoint(lat, lng) ? h3.latLngToCell(Number(lat), Number(lng), resolution) : null);

// Great-circle distance in km.
const distanceKm = (aLat, aLng, bLat, bLng) => {
  if (!hasPoint(aLat, aLng) || !hasPoint(bLat, bLng)) return null;
  const rad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(a)) * 100) / 100;
};

// Rough arrival time: city traffic at ~20 km/h, plus 10 minutes to set off.
const etaMinutes = (km) => (km === null ? null : Math.round((km / 20) * 60 + 10));

const disk = (cell, k) => h3.gridDisk(cell, k);
const parent = (cell, resolution = PUBLIC_RESOLUTION) => h3.cellToParent(cell, resolution);
// The hexagon's corners as [lat, lng] pairs, for drawing it on a map.
const boundary = (cell) => h3.cellToBoundary(cell);
const center = (cell) => h3.cellToLatLng(cell);

module.exports = { CELL_RESOLUTION, PUBLIC_RESOLUTION, RINGS, cellFor, distanceKm, etaMinutes, disk, parent, boundary, center, hasPoint };
