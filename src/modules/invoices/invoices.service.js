const PDFDocument = require('pdfkit');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { isAdmin } = require('../../utils/roles');
const { toSkipTake, paginatedResponse } = require('../../utils/pagination');
const { dateRange, personSearch } = require('../../utils/queryFilters');

// Customer invoices. One per booking, issued when the job is completed (by the
// vendor with the customer's code, or by the team). No tax is charged for now,
// so the total is the booking's price.

const invoiceNumber = (sequence) => `INV-${String(sequence).padStart(6, '0')}`;
const bookingNumber = (sequence) => `BK-${String(sequence).padStart(6, '0')}`;
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;

const bookingInclude = {
  category: { select: { id: true, name: true } },
  city: { select: { name: true } },
  zone: { select: { name: true } },
  payment: true,
  customer: { select: { id: true, name: true, phone: true, email: true } },
  professional: { select: { id: true, user: { select: { name: true } } } },
};
const include = { booking: { include: bookingInclude } };

// Creates the invoice for a completed booking if it has none. Called inside
// the transaction that completes the booking.
const issueForBooking = (tx, booking) =>
  tx.invoice.upsert({ where: { bookingId: booking.id }, update: {}, create: { bookingId: booking.id, amount: booking.price ?? 0, issuedAt: new Date() } });

// PAID once the customer has paid; REFUNDED / REFUND_PENDING after a refund; otherwise UNPAID.
const paymentStatus = (payment) => {
  if (!payment) return 'UNPAID';
  if (payment.status === 'SUCCESS') return 'PAID';
  if (['REFUNDED', 'REFUND_PENDING'].includes(payment.status)) return payment.status;
  return 'UNPAID';
};

const toView = (invoice, { pdfPath }) => {
  const { booking } = invoice;
  const total = money(invoice.amount);
  return {
    id: invoice.id,
    invoiceNumber: invoiceNumber(invoice.sequence),
    issuedAt: invoice.issuedAt,
    status: paymentStatus(booking.payment),
    currency: 'INR',
    business: {
      name: env.INVOICE_BUSINESS_NAME,
      address: env.INVOICE_BUSINESS_ADDRESS ?? null,
      email: env.INVOICE_BUSINESS_EMAIL ?? null,
      phone: env.INVOICE_BUSINESS_PHONE ?? null,
    },
    billedTo: {
      id: booking.customer.id,
      name: booking.customer.name,
      phone: booking.customer.phone,
      email: booking.customer.email,
      address: booking.address,
    },
    booking: {
      id: booking.id,
      bookingNumber: bookingNumber(booking.sequence),
      service: booking.category,
      scheduledAt: booking.scheduledAt,
      completedAt: booking.completedAt,
      city: booking.city?.name ?? null,
    },
    vendor: booking.professional ? { id: booking.professional.id, name: booking.professional.user.name } : null,
    items: [{ description: booking.category?.name ?? 'Service', details: booking.description ?? null, quantity: 1, unitPrice: total, amount: total }],
    subtotal: total,
    tax: 0,
    total,
    payment: {
      mode: booking.paymentMode,
      method: booking.payment?.method ?? null,
      paidAt: booking.payment?.status === 'SUCCESS' ? booking.payment.paidAt : null,
      amountPaid: booking.payment?.status === 'SUCCESS' ? money(booking.payment.amount) : 0,
    },
    // API path of the PDF (needs the caller's token).
    pdf: pdfPath,
  };
};

// The invoice for a booking: the customer's own (or any, for the team), once completed.
const findForBooking = async (bookingId, user) => {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, customerId: true, status: true, price: true } });
  if (!booking || (!isAdmin(user.role) && booking.customerId !== user.id)) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'COMPLETED') throw ApiError.notFound('The invoice is issued once the job is completed');
  // Completed before invoices existed, or by a path that did not issue one.
  await issueForBooking(prisma, booking);
  return prisma.invoice.findUnique({ where: { bookingId }, include });
};

const getForBooking = async (bookingId, user) => toView(await findForBooking(bookingId, user), { pdfPath: `/customer/bookings/${bookingId}/invoice/pdf` });

const find = async (id) => {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include });
  if (!invoice) throw ApiError.notFound('Invoice not found');
  return invoice;
};

const adminView = (invoice) => toView(invoice, { pdfPath: `/invoices/${invoice.id}/pdf` });

const getById = async (id) => adminView(await find(id));

const list = async ({ page, limit, search, issuedFrom, issuedTo, status, customerId }) => {
  const issuedAt = dateRange(issuedFrom, issuedTo);
  const number = search?.match(/^(inv|bk)-?0*(\d+)$/i);
  const paid = { payment: { is: { status: 'SUCCESS' } } };
  const where = {
    ...(issuedAt && { issuedAt }),
    ...(customerId && { booking: { customerId } }),
    ...(status === 'PAID' && { booking: { ...(customerId && { customerId }), ...paid } }),
    ...(status === 'UNPAID' && { booking: { ...(customerId && { customerId }), NOT: paid } }),
    ...(search &&
      (number
        ? number[1].toLowerCase() === 'inv'
          ? { sequence: Number(number[2]) }
          : { booking: { sequence: Number(number[2]) } }
        : { booking: { customer: personSearch(search) } })),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.invoice.findMany({ where, ...toSkipTake({ page, limit }), orderBy: { issuedAt: 'desc' }, include }),
    prisma.invoice.count({ where }),
    Promise.all([
      prisma.invoice.aggregate({ where, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: { AND: [where, { booking: paid }] }, _sum: { amount: true }, _count: { _all: true } }),
    ]),
  ]);
  const [all, paidSum] = sums;
  return {
    ...paginatedResponse(rows.map(adminView), total, { page, limit }),
    totals: { invoices: total, amount: money(all._sum.amount), paid: money(paidSum._sum.amount), paidInvoices: paidSum._count._all, unpaid: money(Number(all._sum.amount ?? 0) - Number(paidSum._sum.amount ?? 0)) },
  };
};

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const rupees = (value) => `Rs. ${money(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');

const renderPdf = (view) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${view.invoiceNumber}`, Author: view.business.name } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ink = '#15261f';
    const muted = '#6b7a74';
    const line = '#dfe6e3';
    const left = 50;
    const right = doc.page.width - 50;
    const width = right - left;

    // Header
    doc.fillColor('#0D230D').rect(0, 0, doc.page.width, 110).fill();
    doc.fillColor('#FCB723').rect(left, 38, 36, 4).fill();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('INVOICE', left, 50);
    doc.font('Helvetica').fontSize(10).text(view.business.name, left, 78);
    doc.font('Helvetica-Bold').fontSize(12).text(view.invoiceNumber, left, 50, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).text(`Issued ${day(view.issuedAt)}`, left, 68, { width, align: 'right' });
    doc.text(view.status === 'PAID' ? 'PAID' : view.status === 'UNPAID' ? 'PAYMENT DUE' : view.status.replace('_', ' '), left, 84, { width, align: 'right' });

    // From / billed to
    let y = 140;
    const block = (title, lines, x) => {
      doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), x, y);
      doc.fillColor(ink).font('Helvetica').fontSize(10);
      lines.filter(Boolean).forEach((text, index) => doc.text(text, x, y + 14 + index * 14, { width: width / 2 - 20 }));
    };
    block('From', [view.business.name, view.business.address, view.business.phone, view.business.email], left);
    block('Billed to', [view.billedTo.name, view.billedTo.phone, view.billedTo.email, view.billedTo.address], left + width / 2);

    // Booking details
    y = 250;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(line).stroke();
    y += 12;
    const facts = [
      ['Booking', view.booking.bookingNumber],
      ['Service date', day(view.booking.scheduledAt)],
      ['Completed', day(view.booking.completedAt)],
      ['Professional', view.vendor?.name ?? '—'],
    ];
    facts.forEach(([label, value], index) => {
      const x = left + (index * width) / 4;
      doc.fillColor(muted).font('Helvetica').fontSize(8).text(label.toUpperCase(), x, y);
      doc.fillColor(ink).font('Helvetica').fontSize(10).text(value, x, y + 12, { width: width / 4 - 10 });
    });

    // Items
    y += 50;
    doc.fillColor('#f3f6f5').rect(left, y, width, 22).fill();
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', left + 8, y + 7);
    doc.text('QTY', left + width * 0.6, y + 7, { width: 40, align: 'right' });
    doc.text('PRICE', left + width * 0.68, y + 7, { width: 70, align: 'right' });
    doc.text('AMOUNT', right - 90, y + 7, { width: 82, align: 'right' });
    y += 30;
    view.items.forEach((item) => {
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text(item.description, left + 8, y, { width: width * 0.55 });
      doc.font('Helvetica').text(String(item.quantity), left + width * 0.6, y, { width: 40, align: 'right' });
      doc.text(rupees(item.unitPrice), left + width * 0.68, y, { width: 70, align: 'right' });
      doc.text(rupees(item.amount), right - 90, y, { width: 82, align: 'right' });
      if (item.details) doc.fillColor(muted).fontSize(9).text(item.details, left + 8, y + 14, { width: width * 0.55 });
      y += item.details ? 42 : 26;
    });
    doc.moveTo(left, y).lineTo(right, y).strokeColor(line).stroke();

    // Totals
    y += 12;
    const total = (label, value, bold) => {
      doc.fillColor(bold ? ink : muted).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
      doc.text(label, right - 250, y, { width: 150, align: 'right' });
      doc.text(value, right - 90, y, { width: 82, align: 'right' });
      y += bold ? 22 : 18;
    };
    total('Subtotal', rupees(view.subtotal));
    total('Total', rupees(view.total), true);
    total('Paid', rupees(view.payment.amountPaid));
    total('Balance due', rupees(view.total - view.payment.amountPaid), true);

    // Payment
    y += 16;
    const how = view.payment.mode === 'ONLINE' ? 'Paid online' : `Pay after service${view.payment.method ? ` (${view.payment.method.toLowerCase()})` : ''}`;
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(`Payment: ${how}${view.payment.paidAt ? ` on ${day(view.payment.paidAt)}` : ''}.`, left, y, { width });
    doc.text('No tax has been charged on this invoice.', left, y + 14, { width });
    doc.fillColor(muted).fontSize(8).text(`Thank you for choosing ${view.business.name}.`, left, doc.page.height - 70, { width, align: 'center' });

    doc.end();
  });

const pdfForBooking = async (bookingId, user) => {
  const view = await getForBooking(bookingId, user);
  return { buffer: await renderPdf(view), filename: `${view.invoiceNumber}.pdf` };
};

const pdfById = async (id) => {
  const view = await getById(id);
  return { buffer: await renderPdf(view), filename: `${view.invoiceNumber}.pdf` };
};

module.exports = { invoiceNumber, issueForBooking, getForBooking, getById, list, pdfForBooking, pdfById };
