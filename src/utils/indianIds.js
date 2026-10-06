// Format checks for Indian identity numbers. These only prove a number is
// well-formed — whether it belongs to the person is the verification step's job.

// Verhoeff checksum tables (the scheme UIDAI uses for Aadhaar's last digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const verhoeffValid = (digits) => {
  let c = 0;
  [...digits].reverse().forEach((digit, i) => {
    c = D[c][P[i % 8][Number(digit)]];
  });
  return c === 0;
};

const verhoeffCheckDigit = (digits) => {
  let c = 0;
  [...digits].reverse().forEach((digit, i) => {
    c = D[c][P[(i + 1) % 8][Number(digit)]];
  });
  return String(INV[c]);
};

// Accepts "1234 5678 9012" / "1234-5678-9012"; returns the bare 12 digits.
const normalizeAadhaar = (value) => String(value).replace(/[\s-]/g, '');

// 12 digits, never starting with 0 or 1, with a valid Verhoeff check digit.
const isValidAadhaar = (value) => {
  const digits = normalizeAadhaar(value);
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
};

const normalizePan = (value) => String(value).replace(/\s/g, '').toUpperCase();

// AAAPL1234C — the 4th character is the holder type (P = individual, C = company, ...).
const isValidPan = (value) => /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/.test(normalizePan(value));

module.exports = { verhoeffValid, verhoeffCheckDigit, normalizeAadhaar, isValidAadhaar, normalizePan, isValidPan };
