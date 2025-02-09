
const pool = require('../db'); // PostgreSQL connection pool

exports.registerPet = async (req, res) => {
    try {
        const { name, type, breed, age, gender, customer_id } = req.body;
        const query = `
          INSERT INTO pets (name, type, breed, age, gender, customer_id) 
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
        `;
        const values = [name, type, breed, age, gender, customer_id];
    
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
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