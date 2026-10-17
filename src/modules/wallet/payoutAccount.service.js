const prisma = require('../../config/prisma');
const ApiError = require('../../utils/ApiError');
const kycCrypto = require('../../utils/kycCrypto');

// Where a vendor's money goes: their bank account and UPI id. The vendor gives
// these in onboarding; the team can add or correct them from the dashboard,
// in which case they count as checked (the team entered them).

const find = async (professionalId) => {
  const professional = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: { id: true, documents: { where: { type: 'BANK_ACCOUNT' } }, user: { select: { id: true, name: true, phone: true, email: true } } },
  });
  if (!professional) throw ApiError.notFound('Vendor not found');
  return professional;
};

const view = (doc) =>
  doc
    ? {
        status: doc.status,
        accountHolderName: doc.nameOnDocument || null,
        maskedAccountNumber: doc.numberLast4 ? `XXXX${doc.numberLast4}` : null,
        ifsc: doc.ifsc,
        bankName: doc.bankName,
        branchName: doc.branchName,
        accountType: doc.accountType,
        upiId: doc.upiId,
        hasBankAccount: Boolean(doc.numberLast4 && doc.ifsc),
        hasUpi: Boolean(doc.upiId),
        updatedAt: doc.updatedAt,
      }
    : { status: 'NOT_UPLOADED', accountHolderName: null, maskedAccountNumber: null, ifsc: null, bankName: null, branchName: null, accountType: null, upiId: null, hasBankAccount: false, hasUpi: false, updatedAt: null };

const get = async (professionalId) => view((await find(professionalId)).documents[0]);

// Everything needed to send money, with the account number decrypted.
const destinationFor = async (professionalId) => {
  const { documents, user } = await find(professionalId);
  const doc = documents[0];
  return {
    vendor: { professionalId, name: user.name, phone: user.phone, email: user.email },
    verified: doc?.status === 'VERIFIED',
    accountHolderName: doc?.nameOnDocument || user.name,
    accountNumber: doc?.numberLast4 ? kycCrypto.decrypt(doc.numberEncrypted) : null,
    ifsc: doc?.ifsc ?? null,
    upiId: doc?.upiId ?? null,
  };
};

// Only the fields sent change. The account number is needed to add a bank
// account the first time; afterwards it may be left out to keep it.
const set = async (professionalId, body, actor) => {
  const { documents } = await find(professionalId);
  const existing = documents[0];
  const accountNumber = body.accountNumber?.replace(/\s/g, '') || null;
  if (!existing && !accountNumber && !body.upiId) throw ApiError.badRequest('Give a bank account number or a UPI id');
  if (accountNumber && !(body.ifsc ?? existing?.ifsc)) throw ApiError.badRequest('Give the IFSC code with the account number');

  const bankChanged = Boolean(accountNumber) || (body.ifsc !== undefined && body.ifsc !== existing?.ifsc);
  const upiChanged = body.upiId !== undefined && (body.upiId || null) !== (existing?.upiId ?? null);

  if (accountNumber) {
    const numberHash = kycCrypto.hashNumber('BANK_ACCOUNT', `${(body.ifsc ?? existing.ifsc).slice(0, 4)}:${accountNumber}`);
    const usedElsewhere = await prisma.professionalDocument.findFirst({ where: { type: 'BANK_ACCOUNT', numberHash, professionalId: { not: professionalId } } });
    if (usedElsewhere) throw ApiError.conflict('This bank account is already registered to another vendor');
  }

  const data = {
    ...(accountNumber && { numberEncrypted: kycCrypto.encrypt(accountNumber), numberHash: kycCrypto.hashNumber('BANK_ACCOUNT', `${(body.ifsc ?? existing.ifsc).slice(0, 4)}:${accountNumber}`), numberLast4: accountNumber.slice(-4) }),
    ...(body.accountHolderName !== undefined && { nameOnDocument: body.accountHolderName }),
    ...(body.ifsc !== undefined && { ifsc: body.ifsc }),
    ...(body.bankName !== undefined && { bankName: body.bankName }),
    ...(body.branchName !== undefined && { branchName: body.branchName }),
    ...(body.accountType !== undefined && { accountType: body.accountType }),
    ...(body.upiId !== undefined && { upiId: body.upiId || null }),
    // Entered by the team, so checked.
    status: 'VERIFIED',
    rejectionReason: null,
    verificationSource: 'MANUAL',
    verifiedById: actor.id,
    verifiedAt: new Date(),
  };

  await prisma.$transaction(async (tx) => {
    if (existing) await tx.professionalDocument.update({ where: { id: existing.id }, data });
    else {
      await tx.professionalDocument.create({
        data: { professionalId, type: 'BANK_ACCOUNT', numberEncrypted: kycCrypto.encrypt(''), numberHash: `none:${professionalId}`, numberLast4: '', frontFileKey: '', frontFileMime: '', ...data },
      });
    }
    // New details need new payout destinations at the provider.
    if (bankChanged || upiChanged) {
      await tx.professional.update({
        where: { id: professionalId },
        data: { ...(bankChanged && { razorpayBankFundAccountId: null }), ...(upiChanged && { razorpayUpiFundAccountId: null }) },
      });
    }
  });
  return get(professionalId);
};

module.exports = { get, set, destinationFor };
