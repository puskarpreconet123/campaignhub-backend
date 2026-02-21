const multer = require("multer");
const multerS3 = require("multer-s3");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const s3 = require("../config/wasabi")

//cloudinary Storage
const cloudinaryStorage = new CloudinaryStorage({
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

    // PDF
    if (file.mimetype === "application/pdf") {
      return {
        folder: "campaign_media/pdfs",
        resource_type: "raw",
        format: "pdf"
      };
    }

    // fallback (any other file)
    return {
      folder: "campaign_media/files",
      resource_type: "raw"
    };
  }
});

//Wasabi Storage
const wasabiStorage = multerS3 ({
  s3: s3,
  bucket: process.env.WASABI_BUCKET,
  acl: "public-read",
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (req, file, cb) => {
    let folder
    if (file.mimetype.startsWith("image/")){
      folder = "images"
    } else if (file.mimetype.startsWith("video/")){
      folder = "videos"
    } else if (file.mimetype === "application/pdf"){
      folder = "pdfs"
    } else {
      return cb(new Error ("Unsupported file type"));
    }
    cb(null, `campaign_media/${folder}/${Date.now()}-${file.originalname}`);
  }
})

const uploadCloudinary = multer({ storage: cloudinaryStorage }).fields([
  { name: "images", maxCount: 10 },
  { name: "pdfVideo", maxCount: 5 }
]);

const uploadWasabi = multer({ storage: wasabiStorage }).fields([
  { name: "images", maxCount: 10 },
  { name: "pdfVideo", maxCount: 5 }
]);

// The Dispatcher
const providers = {
  cloudinary: uploadCloudinary,
  wasabi: uploadWasabi
};

const dynamicUpload = (req, res, next) => {
  const provider =(req.headers["x-storage-provider"] || "cloudinary").toLowerCase();

  const selectedUploader = providers[provider];

  if (!selectedUploader) {
    return res.status(400).json({
      success: false,
      message: "Invalid storage provider"
    });
  }

   // Save provider for later use (controller, DB, etc.)
  req.storageProvider = provider;
  return selectedUploader(req, res, next);
};


module.exports = dynamicUpload;