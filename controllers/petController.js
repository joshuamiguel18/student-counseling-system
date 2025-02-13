
const pool = require('../db'); // PostgreSQL connection pool
const { S3Client, PutObjectCommand ,GetObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require('crypto');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const randomFile = (bytes = 32 ) => crypto.randomBytes(bytes).toString('hex');


const extractFileName = (file) => file ? file[0].key : null;  

exports.registerPet = async (req, res) => {
  try {
    const { name, type, breed, age, gender, owner_name, owner_contact, owner_address } = req.body;

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const customer_id = 1;

    // Extract only file names
    const profile_image = extractFileName(req.files["profile_image"]);
    const vaccination_doc = extractFileName(req.files["vaccination_doc"]);
    const health_certificate_doc = extractFileName(req.files["health_certificate_doc"]);
    const ownership_certificate_doc = extractFileName(req.files["ownership_certificate_doc"]);

    console.log("PROFILE IMAGE NAME: ", profile_image);

    // Insert pet details into the database
    const query = `
      INSERT INTO pets 
      (name, type, breed, age, gender, owner_name, owner_contact, owner_address, 
      profile_image, vaccination_doc, health_certificate_doc, ownership_certificate_doc, customer_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *;
    `;
    
    const values = [
      name, type, breed, age, gender, owner_name, owner_contact, owner_address,
      profile_image, vaccination_doc, health_certificate_doc, ownership_certificate_doc, customer_id
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ message: "Pet registered successfully!", pet: result.rows[0] });

  } catch (err) {
    console.error("Error registering pet:", err);
    res.status(500).json({ error: "Database error" });
  }
};








const BUCKET_NAME = process.env.BUCKET_NAME;


const getSignedS3Url = async (fileName) => {
  if (!fileName) return null;

  // Create a new S3 client instance for each request
  const s3 = new S3Client({
    
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_VARIABLE,
        secretAccessKey: process.env.ACCESS_SECRET_KEY_VARIABLE,
    },
    region: process.env.BUCKET_REGION
  })

  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: fileName,
  });

  return await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
};

exports.getPetDetails = async (req, res) => {
  try {
    const { petId } = req.params;

    // Fetch pet details from database
    const query = "SELECT * FROM pets WHERE id = $1";
    const result = await pool.query(query, [petId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pet not found" });
    }

    const pet = result.rows[0];

    // Generate signed URLs for S3 files
    const profileImageUrl = await getSignedS3Url(pet.profile_image);
    const vaccinationDocUrl = await getSignedS3Url(pet.vaccination_doc);
    const healthCertDocUrl = await getSignedS3Url(pet.health_certificate_doc);
    const ownershipCertDocUrl = await getSignedS3Url(pet.ownership_certificate_doc);

    // Respond with pet details and signed URLs
    res.json({
      ...pet,
      profile_image: profileImageUrl,
      vaccination_doc: vaccinationDocUrl,
      health_certificate_doc: healthCertDocUrl,
      ownership_certificate_doc: ownershipCertDocUrl,
    });

  } catch (error) {
    console.error("Error retrieving pet details:", error);
    res.status(500).json({ error: "Database or AWS S3 error" });
  }
};







  // 📌 2️⃣ Get Pet Details by ID
// exports.getPetDetails = async (req, res) => {
//     try {
//         const petId = req.params.id;
//         const query = `SELECT * FROM pets WHERE id = $1;`;
//         const result = await pool.query(query, [petId]);
    
//         if (result.rows.length === 0) {
//           return res.status(404).json({ error: 'Pet not found' });
//         }
    
//         res.json(result.rows[0]);
//       } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: 'Database error' });
//       }
//   };




exports.getCustomerPets = async (req, res) => {
  try {
    const { id } = req.params;

    const petsQuery = `SELECT id, profile_image, name, type, breed FROM pets WHERE customer_id = $1;`;
    const petsResult = await pool.query(petsQuery, [id]);

    if (petsResult.rows.length === 0) {
      return res.status(404).json({ error: 'No pets found for this customer' });
    }

    // Generate signed URLs for profile images
    const petsWithSignedUrls = await Promise.all(
      petsResult.rows.map(async (pet) => ({
        id: pet.id,
        name: pet.name,
        type: pet.type,
        breed: pet.breed,
        profile_image: pet.profile_image ? await getSignedS3Url(pet.profile_image) : null,
      }))
    );

    res.json(petsWithSignedUrls);
  } catch (err) {
    console.error("Error fetching customer pets:", err);
    res.status(500).json({ error: "Database error" });
  }
};

