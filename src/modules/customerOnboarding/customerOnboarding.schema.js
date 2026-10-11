const { z } = require('zod');
const fields = require('../../utils/fieldSchemas');
const { OTP_LENGTH } = require('../auth/otp.store');
const { addressBody } = require('../users/users.schema');
const { relaxed, looseText } = require('../../utils/onboardingValidation');

// With validation off a phone number is any text (it is only the account's
// identifier). The OTP is the one thing always checked: the right number of digits.
const loginPhone = relaxed ? z.coerce.string().trim().min(1, 'Phone number is required') : fields.phone;
const loginOtp = z.coerce.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `OTP must be ${OTP_LENGTH} digits`);

const requestOtp = {
  body: z.object({ phone: loginPhone }),
};

const verifyOtp = {
  body: z.object({ phone: loginPhone, otp: loginOtp }),
};

// Step 3. Name and gender are what the step asks for; email and date of
// birth can be given here too, or later from the profile screen.
const strictProfile = {
  body: z.object({
    name: z.string().trim().min(2).max(100),
    gender: fields.gender,
    email: fields.optionalFormatted(z.email()),
    dateOfBirth: fields.optionalFormatted(fields.dateOnly),
  }),
};

// Step 4: the same shape as any saved address.
const strictAddress = { body: addressBody };

// Validation off: every field optional and unchecked.
const relaxedProfile = {
  body: z.object({ name: looseText, gender: looseText, email: looseText, dateOfBirth: looseText }),
};

const coordinate = z.preprocess((value) => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)), z.number().nullable());

const relaxedAddress = {
  body: z.object({
    label: looseText,
    contactName: looseText,
    contactPhone: looseText,
    line1: looseText,
    line2: looseText,
    landmark: looseText,
    cityId: looseText,
    zoneId: looseText,
    state: looseText,
    pincode: looseText,
    latitude: coordinate,
    longitude: coordinate,
  }),
};

const saveProfile = relaxed ? relaxedProfile : strictProfile;
const saveAddress = relaxed ? relaxedAddress : strictAddress;

module.exports = { requestOtp, verifyOtp, saveProfile, saveAddress };
