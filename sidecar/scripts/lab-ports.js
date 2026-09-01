/** Single source for lab bind — must match `lab/labDefaults.ts` (4077 / 4078). */
module.exports = {
  LAB_HOST: process.env.SPECULUM_LAB_HOST || '127.0.0.1',
  LAB_PORT: process.env.SPECULUM_LAB_PORT || '4077',
  LAB_XO_PORT: process.env.SPECULUM_LAB_XO_PORT || '4078',
};
