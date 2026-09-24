const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./users.controller');
const schema = require('./users.schema');

const router = Router();

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [CUSTOMER, PROFESSIONAL, ADMIN] }
 *     responses:
 *       200:
 *         description: Paginated list of users
 */
router.get('/', authenticate, authorize('ADMIN'), validate(schema.listUsers), controller.list);

/**
 * @openapi
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Create a user (admin only) — the invite flow for new admin/ops accounts
 *     description: >
 *       No public signup exists for ADMIN accounts. An existing admin creates the account
 *       here instead. If `password` is omitted, a temporary password is generated and
 *       returned once in the response — share it with the new user out of band; it is
 *       never stored or logged in plaintext.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email]
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [CUSTOMER, PROFESSIONAL, ADMIN]
 *                 default: ADMIN
 *               password:
 *                 type: string
 *                 description: Omit to auto-generate a temporary password
 *     responses:
 *       201:
 *         description: Created user, plus temporaryPassword if one was generated
 *       409:
 *         description: Email already registered
 */
router.post('/', authenticate, authorize('ADMIN'), validate(schema.createUser), controller.create);

/**
 * @openapi
 * /users/me:
 *   patch:
 *     tags: [Users]
 *     summary: Update the current user's profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated user
 */
router.patch('/me', authenticate, validate(schema.updateMe), controller.updateMe);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user by id (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: A user
 */
router.get('/:id', authenticate, authorize('ADMIN'), validate(schema.getUser), controller.getById);

/**
 * @openapi
 * /users/{id}/active:
 *   patch:
 *     tags: [Users]
 *     summary: Activate/deactivate a user (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated user
 */
router.patch('/:id/active', authenticate, authorize('ADMIN'), validate(schema.setActive), controller.setActive);

module.exports = router;
