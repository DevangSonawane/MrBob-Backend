const jwt = require('jsonwebtoken');
const env = require('../../config/env');

const signAccessToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });

const signRefreshToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  });

const verifyRefreshToken = (token) => jwt.verify(token, env.JWT_REFRESH_SECRET);

const issueTokenPair = (user) => ({
  accessToken: signAccessToken(user),
  refreshToken: signRefreshToken(user),
});

module.exports = { signAccessToken, signRefreshToken, verifyRefreshToken, issueTokenPair };
