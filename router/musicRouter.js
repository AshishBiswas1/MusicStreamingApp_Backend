const express = require('express');
const musicController = require('../controller/musicController');

const router = express.Router();

router.route('/').get(musicController.getAllMusic);
router.post('/upload', musicController.uploadSong);

router.route('/:id').get(musicController.getMusic);

module.exports = router;
