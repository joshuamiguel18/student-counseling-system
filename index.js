const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const pool = require('./db')
const app = express();
const multer = require("multer");
const crypto = require("crypto");
const sendVerificationEmail = require("./emailService");
const moment = require('moment');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const flash = require('connect-flash');
const session = require('express-session');
const cors = require('cors');

app.use(express.static(path.join(__dirname + '/public')));
app.use(cookieParser());

app.set('view engine', 'ejs')
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.set('views', path.join(__dirname, '/views'))
app.use("/uploads", express.static("uploads")); // Serve uploaded files
app.use(session({ secret: 'petCounseling', resave: false, saveUninitialized: true }));
app.use(flash());
app.use(cors({
    origin: 'https://counseling-system.vercel.app',
    credentials: true // if you use cookies/sessions
}));

const storage = multer.memoryStorage();
const upload = multer({ storage });

const JWT_SECRET = 'studentCounseling'; // Make sure to use the same secret as in the login route

app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
  });

  
// Middleware to verify the JWT token
const authenticateToken = (req, res, next) => {
    const token = req.cookies.jwt; // Assumes you are using cookies to store the JWT

    if (!token) {
        return res.redirect('/login');
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.redirect('/login');
            //return res.status(403).render('login', { error: 'Invalid or expired token' });
        }

        // Attach user info to the request object
        req.user = decoded;
        next();
    });
};

app.get('/appointments', authenticateToken, async (req, res) => {
    const studentId = req.user.user.id;

    try {
        const result = await pool.query(`
            SELECT 
                a.*, 
                s.first_name AS student_first_name,
                s.middle_name AS student_middle_name,
                s.last_name AS student_last_name,
                c.first_name AS counselor_first_name,
                c.middle_name AS counselor_middle_name,
                c.last_name AS counselor_last_name
            FROM 
                appointment a
            JOIN student s ON a.student_id = s.id
            JOIN counselor c ON a.counselor_id = c.id
            WHERE a.student_id = $1
            ORDER BY a.appointment_date DESC
        `, [studentId]);

        res.render('appointments', { appointments: result.rows });
    } catch (err) {
        console.error('Error fetching appointments:', err);
        res.status(500).send('Server error');
    }
});

// Route: /appointments/:id/chat
app.get('/appointments/:id/chat', authenticateToken, async (req, res) => {
    const appointmentId = req.params.id;
    const currentUser = req.user.user;
    
    try {
        // Get appointment details to validate access
        const appointmentResult = await pool.query(`
            SELECT * FROM appointment WHERE id = $1
        `, [appointmentId]);

        if (appointmentResult.rows.length === 0) {
            return res.status(404).send("Appointment not found");
        }

        const appointment = appointmentResult.rows[0];

        // Fetch messages
        const messagesResult = await pool.query(`
            SELECT * FROM messages WHERE appointment_id = $1 ORDER BY created_at ASC
        `, [appointmentId]);

        res.render('appointment-chat', {
            messages: messagesResult.rows,
            appointment,
            currentUser
        });

    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).send("Server Error");
    }
});

app.post('/messages/send', authenticateToken, async (req, res) => {
    const { appointment_id, message, sender_type } = req.body;

    try {
        await pool.query(
            `INSERT INTO messages (appointment_id, message, sender_type) VALUES ($1, $2, $3)`,
            [appointment_id, message, sender_type]
        );
        res.redirect(`/appointments/${appointment_id}/chat`);
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).send('Server Error');
    }
});


// Route: Get messages for a specific appointment
app.get('/messages/:appointmentId', async (req, res) => {
    const appointmentId = req.params.appointmentId;

    try {
        const messagesResult = await pool.query(`
            SELECT * FROM messages WHERE appointment_id = $1 ORDER BY created_at ASC
        `, [appointmentId]);

        res.json(messagesResult.rows);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).send("Server Error");
    }
});



app.get('/', authenticateToken, (req, res) => {
    res.redirect('/student-app');
});


app.get('/student-app', authenticateToken, async (req, res) => {
    try {
      const studentId = req.user.user.id;
  
      // 1. Get appointments
      const appointmentResult = await pool.query(
        'SELECT * FROM appointment WHERE student_id = $1 ORDER BY appointment_date DESC',
        [studentId]
      );
  
      // 2. Get today's mood if already selected
      const moodResult = await pool.query(`
        SELECT emotion, create_date 
        FROM mood 
        WHERE student_id = $1 
          AND DATE(create_date) = CURRENT_DATE
        ORDER BY create_date DESC 
        LIMIT 1;
      `, [studentId]);
  
      const todayMood = moodResult.rows.length > 0 ? moodResult.rows[0] : null;
  
      // 3. Render view with user, appointments, and mood
      res.render('student-app', {
        user: req.user.user,
        appointments: appointmentResult.rows,
        todayMood: todayMood
      });
    } catch (err) {
      console.error('Error loading student app:', err);
      res.status(500).render('student-app', {
        error: 'Error fetching data',
        user: req.user.user,
        appointments: [],
        todayMood: null
      });
    }
  });
  


app.get('/appointment-form', async (req, res) => {
    try {
        // Query to fetch counselors and concatenate their names
        const result = await pool.query(`
            SELECT id, 
                   CONCAT(first_name, ' ', COALESCE(middle_name, ''), ' ', last_name) AS full_name
            FROM counselor
        `);
        
        // Pass the counselors data to the EJS template
        res.render('appointment-form', { counselors: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

// Routes


//FOR CUSTOMERS
app.get('/login', (req, res) => {
    res.render('login', { error: null, username: '' }); // Ensure username is always defined
});
app.get('/register', (req, res) => {
    res.render('register', { error: null, username: '', email: '' }); 
});

app.get('/forums', authenticateToken, async (req, res) => {
    try {
      const forumsResult = await pool.query(`
        SELECT f.*, 
               COUNT(fc.id) AS comment_count,
               s.first_name AS student_first_name,
               s.last_name AS student_last_name
        FROM forum f
        LEFT JOIN forum_comment fc ON f.id = fc.forum_id
        LEFT JOIN student s ON f.student_id = s.id
        GROUP BY f.id, s.first_name, s.last_name
        ORDER BY f.create_date DESC
      `);
  
      const forums = forumsResult.rows;
      console.log(forums);
      res.render('forums', { forums, user: req.user.user });
    } catch (err) {
      console.error('Error fetching forums:', err);
      res.status(500).render('forums', { error: 'Failed to load forums', forums: [], user: req.user.user });
    }
  });
  
  // CREATE A FORUM
  app.post('/forums/create', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    const studentId = req.user.user.id;
  
    try {
      await pool.query(
        'INSERT INTO forum (student_id, title, content) VALUES ($1, $2, $3)',
        [studentId, title, content]
      );
      res.redirect('/forums?status=success');
    } catch (err) {
      console.error('Error creating forum:', err);
      res.redirect('/forums?status=error');
    }
  });
  

  // GET THE COMMENTS AND CONTENTS OF THE COMMENTS
  app.get('/forums/:id', authenticateToken, async (req, res) => {
    try {
      // Query the specific forum based on the provided ID
      const forumResult = await pool.query(
        `SELECT f.*, 
                s.first_name AS student_first_name,
                s.last_name AS student_last_name
         FROM forum f
         JOIN student s ON f.student_id = s.id
         WHERE f.id = $1`,
        [req.params.id]
      );
      const forum = forumResult.rows[0];
  
      // Query comments associated with the forum
      const commentsResult = await pool.query(
        `SELECT fc.*, 
                s.first_name AS student_first_name, 
                s.last_name AS student_last_name
         FROM forum_comment fc
         JOIN student s ON fc.student_id = s.id
         WHERE fc.forum_id = $1
         ORDER BY fc.create_date ASC`,
        [req.params.id]
      );
      const comments = commentsResult.rows;
  
      res.render('forum-details', { forum, comments, user: req.user.user });
    } catch (err) {
      console.error('Error fetching forum:', err);
      res.status(500).render('forum-detail', { error: 'Failed to load forum details', forum: {}, comments: [], user: req.user.user });
    }
  });
  
  // CREATE A COMMENT
  app.post('/forums/:id/comment', authenticateToken, async (req, res) => {
    const { comment } = req.body;
    const forumId = req.params.id;
    const studentId = req.user.user.id;
  
    try {
      await pool.query(
        'INSERT INTO forum_comment (forum_id, student_id, comment) VALUES ($1, $2, $3)',
        [forumId, studentId, comment]
      );
  
      // Redirect to the forum detail page to show the new comment
      res.redirect(`/forums/${forumId}`);
    } catch (err) {
      console.error('Error adding comment:', err);
      res.status(500).send('Failed to add comment');
    }
  });
  
  // USED FOR COMMENT AJAX REFRESH
  app.get('/forums/:id/comments', async (req, res) => {
    try {
      const forumId = req.params.id;
      const result = await pool.query(
        `SELECT fc.*, 
                s.first_name AS student_first_name, 
                s.last_name AS student_last_name
         FROM forum_comment fc
         JOIN student s ON fc.student_id = s.id
         WHERE fc.forum_id = $1
         ORDER BY fc.create_date ASC`,
        [forumId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error('Error fetching comments:', err);
      res.status(500).json({ error: 'Failed to fetch comments' });
    }
  });
  


app.get('/admin-app', (req, res) => {
    res.render('adminPages/admin-app'); 
});
//FOR ADMINS
app.get('/admin/register', (req, res) => {
    res.render('adminRegister', { error: null, username: '', email: '' }); 
});
app.get('/admin/login', (req, res) => {
    res.render('login-admin', { error: null, username: '', email: '' }); 
});
app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            return res.render('login-admin', {
                error: 'Admin not found.',
                username,
                email: ''
            });
        }

        const admin = result.rows[0];

        // If you're using hashed passwords
        const isMatch = await bcrypt.compare(password, admin.password);

        if (!isMatch) {
            return res.render('login-admin', {
                error: 'Invalid password.',
                username,
                email: admin.email
            });
        }

        // Create JWT or set session (up to your auth logic)
        const token = jwt.sign({ user: { id: admin.id, role: 'admin' } }, 'your-secret-key', {
            expiresIn: '1h'
        });

        // Set token as cookie or store in session
        res.cookie('token', token, { httpOnly: true });

        // Redirect to admin dashboard
        res.redirect('/admin-app');

    } catch (err) {
        console.error(err);
        res.render('login-admin', {
            error: 'Something went wrong.',
            username,
            email: ''
        });
    }
});

/// display all the 
app.get('/admin/appointments', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                appointment.id, 
                appointment.title, 
                appointment.status, 
                appointment.appointment_date,
                student.first_name AS student_first_name,
                student.last_name AS student_last_name,
                counselor.first_name AS counselor_first_name,
                counselor.last_name AS counselor_last_name
            FROM appointment
            JOIN student ON appointment.student_id = student.id
            JOIN counselor ON appointment.counselor_id = counselor.id
            WHERE appointment.status = 'pending'
            ORDER BY appointment.appointment_date DESC
        `);

        const appointments = result.rows;

        res.render('adminPages/appointments-admin', { appointments });
    } catch (err) {
        console.error('Error fetching pending appointments:', err);
        res.status(500).send('Server Error');
    }
});



app.get("/admin/students", async (req, res) => {
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


// Student login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM student WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            return res.render('login', { error: 'Invalid username or password', username });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.render('login', { error: 'Invalid username or password', username });
        }

        // Create a JWT token with user data (avoid putting sensitive data like password in the token)
        const token = jwt.sign(
            { user }, // payload (store minimal info)
            JWT_SECRET, // secret key
            { expiresIn: '1h' } // token expiration time
        );

        // Optionally, set the token as a cookie (for client-side session)
        res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

        // Redirect or render user-specific view (you could pass user info to the next page if needed)
        res.redirect('/student-app');
    } catch (err) {
        console.error('Error logging in user:', err);
        res.status(500).render('login', { error: 'Internal server error', username });
    }
});




app.get('/appointments/cancel/:id', async (req, res) => {
    const appointmentId = req.params.id;
  
    try {
      // Update the appointment's status to 'Cancelled'
      const result = await pool.query(
        'UPDATE appointment SET status = $1 WHERE id = $2 RETURNING *',
        ['cancelled', appointmentId]
      );
  
      // Check if appointment was found and updated
      if (result.rows.length > 0) {
        // Redirect to the appointments page with a success message
        req.flash('success', 'Appointment has been successfully cancelled.');
        res.redirect('/appointments');
      } else {
        // If no appointment found
        req.flash('error', 'Appointment not found.');
        res.redirect('/appointments');
      }
    } catch (err) {
      console.error(err);
      req.flash('error', 'Something went wrong while cancelling the appointment.');
      res.redirect('/appointments');
    }
  });



app.get('/mood/:emotion/:studentId', async (req, res) => {
    const { emotion, studentId } = req.params;

    try {
        const result = await pool.query(
        'INSERT INTO mood (emotion, student_id) VALUES ($1, $2) RETURNING *;',
        [emotion, studentId]
        );
        
        // Redirect with a query parameter indicating successful submission
        res.redirect('/student-app?submittedMood=true');
    } catch (error) {
        console.error('Error saving mood:', error);
        res.status(500).send('Something went wrong');
    }
});




app.post("/register", upload.single("verification"), async (req, res) => {
    const { first_name, middle_name, last_name, username, email, password } = req.body;

    if (!first_name || !last_name || !username || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO student (first_name, middle_name, last_name, username, email, password, is_class_mayor, create_date, update_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id`,
            [first_name, middle_name, last_name, username, email, hashedPassword, false]
        );

        res.json({ message: "Registration successful!", student_id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});


  

app.get("/verify", async (req, res) => {
const { token } = req.query;

try {
    const result = await pool.query("UPDATE customerusers SET is_verified = TRUE WHERE verification_token = $1 RETURNING *", [token]);

    if (result.rowCount === 0) {
    return res.status(400).json({ error: "Invalid or expired token" });
    }


    res.render('verified')
    //res.json({ message: "Email verified successfully!" });
} catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
}
});
  


app.get('/counselors/:id/availability', async (req, res) => {
    const counselorId = req.params.id;

    try {
        // Query to get the available days for the counselor
        const result = await pool.query(
            'SELECT available_day FROM counselor_availability WHERE counselor_id = $1',
            [counselorId]
        );

        // Check if the counselor has availability
        if (result.rows.length > 0) {
            const availableDays = result.rows.map(row => row.available_day);
            return res.json({ available_days: availableDays });
        } else {
            return res.status(404).json({ message: 'Counselor not found or no availability' });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});






app.post('/saveAppointment', async (req, res) => {
    const { title, student_id, counselor_id, appointment_date, isOnlineAppointment } = req.body;

    // Default status
    const status = req.body.status || 'pending';

    // Format date
    const formattedAppointmentDate = moment(appointment_date).format('YYYY-MM-DD HH:mm:ss');
    const todayFormatted = moment().format('YYYYMMDD');

    // Generate 6-digit random number
    const randomDigits = Math.floor(100000 + Math.random() * 900000); // 6-digit random number

    // Generate appointment number
    const appointmentNumber = `${randomDigits}${todayFormatted}${student_id}${counselor_id}`;

    try {
        // Insert appointment into DB
        const result = await pool.query(
            `INSERT INTO appointment 
              (title, student_id, counselor_id, status, appointment_date, is_online_appointment, appointment_number, create_date, update_date)
             VALUES 
              ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id`,
            [title, student_id, counselor_id, status, formattedAppointmentDate, isOnlineAppointment, appointmentNumber]
        );

        const appointmentId = result.rows[0].id;

        // Log and redirect
        console.log("Appointment created successfully");
        res.redirect('/student-app');
    } catch (error) {
        console.error('Error saving appointment:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



app.get('/logout', (req, res) => {
    // Clear the JWT cookie by setting it to an empty value and making it expired
    res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

    // Redirect to the login page or home page after logging out
    res.redirect('/login');
});


// Start server
const PORT = process.env.PORT || 8181;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
