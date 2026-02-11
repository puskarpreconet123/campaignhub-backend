const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {

    // IMAGE
    if (file.mimetype.startsWith("image")) {
      return {
        folder: "campaign_media/images",
        resource_type: "image",
        allowed_formats: ["jpg", "png", "jpeg"]
      };
    }

    // VIDEO
    if (file.mimetype.startsWith("video")) {
      return {
        folder: "campaign_media/videos",
        resource_type: "video",
        allowed_formats: ["mp4", "mov", "avi", "mkv"]
      };
    }

    // PDF / DOC FILE
    return {
      folder: "campaign_media/files",
      resource_type: "raw",
    };
  }
});

const upload = multer({
  storage
});

module.exports = upload;
