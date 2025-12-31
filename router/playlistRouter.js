const express = require('express');
const authController = require('../controller/authController');
const playlistController = require('../controller/playlistController');
const musicRouter = require('./musicRouter');

const router = express.Router();

router.use(authController.protect);

router
  .route('/')
  .get(playlistController.getUsersPlaylist)
  .post(playlistController.createPlaylist);

// Mount the musicRouter under a playlist id so child routes can access the
// parent `:id` param via `mergeParams: true` in the child router.
router.use('/:id/addSong', musicRouter);

router.route('/:id/songs').get(playlistController.getPlaylistSongs);

router
  .route('/:id')
  .get(playlistController.getPlaylist)
  .delete(playlistController.deletePlaylist);

module.exports = router;
