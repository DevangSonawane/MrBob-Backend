const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate } = require('../../middlewares/auth');
const controller = require('./onboarding.controller');
const schema = require('./onboarding.schema');

const router = Router();

/**
 * @openapi
 * /onboarding/status:
 *   get:
 *     tags: [Onboarding]
 *     summary: Get the current user's onboarding status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding status
 */
router.get('/status', authenticate, controller.getStatus);

/**
 * @openapi
 * /onboarding/customer:
 *   post:
 *     tags: [Onboarding]
 *     summary: Complete onboarding as a customer (city + optional profile details)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cityId]
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               cityId:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated user, isOnboarded now true
 */
router.post('/customer', authenticate, validate(schema.completeCustomer), controller.completeCustomer);

/**
 * @openapi
 * /onboarding/professional:
 *   post:
 *     tags: [Onboarding]
 *     summary: Complete onboarding as a professional (creates the professional profile)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cityId, categories]
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               cityId:
 *                 type: string
 *               categories:
 *                 type: array
 *                 items:
 *                   type: string
 *               homeZoneId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated user + created professional profile, isOnboarded now true
 */
router.post(
  '/professional',
  authenticate,
  validate(schema.completeProfessional),
  controller.completeProfessional,
);

module.exports = router;
