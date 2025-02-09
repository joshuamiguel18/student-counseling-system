const bcrypt = require('bcrypt');
const pool = require('../db'); // PostgreSQL connection pool
const { authenticateRider } = require('../public/js/authentication');


// Register a new rider
exports.registerRider = async (req, res) => {
  const { username, password, email, mobile_number } = req.body;

  // Validate input
  if (!username || !password || !email || !mobile_number) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Check if the username or email already exists
    const existingUser = await pool.query(
      'SELECT * FROM riders WHERE username = $1 OR email = $2 ',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new rider into the database
    const query = `
      INSERT INTO riders (username, password, email, mobile_number)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, mobile_number, is_verified
    `;
    const values = [username, hashedPassword, email, mobile_number];
    const result = await pool.query(query, values);

    // Simulate sending an OTP to the mobile number (placeholder logic)
    console.log(`Sending OTP to ${mobile_number}...`);

    // Respond with the created rider details
    res.status(201).json({
      message: 'Rider registered successfully. OTP sent to mobile number.',
      rider: result.rows[0],
    });
  } catch (error) {
    console.error('Error registering rider:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


exports.loginRider = async (req, res) => {
    const { username, password } = req.body;
  
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
  
    try {
      // Authenticate the rider
      const rider = await authenticateRider(username, password, 'riders'); // Pass the riders table name
  
      if (rider) {
        // If authentication is successful, create a session or token
        req.session.isAuthenticated = true;
        req.session.userId = rider.id;
  
        // Respond with success message
        return res.status(200).json({
          message: 'Login successful!',
          rider: {
            id: rider.id,
            username: rider.username,
            email: rider.email,
            mobile_number: rider.mobile_number,
          },
        });
      } else {
        // Invalid credentials
        return res.status(401).json({ error: 'Invalid username or password' });
      }
    } catch (error) {
      console.error('Error during login:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };