const express = require('express');
const podcastController = require('../controller/podcastController');
const authController = require('../controller/authController');

const router = express.Router();

router.use(authController.protect);

router
  .route('/')
  .get(podcastController.getBestPodcasts)
  .post(podcastController.savePodcast);

router.route('/getSavedPodcast').get(podcastController.getSavedPodcast);

router.route('/setHistory').post(podcastController.podcast_history);

router.route('/getHistory').get(podcastController.getHistory);

// Search podcasts by name (returns id, title, publisher, image, episodes)
router.route('/search').get(podcastController.search);

router
  .route('/getOneSavePodcast/:id')
  .get(podcastController.getOneSavedPodcast);

module.exports = router;
