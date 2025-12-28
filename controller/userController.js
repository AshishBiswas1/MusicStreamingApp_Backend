const supabase = require('../util/supabaseClient');
const AppError = require('../util/appError');
const catchAsync = require('../util/catchAsync');
const multer = require('multer');
const { z } = require('zod');

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() }).single(
  'profile_image'
);

// Validation schema for updateMe
const updateMeSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional()
});

/**
 * Get current user details from custom users table
 */
exports.getMe = catchAsync(async (req, res, next) => {
  // req.user is set by protect middleware
  const userId = req.user.id;

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    return next(
      new AppError('Could not fetch user data. Please try again.', 500)
    );
  }

  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
});

/**
 * Update current user (name and profile_image)
 */
exports.updateMe = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  // Parse and validate name if provided
  const updateData = {};

  if (req.body.name) {
    const parsed = updateMeSchema.safeParse({ name: req.body.name });
    if (!parsed.success) {
      const message = parsed.error.issues.map((e) => e.message).join(', ');
      return next(new AppError(message, 400));
    }
    updateData.name = parsed.data.name;
  }

  // Handle profile image upload if file is provided
  if (req.file) {
    const imageFile = req.file;
    const imageBucket = process.env.SUPABASE_IMAGE_BUCKET || 'images';
    const timestamp = Date.now();
    const imagePath = `profiles/${timestamp}_${imageFile.originalname}`;

    // Upload image to Supabase storage
    const { error: uploadError } = await supabase.storage
      .from(imageBucket)
      .upload(imagePath, imageFile.buffer, {
        contentType: imageFile.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error('Image upload error:', uploadError);
      return next(
        new AppError(
          `Failed to upload profile image: ${uploadError.message}`,
          500
        )
      );
    }

    // Get public URL for the image
    const { data: urlData } = supabase.storage
      .from(imageBucket)
      .getPublicUrl(imagePath);

    if (urlData && urlData.publicUrl) {
      updateData.profile_image = urlData.publicUrl;
    }
  }

  // Check if there's anything to update
  if (Object.keys(updateData).length === 0) {
    return next(
      new AppError('Please provide name or profile_image to update.', 400)
    );
  }

  // Update user in custom users table
  const { data: updatedUser, error } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('Update user error:', error);
    return next(
      new AppError(
        `Failed to update user: ${error.message || 'Unknown error'}`,
        500
      )
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser
    }
  });
});

/**
 * Soft delete current user (set is_active to false)
 */
exports.deleteMe = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  // Update is_active to false (soft delete)
  const { data, error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('Delete user error:', error);
    return next(
      new AppError(
        `Failed to deactivate user: ${error.message || 'Unknown error'}`,
        500
      )
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'User account deactivated successfully',
    data: null
  });
});

// Export multer upload middleware
exports.uploadProfileImage = upload;
