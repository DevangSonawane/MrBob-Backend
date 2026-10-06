const { ref, arrayOf, ok, paginated, jsonBody, queryParam, pageParams, op } = require('../helpers');

const ZONES = 'Cities & zones';
const PARTNERS = 'Partners';
const DASHBOARD = 'Dashboard';

module.exports = {
  tags: [
    { name: ZONES, description: 'Where the service operates. Cities contain zones; a vendor picks a city and a home zone during onboarding.' },
    { name: PARTNERS, description: 'Builders and resident welfare associations that send bookings.' },
    { name: DASHBOARD, description: 'Aggregates for the admin dashboard.' },
  ],
  paths: {
    '/zones/cities': {
      get: op({ tag: ZONES, summary: 'List active cities', access: 'public', responses: { 200: ok('Active cities, by name', arrayOf(ref('City'))) } }),
      post: op({
        tag: ZONES,
        summary: 'Create a city',
        access: 'ADMIN',
        body: jsonBody(
          { type: 'object', required: ['name', 'tier'], properties: { name: { type: 'string', minLength: 2 }, tier: { type: 'string', enum: ['TIER_1', 'TIER_2'] } } },
          { name: 'Pune', tier: 'TIER_1' },
        ),
        responses: { 201: ok('City created', ref('City')) },
      }),
    },
    '/zones': {
      get: op({
        tag: ZONES,
        summary: 'List active zones',
        access: 'public',
        params: [queryParam('cityId', 'Only zones in this city', { type: 'string', format: 'uuid' })],
        responses: { 200: ok('Active zones, by name', arrayOf(ref('Zone'))) },
      }),
      post: op({
        tag: ZONES,
        summary: 'Create a zone',
        access: 'ADMIN',
        body: jsonBody(
          { type: 'object', required: ['cityId', 'name'], properties: { cityId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 2 } } },
          { cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', name: 'Indiranagar' },
        ),
        responses: { 201: ok('Zone created', ref('Zone')) },
      }),
    },
    '/partners': {
      post: op({
        tag: PARTNERS,
        summary: 'Create a partner',
        access: 'ADMIN',
        body: jsonBody(
          {
            type: 'object',
            required: ['type', 'name', 'cityId'],
            properties: { type: { type: 'string', enum: ['BUILDER', 'RWA'] }, name: { type: 'string', minLength: 2 }, cityId: { type: 'string', format: 'uuid' }, contact: { type: 'string' } },
          },
          { type: 'BUILDER', name: 'Prestige Group', cityId: '0d9b7a3c-1111-4a2b-9c3d-4e5f6a7b8c9d', contact: '+919000011111' },
        ),
        responses: { 201: ok('Partner created', ref('Partner')) },
      }),
      get: op({
        tag: PARTNERS,
        summary: 'List partners',
        access: 'ADMIN',
        params: [
          queryParam('cityId', 'Only partners in this city', { type: 'string', format: 'uuid' }),
          queryParam('type', 'Only partners of this type', { type: 'string', enum: ['BUILDER', 'RWA'] }),
          ...pageParams,
        ],
        responses: { 200: paginated('A page of partners, newest first', ref('Partner')) },
      }),
    },
    '/dashboard/stats': {
      get: op({ tag: DASHBOARD, summary: 'Headline counts', access: 'ADMIN', responses: { 200: ok('Counts across the platform', ref('DashboardStats')) } }),
    },
  },
};
