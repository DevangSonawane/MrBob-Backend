const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const controller = require('./disputes.controller');
const schema = require('./disputes.schema');

// What a customer or a vendor does with their own help requests and disputes.
// Mounted inside /customer and /vendor, which already restrict the role.
const addOwnRoutes = (router) => {
  router.get('/disputes/categories', controller.categories);
  router.post('/disputes', validate(schema.create), controller.create);
  router.get('/disputes', validate(schema.listMine), controller.listMine);
  router.get('/disputes/:id', validate(schema.one), controller.getOne);
  router.post('/disputes/:id/messages', validate(schema.reply), controller.reply);
  router.post('/disputes/:id/close', validate(schema.one), controller.close);
};

// The support team's side, mounted at /disputes.
const router = Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/', validate(schema.listAll), controller.listAll);
router.get('/summary', controller.getSummary);
router.get('/:id', validate(schema.one), controller.getOne);
router.patch('/:id', validate(schema.update), controller.update);
router.post('/:id/messages', validate(schema.reply), controller.reply);
router.post('/:id/resolve', validate(schema.resolve), controller.resolve);

module.exports = router;
module.exports.addOwnRoutes = addOwnRoutes;
