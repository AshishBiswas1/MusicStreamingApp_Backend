const express = require('express');
const musicController = require('../controller/musicController');
const authController = require('../controller/authController');

const router = express.Router();

router.route('/').get(musicController.getAllMusic);

router.use(authController.protect);
router.post(
  '/upload',
  authController.restrictTo('admin'),
  musicController.uploadSong
);

router.use(authController.restrictTo('user'));
router.route('/userWatch').post(musicController.userWatch);

router.route('/like').post(musicController.likeSong);

router.route('/:id').get(musicController.getMusic);

module.exports = router;
