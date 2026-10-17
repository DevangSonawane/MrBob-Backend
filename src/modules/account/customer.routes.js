const { Router } = require('express');
const validate = require('../../utils/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const users = require('../users/users.controller');
const usersSchema = require('../users/users.schema');
const bookings = require('../bookings/bookings.controller');
const bookingsSchema = require('../bookings/bookings.schema');
const { addOwnRoutes: addDisputeRoutes } = require('../disputes/disputes.routes');
const { addCustomerRoutes: addInvoiceRoutes } = require('../invoices/invoices.routes');

// The customer app's own corner of the API: the signed-in customer's profile
// and bookings under one prefix. Each route is the same logic as its general
// counterpart (/users/me, /bookings), restricted to customers.
const router = Router();
router.use(authenticate, authorize('CUSTOMER'));

router.get('/profile', users.getMe);
router.patch('/profile', validate(usersSchema.updateMe), users.updateMe);
router.delete('/profile', users.deleteMe);

router.get('/bookings', validate(bookingsSchema.listBookings), bookings.list);
router.get('/bookings/:id', validate(bookingsSchema.getBooking), bookings.getById);

// The invoice for a completed booking.
addInvoiceRoutes(router);

// Help & disputes raised by this customer.
addDisputeRoutes(router);

module.exports = router;
