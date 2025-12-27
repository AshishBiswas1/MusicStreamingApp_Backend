const supabase = require('../util/supabaseClient');
const AppError = require('../util/appError');
const catchAsync = require('../util/catchAsync');
const { z } = require('zod');

exports.setPlayedMusic = catchAsync(async (req, res, next) => {
  const userId = req.user && req.user.id;
  if (!userId) return next(new AppError('Authenticated user required', 401));

  const body = req.body || {};
  const songIdRaw = body.song_id || body.songId || body.song || null;

  const schema = z.object({ song_id: z.string().uuid() });
  let parsed;
  try {
    parsed = schema.parse({ song_id: String(songIdRaw) });
  } catch (err) {
    return next(
      new AppError('`song_id` is required and must be a valid UUID', 400)
    );
  }

  const songId = parsed.song_id;

  // Look for an existing recently played row for this user+song (pick the most recent if duplicates exist)
  const { data: existingRow, error: existErr } = await supabase
    .from('recently_played_music')
    .select('*')
    .match({ user_id: userId, song_id: songId })
    .order('played_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existErr) {
    return next(
      new AppError(existErr.message || 'Failed to check recently played', 500)
    );
  }

  const now = new Date().toISOString();
  if (existingRow && existingRow.id) {
    // Update only the played_at timestamp
    const { data: updated, error: updateErr } = await supabase
      .from('recently_played_music')
      .update({ played_at: now })
      .eq('id', existingRow.id)
      .select()
      .maybeSingle();

    if (updateErr) {
      return next(
        new AppError(
          updateErr.message || 'Failed to update recently played',
          500
        )
      );
    }

    return res
      .status(200)
      .json({ status: 'success', recently_played: updated });
  }

  // Insert new recently played record
  const record = {
    song_id: songId,
    user_id: userId,
    played_at: now
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('recently_played_music')
    .insert([record])
    .select()
    .maybeSingle();

  if (insertErr) {
    return next(
      new AppError(insertErr.message || 'Failed to save recently played', 500)
    );
  }

  res.status(201).json({ status: 'success', recently_played: inserted });
});

exports.getPlayedMusic = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const { data, error } = await supabase
    .from('recently_played_music')
    .select('*')
    .eq('user_id', userId)
    .order('played_at', { ascending: false });

  if (error) {
    return next(
      new AppError(
        error.message || 'Could not fetch the recently played Music',
        400
      )
    );
  }

  // If there are song_ids, fetch their details from `songs` table and populate
  const rows = Array.isArray(data) ? data : [];
  const songIds = Array.from(
    new Set(rows.map((r) => r.song_id).filter(Boolean))
  );

  let populated = rows;
  if (songIds.length > 0) {
    const { data: songs, error: songsErr } = await supabase
      .from('songs')
      .select('*')
      .in('id', songIds);

    if (songsErr) {
      return next(
        new AppError(songsErr.message || 'Failed to fetch songs', 500)
      );
    }

    const songMap = new Map();
    (Array.isArray(songs) ? songs : []).forEach((s) =>
      songMap.set(String(s.id), s)
    );

    populated = rows.map((r) => {
      const out = Object.assign({}, r);
      const sid = r && r.song_id ? String(r.song_id) : null;
      out.song_id = sid ? songMap.get(sid) || null : null;
      return out;
    });
  }

  res
    .status(200)
    .json({ status: 'success', length: populated.length, data: populated });
});

exports.setPlayedPodcast = catchAsync(async (req, res, next) => {
  const userId = req.user && req.user.id;
  if (!userId) return next(new AppError('Authenticated user required', 401));

  const body = req.body || {};
  const podcastIdRaw =
    body.podcast_id || body.podcastId || body.podcast || null;

  const schema = z.object({ podcast_id: z.string().min(1) });
  let parsed;
  try {
    parsed = schema.parse({ podcast_id: String(podcastIdRaw) });
  } catch (err) {
    return next(
      new AppError(
        '`podcast_id` is required and must be a non-empty string',
        400
      )
    );
  }

  const podcastId = parsed.podcast_id;

  // Look for an existing recently played row for this user+podcast (pick the most recent if duplicates exist)
  const { data: existingRow, error: existErr } = await supabase
    .from('recently_played_podcast')
    .select('*')
    .match({ user_id: userId, podcast_id: podcastId })
    .order('played_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existErr) {
    return next(
      new AppError(
        existErr.message || 'Failed to check recently played podcast',
        500
      )
    );
  }

  const now = new Date().toISOString();
  if (existingRow && existingRow.id) {
    // Update only the played_at timestamp
    const { data: updated, error: updateErr } = await supabase
      .from('recently_played_podcast')
      .update({ played_at: now })
      .eq('id', existingRow.id)
      .select()
      .maybeSingle();

    if (updateErr) {
      return next(
        new AppError(
          updateErr.message || 'Failed to update recently played podcast',
          500
        )
      );
    }

    return res
      .status(200)
      .json({ status: 'success', recently_played: updated });
  }

  // Insert new recently played podcast record
  const record = {
    podcast_id: podcastId,
    user_id: userId,
    played_at: now
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('recently_played_podcast')
    .insert([record])
    .select()
    .maybeSingle();

  if (insertErr) {
    return next(
      new AppError(
        insertErr.message || 'Failed to save recently played podcast',
        500
      )
    );
  }

  res.status(201).json({ status: 'success', recently_played: inserted });
});

exports.getPlayedPodcast = catchAsync(async (req, res, next) => {
  const { data, error } = await supabase
    .from('recently_played_podcast')
    .select('*')
    .eq('user_id', req.user.id)
    .order('played_at', { ascending: false });

  if (error) {
    return next(
      new AppError(
        error.message || 'Could not fetch the recently Played Podcast',
        400
      )
    );
  }

  const rows = Array.isArray(data) ? data : [];
  const podcastIds = Array.from(
    new Set(rows.map((r) => r.podcast_id).filter(Boolean))
  );

  let populated = rows;
  if (podcastIds.length > 0) {
    const { data: podcasts, error: podcastsErr } = await supabase
      .from('podcast')
      .select('*')
      .in('id', podcastIds);

    if (podcastsErr) {
      return next(
        new AppError(podcastsErr.message || 'Failed to fetch podcasts', 500)
      );
    }

    const podcastMap = new Map();
    (Array.isArray(podcasts) ? podcasts : []).forEach((p) =>
      podcastMap.set(String(p.id), p)
    );

    populated = rows.map((r) => {
      const out = Object.assign({}, r);
      const pid = r && r.podcast_id ? String(r.podcast_id) : null;
      // keep original podcast_id string and add `podcast` field with the populated data or null
      out.podcast_id = pid;
      out.podcast = pid ? podcastMap.get(pid) || null : null;
      return out;
    });
  }

  res
    .status(200)
    .json({ status: 'success', length: populated.length, data: populated });
});
