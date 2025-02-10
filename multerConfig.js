const multer = require("multer");
const multerS3 = require("multer-s3");
const { S3Client } = require("@aws-sdk/client-s3");
const path = require("path");
require("dotenv").config();

// Initialize AWS S3 Client (AWS SDK v3)
const s3 = new S3Client({
    
  credentials: {
      accessKeyId: process.env.ACCESS_KEY_VARIABLE,
      secretAccessKey: process.env.ACCESS_SECRET_KEY_VARIABLE,
  },
  region: process.env.BUCKET_REGION
})

// Configure Multer-S3 for uploading files to AWS S3
const storage = multerS3({
  s3: s3,
  bucket: process.env.BUCKET_NAME,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: function (req, file, cb) {
    cb(null, { fieldName: file.fieldname });
  },
  key: function (req, file, cb) {
    const uniqueFilename = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueFilename);
  },
});

// Allowed file types
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    return cb(new Error("Only images and documents (PDF, DOCX) are allowed!"), false);
  }
};

// Configure Multer middleware for S3
const uploadFilesPetRegistration = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter,
}).fields([
  { name: "profile_image", maxCount: 1 },
  { name: "vaccination_doc", maxCount: 1 },
  { name: "health_certificate_doc", maxCount: 1 },
  { name: "ownership_certificate_doc", maxCount: 1 }
]);

module.exports = { uploadFilesPetRegistration };
