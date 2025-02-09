const bcrypt = require('bcrypt'); // For password hashing
require('dotenv').config();
const pool = require('../db'); // Assuming you have a PostgreSQL pool set up
const { authenticateCustomerUser, sendOTP } = require('../public/js/authentication');


exports.registerCustomerUser = async (req, res) => {
  console.log("REGISTER ATTEMPT FOR CUSTOMER")
    try {
        const { username, password, email, mobile_number } = req.body;

        // Check if all required fields are present
        if (!username || !password || !email) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if username or email already exists
        const checkUserQuery = 'SELECT * FROM customer_user WHERE username = $1 OR email = $2';
        const result = await pool.query(checkUserQuery, [username, email]);

        if (result.rows.length > 0) {
            console.log("USER ALREADY EXISTS")
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10); // 10 rounds of salting

        // Insert new user into the database
        const insertQuery = `
            INSERT INTO customer_user (username, password, email, mobile_number)
            VALUES ($1, $2, $3, $4) RETURNING id, username, email, mobile_number
        `;
        const insertResult = await pool.query(insertQuery, [username, hashedPassword, email, mobile_number]);

        const newUser = insertResult.rows[0];

        

        // Optionally, log the user in or just respond with success
        // req.session.userId = newUser.id; // If you're using sessions for authentication
        res.status(201).json({ message: 'User registered successfully', user: newUser });

      } catch (error) {
          console.error('Error registering customer user:', error);
          res.status(500).json({ error: 'Internal Server Error' });
      }
  };


exports.OTPCustomerUser = async (req, res) => {
  try {
    const { username, email, mobile_number } = req.body;
    const checkUserQuery = 'SELECT * FROM customer_user WHERE username = $1 OR email = $2';

    const result = await pool.query(checkUserQuery, [username, email]);

    if (result.rows.length > 0) {
      console.log("USER ALREADY EXISTS");
      return res.status(400).json({ error: 'Username or email already exists' }); // Stop execution with `return`
    }

    // Generate a random OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    sendOTP(otp, mobile_number);

    try {
      const query = `
        INSERT INTO otp_storage (username, otp)
        VALUES ($1, $2)
        RETURNING id, username, otp, created_at;
      `;
      const values = [username, otp];

      const otpResult = await pool.query(query, values);

      return res.status(201).json({
        message: 'OTP SAVED',
      }); // Send response here and stop further execution
    } catch (error) {
      console.error('Error inserting OTP:', error);
      return res.status(500).json({ error: 'An error occurred while inserting OTP.' });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'An error occurred while processing the request.' });
  }
};


exports.verifyOTPUser = async (req, res) => {
  const { username, otp } = req.body;

  if (!username || !otp) {
    return res.status(400).json({ error: 'username and otp are required.' });
  }

  try {
    const query = `
      SELECT * FROM otp_storage
      WHERE username = $1 AND otp = $2;
    `;
    const values = [username, otp];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or OTP.' });
    }

    // If the OTP is valid
    res.status(200).json({
      message: 'OTP verified successfully.',
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'An error occurred while verifying OTP.' });
  }
};



exports.loginCustomerUser = async (req, res) => {
  const { username, password } = req.body;

  // Validate the input fields
  if (!username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Call the authenticateUser function to verify the user
    const user = await authenticateCustomerUser(username, password);

    if (user) {
      // If user is found and password is correct, create a session or JWT token

      console.log("LOGIN SUCCESFUL!");
      // Respond with success message
      return res.status(200).json({
        message: 'Login successful!',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          mobile_number: user.mobile_number,
        }
      });
    } else {
      // If user is not found or password is incorrect
      return res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
