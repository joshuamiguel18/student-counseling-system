const pool = require('../db'); // Import your database connection

exports.usersPage = async (req, res) => {
  try {
    // Query to get all users
    const query = 'SELECT * FROM customer_user ORDER BY created_at DESC;';
    const result = await pool.query(query);

    // Pass the users data to the template
    res.render('users', {
      users: result.rows, // Array of users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).send('Internal Server Error');
  }
};


exports.ridersPage = async (req, res) => {
    try {
        // Fetch all riders from the database
        const query = 'SELECT * FROM riders WHERE is_verified = TRUE ORDER BY created_at ASC ;';
        const result = await pool.query(query);

        // Render the riders page and pass the data to the view
        res.render('riders', { riders: result.rows });
    } catch (error) {
        console.error('Error fetching riders:', error);
        res.status(500).send('Internal Server Error');
    }
};


exports.pendingRidersPage = async (req, res) => {
  try {
      // Fetch all riders from the database
      const query = 'SELECT * FROM riders WHERE is_verified = FALSE ORDER BY created_at ASC ;';
      const result = await pool.query(query);

      // Render the riders page and pass the data to the view
      res.render('riders', { riders: result.rows });
  } catch (error) {
      console.error('Error fetching riders:', error);
      res.status(500).send('Internal Server Error');
  }
};