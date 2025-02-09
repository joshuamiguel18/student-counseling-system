require('dotenv').config();
const pool = require('../../db'); // Import your PostgreSQL database connection pool
const bcrypt = require('bcrypt');
const {client} = require('../../controllers/otpController');
// Check if the user is authenticated by checking the session
exports.isLoggedIn = (req, res, next) => {
    if (req.session.isAuthenticated) {
        return next(); // Proceed to the next middleware or route handler
    }
    res.redirect('/login'); // Redirect to login if not authenticated
}


exports.authenticateAdminUser = async (username, password) => {
  try {
    // Query the database for a user with the provided email
    const query = 'SELECT * FROM admin_users WHERE username = $1';
    const result = await pool.query(query, [username]);

    if (result.rows.length > 0) {
      const user = result.rows[0];

      // Compare the provided password with the hashed password
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (passwordMatch) {
        // Return the user object if the password is valid
        return user;
      }
    }

    // Return null if no user found or password is invalid
    return null;
  } catch (error) {
    console.error('Error authenticating user:', error);
  }
}


exports.authenticateCustomerUser = async (username, password) => {
    try {
      // Query the database for a user with the provided username
      const query = 'SELECT * FROM customer_user WHERE username = $1';
      const result = await pool.query(query, [username]);
  
      if (result.rows.length > 0) {
        const user = result.rows[0];
  
        // Compare the provided password with the hashed password stored in the database
        const passwordMatch = await bcrypt.compare(password, user.password);
  
        if (passwordMatch) {
          // Return the user object if the password is valid
          return user;
        }
      }
  
      // Return null if no user found or password is invalid
      return null;
    } catch (error) {
      console.error('Error authenticating user:', error);
      return null;
    }
  };


  exports.authenticateRider = async (username, password) => {
    try {
      const query = `SELECT * FROM riders WHERE username = $1`;
      const result = await pool.query(query, [username]);
  
      if (result.rows.length > 0) {
        const rider = result.rows[0];
  
        // Compare the provided password with the hashed password in the database
        const passwordMatch = await bcrypt.compare(password, rider.password);
  
        if (passwordMatch) {
          return rider;
        }
      }
  
      return null; // Return null if authentication fails
    } catch (error) {
      console.error('Error authenticating rider:', error);
      return null;
    }
  };
  

  exports.sendOTP = async (otp, mobile_number) => {
    try {
      await client.messages.create({
        body: `Your OTP for verification is: ${otp}`,
        from: process.env.TWILIO_PHONE_NUMBER, // Your Twilio phone number
        to: mobile_number,   // User's mobile number
      });
    } catch (err) {
        console.log(err);
    }
}
