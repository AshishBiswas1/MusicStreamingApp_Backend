const AppError = require('../util/appError');

// Note: `util/appError.js` uses the property name `isOpertational` (typo).
const handleSupabaseError = (err) => {
  if (err instanceof AppError) return err;

  if (err && typeof err.status === 'number') {
    return new AppError(err.message || 'Database error', err.status);
  }

  const msg =
    (err && (err.message || err.error || err.msg)) || 'Supabase error';

  const isDuplicate =
    (err && err.code && String(err.code).includes('23505')) ||
    (typeof msg === 'string' &&
      /duplicate|unique constraint|already exists/i.test(msg));

  if (isDuplicate)
    return new AppError(
      'Duplicate field value. Please use another value.',
      400
    );

  if (err && err.code && String(err.code).includes('23503')) {
    return new AppError('Invalid reference or foreign key constraint.', 400);
  }

  if (err && err.status) {
    const statusNum = Number(err.status);
    if (!Number.isNaN(statusNum) && statusNum > 0 && statusNum < 600) {
      return new AppError(msg, statusNum);
    }
  }

  return new AppError(msg, 500);
};

const sendErrorDev = (err, req, res) => {
  const code = Number(err.statusCode);
  res.status(Number.isFinite(code) ? code : 500).json({
    status: err.status || 'error',
    error: err,
    message: err.message,
    stack: err.stack
  });
};

const sendErrorProd = (err, req, res) => {
  if (err.isOpertational) {
    const code = Number(err.statusCode);
    return res
      .status(Number.isFinite(code) ? code : 500)
      .json({ status: err.status, message: err.message });
  }

  console.error('ERROR 💥', err);

  res
    .status(500)
    .json({ status: 'error', message: 'Something went very wrong!' });
};

// Global error handler (use as `app.use(require('./controller/errorontroller'))`)
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status =
    err.status || (String(err.statusCode).startsWith('4') ? 'fail' : 'error');

  const env = process.env.NODE_ENV || 'development';

  if (env === 'development') {
    const normalized =
      err &&
      (err.code ||
        err.status ||
        (err.message && err.message.includes('Supabase')))
        ? handleSupabaseError(err)
        : err;
    return sendErrorDev(normalized, req, res);
  }

  let error = err;
  try {
    if (err && (err.code || err.status || err.error))
      error = handleSupabaseError(err);
  } catch (parseErr) {
    error = err;
  }

  sendErrorProd(error, req, res);
};
