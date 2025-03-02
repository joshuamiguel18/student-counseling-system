const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const pool = require('./db')
const app = express();

app.use(express.static(path.join(__dirname + '/public')));

app.set('view engine', 'ejs')
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.set('views', path.join(__dirname, '/views'))

// Serve static files (CSS, JS)


const port = 5000;

app.get('/', (req, res) => {
    res.redirect('/login');
});

// Routes
app.get('/dashboard', (req, res) => {
    res.render('index');
});

app.get('/login', (req, res) => {
    res.render('login', { error: null, username: '' }); // Ensure username is always defined
});

app.get('/register', (req, res) => {
    res.render('register', { error: null, username: '', email: '' }); 
});


// User registration
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // Check if user already exists
        const userExists = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $2', [username, email]);
        
        if (userExists.rows.length > 0) {
            return res.render('register', { error: 'Username or email already exists', username, email });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3)', [username, email, hashedPassword]);

        res.redirect('/login'); // Redirect to login page after successful registration
    } catch (err) {
        console.error('Error registering user:', err);
        res.status(500).render('register', { error: 'Internal server error', username, email });
    }
});


// User login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(username)
    console.log(password)
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            return res.render('login', { error: 'Invalid username or password', username });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.render('login', { error: 'Invalid username or password', username });
        }

        res.render('index'); // Redirect to dashboard
    } catch (err) {
        console.error('Error logging in user:', err);
        res.status(500).render('login', { error: 'Internal server error', username });
    }
});




// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
