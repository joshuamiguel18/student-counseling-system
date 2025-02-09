const multer = require("multer");
const path = require("path");

// Set storage engine for multer (files saved in `uploads/`)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // Ensure this folder exists
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

// File filter to allow images AND documents
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|gif/;
  const allowedDocTypes = /pdf|doc|docx/;

  const extname = path.extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype;

  if (allowedImageTypes.test(extname) || allowedImageTypes.test(mimetype)) {
    return cb(null, true); // Allow image
  } else if (allowedDocTypes.test(extname) || allowedDocTypes.test(mimetype)) {
    return cb(null, true); // Allow document
  } else {
    return cb(new Error("Only images (JPG, PNG, GIF) and documents (PDF, DOCX) are allowed!"), false);
  }
};

// Initialize multer with storage and file filter
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file limit
  fileFilter,
});

module.exports = upload;
