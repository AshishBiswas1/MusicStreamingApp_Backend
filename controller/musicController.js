const Supabase = require('../util/supabaseClient');
const AppError = require('../util/appError');
const catchAsync = require('../util/catchAsync');
const supabase = require('../util/supabaseClient');
const mm = require('music-metadata');
const https = require('https');
const multer = require('multer');
const { z } = require('zod');

const upload = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'music', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]);

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
    .from('likes')
    .insert({ song_id, user_id: req.user.id })
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

exports.recommended = catchAsync(async (req, res, next) => {
  // Fetch the user's recommended array from DB. Use maybeSingle() so we get
  // an object { recommended: [...] } or null rather than an array of rows.
  const userId = req.user && req.user.id;

  let recommended = null;
  // keep the raw value fetched from DB (if any) so we can return it explicitly
  let recommended_from_db = null;

  if (userId) {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('recommended')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return next(new AppError(error.message || 'Database error', 500));
    }

    if (userRow && Array.isArray(userRow.recommended)) {
      recommended = userRow.recommended;
      recommended_from_db = userRow.recommended;
    }
  }

  // If DB didn't yield a recommended array, fall back to any value present on req.user
  if (
    (!Array.isArray(recommended) || recommended.length === 0) &&
    req.user &&
    Array.isArray(req.user.recommended)
  ) {
    recommended = req.user.recommended;
  }

  if (!Array.isArray(recommended) || recommended.length === 0) {
    return res.status(200).json({
      status: 'success',
      recommended: [],
      recommended_field: recommended,
      recommended_from_db,
      length: 0
    });
  }

  // If recommended is exactly ["all"], fetch songs from Supabase
  if (
    recommended.length === 1 &&
    String(recommended[0] || '')
      .trim()
      .toLowerCase() === 'all'
  ) {
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

    return res.status(200).json({
      status: 'success',
      recommended: [
        {
          query: 'all',
          ok: true,
          data
        }
      ],
      recommended_field: recommended,
      recommended_from_db,
      length: Array.isArray(data) ? data.length : 0
    });
  }

  function fetchJson(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (resp) => {
          const { statusCode } = resp;
          let rawData = '';

          resp.on('data', (chunk) => {
            rawData += chunk;
          });

          resp.on('end', () => {
            if (statusCode < 200 || statusCode >= 300) {
              return reject(
                new Error(`Request failed with status ${statusCode}`)
              );
            }
            try {
              const parsed = JSON.parse(rawData);
              resolve(parsed);
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', (e) => reject(e));
    });
  }

  const base = 'https://saavnapi-nine.vercel.app/result/?query=';
  const desiredFields = [
    'copyright_text',
    'duration',
    'image',
    'label',
    'media_url',
    'music',
    'song',
    'year'
  ];

  function pick(item, keys) {
    for (const k of keys) {
      if (item == null) break;
      if (
        Object.prototype.hasOwnProperty.call(item, k) &&
        item[k] !== undefined
      )
        return item[k];
      if (item[k] !== undefined) return item[k];
    }
    return undefined;
  }

  function normalizeItems(apiData) {
    if (apiData == null) return [];

    let items = [];
    if (Array.isArray(apiData)) items = apiData;
    else if (Array.isArray(apiData.results)) items = apiData.results;
    else if (Array.isArray(apiData.data)) items = apiData.data;
    else if (Array.isArray(apiData.songs)) items = apiData.songs;
    else if (Array.isArray(apiData.tracks)) items = apiData.tracks;
    else items = [apiData];

    return items.map((it) => {
      const out = {};
      // attempt to map common alternative keys for each desired field
      out.copyright_text = pick(it, [
        'copyright_text',
        'copyright',
        'copyrightText'
      ]);
      out.duration = pick(it, [
        'duration',
        'length',
        'time',
        'duration_seconds'
      ]);
      out.image = pick(it, ['image', 'image_url', 'thumbnail', 'img', 'cover']);
      out.label = pick(it, ['label', 'album', 'album_name', 'publisher']);
      out.media_url = pick(it, [
        'media_url',
        'url',
        'mediaURL',
        'downloadUrl',
        'more_info',
        'link'
      ]);
      out.music = pick(it, ['music', 'music_name', 'title', 'name']);
      out.song = pick(it, ['song', 'title', 'name']);
      out.year = pick(it, ['year', 'release_year', 'released']);
      return out;
    });
  }

  const promises = recommended.map((q) => {
    const queryStr = String(q || '').trim();
    if (!queryStr) {
      return Promise.resolve({ query: q, ok: false, error: 'empty query' });
    }
    const url = `${base}${encodeURIComponent(queryStr)}`;
    return fetchJson(url)
      .then((data) => ({
        data: normalizeItems(data)
      }))
      .catch((err) => ({
        query: queryStr,
        ok: false,
        error: err.message || String(err)
      }));
  });

  const results = await Promise.all(promises);

  // compute total length of returned items across all query results
  let total = 0;
  for (const r of results) {
    if (r && r.data && Array.isArray(r.data)) total += r.data.length;
  }

  // If we used the external Saavn API (not the 'all' branch), store the
  // normalized results in `previously_recommended` for the authenticated user.
  // Only insert items that don't already exist for this user (by media_url
  // or song). This is non-blocking for the response: insertion errors are
  // logged but do not stop the request.
  try {
    if (userId) {
      const candidates = [];
      const mediaUrls = [];
      const songs = [];

      for (const r of results) {
        if (!r || !r.data || !Array.isArray(r.data)) continue;
        for (const it of r.data) {
          if (!it) continue;
          const rec = {
            user_id: userId,
            copyright_text: it.copyright_text || null,
            duration:
              it.duration !== undefined && it.duration !== null
                ? Number(it.duration)
                : null,
            image: it.image || null,
            label: it.label || null,
            media_url: it.media_url || null,
            music: it.music || null,
            song: it.song || null,
            year:
              it.year !== undefined && it.year !== null ? Number(it.year) : null
          };
          if (!rec.media_url && !rec.song) continue;
          candidates.push(rec);
          if (rec.media_url) mediaUrls.push(rec.media_url);
          if (rec.song) songs.push(rec.song);
        }
      }

      const existingMedia = new Set();
      const existingSongs = new Set();

      try {
        // Fetch existing previously_recommended rows for this user and build
        // sets for quick membership tests. Fetching all rows for the user is
        // simpler and robust against case/format differences in `song`.
        const { data: existingRows, error: existingErr } = await supabase
          .from('previously_recommended')
          .select('media_url, song')
          .eq('user_id', userId);

        if (existingErr) {
          console.warn(
            'previously_recommended existence check failed:',
            existingErr.message || existingErr
          );
        } else if (Array.isArray(existingRows)) {
          for (const row of existingRows) {
            if (row.media_url) existingMedia.add(String(row.media_url));
            if (row.song)
              existingSongs.add(String(row.song).trim().toLowerCase());
          }
        }
      } catch (err) {
        console.warn(
          'Error checking previously_recommended existence:',
          err && err.message ? err.message : err
        );
      }

      const toInsert = candidates.filter((c) => {
        if (c.media_url && existingMedia.has(String(c.media_url))) return false;
        if (
          !c.media_url &&
          c.song &&
          existingSongs.has(String(c.song).trim().toLowerCase())
        )
          return false;
        return true;
      });

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('previously_recommended')
          .insert(toInsert);
        if (insertError) {
          console.warn(
            'previously_recommended insert failed:',
            insertError.message || insertError
          );
        }
      }
    }
  } catch (err) {
    console.warn(
      'Error storing previously recommended items:',
      err && err.message ? err.message : err
    );
  }

  res.status(200).json({
    status: 'success',
    recommended_from_db,
    length: total,
    recommended: results
  });
});

exports.updateRecommended = catchAsync(async (req, res, next) => {
  // Read user id from route params (public endpoint)
  const paramsSchema = z.object({
    user_id: z.string().uuid('Invalid user_id')
  });

  const parsedParams = paramsSchema.safeParse(req.params ?? {});
  if (!parsedParams.success) {
    const message = parsedParams.error.issues.map((i) => i.message).join(', ');
    return next(new AppError(message, 400));
  }

  const id = parsedParams.data.user_id;

  const schema = z.object({
    recommended: z
      .array(
        z.string().min(1, 'Each recommendation must be a non-empty string')
      )
      .min(1, 'recommended must contain at least one item')
  });

  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(', ');
    return next(new AppError(message, 400));
  }

  const { recommended } = parsed.data;

  // Update the user's recommended array in the users table
  const { data, error } = await supabase
    .from('users')
    .update({ recommended })
    .eq('id', id)
    .select('id, recommended')
    .maybeSingle();

  if (error) {
    return next(
      new AppError(error.message || 'Failed to update recommended', 500)
    );
  }

  res.status(200).json({ status: 'success', recommended: data.recommended });
});

exports.addSongToPlaylist = catchAsync(async (req, res, next) => {
  if (!req.user || !req.user.id) {
    return next(new AppError('Authenticated user required', 401));
  }

  // Accept playlist id from route params (parent router) or request body.
  const input = Object.assign({}, req.body || {}, {
    playlist_id:
      (req.params &&
        (req.params.id || req.params.playlist_id || req.params.playlist)) ||
      (req.body && (req.body.playlist_id || req.body.playlist))
  });

  const schema = z
    .object({
      song_id: z.string().uuid('Invalid song_id'),
      playlist: z.string().uuid().optional(),
      playlist_id: z.string().uuid().optional()
    })
    .refine((d) => !!(d.playlist || d.playlist_id), {
      message: 'playlist or playlist_id is required'
    });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(', ');
    return next(new AppError(message, 400));
  }

  const { song_id } = parsed.data;
  const playlistId = parsed.data.playlist_id || parsed.data.playlist;

  const record = {
    user_id: req.user.id,
    song_id,
    playlist: playlistId
  };

  // Try the expected table name first, fall back to possible misspelling
  let resp = await supabase
    .from('playlist_songs')
    .insert([record])
    .select()
    .maybeSingle();

  if (resp.error) {
    return next(
      new AppError(resp.error.message || 'Failed to add song to playlist', 500)
    );
  }

  res.status(201).json({ status: 'success', playlist_song: resp.data });
});

exports.getPreviouslyRecommended = catchAsync(async (req, res, next) => {
  const { data, error } = await supabase
    .from('previously_recommended')
    .select('song, music, label, image')
    .eq('user_id', req.user.id);

  if (error) {
    return next(
      new AppError(
        error.message || 'Could not fetch previously recommended songs!',
        400
      )
    );
  }

  res.status(200).json({
    status: 'success',
    length: data.length,
    data
  });
});
