const multer = require("multer");
const multerS3 = require("multer-s3");
const { S3Client } = require("@aws-sdk/client-s3");
const path = require("path");
require("dotenv").config();
const crypto = require('crypto');


 
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
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // DOCX
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Only images (JPEG, PNG) and documents (PDF, DOC, DOCX) are allowed. Received: ${file.mimetype}`), false);
  }
};






const uploadStudentIdImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter,
}).fields([
  { name: 'student_id_image', maxCount: 1 },
]);



module.exports = { uploadStudentIdImage };
