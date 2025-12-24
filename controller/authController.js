const supabase = require('../util/supabaseClient');
const AppError = require('../util/appError');
const catchAsync = require('../util/catchAsync');
const { z } = require('zod');

const signUpSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

exports.signUp = catchAsync(async (req, res, next) => {
  const parsed = signUpSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ');
    return next(new AppError(message, 400));
  }

  const { name, email, password } = parsed.data;

  // attach user metadata under `data` (Supabase v2 expects metadata in options.data)
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name }
    }
  });

  if (error) {
    return next(
      new AppError(error.message || 'Could not signup the user', 400)
    );
  }

  res.status(201).json({
    status: 'success',
    data
  });
});

exports.login = catchAsync(async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ');
    return next(new AppError(message, 400));
  }

  const { email, password } = parsed.data;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return next(
      new AppError(error.message || 'Could not log the user in!', 404)
    );
  }

  const token = data?.session?.access_token || null;

  if (!token) {
    // authentication succeeded but no session was returned (e.g. email confirmation required)
    return res.status(200).json({
      status: 'success',
      message: 'Login successful but no active session returned',
      data
    });
  }

  res.status(200).json({
    status: 'success',
    token,
    data
  });
});

// Protect middleware: verifies bearer token with Supabase and attaches user to req.user
exports.protect = catchAsync(async (req, res, next) => {
  // 1) Check if token exists
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError('You are not logged in. Please log in to get access.', 401)
    );
  }

  // 2) Verify token with Supabase
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return next(
      new AppError(
        'Invalid token or session expired. Please log in again.',
        401
      )
    );
  }

  // 3) Attach user to request
  req.user = user;
  next();
});

// restrictTo middleware: fetch role from custom `users` table and check permissions
exports.restrictTo = (...roles) => {
  return catchAsync(async (req, res, next) => {
    // User must be authenticated first (protect middleware should run before this)
    if (!req.user) {
      return next(
        new AppError('You must be logged in to access this route.', 401)
      );
    }

    // Fetch user role from custom user table
    const { data: userData, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error) {
      return next(
        new AppError('Could not fetch user role. Please try again.', 500)
      );
    }

    if (!userData || !userData.role) {
      return next(new AppError('User role not found.', 403));
    }

    // Check if user's role is in the allowed roles
    if (!roles.includes(userData.role)) {
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }

    next();
  });
};
