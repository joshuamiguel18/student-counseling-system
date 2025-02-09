const pool = require('../db');
const { authenticateAdminUser } = require('../public/js/authentication');
const bcrypt = require('bcrypt')
// Render login page
exports.getLoginPage = (req, res) => {
    res.render('login');  // Render the login page
};

// Handle login logic (POST)
exports.login = async (req, res) => {
    const { username, password } = req.body;
    console.log(username, password);
    try {
        // Authenticate the user
        const user = await authenticateAdminUser(username, password);

        if (!user) {
            // Redirect to the login page with an error message
            return res.redirect('/login?error=Invalid username or password');
        }

        // Set session data if authentication is successful
        req.session.isAuthenticated = true;
        req.session.userId = user.id;

        // Redirect to the home page after successful login
        res.redirect('/');
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({
            message: 'Internal server error',
        });
    }
};

// Handle logout logic
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({
                message: 'Failed to log out',
            });
        }
        // Redirect to login page after successful logout
        res.redirect('/login');
    });
};


exports.signUp = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT * FROM admin_users WHERE email = $1',
            [email]
        );
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash the password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert user into database
        const result = await pool.query(
            'INSERT INTO admin_users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
            [username, email, hashedPassword]
        );

        res.status(201).redirect('/login');
    } catch (error) {
        console.error('Error registering admin:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getSignUp = (req, res) => {
    res.render('register');
};
