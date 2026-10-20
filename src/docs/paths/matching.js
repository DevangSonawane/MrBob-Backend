const { ok, jsonBody, pathParam, queryParam, op } = require('../helpers');

const VENDOR = 'Vendor app — going online (nearby jobs)';
const CUSTOMER = 'Customer app — vendors nearby';
const ADMIN = 'Nearby dispatch (admin)';

const uuid = { type: 'string', format: 'uuid' };
const dateTime = { type: 'string', format: 'date-time' };
const latLng = { type: 'array', items: { type: 'number' }, example: [19.06, 72.83], description: '[latitude, longitude]' };

const presence = {
  type: 'object',
  properties: {
    online: { type: 'boolean' },
    latitude: { type: 'number', nullable: true },
    longitude: { type: 'number', nullable: true },
    h3Cell: { type: 'string', nullable: true, description: 'The H3 hexagon (resolution 8, ~0.7 km²) of the last position' },
    lastSeenAt: { ...dateTime, nullable: true },
    onlineSince: { ...dateTime, nullable: true },
    canReceiveOffers: { type: 'boolean', description: 'Online and approved: nearby jobs will be offered' },
    activeOffers: { type: 'integer', description: 'Jobs offered to this vendor right now — see GET /vendor/jobs/available' },
    updateEverySeconds: { type: 'integer', example: 30, description: 'How often to send the position while online' },
  },
};
const presenceExample = { online: true, latitude: 19.0636, longitude: 72.83, h3Cell: '88608b0b13fffff', lastSeenAt: '2026-10-21T10:00:00.000Z', onlineSince: '2026-10-21T09:30:00.000Z', canReceiveOffers: true, activeOffers: 1, updateEverySeconds: 30 };

module.exports = {
  tags: [
    {
      name: VENDOR,
      description:
        'How jobs reach vendors. The map is divided into H3 hexagons (Uber\'s grid). A vendor who is **online** reports their position; a new ' +
        'booking is placed in the hexagon of its address. Offers go out in **waves**: the nearest few online vendors within one ring of ' +
        'hexagons (~1 km) get the job in `GET /vendor/jobs/available` with `offer.expiresAt` (60 seconds). If nobody accepts, the next ' +
        'wave goes to vendors in a wider ring (~2.5, 5, 8, 12 km). The first to accept gets it. If nobody nearby takes it, or the booking ' +
        'has no location, it is opened to every approved vendor (`openToAll`).\n\n' +
        '**The vendor app should:** have an Online/Offline switch → `PUT /vendor/presence`; while online, send the position every ' +
        '`updateEverySeconds` (30) and poll `GET /vendor/jobs/available` every few seconds; show offered jobs with a countdown to ' +
        '`offer.expiresAt`, with **Accept** (`POST /vendor/jobs/{id}/accept`) and **Decline** (`POST /vendor/jobs/{id}/decline`). A vendor ' +
        'who stops sending a position for 5 minutes is not offered jobs, and after 15 minutes is set offline.',
    },
    {
      name: CUSTOMER,
      description: 'Before booking: how many vendors are online near the address, the nearest one\'s distance and a rough arrival time. Positions are only ever shown as ~5 km² areas.',
    },
    {
      name: ADMIN,
      description: 'The live supply-and-demand map (online vendors, open bookings and active jobs per hexagon) and the offers sent for a booking.',
    },
  ],
  paths: {
    '/vendor/presence': {
      get: op({ tag: VENDOR, summary: 'Am I online?', access: 'PROFESSIONAL', responses: { 200: ok('Presence', presence, presenceExample) }, errors: [403] }),
      put: op({
        tag: VENDOR,
        summary: 'Go online / offline, and report my position',
        description:
          'Going online needs a position (`latitude` + `longitude`), unless one was sent before. While online, call it again with `online: true` ' +
          'and the current position every `updateEverySeconds`. Going offline hands back any offers not answered yet. Only approved vendors ' +
          'are offered jobs (`canReceiveOffers`).',
        access: 'PROFESSIONAL',
        body: jsonBody(
          { type: 'object', required: ['online'], properties: { online: { type: 'boolean' }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } } },
          { online: true, latitude: 19.0636, longitude: 72.83 },
        ),
        responses: { 200: ok('Presence', presence, presenceExample) },
        errors: [403],
      }),
    },
    '/vendor/jobs/{id}/decline': {
      post: op({
        tag: VENDOR,
        summary: 'Decline an offered job',
        description: 'The job is offered to the next vendors straight away. **409** if it was not offered to this vendor (or the offer ran out).',
        access: 'PROFESSIONAL',
        params: [pathParam('id', 'Booking id')],
        responses: { 200: ok('Declined', { type: 'object', properties: { declined: { type: 'boolean' } } }, { declined: true }) },
        errors: [409],
      }),
    },
    '/customer/nearby-vendors': {
      get: op({
        tag: CUSTOMER,
        summary: 'Vendors online near an address',
        description: 'Counts approved vendors online within ~5 km who offer the service (if `categoryId` is given). `areas` are ~5 km² hexagons with how many vendors are in each, for an optional map; exact positions are never returned.',
        access: 'CUSTOMER',
        params: [
          queryParam('latitude', 'The address\'s latitude', { type: 'number' }),
          queryParam('longitude', 'The address\'s longitude', { type: 'number' }),
          queryParam('categoryId', 'Only vendors offering this service', uuid),
        ],
        responses: {
          200: ok(
            'Who is around',
            {
              type: 'object',
              properties: {
                vendorsNearby: { type: 'integer' },
                nearestKm: { type: 'number', nullable: true },
                etaMinutes: { type: 'integer', nullable: true, description: 'Rough arrival time of the nearest vendor' },
                radiusKm: { type: 'number' },
                areas: { type: 'array', items: { type: 'object', properties: { cell: { type: 'string' }, center: latLng, boundary: { type: 'array', items: latLng }, vendors: { type: 'integer' } } } },
              },
            },
            { vendorsNearby: 6, nearestKm: 0.8, etaMinutes: 12, radiusKm: 5, areas: [{ cell: '87608b0b1ffffff', center: [19.061, 72.832], boundary: [[19.07, 72.82], [19.05, 72.84]], vendors: 4 }] },
          ),
        },
      }),
    },
    '/dispatch/map': {
      get: op({
        tag: ADMIN,
        summary: 'Live supply and demand map',
        description: 'Per H3 hexagon (resolution 7 by default, ~5 km²): vendors online now, bookings waiting for a vendor, and jobs assigned or in progress — with each hexagon\'s corners for drawing it.',
        access: 'ADMIN',
        params: [queryParam('resolution', 'Hexagon size: 6 (~36 km²), 7 (~5 km²), 8 (~0.7 km²)', { type: 'integer', minimum: 5, maximum: 9, default: 7 }), queryParam('cityId', 'Only this city', uuid)],
        responses: {
          200: ok(
            'The map',
            { type: 'object', properties: { resolution: { type: 'integer' }, totals: { type: 'object', properties: { onlineVendors: { type: 'integer' }, openBookings: { type: 'integer' }, activeJobs: { type: 'integer' } } }, cells: { type: 'array', items: { type: 'object', properties: { cell: { type: 'string' }, onlineVendors: { type: 'integer' }, openBookings: { type: 'integer' }, activeJobs: { type: 'integer' }, center: latLng, boundary: { type: 'array', items: latLng } } } } } },
            { resolution: 7, totals: { onlineVendors: 18, openBookings: 3, activeJobs: 9 }, cells: [{ cell: '87608b0b1ffffff', onlineVendors: 4, openBookings: 1, activeJobs: 2, center: [19.061, 72.832], boundary: [[19.07, 72.82], [19.05, 72.84]] }] },
          ),
        },
      }),
    },
    '/dispatch/bookings/{id}/offers': {
      get: op({
        tag: ADMIN,
        summary: 'Who a booking was offered to',
        description: 'Every offer in every wave, with each vendor\'s distance and answer, and whether the booking was opened to everyone.',
        access: 'ADMIN',
        params: [pathParam('id', 'Booking id')],
        responses: {
          200: ok(
            'Offers',
            {
              type: 'object',
              properties: {
                bookingNumber: { type: 'string' },
                status: { type: 'string' },
                h3Cell: { type: 'string', nullable: true },
                wave: { type: 'integer' },
                maxWaves: { type: 'integer' },
                openToAll: { type: 'boolean' },
                openToAllAt: { ...dateTime, nullable: true },
                offers: { type: 'array', items: { type: 'object', properties: { id: uuid, wave: { type: 'integer' }, status: { type: 'string', enum: ['OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] }, distanceKm: { type: 'number', nullable: true }, vendor: { type: 'object' }, offeredAt: dateTime, expiresAt: dateTime, respondedAt: { ...dateTime, nullable: true } } } },
              },
            },
            { bookingNumber: 'BK-000123', status: 'ASSIGNED', h3Cell: '88608b0b13fffff', wave: 2, maxWaves: 5, openToAll: false, openToAllAt: null, offers: [] },
          ),
        },
        errors: [404],
      }),
    },
  },
};
