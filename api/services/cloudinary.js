/**
 * VTOS — Cloudinary image upload service
 *
 * Required env vars (set in Vercel project settings):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Free account: https://cloudinary.com/users/register_free
 * Free tier: 25 GB storage · 25 GB bandwidth / month
 */

const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

/**
 * Upload an image buffer to Cloudinary.
 * @param {Buffer} buffer   - Raw image data from multer memoryStorage
 * @param {object} options  - Optional Cloudinary upload options override
 * @returns {Promise<object>} Cloudinary upload result (secure_url, public_id, …)
 */
function uploadImage(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:           'vtos/portfolio',
        allowed_formats:  ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        transformation: [
          {
            width:        1280,
            height:       853,
            crop:         'fill',
            gravity:      'auto',
            quality:      'auto:good',
            fetch_format: 'auto',
          },
        ],
        ...options,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Delete an image from Cloudinary by its public_id.
 * @param {string} publicId
 */
function deleteImage(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

module.exports = { uploadImage, deleteImage };
