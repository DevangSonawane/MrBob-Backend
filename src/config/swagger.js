const swaggerJsdoc = require('swagger-jsdoc');
const env = require('./env');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Home Services Platform API',
      version: '1.0.0',
      description:
        'Backend API for the Home Services Platform (customer app, professional app, admin dashboard). ' +
        'Modular monolith — module boundaries: auth, users, professionals, bookings, dispatch, payments, amc, reviews, zones, partners, notifications.',
    },
    servers: [
      { url: `http://localhost:${env.PORT}${env.API_BASE_PATH}`, description: 'Local' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // JSDoc annotations live next to each module's routes.
  apis: [
    './src/modules/**/*.routes.js',
    './src/modules/**/*.schema.js',
  ],
};

module.exports = swaggerJsdoc(options);
