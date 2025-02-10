
const pool = require('../db'); // PostgreSQL connection pool
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require('crypto');

const randomFile = (bytes = 32 ) => crypto.randomBytes(bytes).toString('hex');

const s3 = new S3Client({
    
  credentials: {
      accessKeyId: process.env.ACCESS_KEY_VARIABLE,
      secretAccessKey: process.env.ACCESS_SECRET_KEY_VARIABLE,
  },
  region: process.env.BUCKET_REGION
})


exports.registerPet = async (req, res) => {
  try {
    const { name, type, breed, age, gender, owner_name, owner_contact, owner_address, customer_id } = req.body;

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Extract S3 file URLs
    const profile_image = req.files["profile_image"] ? req.files["profile_image"][0].location : null;
    const vaccination_doc = req.files["vaccination_doc"] ? req.files["vaccination_doc"][0].location : null;
    const health_certificate_doc = req.files["health_certificate_doc"] ? req.files["health_certificate_doc"][0].location : null;
    const ownership_certificate_doc = req.files["ownership_certificate_doc"] ? req.files["ownership_certificate_doc"][0].location : null;

    console.log("PROFILE IMAGE URL: ", profile_image);

    // Insert pet details into database
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






  // 📌 2️⃣ Get Pet Details by ID
exports.getPetDetails = async (req, res) => {
    try {
        const petId = req.params.id;
        const query = `SELECT * FROM pets WHERE id = $1;`;
        const result = await pool.query(query, [petId]);
    
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Pet not found' });
        }
    
        res.json(result.rows[0]);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
      }
  };




  exports.getCustomerPets = async (req, res) => {
    try {
    const { id } = req.params;
    console.log(id)
      // Fetch pets directly using customer_id
      const petsQuery = `SELECT * FROM pets WHERE customer_id = $1;`;
      const petsResult = await pool.query(petsQuery, [id]);
  
      if (petsResult.rows.length === 0) {
        return res.status(404).json({ error: 'No pets found for this customer' });
      }
  
      res.json(petsResult.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Database error' });
    }
  };