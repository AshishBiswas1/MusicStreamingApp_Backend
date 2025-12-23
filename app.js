const express = require('express');
const morgan = require('morgan');
const globalErrorHandler = require('./controller/errorontroller');
const AppError = require('./util/appError');

const musicRouter = require('./router/musicRouter');
const app = express();

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use('/api/music', musicRouter);

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
