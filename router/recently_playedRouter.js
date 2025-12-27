const express = require('express');
const recently_played = require('../controller/recently_played');
const authController = require('../controller/authController');

const router = express.Router();
router.use(authController.protect, authController.restrictTo('user', 'admin'));

router
  .route('/RecentMusic')
  .post(recently_played.setPlayedMusic)
  .get(recently_played.getPlayedMusic);

router
  .route('/RecentPodcast')
  .post(recently_played.setPlayedPodcast)
  .get(recently_played.getPlayedPodcast);

module.exports = router;
