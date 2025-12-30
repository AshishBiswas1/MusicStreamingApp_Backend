const express = require('express');
const musicController = require('../controller/musicController');
const authController = require('../controller/authController');

const router = express.Router({ mergeParams: true });

router.route('/').get(musicController.getAllMusic);

router.route('/search').get(musicController.search);

// Public route: updating a user's `recommended` does NOT require authentication
// (defined before `authController.protect` middleware)
router
  .route('/updateRecommended/:user_id')
  .patch(musicController.updateRecommended);

router.use(authController.protect);

// When mounted under a parent route like `/playlist/:id/addSong`, the child
// router receives `:id` via `mergeParams: true`. Define POST on `/` so the
// final path becomes `/playlist/:id/addSong`.
router.route('/').post(musicController.addSongToPlaylist);

router.post(
  '/upload',
  authController.restrictTo('admin'),
  musicController.uploadSong
);

// Allow both `user` and `admin` roles. Pass roles as separate args.
router.use(authController.restrictTo('user', 'admin'));

router.route('/previously').get(musicController.getPreviouslyRecommended);

router.route('/recommended').get(musicController.recommended);

router.route('/savetosongs').post(musicController.saveRecommendedToSongs);

router.route('/userWatch').post(musicController.userWatch);

router.route('/like').post(musicController.likeSong);

router.route('/unlike').delete(musicController.unlikeSong);

router.route('/liked').get(musicController.getLikedSongs);

router.route('/:id').get(musicController.getMusic);

module.exports = router;
