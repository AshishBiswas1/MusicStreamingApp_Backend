const supabase = require('../util/supabaseClient');
const AppError = require('../util/appError');
const catchAsync = require('../util/catchAsync');

exports.getUsersPlaylist = catchAsync(async (req, res, next) => {
  const { data, error } = await supabase
    .from('playlist')
    .select('id, playlist_name, created_at')
    .eq('user_id', req.user.id);

  if (error) {
    return next(new AppError(error.message || 'No playlist found', 400));
  }

  res.status(200).json({
    status: 'success',
    length: data.length,
    data
  });
});

exports.createPlaylist = catchAsync(async (req, res, next) => {
  const { playlistName } = req.body;

  if (!playlistName || String(playlistName).trim() === '') {
    return next(new AppError('playlistName is required', 400));
  }

  const { data, error } = await supabase
    .from('playlist')
    .insert({ user_id: req.user.id, playlist_name: playlistName })
    .select()
    .maybeSingle();

  if (error) {
    return next(new AppError(error.message || 'Could not create the playlist'));
  }

  res.status(200).json({
    status: 'success',
    data
  });
});

exports.getPlaylist = catchAsync(async (req, res, next) => {
  const id = req.params.id;

  const { data, error } = await supabase
    .from('playlist')
    .select('*')
    .eq('id', id);

  if (error) {
    return next(new AppError('Could not find the playlist', 400));
  }

  res.status(200).json({
    status: 'success',
    data
  });
});

exports.deletePlaylist = catchAsync(async (req, res, next) => {
  const id = req.params.id;
  // Delete the playlist row by id and return the deleted row
  const { error } = await supabase.from('playlist').delete().eq('id', id);

  if (error) {
    return next(
      new AppError(error.message || 'Failed to delete playlist', 500)
    );
  }

  res.status(204).json({ status: 'success' });
});
