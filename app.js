const express = require('express');
const morgan = require('morgan');
const globalErrorHandler = require('./controller/errorontroller');
const AppError = require('./util/appError');

const musicRouter = require('./router/musicRouter');
const userRouter = require('./router/userRouter');
const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '10kb' }));
// Parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use('/api/music', musicRouter);
app.use('/api/user', userRouter);

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
