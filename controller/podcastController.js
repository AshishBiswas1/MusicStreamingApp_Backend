const { Client } = require('podcast-api');
const catchAsync = require('../util/catchAsync');
const https = require('https');
const supabase = require('../util/supabaseClient');
const AppError = require('../util/appError');

const API_KEY = '74aeeb795a6a44b69bf2154d0074e692';
const client = Client({ apiKey: API_KEY });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJsonWithKeyOnce(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'X-ListenAPI-Key': API_KEY } };
    const req = https.get(url, options, (resp) => {
      const { statusCode } = resp;
      let raw = '';
      resp.on('data', (chunk) => {
        raw += chunk;
      });
      resp.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          // If body isn't JSON, still surface the error
        }
        if (statusCode >= 200 && statusCode < 300) return resolve(parsed);
        const err = new Error(`Request failed with status ${statusCode}`);
        err.statusCode = statusCode;
        err.body = parsed;
        return reject(err);
      });
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(7000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

async function fetchJsonWithRetry(url, attempts = 3, initialDelay = 500) {
  let attempt = 0;
  while (attempt < attempts) {
    try {
      return await fetchJsonWithKeyOnce(url);
    } catch (err) {
      attempt += 1;
      const status = err && err.statusCode;
      if (attempt >= attempts) throw err;
      if (status === 429) {
        const backoff = initialDelay * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 200);
        await delay(backoff + jitter);
        continue;
      }
      // For other transient HTTP errors (5xx) retry as well
      if (status >= 500 && status < 600) {
        const backoff = initialDelay * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 200);
        await delay(backoff + jitter);
        continue;
      }
      throw err;
    }
  }
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

exports.getBestPodcasts = catchAsync(async (req, res, next) => {
  const page = req.query && req.query.page ? Number(req.query.page) : 1;
  const response = await client.fetchBestPodcasts({
    genre_id: '93',
    page: page,
    region: 'us',
    sort: 'listen_score',
    safe_mode: 0
  });

  const raw = response && response.data ? response.data : response;
  let podcasts = [];
  if (Array.isArray(raw)) podcasts = raw;
  else podcasts = raw.podcasts || raw.best_podcasts || raw.results || [];

  const batchSize = 3;
  const chunks = chunkArray(podcasts, batchSize);
  const results = [];

  for (const chunk of chunks) {
    const chunkPromises = chunk.map(async (p) => {
      const id = p && (p.id || p._id || p.podcast_id);
      const base = {
        id: id || null,
        title: p.title || null,
        publisher: p.publisher || null,
        image: p.image || p.thumbnail || null
      };
      if (!id) return Object.assign({}, base, { episodes: [] });
      const url = `https://listen-api.listennotes.com/api/v2/podcasts/${id}?sort=recent_first`;
      try {
        const pod = await fetchJsonWithRetry(url, 4, 500);
        const episodes = Array.isArray(pod && pod.episodes) ? pod.episodes : [];
        // Sort episodes by pub_date_ms ascending (oldest first). Treat missing/invalid dates as newest.
        episodes.sort((a, b) => {
          const pa =
            a && a.pub_date_ms != null ? Number(a.pub_date_ms) : Infinity;
          const pb =
            b && b.pub_date_ms != null ? Number(b.pub_date_ms) : Infinity;
          return pa - pb;
        });
        const episodesSummary = episodes.map((e) => ({
          id: e.id,
          title: e.title,
          audio: e.audio,
          audio_length_sec: e.audio_length_sec,
          pub_date_ms: e.pub_date_ms
        }));
        return Object.assign({}, base, { episodes: episodesSummary });
      } catch (err) {
        return Object.assign({}, base, { episodes: [] });
      }
    });
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    // slightly longer pause between batches to reduce request bursts and avoid rate limits
    await delay(500);
  }

  res.status(200).json({
    status: 'success',
    length: results.length,
    data: results
  });
});

exports.savePodcast = catchAsync(async (req, res, next) => {
  const body = req.body || {};
  const podcastId = body.id;
  const title = body.title || null;
  const publisher = body.publisher || null;
  const image = body.image || null;

  if (!podcastId || !title) {
    return next(new AppError('podcast id and title are required', 400));
  }

  const episodes = Array.isArray(body.episodes) ? body.episodes : [];
  const episodeIds = episodes.map((e) => e && e.id).filter(Boolean);

  const userId = req.user && req.user.id ? req.user.id : null;

  const podcastRecord = {
    id: podcastId,
    title,
    publisher,
    image,
    user_id: userId,
    episode: episodeIds.length > 0 ? episodeIds : null
  };

  // Upsert podcast into `podcast` table (note: table name is 'podcast')
  const { data: podcastData, error: podcastError } = await supabase
    .from('podcast')
    .upsert([podcastRecord], { onConflict: 'id' })
    .select()
    .maybeSingle();

  if (podcastError) {
    return next(
      new AppError(podcastError.message || 'Failed to save podcast', 500)
    );
  }

  // Prepare episode records and insert only those that don't already exist
  let episodesInserted = [];
  if (episodes.length > 0) {
    // Check which episode ids already exist
    const { data: existingRows, error: existingErr } = await supabase
      .from('episodes')
      .select('id')
      .in('id', episodeIds);

    if (existingErr) {
      return next(
        new AppError(
          existingErr.message || 'Failed to check existing episodes',
          500
        )
      );
    }

    const existingIds = new Set((existingRows || []).map((r) => String(r.id)));

    const toInsert = episodes.filter(
      (e) => e && !existingIds.has(String(e.id))
    );

    if (toInsert.length > 0) {
      const episodeRecords = toInsert.map((e) => ({
        id: e.id,
        title: e.title || null,
        audio: e.audio || null,
        audio_length:
          e.audio_length_sec != null ? Number(e.audio_length_sec) : null,
        published_at:
          e.pub_date_ms != null
            ? new Date(Number(e.pub_date_ms)).toISOString().slice(0, 10)
            : null
      }));

      const { data: epsData, error: epsError } = await supabase
        .from('episodes')
        .insert(episodeRecords)
        .select();

      if (epsError) {
        return next(
          new AppError(epsError.message || 'Failed to save episodes', 500)
        );
      }

      episodesInserted = Array.isArray(epsData) ? epsData : [];
    }
  }

  res.status(201).json({
    status: 'success',
    podcast: podcastData,
    episodes: episodesInserted
  });
});

exports.getSavedPodcast = catchAsync(async (req, res, next) => {
  const userId = req.user && req.user.id;
  if (!userId) {
    return next(new AppError('Authenticated user required', 401));
  }

  const { data: podcasts, error: podcastsErr } = await supabase
    .from('podcast')
    .select('*')
    .eq('user_id', userId);

  if (podcastsErr) {
    return next(
      new AppError(podcastsErr.message || 'Failed to fetch podcasts', 500)
    );
  }

  if (!Array.isArray(podcasts) || podcasts.length === 0) {
    return res.status(200).json({ status: 'success', length: 0, podcasts: [] });
  }

  const populatedPodcasts = podcasts.map((p) => {
    const ids = Array.isArray(p.episode) ? p.episode : [];
    const out = Object.assign({}, p);
    delete out.episode;
    out.episodes = ids;
    return out;
  });

  res.status(200).json({
    status: 'success',
    length: populatedPodcasts.length,
    podcasts: populatedPodcasts
  });
});

exports.podcast_history = catchAsync(async (req, res, next) => {
  const userId = req.user && req.user.id;
  if (!userId) {
    return next(new AppError('Authenticated user required', 401));
  }

  const body = req.body || {};
  const podcast_id = body.podcast_id || body.podcastId || body.podcast || null;
  const episode_id = body.episode_id || body.episodeId || body.episode || null;
  const watchedRaw =
    body.watched || body.watched_count || body.watchedAt || null;
  const watched = watchedRaw != null ? Number(watchedRaw) : null;

  if (!podcast_id || !episode_id) {
    return next(new AppError('podcast_id and episode_id are required', 400));
  }

  const record = {
    user_id: userId,
    podcast_id: String(podcast_id),
    episode_id: String(episode_id)
  };
  if (watched !== null && !Number.isNaN(watched)) record.watched = watched;
  // Check for existing history row for this user+episode (+podcast if provided)
  const matchObj = { user_id: userId, episode_id: String(episode_id) };
  if (podcast_id) matchObj.podcast_id = String(podcast_id);

  const { data: existingRow, error: existErr } = await supabase
    .from('podcast_history')
    .select('*')
    .match(matchObj)
    .maybeSingle();

  if (existErr) {
    return next(
      new AppError(existErr.message || 'Failed to check podcast history', 500)
    );
  }

  if (existingRow) {
    // Try to update `updated_at` first; if column doesn't exist, fall back to updating `created_at`.
    const now = new Date().toISOString();
    const updatePayload = { updated_at: now };
    if (watched !== null && !Number.isNaN(watched))
      updatePayload.watched = watched;
    let { data: updated, error: updateErr } = await supabase
      .from('podcast_history')
      .update(updatePayload)
      .eq('id', existingRow.id)
      .select()
      .maybeSingle();

    if (updateErr && /updated_at/.test(updateErr.message || '')) {
      const fallbackPayload = { created_at: now };
      if (watched !== null && !Number.isNaN(watched))
        fallbackPayload.watched = watched;
      const { data: updated2, error: updateErr2 } = await supabase
        .from('podcast_history')
        .update(fallbackPayload)
        .eq('id', existingRow.id)
        .select()
        .maybeSingle();

      if (updateErr2) {
        return next(
          new AppError(
            updateErr2.message || 'Failed to update podcast history timestamp',
            500
          )
        );
      }

      return res.status(200).json({ status: 'success', history: updated2 });
    }

    if (updateErr) {
      return next(
        new AppError(
          updateErr.message || 'Failed to update podcast history',
          500
        )
      );
    }

    return res.status(200).json({ status: 'success', history: updated });
  }

  // Insert new history record
  const { data, error } = await supabase
    .from('podcast_history')
    .insert([record])
    .select()
    .maybeSingle();

  if (error) {
    return next(
      new AppError(error.message || 'Failed to save podcast history', 500)
    );
  }

  res.status(201).json({ status: 'success', history: data });
});

exports.getHistory = catchAsync(async (req, res, next) => {
  const userId = req.user && req.user.id;
  if (!userId) {
    return next(new AppError('Authenticated user required', 401));
  }

  // Fetch history rows for this user, most recent first
  const { data: historyRows, error: historyErr } = await supabase
    .from('podcast_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (historyErr) {
    return next(
      new AppError(historyErr.message || 'Failed to fetch history', 500)
    );
  }

  if (!Array.isArray(historyRows) || historyRows.length === 0) {
    return res.status(200).json({ status: 'success', length: 0, history: [] });
  }

  // Collect unique podcast and episode ids to fetch
  const podcastIds = new Set();
  const episodeIds = new Set();
  for (const h of historyRows) {
    if (h.podcast_id) podcastIds.add(String(h.podcast_id));
    if (h.episode_id) episodeIds.add(String(h.episode_id));
  }

  let podcasts = [];
  if (podcastIds.size > 0) {
    const ids = Array.from(podcastIds);
    const { data: pData, error: pErr } = await supabase
      .from('podcast')
      .select('id,title,image')
      .in('id', ids);
    if (pErr)
      return next(
        new AppError(pErr.message || 'Failed to fetch podcasts', 500)
      );
    podcasts = Array.isArray(pData) ? pData : [];
  }

  let episodes = [];
  if (episodeIds.size > 0) {
    const ids = Array.from(episodeIds);
    const { data: eData, error: eErr } = await supabase
      .from('episodes')
      .select('id,title,audio,audio_length,published_at')
      .in('id', ids);
    if (eErr)
      return next(
        new AppError(eErr.message || 'Failed to fetch episodes', 500)
      );
    episodes = Array.isArray(eData) ? eData : [];
  }

  const podcastMap = new Map();
  for (const p of podcasts) podcastMap.set(String(p.id), p);
  const episodeMap = new Map();
  for (const e of episodes) episodeMap.set(String(e.id), e);

  // Build populated history preserving original order
  const populated = historyRows.map((h) => {
    const out = {
      id: h.id,
      podcast_id: h.podcast_id,
      episode_id: h.episode_id,
      created_at: h.created_at
    };
    const pod = podcastMap.get(String(h.podcast_id)) || null;
    const ep = episodeMap.get(String(h.episode_id)) || null;
    out.podcast = pod
      ? { id: pod.id, title: pod.title, image: pod.image }
      : null;
    out.episode = ep
      ? {
          id: ep.id,
          title: ep.title,
          audio: ep.audio,
          audio_length: ep.audio_length,
          published_at: ep.published_at
        }
      : null;
    return out;
  });

  res
    .status(200)
    .json({ status: 'success', length: populated.length, history: populated });
});

exports.getOneSavedPodcast = catchAsync(async (req, res, next) => {
  const userId = req.user && req.user.id;
  if (!userId) return next(new AppError('Authenticated user required', 401));

  const podcastId = (req.params && req.params.id) || req.query.id;
  if (!podcastId) return next(new AppError('podcast id is required', 400));

  // Fetch latest podcast info from ListenNotes
  let remote;
  try {
    const resp = await client.fetchPodcastById({
      id: podcastId,
      sort: 'recent_first'
    });
    remote = resp && resp.data ? resp.data : resp;
  } catch (err) {
    // Non-fatal: continue but log
    console.warn(
      'Failed to fetch remote podcast:',
      err && err.message ? err.message : err
    );
    remote = null;
  }

  const remoteEpisodes =
    remote && Array.isArray(remote.episodes) ? remote.episodes : [];
  const latest = remoteEpisodes.length > 0 ? remoteEpisodes[0] : null;

  // Load saved podcast for this user
  const { data: savedPodcast, error: savedErr } = await supabase
    .from('podcast')
    .select('*')
    .eq('id', podcastId)
    .eq('user_id', userId)
    .maybeSingle();

  if (savedErr)
    return next(
      new AppError(savedErr.message || 'Failed to fetch saved podcast', 500)
    );
  if (!savedPodcast)
    return next(new AppError('Saved podcast not found for this user', 404));

  const existingEpisodeIds = Array.isArray(savedPodcast.episode)
    ? savedPodcast.episode
    : [];

  // If remote provided a latest episode and it's not in saved array, insert episode + update podcast.episode
  if (latest && latest.id && !existingEpisodeIds.includes(latest.id)) {
    // Check if episode exists in episodes table
    const { data: epExisting, error: epExistErr } = await supabase
      .from('episodes')
      .select('id')
      .eq('id', latest.id)
      .maybeSingle();

    if (epExistErr) {
      return next(
        new AppError(
          epExistErr.message || 'Failed to check episode existence',
          500
        )
      );
    }

    if (!epExisting) {
      const episodeRecord = {
        id: latest.id,
        title: latest.title || null,
        audio: latest.audio || null,
        audio_length:
          latest.audio_length_sec != null
            ? Number(latest.audio_length_sec)
            : null,
        published_at:
          latest.pub_date_ms != null
            ? new Date(Number(latest.pub_date_ms)).toISOString().slice(0, 10)
            : null
      };

      const { data: insertedEp, error: insertErr } = await supabase
        .from('episodes')
        .insert([episodeRecord])
        .select()
        .maybeSingle();

      if (insertErr) {
        // If insertion fails due to race, ignore; otherwise surface
        if (!/duplicate|unique|conflict/i.test(insertErr.message || '')) {
          return next(
            new AppError(insertErr.message || 'Failed to insert episode', 500)
          );
        }
      }
    }

    // Prepend latest id to the episode array to keep newest first
    const newEpisodeIds = [latest.id, ...existingEpisodeIds];
    const { data: updatedPodcast, error: updateErr } = await supabase
      .from('podcast')
      .update({ episode: newEpisodeIds })
      .eq('id', podcastId)
      .select()
      .maybeSingle();

    if (updateErr) {
      return next(
        new AppError(
          updateErr.message || 'Failed to update podcast episode list',
          500
        )
      );
    }

    // use updatedPodcast as the current savedPodcast
    savedPodcast.episode = Array.isArray(
      updatedPodcast && updatedPodcast.episode
    )
      ? updatedPodcast.episode
      : newEpisodeIds;
  }

  // Now populate episodes for the savedPodcast
  const epIds = Array.isArray(savedPodcast.episode) ? savedPodcast.episode : [];
  let episodesRows = [];
  if (epIds.length > 0) {
    const { data: fetchedEpisodes, error: fetchEpErr } = await supabase
      .from('episodes')
      .select('*')
      .in('id', epIds);

    if (fetchEpErr)
      return next(
        new AppError(fetchEpErr.message || 'Failed to fetch episodes', 500)
      );
    episodesRows = Array.isArray(fetchedEpisodes) ? fetchedEpisodes : [];
  }

  // Sort episodesRows by `published_at` ascending (oldest first). Treat missing dates as newest.
  episodesRows.sort((a, b) => {
    const ta =
      a && a.published_at ? new Date(a.published_at).getTime() : Infinity;
    const tb =
      b && b.published_at ? new Date(b.published_at).getTime() : Infinity;
    return ta - tb;
  });

  // Use the sorted episodes as the populated list (oldest -> newest)
  const populated = episodesRows;

  const out = Object.assign({}, savedPodcast);
  delete out.episode;
  out.episodes = populated;

  res.status(200).json({ status: 'success', podcast: out });
});

exports.search = catchAsync(async (req, res, next) => {
  const q =
    (req.query && (req.query.q || req.query.q)) || (req.body && req.body.q);
  if (!q || String(q).trim() === '')
    return next(new AppError('query parameter `q` is required', 400));

  const page = req.query && req.query.page ? Number(req.query.page) : 1;

  const searchUrl = `https://listen-api.listennotes.com/api/v2/search?q=${encodeURIComponent(
    String(q)
  )}&type=podcast&sort_by_date=0&page=${page}`;

  let searchResp;
  try {
    searchResp = await fetchJsonWithRetry(searchUrl, 4, 500);
  } catch (err) {
    return next(new AppError(err.message || 'Failed to search podcasts', 502));
  }

  const rawResults = Array.isArray(searchResp)
    ? searchResp
    : searchResp.results || searchResp.podcasts || [];

  const podcasts = rawResults.map((item) =>
    item && item.podcast ? item.podcast : item
  );

  const batchSize = 3;
  const chunks = chunkArray(podcasts, batchSize);
  const results = [];

  for (const chunk of chunks) {
    const chunkPromises = chunk.map(async (p) => {
      const id = p && (p.id || p._id || p.podcast_id);
      const base = {
        id: id || null,
        title: p.title || p.title_original || null,
        publisher: p.publisher || p.publisher_original || null,
        image: p.image || p.thumbnail || null
      };
      if (!id) return Object.assign({}, base, { episodes: [] });

      const url = `https://listen-api.listennotes.com/api/v2/podcasts/${id}?sort=recent_first`;
      try {
        const pod = await fetchJsonWithRetry(url, 4, 500);
        const episodes = Array.isArray(pod && pod.episodes) ? pod.episodes : [];
        const episodesSummary = episodes.map((e) => ({
          id: e.id,
          title: e.title,
          audio: e.audio,
          audio_length_sec: e.audio_length_sec,
          pub_date_ms: e.pub_date_ms
        }));
        return Object.assign({}, base, { episodes: episodesSummary });
      } catch (err) {
        return Object.assign({}, base, { episodes: [] });
      }
    });
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    await delay(500);
  }

  res
    .status(200)
    .json({ status: 'success', length: results.length, data: results });
});
