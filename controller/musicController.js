const Supabase = require('../util/supabaseClient');
const AppError = require('../util/appError');
const catchAsync = require('../util/catchAsync');
const supabase = require('../util/supabaseClient');
const mm = require('music-metadata');
const multer = require('multer');
const { z } = require('zod');

const upload = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'music', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]);

async function uploadBufferToBucket(bucket, path, buffer, contentType) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: false
    });

  if (error) throw error;

  // get public URL
  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicData && publicData.publicUrl ? publicData.publicUrl : null;
}

async function prepareSongRecord(req) {
  if (!req.files) {
    throw new AppError(
      'No files parsed. Ensure upload middleware is applied on the route',
      400
    );
  }

  const musicFile = req.files.music && req.files.music[0];
  const imageFile = req.files.image && req.files.image[0];

  if (!musicFile) {
    throw new AppError('Audio file is required (field name: music)', 400);
  }

  const audioBucket = process.env.SUPABASE_AUDIO_BUCKET || 'songs';
  const imageBucket = process.env.SUPABASE_IMAGE_BUCKET || 'images';

  const timestamp = Date.now();
  const audioPath = `${timestamp}_${musicFile.originalname}`;
  const imagePath = imageFile ? `${timestamp}_${imageFile.originalname}` : null;

  let duration = null;
  try {
    const meta = await mm.parseBuffer(musicFile.buffer, musicFile.mimetype);
    duration =
      meta && meta.format && meta.format.duration
        ? Math.round(meta.format.duration)
        : null;
  } catch (err) {
    console.warn(
      'Failed to parse audio metadata for duration:',
      err.message || err
    );
  }

  let audioUrl = null;
  let imageUrl = null;
  try {
    audioUrl = await uploadBufferToBucket(
      audioBucket,
      audioPath,
      musicFile.buffer,
      musicFile.mimetype
    );
  } catch (err) {
    throw new AppError(`Failed to upload audio: ${err.message || err}`, 500);
  }

  if (imageFile) {
    try {
      imageUrl = await uploadBufferToBucket(
        imageBucket,
        imagePath,
        imageFile.buffer,
        imageFile.mimetype
      );
    } catch (err) {
      console.warn(
        'Image upload failed, continuing without image URL:',
        err.message || err
      );
      imageUrl = null;
    }
  }

  const record = {
    copyright_text: req.body.copyright_text || null,
    duration: duration,
    image: imageUrl,
    label: req.body.label || null,
    media_url: audioUrl,
    music: musicFile.originalname,
    song: req.body.song || null,
    year: req.body.year || null
  };

  return record;
}

exports.getAllMusic = catchAsync(async (req, res, next) => {
  const fields = [
    'id',
    'copyright_text',
    'duration',
    'image',
    'label',
    'media_url',
    'music',
    'song',
    'year'
  ].join(',');

  const { data, error } = await supabase.from('songs').select(fields);

  if (error) {
    return next(new AppError(error.message || 'Database error', 500));
  }

  res.status(200).json({ status: 'success', length: data.length, songs: data });
});

exports.getMusic = catchAsync(async (req, res, next) => {
  const id = req.params.id;

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(String(id || ''))) {
    return next(new AppError('Invalid id format', 400));
  }

  const fields = [
    'id',
    'copyright_text',
    'duration',
    'image',
    'label',
    'media_url',
    'music',
    'song',
    'year'
  ].join(',');

  const { data, error } = await supabase
    .from('songs')
    .select(fields)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return next(new AppError(error.message || 'Database error', 500));
  }

  if (!data) {
    return next(new AppError('Could not find the song', 404));
  }

  res.status(200).json({ status: 'success', song: data });
});

exports.uploadSong = catchAsync(async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => {
      upload(req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  } catch (err) {
    return next(
      new AppError(`Failed to parse upload: ${err.message || err}`, 400)
    );
  }

  let record;
  try {
    record = await prepareSongRecord(req);
  } catch (err) {
    return next(
      err instanceof AppError
        ? err
        : new AppError(err.message || 'Upload failed', 500)
    );
  }

  const { data, error } = await supabase
    .from('songs')
    .insert([record])
    .select()
    .maybeSingle();

  if (error) {
    return next(
      new AppError(error.message || 'Failed to insert song record', 500)
    );
  }

  res.status(201).json({ status: 'success', song: data });
});

exports.likeSong = catchAsync(async (req, res, next) => {
  const { song_id, playlist_name = 'Liked' } = req.body;

  if (!song_id) {
    return next(new AppError('Please select a song', 400));
  }

  const { data, error } = await supabase
    .from('playlists')
    .insert({ song_id, playlist_name, user_id: req.user.id })
    .select()
    .maybeSingle();

  if (error) {
    return next(
      new AppError(
        error.message || 'There is a problem in adding the song to liked list'
      )
    );
  }

  res.status(200).json({
    status: 'success',
    data
  });
});

exports.userWatch = catchAsync(async (req, res, next) => {
  // Validate input: we only accept `song_id` from client. watched_at is set server-side.
  const userWatchSchema = z.object({
    song_id: z.string().uuid('Invalid song_id')
  });

  const parsed = userWatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join(', ');
    return next(new AppError(message, 400));
  }

  const { song_id } = parsed.data;

  if (!req.user || !req.user.id) {
    return next(new AppError('Authenticated user required', 401));
  }

  const record = {
    user_id: req.user.id,
    song_id,
    watched_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('history')
    .insert([record])
    .select()
    .maybeSingle();

  if (error) {
    return next(
      new AppError(error.message || 'Failed to insert history record', 500)
    );
  }

  res.status(201).json({ status: 'success', history: data });
});

exports.search = catchAsync(async (req, res, next) => {
  // Accept query from `req.query.q` (GET) or `req.body.q` (POST)
  const searchSchema = z.object({
    q: z.string().min(1, 'Search query is required'),
    page: z
      .preprocess(
        (val) => (val === undefined ? undefined : Number(val)),
        z.number().int().positive()
      )
      .optional(),
    limit: z
      .preprocess(
        (val) => (val === undefined ? undefined : Number(val)),
        z.number().int().positive().max(100)
      )
      .optional()
  });

  const input = {
    q: (req.query && req.query.q) || (req.body && req.body.q) || undefined,
    page: (req.query && req.query.page) || (req.body && req.body.page),
    limit: (req.query && req.query.limit) || (req.body && req.body.limit)
  };

  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(', ');
    return next(new AppError(message, 400));
  }

  const { q, page = 1, limit = 20 } = parsed.data;

  const fields = [
    'id',
    'copyright_text',
    'duration',
    'image',
    'label',
    'media_url',
    'music',
    'song',
    'year'
  ].join(',');

  // Use ILIKE for case-insensitive LIKE search in Postgres
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error } = await supabase
    .from('songs')
    .select(fields)
    .ilike('song', `%${q}%`)
    .range(from, to);

  if (error) {
    return next(new AppError(error.message || 'Database error', 500));
  }

  res
    .status(200)
    .json({ status: 'success', results: data.length, songs: data });
});
