const { verhoeffValid, verhoeffCheckDigit, isValidAadhaar, normalizeAadhaar, isValidPan, normalizePan } = require('../src/utils/indianIds');
const kycCrypto = require('../src/utils/kycCrypto');

describe('Aadhaar and PAN format checks', () => {
  it('matches the published Verhoeff example (236 -> check digit 3)', () => {
    expect(verhoeffCheckDigit('236')).toBe('3');
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffValid('2364')).toBe(false);
  });

  it('accepts a well-formed Aadhaar number with or without spaces', () => {
    const number = `23456789012${verhoeffCheckDigit('23456789012')}`;
    expect(isValidAadhaar(number)).toBe(true);
    expect(isValidAadhaar(`${number.slice(0, 4)} ${number.slice(4, 8)} ${number.slice(8)}`)).toBe(true);
    expect(normalizeAadhaar('2345-6789 0124')).toBe('234567890124');
  });

  it('rejects Aadhaar numbers with a bad checksum, wrong length or a leading 0/1', () => {
    expect(isValidAadhaar('234567890125')).toBe(false);
    expect(isValidAadhaar('23456789012')).toBe(false);
    expect(isValidAadhaar(`12345678901${verhoeffCheckDigit('12345678901')}`)).toBe(false);
    expect(isValidAadhaar('abcdefghijkl')).toBe(false);
  });

  it('validates PAN structure including the holder-type character', () => {
    expect(isValidPan('ABCPE1234F')).toBe(true);
    expect(isValidPan('abcpe1234f')).toBe(true);
    expect(normalizePan(' abcpe1234f ')).toBe('ABCPE1234F');
    expect(isValidPan('ABCDE1234F')).toBe(false); // D is not a holder type
    expect(isValidPan('ABCPE12345')).toBe(false);
  });
});

describe('KYC number encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const encrypted = kycCrypto.encrypt('234567890124');
    expect(encrypted).not.toContain('234567890124');
    expect(kycCrypto.decrypt(encrypted)).toBe('234567890124');
  });

  it('uses a fresh IV each time but a stable hash', () => {
    expect(kycCrypto.encrypt('ABCPE1234F')).not.toBe(kycCrypto.encrypt('ABCPE1234F'));
    expect(kycCrypto.hashNumber('PAN', 'ABCPE1234F')).toBe(kycCrypto.hashNumber('PAN', 'ABCPE1234F'));
    expect(kycCrypto.hashNumber('PAN', 'ABCPE1234F')).not.toBe(kycCrypto.hashNumber('AADHAAR', 'ABCPE1234F'));
  });

  it('refuses tampered ciphertext', () => {
    const [version, iv, tag, data] = kycCrypto.encrypt('234567890124').split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => kycCrypto.decrypt([version, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('masks all but the last four characters', () => {
    expect(kycCrypto.maskNumber('AADHAAR', '0124')).toBe('XXXX XXXX 0124');
    expect(kycCrypto.maskNumber('PAN', '234F')).toBe('XXXXXX234F');
  });
});
