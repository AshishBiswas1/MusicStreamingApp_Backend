const express = require('express');
const authController = require('../controller/authController');
const userController = require('../controller/userController');

const router = express.Router();

// Auth routes (public)
router.route('/signup').post(authController.signUp);
router.route('/login').post(authController.login);

// Protected routes (require authentication)
router.use(authController.protect);

router.route('/me').get(userController.getMe);
router.route('/lastPlayedSong').get(userController.getLastPlayedSong);

router
  .route('/updateMe')
  .patch(userController.uploadProfileImage, userController.updateMe);

router.route('/deleteMe').delete(userController.deleteMe);

module.exports = router;
