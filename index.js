const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const pool = require('./db')
const app = express();
const multer = require("multer");



app.use(express.static(path.join(__dirname + '/public')));

app.set('view engine', 'ejs')
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.set('views', path.join(__dirname, '/views'))
app.use("/uploads", express.static("uploads")); // Serve uploaded files
// Serve static files (CSS, JS)


const port = 8181;


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });
const upload = multer({ storage: storage });




app.get('/', (req, res) => {
    res.redirect('/login');
});

// Routes
app.get('/dashboard', (req, res) => {
    res.render('index');
});


//FOR CUSTOMERS
app.get('/login', (req, res) => {
    res.render('customerLogin', { error: null, username: '' }); // Ensure username is always defined
});
app.get('/register', (req, res) => {
    res.render('customerRegister', { error: null, username: '', email: '' }); 
});



//FOR ADMINS
app.get('/admin/register', (req, res) => {
    res.render('adminRegister', { error: null, username: '', email: '' }); 
});
app.get('/admin/login', (req, res) => {
    res.render('adminLogin', { error: null, username: '', email: '' }); 
});


app.get("/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customerUsers");
    res.render("user", { users: result.rows }); // Render EJS template
  } catch (err) {
    console.error("Error fetching customer users:", err);
    res.status(500).send("Server error");
  }
});



// User registration
app.post('/admin/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // Check if user already exists
        const userExists = await pool.query('SELECT * FROM adminusers WHERE username = $1 OR email = $2', [username, email]);
        
        if (userExists.rows.length > 0) {
            return res.render('adminRegister', { error: 'Username or email already exists', username, email });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3)', [username, email, hashedPassword]);

        res.redirect('/admin/login'); // Redirect to login page after successful registration
    } catch (err) {
        console.error('Error registering user:', err);
        res.status(500).render('adminRegister', { error: 'Internal server error', username, email });
    }
});


// User login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(username)
    console.log(password)
    try {
        const result = await pool.query('SELECT * FROM customerusers WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            return res.render('customerLogin', { error: 'Invalid username or password', username });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.render('customerLogin', { error: 'Invalid username or password', username });
        }

        res.render('index'); // Redirect to dashboard
    } catch (err) {
        console.error('Error logging in user:', err);
        res.status(500).render('customerLogin', { error: 'Internal server error', username });
    }
});

app.post("/register", upload.single("verification"), async (req, res) => {
    const { first_name, middle_name, last_name, organization_type, username, email, password } = req.body;
    const verification_document = req.file ? req.file.filename : null;
  
    if (!first_name || !last_name || !organization_type || !username || !email || !password || !verification_document) {
      return res.status(400).json({ error: "All fields are required" });
    }
  
    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Insert into database
      const result = await pool.query(
        "INSERT INTO customerusers (first_name, middle_name, last_name, organization_name, verification_document, username, email, password) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [first_name, middle_name, last_name, organization_type, verification_document, username, email, hashedPassword]
      );
  
    //   res.status(201).json({ message: "User registered successfully", userId: result.rows[0].id });
      res.redirect('login')
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });


// Start server
const PORT = process.env.PORT || 8181;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
