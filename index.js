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

const { S3Client, PutObjectCommand ,GetObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { uploadStudentIdImage } = require('./multerConfig');



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


  const getSignedS3Url = async (fileName) => {
    if (!fileName) return null;
  
    // Create a new S3 client instance for each request
    const s3 = new S3Client({
      
      credentials: {
          accessKeyId: process.env.ACCESS_KEY_VARIABLE,
          secretAccessKey: process.env.ACCESS_SECRET_KEY_VARIABLE,
      },
      region: process.env.BUCKET_REGION
    })
  
    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileName,
    });
  
    return await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour expiration
  };
  



  
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

const authenticateTokenAdmin = (req, res, next) => {
    const token = req.cookies.jwt; // Assumes you are using cookies to store the JWT

    if (!token) {
        return res.redirect('/admin/login');
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.redirect('/admin/login');
            //return res.status(403).render('login', { error: 'Invalid or expired token' });
        }

        // Attach user info to the request object
        req.user = decoded;
        next();
    });
};

const authenticateTokenCounselor = (req, res, next) => {
  const token = req.cookies.jwt; // Assumes you are using cookies to store the JWT

  if (!token) {
      return res.redirect('/counselor/login');
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
          return res.redirect('/counselor/login');
          //return res.status(403).render('login', { error: 'Invalid or expired token' });
      }

      // Attach user info to the request object
      req.user = decoded;
      next();
  });
};

// My appointments
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
            ORDER BY a.appointment_date ASC
        `, [studentId]);
        res.render('appointments', { appointments: result.rows, user: req.user.user });
    } catch (err) {
        console.error('Error fetching appointments:', err);
        res.status(500).send('Server error');
    }
});


app.get('/getAppointments', authenticateToken, async (req, res) => {
  const studentId = req.user.user.id;
  const { status, sort } = req.query; // Get filter and sort parameters from query

  try {
      let query = `
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
      `;

      const queryParams = [studentId];

      // Add filter for status if provided
      if (status && status !== 'all') {
          query += ` AND a.status = $${queryParams.length + 1}`;
          queryParams.push(status); // Add the status filter parameter
      }

      // Add sorting by date (ascending or descending)
      const sortOrder = sort === 'desc' ? 'DESC' : 'ASC';
      query += ` ORDER BY a.appointment_date ${sortOrder}`;

      // Execute the query with the parameters
      const result = await pool.query(query, queryParams);

      // Return JSON data instead of rendering the page (useful for dynamic updates)
      res.json({ appointments: result.rows });
      console.log(result.rows);
  } catch (err) {
      console.error('Error fetching appointments:', err);
      res.status(500).send('Server error');
  }
});

app.post('/appointments/delete/:id', async (req, res) => {
  const appointmentId = req.params.id;

  try {
    // Fetch the appointment by ID
    const result = await pool.query(
      'SELECT status FROM appointment WHERE id = $1',
      [appointmentId]
    );

    const appointment = result.rows[0];

    if (appointment && (appointment.status === 'cancelled' || appointment.status === 'rejected')) {
      await pool.query('DELETE FROM appointment WHERE id = $1', [appointmentId]);
      req.flash('success', 'Appointment deleted successfully.');
    } else {
      req.flash('error', 'Only cancelled or rejected appointments can be deleted.');
    }
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error deleting appointment.');
  }

  res.redirect('/appointments');
});


app.get('/api/resources', async (req, res) => {
  const { search } = req.query;

  try {
    let query = `
      SELECT 
        resources.*, 
        categories.name AS category_name
      FROM 
        resources
      LEFT JOIN 
        categories ON resources.category_id = categories.id
    `;

    const values = [];

    if (search) {
      query += ` WHERE LOWER(resources.title) LIKE $1 OR LOWER(resources.description) LIKE $1 `;
      values.push(`%${search.toLowerCase()}%`);
    }

    query += ' ORDER BY resources.id DESC';

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching resources:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});




// Route: /appointments/:id/chat
app.get('/appointments/:id/chat', authenticateToken, async (req, res) => {
    const appointmentId = req.params.id;
    const currentUser = req.user.user;
    
    try {
        // Get appointment details to validate access
        const appointmentResult = await pool.query(`
            SELECT 
              a.*, 
              (c.first_name || ' ' || c.middle_name || ' ' || c.last_name) AS counselor_name
            FROM appointment a
            JOIN counselor c ON a.counselor_id = c.id
            WHERE a.id = $1
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
            appointment: appointmentResult.rows[0],
            currentUser,
            user: req.user.user
        });
          

    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).send("Server Error");
    }
});

// ADMIN APPROVE POWER
app.get('/appointments/approve/:id', async (req, res) => {
    const appointmentId = req.params.id;
  
    try {
      // Update the appointment status to 'approved'
      await pool.query(
        'UPDATE appointment SET status = $1, update_date = NOW() WHERE id = $2',
        ['approved', appointmentId]
      );
  
      // Redirect back to the appointments page
      res.redirect('/admin/appointments'); // Change to match your route for listing appointments
    } catch (err) {
      console.error('Error approving appointment:', err);
      res.status(500).send('Internal Server Error');
    }
});
  

app.get('/counselor/appointments/approve/:id', async (req, res) => {
  const appointmentId = req.params.id;

  try {
    // Update the appointment status to 'approved'
    await pool.query(
      'UPDATE appointment SET status = $1, update_date = NOW() WHERE id = $2',
      ['approved', appointmentId]
    );

    // Redirect back to the appointments page
    res.redirect('/counselor/appointments'); // Change to match your route for listing appointments
  } catch (err) {
    console.error('Error approving appointment:', err);
    res.status(500).send('Internal Server Error');
  }
});
app.get('/counselor/appointments/completed/:id', async (req, res) => {
  const appointmentId = req.params.id;

  try {
    // Update the appointment status to 'approved'
    await pool.query(
      'UPDATE appointment SET status = $1, update_date = NOW() WHERE id = $2',
      ['completed', appointmentId]
    );

    // Redirect back to the appointments page
    res.redirect('/counselor/appointments'); // Change to match your route for listing appointments
  } catch (err) {
    console.error('Error approving appointment:', err);
    res.status(500).send('Internal Server Error');
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
    console.log(req.user)
    // 1. Get all appointments
    const appointmentResult = await pool.query(
      'SELECT * FROM appointment WHERE student_id = $1 ORDER BY appointment_date DESC',
      [studentId]
    );

    // 2. Get today's mood
    const moodResult = await pool.query(`
      SELECT emotion, create_date 
      FROM mood 
      WHERE student_id = $1 
        AND DATE(create_date) = CURRENT_DATE
      ORDER BY create_date DESC 
      LIMIT 1;
    `, [studentId]);

    const todayMood = moodResult.rows.length > 0 ? moodResult.rows[0] : null;

    // 3. Check if student is class mayor
    const mayorResult = await pool.query(
      'SELECT is_class_mayor FROM student WHERE id = $1',
      [studentId]
    );

    const isClassMayor = mayorResult.rows[0]?.is_class_mayor || false;

    // 4. Count appointment statuses
    const countResult = await pool.query(`
      SELECT 
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed
      FROM appointment
      WHERE student_id = $1
    `, [studentId]);

    const counts = countResult.rows[0];

    // 5. Render view
    res.render('student-app', {
      user: req.user.user,
      appointments: appointmentResult.rows,
      todayMood,
      isClassMayor,
      appointmentStats: {
        total: parseInt(counts.total),
        pending: parseInt(counts.pending),
        completed: parseInt(counts.completed)
      }
    });

  } catch (err) {
    console.error('Error loading student app:', err);
    res.status(500).render('student-app', {
      error: 'Error fetching data',
      user: req.user.user,
      appointments: [],
      todayMood: null,
      isClassMayor: false,
      appointmentStats: {
        total: 0,
        pending: 0,
        completed: 0
      }
    });
  }
});

app.get('/source-materials',authenticateToken, (req, res) => {
  res.render('source-materials', { user: req.user.user }); 
});
  


  app.get('/appointment-form', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT DISTINCT c.id, 
               CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name
        FROM counselor c
        INNER JOIN counselor_availability ca ON c.id = ca.counselor_id
      `);
  
      res.render('appointment-form', { counselors: result.rows, user: req.user.user });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  });
  app.get('/psycho-testing-form', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT DISTINCT c.id, 
               CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name
        FROM counselor c
        INNER JOIN counselor_availability ca ON c.id = ca.counselor_id
      `);
  
      res.render('psycho-testing-form', { counselors: result.rows, user: req.user.user });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  });
  

  app.post('/appointments/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { title, appointment_date, status } = req.body;
    console.log(title, appointment_date, status);
    try {
      await pool.query(
        `UPDATE appointment
         SET title = $1,
             appointment_date = $2,
             status = $3,
             update_date = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [title, appointment_date, status, id]
      );
  
      res.json({ success: true });
    } catch (err) {
      console.error('Error updating appointment:', err);
      res.json({ success: false });
    }
  });
  



app.post('/appointments/reschedule', async (req, res) => {
  const { appointment_id, new_date } = req.body;

  try {
    // Optional: Validate inputs here

    const updateQuery = `
      UPDATE appointment
      SET appointment_date = $1,
          update_date = NOW()
      WHERE id = $2
    `;

    await pool.query(updateQuery, [new_date, appointment_id]);

    // Redirect or send JSON depending on your app flow
    res.redirect('/appointments'); // or res.json({ success: true });
  } catch (err) {
    console.error('Error rescheduling appointment:', err);
    res.status(500).send('Something went wrong');
  }
});



//FOR CUSTOMERS
app.get('/login', (req, res) => {
    res.render('login', { error: null, username: '' }); // Ensure username is always defined
});


app.get('/register', async (req, res) => {
  try {
    const departments = await pool.query('SELECT * FROM departments');
    const programs = await pool.query('SELECT * FROM programs');
    res.render('register', { departments: departments.rows, programs: programs.rows, error: null, username: '', email: '' });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

app.get('/programs/:departmentId', async (req, res) => {
  const departmentId = req.params.departmentId;

  try {
    // Fetch programs that belong to the selected department by ID
    const programs = await pool.query('SELECT * FROM programs WHERE department_id = $1', [departmentId]);
    
    res.json(programs.rows);  // Send the programs as a JSON response
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch programs' });
  }
});



app.get('/profile/:id',authenticateToken, (req, res) => {
  
  res.render('profile',{user: req.user.user}); // Ensure username is always defined
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
  

  app.get('/student/mood-trend', authenticateToken, async (req, res) => {
    const studentId = req.user.user.id;
  
    try {
      const result = await pool.query(`
        SELECT 
          emotion,
          COUNT(*) AS count,
          DATE_TRUNC('week', create_date)::date AS week_start
        FROM mood
        WHERE student_id = $1
        GROUP BY week_start, emotion
        ORDER BY week_start ASC;
      `, [studentId]);
  
      res.render('mood-trends', { moodData: result.rows, user: req.user.user });
  
    } catch (error) {
      console.error("Error fetching mood trend:", error);
      res.status(500).send("Server Error");
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
  


  app.get('/admin-app', authenticateTokenAdmin, async (req, res) => {
    try {
        // Get total number of students
        const studentsResult = await pool.query('SELECT COUNT(*) FROM student');
        const totalStudents = studentsResult.rows[0].count;

        // Get total number of counselors
        const counselorsResult = await pool.query('SELECT COUNT(*) FROM counselor');
        const totalCounselors = counselorsResult.rows[0].count;

        // Get total number of appointments
        const appointmentsResult = await pool.query('SELECT COUNT(*) FROM appointment');
        const totalAppointments = appointmentsResult.rows[0].count;

        // Pass the totals to the view
        res.render('adminPages/admin-app', {
            totalStudents,
            totalCounselors,
            totalAppointments,
            user: req.user.user,
        });
    } catch (err) {
        console.error('Error fetching totals:', err);
        res.status(500).send('Server Error');
    }
});

//FOR ADMINS
app.get('/admin/register', (req, res) => {
    res.render('adminPages/register-admin', { error: null, username: '', email: '' }); 
});

app.post('/admin/register', async (req, res) => {
    const { username, password, email, terms } = req.body;
  
    // Basic validation
    if (!username || !password || !terms) {
      return res.render('admin/register', {
        error: "All fields are required and terms must be accepted.",
        username,
        email,
      });
    }
  
    try {
      // Check if username already exists
      const checkUser = await pool.query(
        "SELECT * FROM admins WHERE username = $1",
        [username]
      );
  
      if (checkUser.rows.length > 0) {
        return res.render('adminPages/register-admin', {
          error: "Username is already taken.",
          username,
          email
        });
      }
  
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Insert into DB
      await pool.query(
        `INSERT INTO admins (username, password, email) VALUES ($1, $2, $3)`,
        [username, hashedPassword, email]
      );
  
      // Redirect to login or dashboard
      res.redirect('/admin/login');
  
    } catch (err) {
      console.error("Registration error:", err);
      res.render('admin/register', {
        error: "Something went wrong. Please try again.",
        username,
        email
      });
    }
  });
  

app.get('/admin/login', (req, res) => {
    res.render('adminPages/login-admin', { error: null, username: '', email: '' }); 
});
app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            return res.render('adminPages/login-admin', {
                error: 'Invalid username or password',
                username
            });
        }

        const admin = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, admin.password);

        if (!passwordMatch) {
            return res.render('adminPages/login-admin', {
                error: 'Invalid username or password',
                username
            });
        }

        const token = jwt.sign(
            { user: { id: admin.id, role: 'admin', username: admin.username } },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.cookie('jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });

        res.redirect('/admin-app');

    } catch (err) {
        console.error('Error logging in admin:', err);
        res.status(500).render('adminPages/login-admin', {
            error: 'Internal server error',
            username
        });
    }
});


/// display all the pending appointments
app.get('/admin/appointments',authenticateTokenAdmin, async (req, res) => {
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
            ORDER BY appointment.appointment_date DESC
        `);

        const appointments = result.rows;
        res.render('adminPages/appointments-admin', { appointments, user: req.user.user });
    } catch (err) {
        console.error('Error fetching pending appointments:', err);
        res.status(500).send('Server Error');
    }
});

app.get('/admin/psycho-testing', authenticateTokenAdmin, async (req, res) => {
  try {
      const result = await pool.query(`
          SELECT 
              psycho_tests.id,
              psycho_tests.test_title,
              psycho_tests.status,
              psycho_tests.test_date,
              psycho_tests.test_number,
              psycho_tests.is_online_test,
              student.first_name AS student_first_name,
              student.last_name AS student_last_name,
              counselor.first_name AS counselor_first_name,
              counselor.last_name AS counselor_last_name
          FROM psycho_tests
          JOIN student ON psycho_tests.student_id = student.id
          JOIN counselor ON psycho_tests.counselor_id = counselor.id
          ORDER BY psycho_tests.test_date DESC
      `);

      const tests = result.rows;

      res.render('adminPages/psycho-testing-admin', { tests, user: req.user.user });
  } catch (err) {
      console.error('Error fetching psycho tests:', err);
      res.status(500).send('Server Error');
  }
});

app.get('/admin/appointments/cancelled', authenticateTokenAdmin, async (req, res) => {
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
            WHERE appointment.status = 'cancelled'
            ORDER BY appointment.appointment_date DESC
        `);

        const appointments = result.rows;

        res.render('adminPages/cancelled-appointments-admin', { appointments, user: req.user.user });
    } catch (err) {
        console.error('Error fetching cancelled appointments:', err);
        res.status(500).send('Server Error');
    }
});

app.get('/admin/appointments/rejected', authenticateTokenAdmin, async (req, res) => {
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
            WHERE appointment.status = 'rejected'
            ORDER BY appointment.appointment_date DESC
        `);

        const appointments = result.rows;

        res.render('adminPages/rejected-appointments-admin', { appointments, user: req.user.user });
    } catch (err) {
        console.error('Error fetching rejected appointments:', err);
        res.status(500).send('Server Error');
    }
});

app.get("/admin/students", authenticateTokenAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customerUsers");
    res.render("user", { users: result.rows }); // Render EJS template
  } catch (err) {
    console.error("Error fetching customer users:", err);
    res.status(500).send("Server error");
  }
});



// FOR COUNSELORS
app.get('/counselor/login', (req, res) => {
  res.render('counselorPages/login-counselor', { error: null, username: '' }); // Ensure username is always defined
});
app.get('/counselor/register', (req, res) => {
  res.render('counselorPages/register-counselor', { error: null, username: '', email: '' }); 
});



app.post('/counselor/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM counselor WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.render('counselorPages/login-counselor', {
        error: 'Invalid username or password',
        username
      });
    }

    const counselor = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, counselor.password);

    if (!passwordMatch) {
      return res.render('counselorPages/login-counselor', {
        error: 'Invalid username or password',
        username
      });
    }

    const token = jwt.sign(
      { user: { id: counselor.id, role: 'counselor', username: counselor.username } },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    });

    res.redirect('/counselor-app');

  } catch (err) {
    console.error('Counselor login error:', err);
    res.status(500).render('counselorPages/login-counselor', {
      error: 'Internal server error',
      username
    });
  }
});

app.post('/counselor/register', async (req, res) => {
  const { username, password, email, first_name, middle_name, last_name, terms } = req.body;

  if (!username || !password || !first_name || !last_name || !terms) {
    return res.render('counselorPages/register-counselor', {
      error: "All required fields must be filled and terms accepted.",
      username,
      email,
      first_name,
      middle_name,
      last_name
    });
  }

  try {
    const checkUser = await pool.query(
      "SELECT * FROM counselor WHERE username = $1",
      [username]
    );

    if (checkUser.rows.length > 0) {
      return res.render('counselorPages/register-counselor', {
        error: "Username is already taken.",
        username,
        email,
        first_name,
        middle_name,
        last_name
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO counselor (first_name, middle_name, last_name, username, password, email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [first_name, middle_name, last_name, username, hashedPassword, email]
    );

    res.redirect('/counselor/login');

  } catch (err) {
    console.error("Counselor registration error:", err);
    res.render('counselorPages/register-counselor', {
      error: "Something went wrong. Please try again.",
      username,
      email,
      first_name,
      middle_name,
      last_name
    });
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


app.get('/counselor-app', authenticateTokenCounselor, async (req, res) => {
  try {
    const counselorId = req.user.user.id;

    // 1. Get counselor's appointments
    const appointmentResult = await pool.query(
      `
      SELECT a.*, 
             s.first_name AS student_first_name, 
             s.last_name AS student_last_name
      FROM appointment a
      JOIN student s ON a.student_id = s.id
      WHERE a.counselor_id = $1
      ORDER BY a.appointment_date DESC
      `,
      [counselorId]
    );

    // 2. Get counselor availability status
    const availabilityResult = await pool.query(
      'SELECT is_available FROM counselor WHERE id = $1',
      [counselorId]
    );

    const isAvailable = availabilityResult.rows[0]?.is_available;

    // 3. Render the counselor dashboard
    res.render('counselorPages/counselor-app', {
      user: req.user.user,
      appointments: appointmentResult.rows,
      isAvailable
    });
  } catch (err) {
    console.error('Error loading counselor app:', err);
    res.status(500).render('counselorPages/counselor-app', {
      error: 'Error fetching data',
      user: req.user.user,
      appointments: [],
      isAvailable: false
    });
  }
});

app.get('/counselor/appointments', authenticateTokenCounselor, async (req, res) => {
  try {
    const counselorId = req.user.user.id;

    const result = await pool.query(
      `
      SELECT 
        a.id, 
        a.title, 
        a.status, 
        a.appointment_date,
        a.is_online_appointment,
        a.appointment_number,
        s.first_name AS student_first_name,
        s.last_name AS student_last_name
      FROM appointment a
      JOIN student s ON a.student_id = s.id
      WHERE a.counselor_id = $1
      ORDER BY a.appointment_date DESC
      `,
      [counselorId]
    );

    const appointments = result.rows;
    console.log(appointments)
    res.render('counselorPages/counselor-appointments', { appointments });
  } catch (err) {
    console.error('Error fetching counselor appointments:', err);
    res.status(500).send('Server error');
  }
});

app.get('/counselor/appointments/:id/chat', authenticateTokenCounselor, async (req, res) => {
  const appointmentId = req.params.id;
  const currentUser = req.user.user;
  
  try {
      // Get appointment details to validate access
      const appointmentResult = await pool.query(`
        SELECT 
          a.*, 
          (c.first_name || ' ' || c.middle_name || ' ' || c.last_name) AS counselor_name,
          (s.first_name || ' ' || s.middle_name || ' ' || s.last_name) AS student_name
        FROM appointment a
        JOIN counselor c ON a.counselor_id = c.id
        JOIN student s ON a.student_id = s.id
        WHERE a.id = $1
      `, [appointmentId]);
      
        
        

      if (appointmentResult.rows.length === 0) {
          return res.status(404).send("Appointment not found");
      }

      const appointment = appointmentResult.rows[0];

      // Fetch messages
      const messagesResult = await pool.query(`
          SELECT * FROM messages WHERE appointment_id = $1 ORDER BY created_at ASC
      `, [appointmentId]);

      res.render('counselorPages/counselor-appointment-chat', {
          messages: messagesResult.rows,
          appointment: appointmentResult.rows[0],
          currentUser,
          user: req.user.user
      });
        

  } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).send("Server Error");
  }
});
app.post('/counselor/messages/send', authenticateTokenCounselor, async (req, res) => {
  const { appointment_id, message, sender_type } = req.body;

  try {
      await pool.query(
          `INSERT INTO messages (appointment_id, message, sender_type) VALUES ($1, $2, $3)`,
          [appointment_id, message, sender_type]
      );
      res.redirect(`/counselor/appointments/${appointment_id}/chat`);
  } catch (err) {
      console.error('Error sending message:', err);
      res.status(500).send('Server Error');
  }
});

// // User registration
// app.post('/admin/register', async (req, res) => {
//     const { username, email, password } = req.body;

//     try {
//         // Check if user already exists
//         const userExists = await pool.query('SELECT * FROM adminusers WHERE username = $1 OR email = $2', [username, email]);
        
//         if (userExists.rows.length > 0) {
//             return res.render('adminRegister', { error: 'Username or email already exists', username, email });
//         }

//         // Hash the password
//         const hashedPassword = await bcrypt.hash(password, 10);

//         // Insert new user
//         await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3)', [username, email, hashedPassword]);

//         res.redirect('/admin/login'); // Redirect to login page after successful registration
//     } catch (err) {
//         console.error('Error registering user:', err);
//         res.status(500).render('adminRegister', { error: 'Internal server error', username, email });
//     }
// });


// Student login
// app.post('/login', async (req, res) => {
//     const { username, password } = req.body;

//     try {
//         const result = await pool.query('SELECT * FROM student WHERE username = $1', [username]);

//         if (result.rows.length === 0) {
//             return res.render('login', { error: 'Invalid username or password', username });
//         }

//         const user = result.rows[0];

//         const passwordMatch = await bcrypt.compare(password, user.password);

//         if (!passwordMatch) {
//             return res.render('login', { error: 'Invalid username or password', username });
//         }

//         // Create a JWT token with user data (avoid putting sensitive data like password in the token)
//         const token = jwt.sign(
//             { user }, // payload (store minimal info)
//             JWT_SECRET, // secret key
//             { expiresIn: '1h' } // token expiration time
//         );

//         // Optionally, set the token as a cookie (for client-side session)
//         res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

//         // Redirect or render user-specific view (you could pass user info to the next page if needed)
//         res.redirect('/student-app');
//     } catch (err) {
//         console.error('Error logging in user:', err);
//         res.status(500).render('login', { error: 'Internal server error', username });
//     }
// });

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
      // Query to get student data along with class name
      const result = await pool.query(`
          SELECT student.*, class.class_name
          FROM student
          LEFT JOIN class ON student.class_id = class.id
          WHERE student.username = $1
      `, [username]);

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

  app.get('/admin/appointments/cancel/:id', async (req, res) => {
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
        res.redirect('/admin/appointments');
      } else {
        // If no appointment found
        req.flash('error', 'Appointment not found.');
        res.redirect('/admin/appointments');
      }
    } catch (err) {
      console.error(err);
      req.flash('error', 'Something went wrong while cancelling the appointment.');
      res.redirect('/admin/appointments');
    }
  });
  app.get('/admin/appointments/reject/:id', async (req, res) => {
    const appointmentId = req.params.id;
  
    try {
      // Update the appointment's status to 'Cancelled'
      const result = await pool.query(
        'UPDATE appointment SET status = $1 WHERE id = $2 RETURNING *',
        ['rejected', appointmentId]
      );
  
      // Check if appointment was found and updated
      if (result.rows.length > 0) {
        // Redirect to the appointments page with a success message
        req.flash('success', 'Appointment has been successfully cancelled.');
        res.redirect('/admin/appointments');
      } else {
        // If no appointment found
        req.flash('error', 'Appointment not found.');
        res.redirect('/admin/appointments');
      }
    } catch (err) {
      console.error(err);
      req.flash('error', 'Something went wrong while cancelling the appointment.');
      res.redirect('/admin/appointments');
    }
  });
  app.get('/admin/appointments/approve/:id', async (req, res) => {
    const appointmentId = req.params.id;
  
    try {
      // Update the appointment's status to 'Cancelled'
      const result = await pool.query(
        'UPDATE appointment SET status = $1 WHERE id = $2 RETURNING *',
        ['approved', appointmentId]
      );
  
      // Check if appointment was found and updated
      if (result.rows.length > 0) {
        // Redirect to the appointments page with a success message
        req.flash('success', 'Appointment has been successfully cancelled.');
        res.redirect('/admin/appointments');
      } else {
        // If no appointment found
        req.flash('error', 'Appointment not found.');
        res.redirect('/admin/appointments');
      }
    } catch (err) {
      console.error(err);
      req.flash('error', 'Something went wrong while cancelling the appointment.');
      res.redirect('/admin/appointments');
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


const extractFileName = (file) => file ? file[0].key : null;  


// app.post("/register", uploadStudentIdImage, async (req, res) => {
//     const { first_name, middle_name, last_name, username, email, password } = req.body;

//     if (!first_name || !last_name || !username || !email || !password) {
//         return res.status(400).json({ error: "All fields are required" });
//     }
//     const student_id_image = extractFileName(req.files["student_id_image"]);


//     try {
//         const hashedPassword = await bcrypt.hash(password, 10);

//         const result = await pool.query(
//             `INSERT INTO student (first_name, middle_name, last_name, username, email, password, is_class_mayor, create_date, update_date)
//              VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
//              RETURNING id`,
//             [first_name, middle_name, last_name, username, email, hashedPassword, false]
//         );
//         res.redirect('/login');
//         //res.json({ message: "Registration successful!", student_id: result.rows[0].id });
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: "Server error" });
//     }
// });


app.post("/register", uploadStudentIdImage, async (req, res) => {
  const {
    first_name,
    middle_initial,
    last_name,
    sex,
    contact_number,
    address,
    id_num,
    department,
    program,
    year_level,
    username,
    email,
    password,
  } = req.body;

  // Validate required fields
  if (
    !first_name || !last_name || !sex || !contact_number || !address ||
    !id_num || !department || !program || !year_level ||
    !username || !email || !password
  ) {
    return res.status(400).json({ error: "All fields are required" });
  }

  // Ensure file upload exists
  const studentIdFile = req.files?.student_id_image?.[0];
  if (!studentIdFile) {
    return res.status(400).json({ error: "Student ID image is required" });
  }

  const student_id_image_key = studentIdFile.key;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO student (
        first_name, middle_name, last_name, sex, contact_number, address,
        id_num, department_id, program_id, year_level,
        username, email, password, student_id_image,
        is_class_mayor, create_date, update_date
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id`,
      [
        first_name,
        middle_initial || null,
        last_name,
        sex,
        contact_number,
        address,
        id_num,
        department,
        program,
        year_level,
        username,
        email,
        hashedPassword,
        student_id_image_key,
        false, // is_class_mayor
      ]
    );

    res.redirect('/login');
    // Optionally use JSON:
    // res.json({ message: "Registration successful", student_id: result.rows[0].id });

  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Server error" });
  }
});








// SAVE THE AVAILABLITY
app.post('/counselor/availability', authenticateTokenCounselor, async (req, res) => {
  const counselorId = req.user.user.id;
  const selectedDays = req.body.availableDays; // Check the structure of this value

  console.log('Selected Days:', selectedDays); // Log to debug

  try {
    // Clear existing availability for counselor
    await pool.query('DELETE FROM counselor_availability WHERE counselor_id = $1', [counselorId]);

    // Insert new availability
    if (Array.isArray(selectedDays)) {
      const insertPromises = selectedDays.map(day =>
        pool.query(
          'INSERT INTO counselor_availability (counselor_id, available_day) VALUES ($1, $2)',
          [counselorId, day]
        )
      );
      await Promise.all(insertPromises);
    } else if (typeof selectedDays === 'string') {
      // Handle single day case
      await pool.query(
        'INSERT INTO counselor_availability (counselor_id, available_day) VALUES ($1, $2)',
        [counselorId, selectedDays]
      );
    }

    res.redirect('/counselor/availability?success=true');
  } catch (err) {
    console.error('Error saving availability:', err);
    res.status(500).send('Something went wrong while saving your availability.');
  }
});


// FETCH
app.get('/counselor/availability', authenticateTokenCounselor, async (req, res) => {
  const counselorId = req.user.user.id;

  try {
    const result = await pool.query(
      'SELECT available_day FROM counselor_availability WHERE counselor_id = $1',
      [counselorId]
    );

    const selectedDays = result.rows.map(row => row.available_day);
    console.log(counselorId, selectedDays)
    res.render('counselorPages/counselor-availability', {
      selectedDays
    });
  } catch (err) {
    console.error('Error loading availability page:', err);
    res.status(500).send('Error loading availability.');
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
  

app.post('/create/resource', async (req, res) => {
  const { title, description, read_time, pdf_link, details_link, category_id } = req.body;
  // Assuming you're using a DB function:
  await pool.query(`
    INSERT INTO resources (title, description, read_time, pdf_link, details_link, category_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [title, description, read_time, pdf_link, details_link, category_id || null]
  );
  res.redirect('/create/resources'); // Or wherever your list is
});


app.get('/create/resources', authenticateTokenCounselor, async (req, res) => {
  try {


    const resourceResult = await pool.query(`
      SELECT r.*, c.name AS category_name 
      FROM resources r 
      LEFT JOIN categories c ON r.category_id = c.id
      ORDER BY r.id DESC
    `);
    const categoryResult = await pool.query('SELECT * FROM categories');

    res.render('counselorPages/resource-list', {
      user: req.user.user,
      resources: resourceResult.rows,
      categories: categoryResult.rows
    });
  } catch (err) {
    console.error('Error fetching resources:', err);
    res.send("Failed to load resources");
  }
});
app.post('/update/resource', authenticateTokenCounselor, async (req, res) => {
  const { id, title, description, read_time, pdf_link, details_link, category_id } = req.body;

  try {
    await pool.query(`
      UPDATE resources
      SET title = $1,
          description = $2,
          read_time = $3,
          pdf_link = $4,
          details_link = $5,
          category_id = $6
      WHERE id = $7
    `, [title, description, read_time, pdf_link, details_link, category_id, id]);

    res.redirect('/create/resources/');
  } catch (err) {
    console.error('Error updating resource:', err);
    res.send("Error updating resource");
  }
});
app.post('/delete/resource/:id', authenticateTokenCounselor, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM resources WHERE id = $1', [id]);
    res.redirect('/create/resources/');
  } catch (err) {
    console.error('Error deleting resource:', err);
    res.status(500).send('Error deleting resource');
  }
});



app.get('/psychotests', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.user.id;
    const result = await pool.query(
      `SELECT pt.*, c.first_name AS counselor_first_name, c.last_name AS counselor_last_name
       FROM psycho_tests pt
       JOIN counselor c ON pt.counselor_id = c.id
       WHERE pt.student_id = $1
       ORDER BY pt.test_date DESC`,
      [studentId]
    );
    res.render('psycho-testing',{ psychoTests: result.rows, user: req.user.user });
    //res.render('psychoTests/index', { psychoTests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});


app.get('/classes', authenticateTokenAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id,
        c.class_name,
        c.create_date,
        c.update_date,
        COUNT(s.id) AS student_count
      FROM class c
      LEFT JOIN student s ON s.class_id = c.id
      GROUP BY c.id
      ORDER BY c.class_name;
    `);

    res.render('adminPages/classTable', { classes: result.rows, user: req.user.user });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});


// app.get('/classes/:id/students', authenticateTokenAdmin, async (req, res) => {
//   const classId = req.params.id;

//   try {
//     const classQuery = await pool.query('SELECT * FROM class WHERE id = $1', [classId]);
//     const studentsQuery = await pool.query('SELECT * FROM student WHERE class_id = $1', [classId]);

//     if (classQuery.rows.length === 0) {
//       return res.status(404).send('Class not found');
//     }

//     res.render('adminPages/studentsTable', {
//       classInfo: classQuery.rows[0],
//       students: studentsQuery.rows,
//       user: req.user.user,
//     });
//   } catch (error) {
//     console.error('Error fetching class students:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });
app.get('/classes/:id/students', authenticateTokenAdmin, async (req, res) => {
  const classId = req.params.id;

  try {
    // Get all classes (for dropdown/filtering)
    const classResult = await pool.query(`SELECT * FROM class ORDER BY class_name ASC`);

    // Get the selected class info
    const selectedClassQuery = await pool.query(`SELECT * FROM class WHERE id = $1`, [classId]);
    if (selectedClassQuery.rows.length === 0) {
      return res.status(404).send('Class not found');
    }

    const selectedClass = selectedClassQuery.rows[0];

    // Get students in that class
    const studentResult = await pool.query(`
      SELECT 
        student.*, 
        class.id AS class_id, 
        class.class_name, 
        class.create_date AS class_create_date, 
        class.update_date AS class_update_date
      FROM student 
      LEFT JOIN class ON student.class_id = class.id
      WHERE student.class_id = $1
      ORDER BY student.create_date DESC
    `, [classId]);

    // Map student data with signed image URLs
    const studentsWithSignedUrls = await Promise.all(
      studentResult.rows.map(async (student) => {
        const signedUrl = student.student_id_image
          ? await getSignedS3Url(student.student_id_image)
          : null;

        const {
          class_id,
          class_name,
          class_create_date,
          class_update_date,
          ...studentData
        } = student;

        return {
          ...studentData,
          student_id_image_url: signedUrl,
          class: {
            id: class_id,
            class_name,
            create_date: class_create_date,
            update_date: class_update_date
          }
        };
      })
    );

    res.render('adminPages/studentsTable', {
      students: studentsWithSignedUrls,
      classes: classResult.rows,
      selectedClass, // Pass selected class if you want to highlight it in the UI
      user: req.user.user,
    });

  } catch (error) {
    console.error("Error fetching class students:", error);
    res.status(500).send("Server error");
  }
});

app.post('/students/assign-class', authenticateTokenAdmin, async (req, res) => {
  const { studentId, classId, isMayor } = req.body;
  console.log(studentId, classId, isMayor);
  try {
    // Update student's class
    await pool.query(
      `UPDATE student SET class_id = $1, is_class_mayor = $2, update_date = NOW() WHERE id = $3`,
      [classId, isMayor === 'true', studentId]
    );

    res.status(200).json({ success: true, message: "Student assigned successfully" });
  } catch (error) {
    console.error('Error assigning class:', error);
    res.status(500).json({ success: false, message: "Failed to assign class" });
  }
});


app.get('/counselors', authenticateTokenAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         id,
         first_name,
         middle_name,
         last_name,
         username,
         email,
         contact_number,
         position,
         educational_attainment,
         is_available,
         create_date,
         update_date
       FROM counselor`
    );

    res.render('adminPages/counselorsTable',{ counselors: result.rows, user: req.user.user });
  } catch (err) {
    console.error("Error fetching counselors:", err);
    res.status(500).json({ error: "Server error fetching counselors" });
  }
});

// Route for Departments
app.get('/departments', authenticateTokenAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         id,
         name,
         description
       FROM departments`
    );

    res.render('adminPages/departmentsTable', { departments: result.rows, user: req.user.user });
  } catch (err) {
    console.error("Error fetching departments:", err);
    res.status(500).json({ error: "Server error fetching departments" });
  }
});


app.post('/admin/departments/create', async (req, res) => {
  const { name, description } = req.body;

  try {
    await pool.query(
      'INSERT INTO departments (name, description) VALUES ($1, $2)',
      [name, description]
    );
    res.redirect('/departments'); // Redirect back to the departments page
  } catch (err) {
    console.error('Error creating department:', err);
    res.status(500).send('Failed to create department');
  }
});



app.post('/admin/departments/:id/edit', async (req, res) => {
  const departmentId = req.params.id;
  const { name, description } = req.body;

  console.log('Updating department:', departmentId, req.body);

  if (!name) {
    return res.status(400).json({
      success: false,
      message: 'Department name is required.'
    });
  }

  try {
    const result = await pool.query(`
      UPDATE departments
      SET 
        name = $1,
        description = $2
      WHERE id = $3
      RETURNING *
    `, [name, description, departmentId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Department not found.'
      });
    }

    // res.json({
    //   success: true,
    //   message: 'Department updated successfully.',
    //   department: result.rows[0]
    // });

    res.redirect('/departments')
  } catch (err) {
    console.error('Error updating department:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update department.',
      error: err.message
    });
  }
});

app.post('/admin/departments/:id/delete', async (req, res) => {
  const departmentId = req.params.id;

  try {
    await pool.query('DELETE FROM departments WHERE id = $1', [departmentId]);
    res.redirect('/departments')
  } catch (err) {
    console.error('Error deleting department:', err);
    res.status(500).json({ success: false, message: 'Failed to delete department', error: err.message });
  }
});


// Route for Programs
app.get('/programs', authenticateTokenAdmin, async (req, res) => {
  try {
    // Fetch programs
    const programResult = await pool.query(
      `SELECT 
         p.id,
         p.name AS program_name,
         p.description,
         p.department_id,
         d.name AS department_name
       FROM programs p
       JOIN departments d ON p.department_id = d.id`
    );

    // Fetch departments for dropdown
    const departmentResult = await pool.query(
      `SELECT id, name FROM departments`
    );

    res.render('adminPages/programsTable', {
      programs: programResult.rows,
      departments: departmentResult.rows,
      user: req.user.user
    });
  } catch (err) {
    console.error("Error fetching programs or departments:", err);
    res.status(500).json({ error: "Server error fetching programs or departments" });
  }
});



app.post('/admin/programs/create', authenticateTokenAdmin, async (req, res) => {
  try {
    const { name, description, department_id } = req.body;

    await pool.query(
      `INSERT INTO programs (name, description, department_id) VALUES ($1, $2, $3)`,
      [name, description, department_id]
    );

    res.redirect('/programs');
  } catch (err) {
    console.error("Error creating program:", err);
    res.status(500).json({ error: "Server error creating program" });
  }
});
app.post('/admin/programs/:id/delete', authenticateTokenAdmin, async (req, res) => {
  const programId = req.params.id;

  try {
    await pool.query('DELETE FROM programs WHERE id = $1', [programId]);
    res.redirect('/programs');
  } catch (err) {
    console.error('Error deleting program:', err);
    res.status(500).json({ error: 'Server error deleting program' });
  }
});


app.post('/admin/counselors/create', authenticateTokenAdmin, async (req, res) => {
  const {
    first_name,
    middle_name,
    last_name,
    username,
    email,
    contact_number,
    position,
    educational_attainment,
    password
  } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10); // Securely hash the password

    await pool.query(
      `INSERT INTO counselor 
        (first_name, middle_name, last_name, username, email, contact_number, position, educational_attainment, password, is_available, create_date, update_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW())`,
      [first_name, middle_name, last_name, username, email, contact_number, position, educational_attainment, hashedPassword]
    );

    res.redirect('/counselors');
  } catch (err) {
    console.error("Error creating counselor:", err);
    res.status(500).send("Failed to create counselor");
  }
});

app.post('/admin/counselors/:id/edit', authenticateTokenAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    first_name,
    middle_name,
    last_name,
    username,
    email,
    contact_number,
    position,
    educational_attainment
  } = req.body;

  try {
    await pool.query(
      `UPDATE counselor
       SET first_name = $1,
           middle_name = $2,
           last_name = $3,
           username = $4,
           email = $5,
           contact_number = $6,
           position = $7,
           educational_attainment = $8,
           update_date = NOW()
       WHERE id = $9`,
      [first_name, middle_name, last_name, username, email, contact_number, position, educational_attainment, id]
    );

    res.redirect('/counselors');
  } catch (err) {
    console.error("Error updating counselor:", err);
    res.status(500).send("Failed to update counselor");
  }
});

app.post('/admin/counselors/:id/delete', authenticateTokenAdmin, async (req, res) => {
  const counselorId = req.params.id;

  try {
    // First delete the related counselor availability records
    await pool.query('DELETE FROM counselor_availability WHERE counselor_id = $1', [counselorId]);

    // Now delete the counselor
    await pool.query('DELETE FROM counselor WHERE id = $1', [counselorId]);

    res.redirect('/counselors'); // Redirect back to the counselor list page
  } catch (err) {
    console.error("Error deleting counselor:", err);
    res.status(500).send("Server error deleting counselor.");
  }
});

// app.get('/students', authenticateTokenAdmin, async (req, res) => {
    
//   try {
//     const result = await pool.query(`
//       SELECT student.*, class.class_name AS class_name 
//       FROM student 
//       LEFT JOIN class ON student.class_id = class.id
//       ORDER BY student.create_date DESC
//     `);
//     const idImageUrl = await getSignedS3Url(result.rows.student_id_image);

//     res.render('adminPages/studentsTable', { students: result.rows, user: req.user.user });
//   } catch (error) {
//     console.error(error);
//     res.status(500).send("Server error");
//   }
// });
app.get('/mayors', authenticateTokenAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT student.*, class.class_name AS class_name 
      FROM student 
      LEFT JOIN class ON student.class_id = class.id
      WHERE student.class_id IS NOT NULL AND student.is_class_mayor = TRUE
      ORDER BY student.create_date DESC
    `);
    

    const studentsWithSignedUrls = await Promise.all(
      result.rows.map(async (student) => {
        if (student.student_id_image) {
          student.student_id_image_url = await getSignedS3Url(student.student_id_image);
        } else {
          student.student_id_image_url = null;
        }
        return student;
      })
    );

    res.render('adminPages/mayorsTable', {
      students: studentsWithSignedUrls,
      user: req.user.user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});
// app.get('/students', authenticateTokenAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(`
//       SELECT student.*, class.class_name AS class_name 
//       FROM student 
//       LEFT JOIN class ON student.class_id = class.id
//       WHERE student.class_id IS NOT NULL
//       ORDER BY student.create_date DESC
//     `);

//     const studentsWithSignedUrls = await Promise.all(
//       result.rows.map(async (student) => {
//         if (student.student_id_image) {
//           student.student_id_image_url = await getSignedS3Url(student.student_id_image);
//         } else {
//           student.student_id_image_url = null;
//         }
//         return student;
//       })
//     );

//     res.render('adminPages/studentsTable', {
//       students: studentsWithSignedUrls,
//       user: req.user.user,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).send("Server error");
//   }
// });


app.get('/students', authenticateTokenAdmin, async (req, res) => {
  try {
    // Get all students with their class, department, and program info
    const studentResult = await pool.query(`
      SELECT 
        student.*, 
        class.id AS class_id, 
        class.class_name, 
        class.create_date AS class_create_date, 
        class.update_date AS class_update_date,
        departments.name AS department_name,
        programs.name AS program_name
      FROM student 
      LEFT JOIN class ON student.class_id = class.id
      LEFT JOIN departments ON student.department_id = departments.id
      LEFT JOIN programs ON student.program_id = programs.id
      WHERE student.class_id IS NOT NULL
      ORDER BY student.create_date DESC
    `);

    // Get all classes
    const classResult = await pool.query(`SELECT * FROM class ORDER BY class_name ASC`);

    // Get all departments
    const departmentResult = await pool.query(`SELECT id, name FROM departments ORDER BY name ASC`);

    // Get all programs
    const programResult = await pool.query(`SELECT id, name, department_id FROM programs ORDER BY name ASC`);

    // Attach signed S3 URLs for student ID images
    const studentsWithSignedUrls = await Promise.all(
      studentResult.rows.map(async (student) => {
        const signedUrl = student.student_id_image
          ? await getSignedS3Url(student.student_id_image)
          : null;

        // Destructure joined info
        const {
          class_id,
          class_name,
          class_create_date,
          class_update_date,
          department_name,
          program_name,
          ...studentData
        } = student;

        return {
          ...studentData,
          student_id_image_url: signedUrl,
          class: {
            id: class_id,
            class_name,
            create_date: class_create_date,
            update_date: class_update_date
          },
          department_name,
          program_name
        };
      })
    );
    // console.log({
    //   students: studentsWithSignedUrls,
    //   classes: classResult.rows,
    //   departments: departmentResult.rows,
    //   programs: programResult.rows,
    //   user: req.user.user,
    // });
    // Render with all required data
    res.render('adminPages/studentsTable', {
      students: studentsWithSignedUrls,
      classes: classResult.rows,
      departments: departmentResult.rows,
      programs: programResult.rows,
      user: req.user.user,
      unAssignedPage: false
    });

  } catch (error) {
    console.error("Error fetching students and classes:", error);
    res.status(500).send("Server error");
  }
});



app.get('/students/unassigned', authenticateTokenAdmin, async (req, res) => {
    try {
      // Get all students with their class, department, and program info
      const studentResult = await pool.query(`
        SELECT 
          student.*, 
          class.id AS class_id, 
          class.class_name, 
          class.create_date AS class_create_date, 
          class.update_date AS class_update_date,
          departments.name AS department_name,
          programs.name AS program_name
        FROM student 
        LEFT JOIN class ON student.class_id = class.id
        LEFT JOIN departments ON student.department_id = departments.id
        LEFT JOIN programs ON student.program_id = programs.id
        WHERE student.class_id IS NULL
        ORDER BY student.create_date DESC
      `);
  
      // Get all classes
      const classResult = await pool.query(`SELECT * FROM class ORDER BY class_name ASC`);
  
      // Get all departments
      const departmentResult = await pool.query(`SELECT id, name FROM departments ORDER BY name ASC`);
  
      // Get all programs
      const programResult = await pool.query(`SELECT id, name, department_id FROM programs ORDER BY name ASC`);
  
      // Attach signed S3 URLs for student ID images
      const studentsWithSignedUrls = await Promise.all(
        studentResult.rows.map(async (student) => {
          const signedUrl = student.student_id_image
            ? await getSignedS3Url(student.student_id_image)
            : null;
  
          // Destructure joined info
          const {
            class_id,
            class_name,
            class_create_date,
            class_update_date,
            department_name,
            program_name,
            ...studentData
          } = student;
  
          return {
            ...studentData,
            student_id_image_url: signedUrl,
            class: {
              id: class_id,
              class_name,
              create_date: class_create_date,
              update_date: class_update_date,
            },
            department_name,
            program_name
          };
        })
      );
      // console.log({
      //   students: studentsWithSignedUrls,
      //   classes: classResult.rows,
      //   departments: departmentResult.rows,
      //   programs: programResult.rows,
      //   user: req.user.user,
      // });
      // Render with all required data
      res.render('adminPages/studentsTable', {
        students: studentsWithSignedUrls,
        classes: classResult.rows,
        departments: departmentResult.rows,
        programs: programResult.rows,
        user: req.user.user,
        unAssignedPage: true,
      });
  
    } catch (error) {
      console.error("Error fetching students and classes:", error);
      res.status(500).send("Server error");
    }
  });
  


app.get('/students/:id', async (req, res) => {
  console.log("FETCHING!")
  try {
    const id = req.params.id;
    const result = await pool.query(`SELECT s.*, c.class_name as class_name FROM student s LEFT JOIN class c ON s.class_id = c.id WHERE s.id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/students/edit/:id', async (req, res) => {
  console.log('Editing student:', req.params.id, req.body);
  const {
    first_name,
    middle_name,
    last_name,
    username,
    email,
    id_num,
    department,
    program,
    year_level,
    sex,
    contact_number,
    is_class_mayor
  } = req.body;

  try {
    await pool.query(`
      UPDATE student
      SET 
        first_name = $1,
        middle_name = $2,
        last_name = $3,
        username = $4,
        email = $5,
        id_num = $6,
        department_id = $7,
        program_id = $8,
        year_level = $9,
        sex = $10,
        contact_number = $11,
        is_class_mayor = $12,
        update_date = CURRENT_TIMESTAMP
      WHERE id = $13
    `, [
      first_name,
      middle_name,
      last_name,
      username,
      email,
      id_num,
      department,
      program,
      year_level,
      sex,
      contact_number,
      is_class_mayor,
      req.params.id
    ]);

    res.json({ success: true, message: 'Student updated successfully' });
  } catch (err) {
    console.error('Error updating student:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update student',
      error: err.message 
    });
  }
});


// Save new class
app.post('/classes/create', async (req, res) => {
  const { class_name } = req.body;
  try {
    await pool.query('INSERT INTO class (class_name) VALUES ($1)', [class_name]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
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
app.post('/savePsychotesting', async (req, res) => {
  const { title, student_id, counselor_id, test_date, isOnlineTest } = req.body;

  // Default status
  const status = req.body.status || 'pending';

  // Format date
  const formattedTestDate = moment(test_date).format('YYYY-MM-DD HH:mm:ss');
  const todayFormatted = moment().format('YYYYMMDD');

  // Generate 6-digit random number
  const randomDigits = Math.floor(100000 + Math.random() * 900000);

  // Generate unique test number
  const testNumber = `${randomDigits}${todayFormatted}${student_id}${counselor_id}`;

  try {
    // Insert into psycho_tests table
    const result = await pool.query(
      `INSERT INTO psycho_tests 
        (test_title, student_id, counselor_id, test_date, test_number, is_online_test, status, created_at, updated_at)
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [title, student_id, counselor_id, formattedTestDate, testNumber, isOnlineTest, status]
    );

    const testId = result.rows[0].id;

    console.log("Psychological test record created successfully");
    res.redirect('/student-app');
  } catch (error) {
    console.error('Error saving psychotesting record:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



app.get('/logout', (req, res) => {
    // Clear the JWT cookie by setting it to an empty value and making it expired
    res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

    // Redirect to the login page or home page after logging out
    res.redirect('/login');
});
app.get('/admin/logout', (req, res) => {
  res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.redirect('/admin/login'); // or wherever your admin login page is
});

app.get('/counselor/logout', (req, res) => {
  res.clearCookie('jwt', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.redirect('/counselor/login'); // or wherever your counselor login page is
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
