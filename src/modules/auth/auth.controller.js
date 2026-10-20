const catchAsync = require('../../utils/catchAsync');
const sanitizeUser = require('../../utils/sanitizeUser');
const authService = require('./auth.service');

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  phone: user.phone,
  email: user.email,
  role: user.role,
  isOnboarded: user.isOnboarded,
});

const requestOtp = catchAsync(async (req, res) => {
  const result = await authService.requestOtp(req.body.phone);
  res.status(200).json({ success: true, data: result });
});

const vendorLogin = catchAsync(async (req, res) => {
  const { user, ...tokens } = await authService.verifyVendorOtp(req.body.phone, req.body.otp);
  res.status(200).json({ success: true, data: { user: toPublicUser(user), ...tokens } });
});

const verifyOtp = catchAsync(async (req, res) => {
  const { phone, otp, name } = req.body;
  const { user, ...tokens } = await authService.verifyOtpAndLogin(phone, otp, name);
  res.status(200).json({
    success: true,
    data: { user: toPublicUser(user), ...tokens },
  });
});

const signup = catchAsync(async (req, res) => {
  const { user, ...tokens } = await authService.signupWithEmail(req.body);
  res.status(201).json({
    success: true,
    data: { user: toPublicUser(user), ...tokens },
  });
});

const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const { user, ...tokens } = await authService.loginWithEmail(email, password);
  res.status(200).json({
    success: true,
    data: { user: toPublicUser(user), ...tokens },
  });
});

const refresh = catchAsync(async (req, res) => {
  const tokens = await authService.refreshTokens(req.body.refreshToken);
  res.status(200).json({ success: true, data: tokens });
});

const me = catchAsync(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  res.status(200).json({ success: true, data: sanitizeUser(user) });
});

const logout = catchAsync(async (req, res) => res.status(200).json({ success: true, data: await authService.logout(req.body.refreshToken) }));

module.exports = { requestOtp, verifyOtp, signup, login, refresh, logout, me, vendorLogin };
