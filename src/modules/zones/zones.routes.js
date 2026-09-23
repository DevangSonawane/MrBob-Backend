const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./zones.controller');
const schema = require('./zones.schema');

const router = Router();

/**
 * @openapi
 * /zones/cities:
 *   get:
 *     tags: [Zones]
 *     summary: List active cities
 *     responses:
 *       200:
 *         description: List of cities
 *   post:
 *     tags: [Zones]
 *     summary: Create a city (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created city
 */
router.get('/cities', controller.listCities);
router.post('/cities', authenticate, authorize('ADMIN'), validate(schema.createCity), controller.createCity);

/**
 * @openapi
 * /zones:
 *   get:
 *     tags: [Zones]
 *     summary: List active zones, optionally filtered by city
 *     parameters:
 *       - in: query
 *         name: cityId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of zones
 *   post:
 *     tags: [Zones]
 *     summary: Create a zone (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created zone
 */
router.get('/', validate(schema.listZones), controller.listZones);
router.post('/', authenticate, authorize('ADMIN'), validate(schema.createZone), controller.createZone);

module.exports = router;
