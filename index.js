const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
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
const stream = require('stream');
const fs = require('fs');
const csv = require('csv-parser');


// Use memory storage instead of disk
const storage = multer.memoryStorage(); // Store files in memory (for buffer use)
const upload = multer({ storage: storage });

//const upload = require('./multerConfigCSV'); // Make sure this is configured correctly

const token = crypto.randomBytes(32).toString("hex");


const { S3Client, PutObjectCommand ,GetObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { uploadStudentIdImage } = require('./multerConfig');

// // Ensure the uploads directory exists
// const uploadDir = path.join(__dirname, 'uploads');
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir);
// }
//const upload = multer({ dest: 'uploads/' }); // temporarily save in the 'uploads' folder


app.use(express.static(path.join(__dirname + '/public')));
app.use(cookieParser());

app.set('view engine', 'ejs')
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.set('views', path.join(__dirname, '/views'))
// app.use("/uploads", express.static("uploads")); // Serve uploaded files
app.use(session({ secret: 'petCounseling', resave: false, saveUninitialized: true }));
app.use(flash());
app.use(cors({
    origin: 'https://counseling-system.vercel.app',
    credentials: true // if you use cookies/sessions
}));

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
  


  async function createNotification(userId, recipientType, message, type = null) {
    try {
      await pool.query(`
        INSERT INTO notifications (user_id, recipient_type, message, type)
        VALUES ($1, $2, $3, $4)
      `, [userId, recipientType, message, type]);
    } catch (err) {
      console.error('Error creating notification:', err.message);
    }
  }
  


  
// Middleware to verify the JWT token
// const authenticateToken = (req, res, next) => {
//     const token = req.cookies.jwt; // Assumes you are using cookies to store the JWT

//     if (!token) {
//         return res.redirect('/login');
//     }

//     jwt.verify(token, JWT_SECRET, (err, decoded) => {
//         if (err) {
//             return res.redirect('/login');
//             //return res.status(403).render('login', { error: 'Invalid or expired token' });
//         }

//         // Attach user info to the request object
//         req.user = decoded;
//         next();
//     });
// };


const authenticateToken = async (req, res, next) => {
  const token = req.cookies.jwt;

  if (!token) return res.redirect('/login');

  try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      res.locals.user = decoded;

      // Fetch last 5 notifications for this user
      const { rows: notifications } = await pool.query(
        `SELECT * FROM notifications
        WHERE user_id = $1 AND recipient_type = $2
        ORDER BY created_at DESC
        LIMIT 5`,
        [res.locals.user.user.id, "student"]
      );

      // Add "time ago" format to each notification
      const formatTimeAgo = (createdAt) => {
          const now = new Date();
          const timeDiff = now - new Date(createdAt); // Difference in milliseconds

          const seconds = Math.floor(timeDiff / 1000);
          const minutes = Math.floor(seconds / 60);
          const hours = Math.floor(minutes / 60);
          const days = Math.floor(hours / 24);

          if (days > 1) {
              return `${days} days ago`;
          } else if (days === 1) {
              return '1 day ago';
          } else if (hours > 1) {
              return `${hours} hours ago`;
          } else if (hours === 1) {
              return '1 hour ago';
          } else if (minutes > 1) {
              return `${minutes} minutes ago`;
          } else if (minutes === 1) {
              return '1 minute ago';
          } else {
              return 'Just now';
          }
      };

      // Add time ago info to each notification
      notifications.forEach(notification => {
          notification.timeAgo = formatTimeAgo(notification.created_at);
      });

      // Make available to all EJS templates
      res.locals.notifications = notifications;
      //console.log(res.locals.notifications);
      next(); 
  } catch (err) {
      console.error('JWT error or DB error:', err);
      return res.redirect('/login');
  }
};


const authenticateTokenCounselor = async (req, res, next) => {
  const token = req.cookies.jwt;

  if (!token) {
    return res.redirect('/counselor/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    res.locals.user = decoded;

    // Fetch last 5 notifications for this counselor
    const { rows: notifications } = await pool.query(
      `SELECT * FROM notifications
      WHERE user_id = $1 AND recipient_type = $2
      ORDER BY created_at DESC
      LIMIT 5`,
      [res.locals.user.user.id, "counselor"]
    );

    // Format "time ago"
    const formatTimeAgo = (createdAt) => {
      const now = new Date();
      const timeDiff = now - new Date(createdAt);

      const seconds = Math.floor(timeDiff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 1) {
        return `${days} days ago`;
      } else if (days === 1) {
        return '1 day ago';
      } else if (hours > 1) {
        return `${hours} hours ago`;
      } else if (hours === 1) {
        return '1 hour ago';
      } else if (minutes > 1) {
        return `${minutes} minutes ago`;
      } else if (minutes === 1) {
        return '1 minute ago';
      } else {
        return 'Just now';
      }
    };

    notifications.forEach(notification => {
      notification.timeAgo = formatTimeAgo(notification.created_at);
    });

    res.locals.notifications = notifications;
    next();
  } catch (err) {
    console.error('JWT or DB error (counselor):', err);
    return res.redirect('/counselor/login');
  }
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


// My appointments
app.get('/appointments', authenticateToken, async (req, res) => {
    const studentId = req.user.user.id;
    try {
        const result = await pool.query(`
            SELECT 
    a.id,
    a.title,
    a.appointment_date,
    a.start_time,
    a.end_time,
    a.status, -- make sure this is included
    a.is_online_appointment,
    a.appointment_number,
    a.turn_to_approve,
    a.counselor_id,
    a.remark,
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
  
app.get('/student/appointments/reschedule/:id', async (req, res) => {
  const appointmentId = req.params.id;

  try {
    // Update the appointment status to 'approved'
    await pool.query(
      'UPDATE appointment SET turn_to_approve = $1, update_date = NOW() WHERE id = $3',
      ['counselor', appointmentId] // Correct order of values
    );

    // Redirect back to the appointments page
    res.redirect('/appointments'); // Adjust the route as needed
  } catch (err) {
    console.error('Error approving appointment:', err);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/student/appointments/approve/:id', async (req, res) => {
  const appointmentId = req.params.id;

  try {
    // Update the appointment status to 'approved'
    await pool.query(
      'UPDATE appointment SET status = $1, update_date = NOW() WHERE id = $2',
      ['approved', appointmentId] // Correct order of values
    );

    // Redirect back to the appointments page
    res.redirect('/appointments'); // Adjust the route as needed
  } catch (err) {
    console.error('Error approving appointment:', err);
    res.status(500).send('Internal Server Error');
  }
});


// app.post('/appointments/check-availability', async (req, res) => {
//   const { date, start_time, end_time, appointment_id, counselor_id } = req.body;
//   try {
//     // Get day of the week (0 = Sunday, 6 = Saturday)
//     const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
//     const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 1 = Monday, etc.
//     const dayName = daysOfWeek[dayOfWeek]; // Get the day name


//     console.log(date, start_time, end_time, appointment_id, counselor_id, dayName)

//     // Check if counselor is available on that day and time
//     const availability = await pool.query(`
//       SELECT * FROM counselor_availability
//       WHERE counselor_id = $1
//         AND available_day = $2
//         AND start_time <= $3
//         AND end_time >= $4
//     `, [counselor_id, dayName, start_time, end_time]);
//       console.log(availability.rows);
//     if (availability.rows.length === 0) {
//       return res.json({ available: false, reason: 'Counselor not available during this time.' });
//     }

//     // Check for conflicting appointments
//     const conflict = await pool.query(`
//       SELECT * FROM appointment 
//       WHERE appointment_date = $1
//         AND counselor_id = $2
//         AND id != $3
//         AND (
//           (start_time < $4 AND end_time > $5)
//         )
//     `, [date, counselor_id, appointment_id, end_time, start_time]);

//     if (conflict.rows.length > 0) {
//       return res.json({ available: false, reason: 'Time slot is already booked.' });
//     }
//     console.log("RUN")
//     // No conflicts, and within counselor's availability
//     res.json({ available: true });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ available: false, reason: 'Server error' });
//   }
// });


app.post('/student/appointments/reschedule', async (req, res) => {
  const { date, start_time, end_time, appointment_id, counselor_id } = req.body;
  try {
    // Get day of the week (0 = Sunday, 6 = Saturday)
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 1 = Monday, etc.
    const dayName = daysOfWeek[dayOfWeek]; // Get the day name

    console.log(date, start_time, end_time, appointment_id, counselor_id, dayName)

    // Check if counselor is available on that day and time
    const availability = await pool.query(`
      SELECT * FROM counselor_availability
      WHERE counselor_id = $1
        AND available_day = $2
        AND start_time <= $3
        AND end_time >= $4
    `, [counselor_id, dayName, start_time, end_time]);

    console.log(availability.rows);

    if (availability.rows.length === 0) {
      return res.json({ available: false, reason: 'Counselor not available during this time.' });
    }

    // Check for conflicting appointments
    const conflict = await pool.query(`
      SELECT * FROM appointment
      WHERE appointment_date = $1
        AND counselor_id = $2
        AND id != $3
        AND (
          (start_time < $4 AND end_time > $5)
        )
    `, [date, counselor_id, appointment_id, end_time, start_time]);

    if (conflict.rows.length > 0) {
      return res.json({ available: false, reason: 'Time slot is already booked.' });
    }

    console.log("RUN");

    // Update the appointment if available
    const updateQuery = `
      UPDATE appointment
      SET appointment_date = $1,
          start_time = $2,
          end_time = $3,
          turn_to_approve = $4
      WHERE id = $5
    `;

    await pool.query(updateQuery, [date, start_time, end_time, "counselor",appointment_id]);
    createNotification(8, 'counselor', 'Your appointment has been rescheduled to ' + date 
      +" at " + start_time + " - " + end_time, 'reschedule')
    // No conflicts, and within counselor's availability
    res.json({ available: true, message: 'Appointment rescheduled successfully and set for approval.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ available: false, reason: 'Server error' });
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



// app.post('/messages/send', authenticateToken, async (req, res) => {
//     const { appointment_id, message, sender_type } = req.body;

//     try {
//         await pool.query(
//             `INSERT INTO messages (appointment_id, message, sender_type) VALUES ($1, $2, $3)`,
//             [appointment_id, message, sender_type]
//         );
//         res.redirect(`/appointments/${appointment_id}/chat`);
//     } catch (err) {
//         console.error('Error sending message:', err);
//         res.status(500).send('Server Error');
//     }
// });

app.post('/messages/send', authenticateToken, async (req, res) => {
    const { appointment_id, message, sender_type } = req.body;

    try {
        await pool.query(
            `INSERT INTO messages (appointment_id, message, sender_type) VALUES ($1, $2, $3)`,
            [appointment_id, message, sender_type]
        );
        res.json({ success: true }); // ✅ Return JSON instead of redirect
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ success: false, error: 'Server Error' }); // Return error in JSON
    }
});




app.get('/messages', authenticateToken, async (req, res) => {
  const userid = req.user.user.id;

  try {
    const messagesResult = await pool.query(`
      SELECT * FROM appointment
      WHERE student_id = $1
        AND is_online_appointment = TRUE
        AND (status = 'completed' OR status = 'approved')
      ORDER BY id ASC
    `, [userid]);

    res.render('messages', {appointments: messagesResult.rows, user: req.user});
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).send("Server Error");
  }
});


app.get('/counselor/messages', authenticateTokenCounselor, async (req, res) => {
  const userid = req.user.user.id;

  try {
    const messagesResult = await pool.query(`
      SELECT * FROM appointment
      WHERE counselor_id = $1
        AND is_online_appointment = TRUE
        AND (status = 'completed' OR status = 'approved')
      ORDER BY id ASC
    `, [userid]);

    res.render('counselorPages/counselorMessages', {appointments: messagesResult.rows, user: req.user});
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).send("Server Error");
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








  app.get('/psycho-testing-form', authenticateTokenCounselor, async (req, res) => {
    try {
      const counselorId = req.user.user.id;
  
      // Get counselor's department_id
      const counselorResult = await pool.query(
        'SELECT department_id FROM counselor WHERE id = $1',
        [counselorId]
      );
  
      const departmentId = counselorResult.rows[0].department_id;
  
      // Fetch programs for the counselor's department
      const programResult = await pool.query(
        'SELECT * FROM programs WHERE department_id = $1',
        [departmentId]
      );
  
      // Render the form with the programs
      res.render('psycho-testing-form', {
        programs: programResult.rows,
        user: req.user.user
      });
    } catch (error) {
      console.error('Error fetching programs:', error);
      res.status(500).send('Internal Server Error');
    }
  });
  
  
  
   


  

// Get classes by program ID
app.get('/getClassesByProgram/:programId', async (req, res) => {
  const programId = req.params.programId;

  try {
    // Fetch classes related to the program
    const classResult = await pool.query(
      'SELECT * FROM class WHERE program_id = $1',
      [programId]
    );

    res.json(classResult.rows); // Return classes as JSON
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).send('Error fetching classes');
  }
});




// app.post('/saveClassPsychotesting', authenticateTokenCounselor, async (req, res) => {
//   const { class_id, title, test_date } = req.body;
//   const counselor_id = req.user.user.id;

//   if (!class_id || !title || !test_date) {
//     return res.status(400).send('All fields are required');
//   }

//   try {
//     const classCheck = await pool.query(
//       `SELECT id FROM class WHERE id = $1`,
//       [class_id]
//     );

//     if (classCheck.rows.length === 0) {
//       return res.status(404).send('Selected class not found');
//     }

//     const testNumber = Math.random().toString(36).substring(2, 8).toUpperCase();

//     await pool.query(
//       `INSERT INTO psycho_tests 
//        (test_title, counselor_id, test_date, test_number, is_online_test, class_id)
//        VALUES ($1, $2, $3, $4, $5, $6)`,
//       [
//         title,
//         counselor_id,
//         test_date,
//         testNumber,
//         false, // is_online_test set to false (for class testing)
//         class_id
//       ]
//     );

//     res.redirect('/psycho-testing-form'); // Or to a success page
//   } catch (error) {
//     console.error('Error saving psychotesting schedule:', error);

//     if (error.code === '23505') {
//       return res.status(409).send('Duplicate test number detected.');
//     }

//     res.status(500).send('Error saving schedule');
//   }
// });

  
app.post('/saveClassPsychotesting', authenticateTokenCounselor, async (req, res) => {
  const { class_id, title, test_date } = req.body;
  const counselor_id = req.user.user.id;

  if (!class_id || !title || !test_date) {
    return res.status(400).send('All fields are required');
  }

  try {
    const classCheck = await pool.query(
      `SELECT id FROM class WHERE id = $1`,
      [class_id]
    );

    if (classCheck.rows.length === 0) {
      return res.status(404).send('Selected class not found');
    }

    const testNumber = Math.random().toString(36).substring(2, 8).toUpperCase();

    await pool.query(
      `INSERT INTO psycho_tests 
       (test_title, counselor_id, test_date, test_number, is_online_test, class_id, turn_to_approve)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        title,
        counselor_id,
        test_date,
        testNumber,
        false, // is_online_test set to false (for class testing)
        class_id,
        'student' // Set the turn to student
      ]
    );

    res.redirect('/psycho-testing-form');
  } catch (error) {
    console.error('Error saving psychotesting schedule:', error);

    if (error.code === '23505') {
      return res.status(409).send('Duplicate test number detected.');
    }

    res.status(500).send('Error saving schedule');
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
  console.log("reschedule")
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

app.post('/counselor/appointments/reschedule', async (req, res) => {
  const { appointment_id, new_date, start_time, end_time } = req.body;
  console.log(appointment_id, new_date, start_time, end_time)
  if (!appointment_id || !new_date || !start_time || !end_time) {
    return res.status(400).send('Missing required fields');
  }

  try {
    const updateQuery = `
      UPDATE appointment
      SET 
        appointment_date = $1,
        start_time = $2,
        end_time = $3,
        update_date = NOW(),
        turn_to_approve = 'student'
      WHERE id = $4
    `;

    await pool.query(updateQuery, [new_date, start_time, end_time, appointment_id]);

    // You can either redirect or respond with JSON
    res.redirect('/counselor/appointments'); // or res.json({ success: true });
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
  console.log(departmentId)
  try {
    // Fetch programs that belong to the selected department by ID
    const programs = await pool.query('SELECT * FROM programs WHERE department_id = $1', [departmentId]);
    console.log(programs.rows)
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
  

  app.get('/counselor/forums', authenticateTokenCounselor, async (req, res) => {
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
      res.render('counselorPages/forums-counselor', { forums, user: req.user.user });
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
  


    app.get('/counselor/forums/:id', authenticateTokenCounselor, async (req, res) => {
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
  
      res.render('counselorPages/forum-details-counselor', { forum, comments, user: req.user.user });
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

// app.get('/admin/psycho-testing', authenticateTokenAdmin, async (req, res) => {
//   try {
//       const result = await pool.query(`
//           SELECT 
//               psycho_tests.id,
//               psycho_tests.test_title,
//               psycho_tests.status,
//               psycho_tests.test_date,
//               psycho_tests.test_number,
//               psycho_tests.is_online_test,
//               student.first_name AS student_first_name,
//               student.last_name AS student_last_name,
//               counselor.first_name AS counselor_first_name,
//               counselor.last_name AS counselor_last_name
//           FROM psycho_tests
//           JOIN student ON psycho_tests.student_id = student.id
//           JOIN counselor ON psycho_tests.counselor_id = counselor.id
//           ORDER BY psycho_tests.test_date DESC
//       `);

//       const tests = result.rows;

//       res.render('adminPages/psycho-testing-admin', { tests, user: req.user.user });
//   } catch (err) {
//       console.error('Error fetching psycho tests:', err);
//       res.status(500).send('Server Error');
//   }
// });

app.get('/admin/psycho-testing', authenticateTokenAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
          psycho_tests.id,
          class.class_name AS class_name,
          psycho_tests.test_title,
          psycho_tests.status,
          psycho_tests.test_date,
          psycho_tests.test_number,
          mayor.first_name AS mayor_first_name,
          mayor.last_name AS mayor_last_name,
          counselor.first_name AS counselor_first_name,
          counselor.last_name AS counselor_last_name
      FROM psycho_tests
      JOIN student AS test_taker ON psycho_tests.student_id = test_taker.id
      JOIN counselor ON psycho_tests.counselor_id = counselor.id
      JOIN class ON psycho_tests.class_id = class.id
      LEFT JOIN student AS mayor ON mayor.class_id = class.id AND mayor.is_class_mayor = true
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

// app.get('/counselor/appointments', authenticateTokenCounselor, async (req, res) => {
//   try {
//     const counselorId = req.user.user.id;

//     const result = await pool.query(
//       `
//       SELECT 
//         a.id, 
//         a.title, 
//         a.status, 
//         a.appointment_date,
//         a.is_online_appointment,
//         a.appointment_number,
//         s.first_name AS student_first_name,
//         s.last_name AS student_last_name
//       FROM appointment a
//       JOIN student s ON a.student_id = s.id
//       WHERE a.counselor_id = $1
//       ORDER BY a.appointment_date DESC
//       `,
//       [counselorId]
//     );

//     const appointments = result.rows;
//     console.log(appointments)
//     res.render('counselorPages/counselor-appointments', { appointments });
//   } catch (err) {
//     console.error('Error fetching counselor appointments:', err);
//     res.status(500).send('Server error');
//   }
// });


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
        a.start_time,        -- Add start time here
        a.end_time,          -- Add end time here
        a.is_online_appointment,
        a.appointment_number,
        a.turn_to_approve,
        a.already_added_new_session,
        a.remark,
        a.student_id,
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
    console.log(appointments);
    res.render('counselorPages/counselor-appointments', { appointments });
  } catch (err) {
    console.error('Error fetching counselor appointments:', err);
    res.status(500).send('Server error');
  }
});

// app.post('/counselor/sessions/new', authenticateTokenCounselor, async (req, res) => {
//   const { appointment_id, session_date, start_time, end_time, appointment_number, isOnlineAppointment } = req.body;

//   try {
//     const original = await pool.query(`SELECT * FROM appointment WHERE id = $1`, [appointment_id]);
//     const data = original.rows[0];

//     await pool.query(
//       `INSERT INTO appointment 
//         (title, student_id, counselor_id, status, is_online_appointment, appointment_number, appointment_date, start_time, end_time)
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
//       [
//         data.title,
//         data.student_id,
//         data.counselor_id,
//         'approved',
//         isOnlineAppointment,
//         appointment_number,
//         session_date,
//         start_time,
//         end_time
//       ]
//     );

//     res.redirect('/counselor/appointments');
//   } catch (err) {
//     console.error('Error creating follow-up appointment:', err);
//     res.status(500).send('Failed to schedule follow-up');
//   }
// });


app.post('/counselor/sessions/new', authenticateTokenCounselor, async (req, res) => {
  const { appointment_id, session_date, start_time, end_time, appointment_number, isOnlineAppointment } = req.body;

  try {
    const original = await pool.query(`SELECT * FROM appointment WHERE id = $1`, [appointment_id]);
    const data = original.rows[0];

    // Insert the new session
    await pool.query(
      `INSERT INTO appointment 
        (title, student_id, counselor_id, status, is_online_appointment, appointment_number, appointment_date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        data.title,
        data.student_id,
        data.counselor_id,
        'approved',
        isOnlineAppointment,
        appointment_number,
        session_date,
        start_time,
        end_time
      ]
    );

    // Update the original appointment to set already_added_new_session = true
    await pool.query(
      `UPDATE appointment SET already_added_new_session = true WHERE id = $1`,
      [appointment_id]
    );

    res.redirect('/counselor/appointments');
  } catch (err) {
    console.error('Error creating follow-up appointment:', err);
    res.status(500).send('Failed to schedule follow-up');
  }
});


// POST route to end a session
app.post('/counselor/appointments/end-session/:id', authenticateTokenCounselor, async (req, res) => {
  const { id } = req.params; // Extract appointment ID from the URL
  try {
    // Update the appointment record to indicate that a new session has been added
    await pool.query(
      `UPDATE appointment SET already_added_new_session = true WHERE id = $1`,
      [id] // Use the appointment ID parameter
    );

    // Optionally, you can send a success response or redirect to a page
    req.flash('success', 'Session successfully ended.');
    res.redirect('/counselor/appointments'); // Redirecting to the appointments page

  } catch (error) {
    console.error('Error ending session:', error);
    req.flash('error', 'Failed to end session.');
    res.redirect('/counselor/appointments'); // Redirect back to appointments page in case of error
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

    // Check if the student is verified
    if (!user.is_verified) {
      return res.render('login', { error: 'Your account is not yet verified.', username });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.render('login', { error: 'Invalid username or password', username });
    }

    // Create JWT token without sensitive data
     const token = jwt.sign(
          { user }, // payload (store minimal info)
          JWT_SECRET, // secret key
          { expiresIn: '1h' } // token expiration time
      );

    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

    res.redirect('/student-app');
  } catch (err) {
    console.error('Error logging in user:', err);
    res.status(500).render('login', { error: 'Internal server error', username });
  }
});


app.post('/counselor/appointments/cancel/:id', async (req, res) => {
  const appointmentId = req.params.id;
  const { remarks } = req.body
  try {
    // Update the appointment's status to 'Cancelled'
    const result = await pool.query(
        `
        UPDATE appointment 
        SET 
          status = 'cancelled', 
          remark = $1
        WHERE id = $2 
        RETURNING *
        `,
        [remarks || null, appointmentId]
      );

    // Check if appointment was found and updated
    if (result.rows.length > 0) {
      // Redirect to the appointments page with a success message
      req.flash('success', 'Appointment has been successfully cancelled.');
      res.redirect('/counselor/appointments');
    } else {
      // If no appointment found
      req.flash('error', 'Appointment not found.');
      res.redirect('/counselor/appointments');
    }
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong while cancelling the appointment.');
    res.redirect('/counselor/appointments');
  }
});

app.post('/appointments/cancel/:id', async (req, res) => {
    const appointmentId = req.params.id;
    const { remark } = req.body;
    try {
      // Update the appointment's status to 'Cancelled'

      const result = await pool.query(
        `
        UPDATE appointment 
        SET 
          status = 'cancelled', 
          remark = $1
        WHERE id = $2 
        RETURNING *
        `,
        [remark || null, appointmentId]
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

  if (
    !first_name || !last_name || !sex || !contact_number || !address ||
    !id_num || !department || !program || !year_level ||
    !username || !email || !password
  ) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const studentIdFile = req.files?.student_id_image?.[0];
  if (!studentIdFile) {
    return res.status(400).json({ error: "Student ID image is required" });
  }

  const student_id_image_key = studentIdFile.key;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the student
    const result = await pool.query(
      `INSERT INTO student (
        first_name, middle_name, last_name, sex, contact_number, address,
        id_num, department_id, program_id, year_level,
        username, email, password, student_id_image,
        is_class_mayor, is_verified, create_date, update_date
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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

    const studentId = result.rows[0].id;

    // Generate a verification token
    const token = crypto.randomBytes(32).toString("hex");

    // Save token to verification_tokens table
    await pool.query(
      `INSERT INTO verification_tokens (student_id, token, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [studentId, token]
    );

    // Send verification email
    await sendVerificationEmail(email, token);

    res.render('emailSentPage');

  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Server error" });
  }
});








// SAVE THE AVAILABLITY
// app.post('/counselor/availability', authenticateTokenCounselor, async (req, res) => {
//   const counselorId = req.user.user.id;
//   const selectedDays = req.body.availableDays; // Check the structure of this value

//   console.log('Selected Days:', selectedDays); // Log to debug

//   try {
//     // Clear existing availability for counselor
//     await pool.query('DELETE FROM counselor_availability WHERE counselor_id = $1', [counselorId]);

//     // Insert new availability
//     if (Array.isArray(selectedDays)) {
//       const insertPromises = selectedDays.map(day =>
//         pool.query(
//           'INSERT INTO counselor_availability (counselor_id, available_day) VALUES ($1, $2)',
//           [counselorId, day]
//         )
//       );
//       await Promise.all(insertPromises);
//     } else if (typeof selectedDays === 'string') {
//       // Handle single day case
//       await pool.query(
//         'INSERT INTO counselor_availability (counselor_id, available_day) VALUES ($1, $2)',
//         [counselorId, selectedDays]
//       );
//     }

//     res.redirect('/counselor/availability?success=true');
//   } catch (err) {
//     console.error('Error saving availability:', err);
//     res.status(500).send('Something went wrong while saving your availability.');
//   }
// });

app.post('/counselor/availability', authenticateTokenCounselor, async (req, res) => {
  const counselorId = req.user.user.id;
  const selectedDays = req.body.availableDays || [];
  const startTimes = req.body.startTime || {};
  const endTimes = req.body.endTime || {};

  console.log('Selected Days:', selectedDays);
  console.log('Start Times:', startTimes);
  console.log('End Times:', endTimes);

  try {
    // Clear existing availability for the counselor
    await pool.query('DELETE FROM counselor_availability WHERE counselor_id = $1', [counselorId]);

    // Normalize selectedDays to an array if it's a single string
    const daysArray = Array.isArray(selectedDays) ? selectedDays : [selectedDays];

    // Insert availability with time
    const insertPromises = daysArray.map(day => {
      const start = startTimes[day];
      const end = endTimes[day];

      return pool.query(
        'INSERT INTO counselor_availability (counselor_id, available_day, start_time, end_time) VALUES ($1, $2, $3, $4)',
        [counselorId, day, start, end]
      );
    });

    await Promise.all(insertPromises);

    res.redirect('/counselor/availability?success=true');
  } catch (err) {
    console.error('Error saving availability:', err);
    res.status(500).send('Something went wrong while saving your availability.');
  }
});





// FETCH
// app.get('/counselor/availability', authenticateTokenCounselor, async (req, res) => {
//   const counselorId = req.user.user.id;

//   try {
//     const result = await pool.query(
//       'SELECT available_day FROM counselor_availability WHERE counselor_id = $1',
//       [counselorId]
//     );

//     const selectedDays = result.rows.map(row => row.available_day);
//     console.log(counselorId, selectedDays)
//     res.render('counselorPages/counselor-availability', {
//       selectedDays
//     });
//   } catch (err) {
//     console.error('Error loading availability page:', err);
//     res.status(500).send('Error loading availability.');
//   }
// });

  
app.get('/counselor/availability', authenticateTokenCounselor, async (req, res) => {
  const counselorId = req.user.user.id;

  try {
    const result = await pool.query(
      'SELECT available_day, start_time, end_time FROM counselor_availability WHERE counselor_id = $1',
      [counselorId]
    );

    const selectedAvailability = {};
    result.rows.forEach(row => {
      selectedAvailability[row.available_day] = {
        start: row.start_time ? row.start_time.slice(0, 5) : '',  // Trim "HH:MM:SS" to "HH:MM"
        end: row.end_time ? row.end_time.slice(0, 5) : ''
      };
    });

    const selectedDays = Object.keys(selectedAvailability);

    res.render('counselorPages/counselor-availability', {
      selectedDays,
      selectedAvailability
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



// app.get('/psychotests', authenticateToken, async (req, res) => {
//   try {
//     const studentId = req.user.user.id;
//     const result = await pool.query(
//       `SELECT pt.*, c.first_name AS counselor_first_name, c.last_name AS counselor_last_name
//        FROM psycho_tests pt
//        JOIN counselor c ON pt.counselor_id = c.id
//        WHERE pt.student_id = $1
//        ORDER BY pt.test_date DESC`,
//       [studentId]
//     );
//     res.render('psycho-testing',{ psychoTests: result.rows, user: req.user.user });
//     //res.render('psychoTests/index', { psychoTests: result.rows });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send('Server error');
//   }
// });


// app.get('/psychotests', authenticateToken, async (req, res) => {
//   try {
//     const studentId = req.user.user.id;

//     // Fetch the student's class_id and is_class_mayor flag
//     const studentResult = await pool.query(
//       `SELECT class_id, is_class_mayor FROM student WHERE id = $1`,
//       [studentId]
//     );

//     if (studentResult.rows.length === 0) {
//       return res.status(404).send('Student not found');
//     }

//     const { class_id, is_class_mayor } = studentResult.rows[0];

//     // Fetch psycho tests associated with that class_id
//     const result = await pool.query(
//       `SELECT pt.*, c.first_name AS counselor_first_name, c.last_name AS counselor_last_name
//        FROM psycho_tests pt
//        JOIN counselor c ON pt.counselor_id = c.id
//        WHERE pt.class_id = $1
//        ORDER BY pt.test_date DESC`,
//       [class_id]
//     );

//     res.render('psycho-testing', {
//       psychoTests: result.rows,
//       user: req.user.user,
//       isClassMayor: is_class_mayor, // Pass the is_class_mayor flag
//     });
    
//   } catch (err) {
//     console.error(err);
//     res.status(500).send('Server error');
//   }
// });



app.get('/psychotests', authenticateToken, async (req, res) => {
  try {
    const studentId = req.user.user.id;

    // Fetch the student's class_id and is_class_mayor flag
    const studentResult = await pool.query(
      `SELECT class_id, is_class_mayor FROM student WHERE id = $1`,
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).send('Student not found');
    }

    const { class_id, is_class_mayor } = studentResult.rows[0];

    // Fetch all psycho tests associated with the student's class (no student_id filter)
    const result = await pool.query(
      `SELECT pt.*, c.first_name AS counselor_first_name, c.last_name AS counselor_last_name
       FROM psycho_tests pt
       JOIN counselor c ON pt.counselor_id = c.id
       WHERE pt.class_id = $1
       ORDER BY pt.test_date DESC`,
      [class_id]
    );
    console.log({
      psychoTests: result.rows,
      user: req.user.user,
      isClassMayor: is_class_mayor,
    });
    // Render the page with the psycho tests and student details
    res.render('psycho-testing', {
      psychoTests: result.rows,
      user: req.user.user,
      isClassMayor: is_class_mayor,
    });

  } catch (err) {
    console.error('Error fetching psycho tests:', err);
    res.status(500).send('Server error');
  }
});








// app.get('/classes', authenticateTokenAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(`
//       SELECT
//         c.id,
//         c.class_name,
//         c.create_date,
//         c.update_date,
//         COUNT(s.id) AS student_count
//       FROM class c
//       LEFT JOIN student s ON s.class_id = c.id
//       GROUP BY c.id
//       ORDER BY c.class_name;
//     `);

//     res.render('adminPages/classTable', { classes: result.rows, user: req.user.user });
//   } catch (err) {
//     console.error(err.message);
//     res.status(500).send('Server error');
//   }
// });


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
// app.get('/classes/:id/students', authenticateTokenAdmin, async (req, res) => {
//   const classId = req.params.id;

//   try {
//     // Get all classes (for dropdown/filtering)
//     const classResult = await pool.query(`SELECT * FROM class ORDER BY class_name ASC`);

//     // Get the selected class info
//     const selectedClassQuery = await pool.query(`SELECT * FROM class WHERE id = $1`, [classId]);
//     if (selectedClassQuery.rows.length === 0) {
//       return res.status(404).send('Class not found');
//     }

//     const selectedClass = selectedClassQuery.rows[0];

//     // Get students in that class
//     const studentResult = await pool.query(`
//       SELECT 
//         student.*, 
//         class.id AS class_id, 
//         class.class_name, 
//         class.create_date AS class_create_date, 
//         class.update_date AS class_update_date
//       FROM student 
//       LEFT JOIN class ON student.class_id = class.id
//       WHERE student.class_id = $1
//       ORDER BY student.create_date DESC
//     `, [classId]);

//     // Map student data with signed image URLs
//     const studentsWithSignedUrls = await Promise.all(
//       studentResult.rows.map(async (student) => {
//         const signedUrl = student.student_id_image
//           ? await getSignedS3Url(student.student_id_image)
//           : null;

//         const {
//           class_id,
//           class_name,
//           class_create_date,
//           class_update_date,
//           ...studentData
//         } = student;

//         return {
//           ...studentData,
//           student_id_image_url: signedUrl,
//           class: {
//             id: class_id,
//             class_name,
//             create_date: class_create_date,
//             update_date: class_update_date
//           }
//         };
//       })
//     );

//     res.render('adminPages/studentsTable', {
//       students: studentsWithSignedUrls,
//       classes: classResult.rows,
//       selectedClass, // Pass selected class if you want to highlight it in the UI
//       user: req.user.user,
//       unAssignedPage: false,
//mayorsPage: false,
//     });

//   } catch (error) {
//     console.error("Error fetching class students:", error);
//     res.status(500).send("Server error");
//   }
// });

app.get('/classes', authenticateTokenAdmin, async (req, res) => {
  try {
    const classResult = await pool.query(`
      SELECT
        c.id,
        c.class_name,
        c.program_id,
        c.create_date,
        c.update_date,
        COUNT(s.id) AS student_count,
        p.name AS program_name,
        d.name AS department_name
      FROM class c
      LEFT JOIN student s ON s.class_id = c.id
      LEFT JOIN programs p ON c.program_id = p.id
      LEFT JOIN departments d ON p.department_id = d.id
      GROUP BY c.id, p.name, d.name
      ORDER BY c.class_name;
    `);

    const programResult = await pool.query(`
      SELECT p.id, p.name AS program_name, d.name AS department_name
      FROM programs p
      LEFT JOIN departments d ON p.department_id = d.id
      ORDER BY program_name;
    `);
      console.log({
        classes: classResult.rows,
        programs: programResult.rows,
        user: req.user.user
      })
    res.render('adminPages/classTable', {
      classes: classResult.rows,
      programs: programResult.rows,
      user: req.user.user
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});




app.get('/classes/:id/students', authenticateTokenAdmin, async (req, res) => {
  const classId = req.params.id;

  try {
    // Get all classes (for filter dropdown)
    const classResult = await pool.query(`SELECT * FROM class ORDER BY class_name ASC`);

    // Check if the selected class exists
    const selectedClassQuery = await pool.query(`SELECT * FROM class WHERE id = $1`, [classId]);
    if (selectedClassQuery.rows.length === 0) {
      return res.status(404).send('Class not found');
    }
    const selectedClass = selectedClassQuery.rows[0];

    // Get all departments and programs for filter dropdowns
    const departmentResult = await pool.query(`SELECT id, name FROM departments ORDER BY name ASC`);
    const programResult = await pool.query(`SELECT id, name, department_id FROM programs ORDER BY name ASC`);

    // Fetch students for the specific class, with joined department/program info
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
      WHERE student.class_id = $1
      ORDER BY student.create_date DESC
    `, [classId]);

    // Attach signed URLs to each student
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

    // Render view with complete data
    res.render('adminPages/studentsTable', {
      students: studentsWithSignedUrls,
      classes: classResult.rows,
      departments: departmentResult.rows,
      programs: programResult.rows,
      selectedClass,
      user: req.user.user,
      unAssignedPage: false,
      mayorsPage: false,
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


// app.get('/counselors', authenticateTokenAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT 
//          id,
//          first_name,
//          middle_name,
//          last_name,
//          username,
//          email,
//          contact_number,
//          position,
//          educational_attainment,
//          is_available,
//          create_date,
//          update_date
//        FROM counselor`
//     );

//     res.render('adminPages/counselorsTable',{ counselors: result.rows, user: req.user.user });
//   } catch (err) {
//     console.error("Error fetching counselors:", err);
//     res.status(500).json({ error: "Server error fetching counselors" });
//   }
// });

// Route for Departments

app.get('/counselors', authenticateTokenAdmin, async (req, res) => {
  try {
    const [counselorResult, departmentResult] = await Promise.all([
      pool.query(`
        SELECT 
          c.id, c.first_name, c.middle_name, c.last_name, c.username, c.email,
          c.contact_number, c.position, c.educational_attainment,
          c.is_available, c.create_date, c.update_date, c.department_id,
          d.name AS department_name
        FROM counselor c
        LEFT JOIN departments d ON c.department_id = d.id
      `),
      pool.query(`SELECT id, name FROM departments`)
    ]);

    res.render('adminPages/counselorsTable', {
      counselors: counselorResult.rows,
      departments: departmentResult.rows,
      user: req.user.user
    });
  } catch (err) {
    console.error("Error fetching counselors or departments:", err);
    res.status(500).json({ error: "Server error fetching data" });
  }
});




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
         d.name AS department_name,
         p.acronym
       FROM programs p
       JOIN departments d ON p.department_id = d.id`
    );

    // Fetch departments for dropdown
    const departmentResult = await pool.query(
      `SELECT id, name FROM departments`
    );
    console.log({
      programs: programResult.rows,
      departments: departmentResult.rows,
      user: req.user.user
    })
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
    const { name, description, department_id, acronym } = req.body;

    await pool.query(
      `INSERT INTO programs (name, description, department_id, acronym) VALUES ($1, $2, $3, $4)`,
      [name, description, department_id, acronym]
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


app.post('/admin/programs/:id/edit', authenticateTokenAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, department_id, acronym } = req.body;

    await pool.query(
      `UPDATE programs SET name = $1, description = $2, department_id = $3, acronym = $4 WHERE id = $5`,
      [name, description, department_id, acronym, id]
    );

    res.redirect('/programs'); // or wherever you want to redirect after edit
  } catch (err) {
    console.error("Error editing program:", err);
    res.status(500).json({ error: "Server error updating program" });
  }
});




app.get('/getStudent/:id', authenticateTokenAdmin, async (req, res) => {
const { id } = req.params;
  console.log("GETTING STUDENTS DETAILS: ", id)
  try {
    console.log("SUasdCsda")
    const result = await pool.query(`
      SELECT 
        id,
        username,
        email,
        first_name,
        middle_name,
        last_name,
        middle_initial,
        id_num,
        sex,
        contact_number,
        address,
        year_level,
        class_id,
        is_class_mayor,
        student_id_image,
        create_date
      FROM student
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      console.log("Result length: ", result.rows.length);
      return res.status(404).json({ error: 'Student not found' });
    }
    console.log("rows:", result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching student details:', err);
    res.status(500).json({ error: 'Internal server error' });
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
    password,
    department_id, // <-- New field
  } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10); // Securely hash the password

    await pool.query(
      `INSERT INTO counselor 
        (first_name, middle_name, last_name, username, email, contact_number, position, educational_attainment, password, is_available, create_date, update_date, department_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW(), $10)`,
      [
        first_name,
        middle_name,
        last_name,
        username,
        email,
        contact_number,
        position,
        educational_attainment,
        hashedPassword,
        department_id // <-- Bind this to $10
      ]
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
    educational_attainment,
    department_id // <-- New field
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
           department_id = $9, -- Add this line
           update_date = NOW()
       WHERE id = $10`,
      [
        first_name,
        middle_name,
        last_name,
        username,
        email,
        contact_number,
        position,
        educational_attainment,
        department_id, // Bind as $9
        id              // Bind as $10
      ]
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
    // Get all class info
    const classResult = await pool.query(`SELECT * FROM class ORDER BY class_name ASC`);

    // Get all departments
    const departmentResult = await pool.query(`SELECT id, name FROM departments ORDER BY name ASC`);

    // Get all programs
    const programResult = await pool.query(`SELECT id, name, department_id FROM programs ORDER BY name ASC`);

    // Get only class mayors with class, department, and program info
    const result = await pool.query(`
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
      WHERE student.class_id IS NOT NULL AND student.is_class_mayor = TRUE
      ORDER BY student.create_date DESC
    `);

    // Attach signed image URLs
    const studentsWithSignedUrls = await Promise.all(
      result.rows.map(async (student) => {
        const signedUrl = student.student_id_image
          ? await getSignedS3Url(student.student_id_image)
          : null;

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

    // Render same template but filtered to mayors only
    res.render('adminPages/studentsTable', {
      students: studentsWithSignedUrls,
      classes: classResult.rows,
      departments: departmentResult.rows,
      programs: programResult.rows,
      user: req.user.user,
      unAssignedPage: false,
      mayorsPage: true,
    });

  } catch (error) {
    console.error("Error fetching mayors:", error);
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
      unAssignedPage: false,
      mayorsPage: false,
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


app.post('/classes/update', async (req, res) => {
  const { id, class_name, program_id } = req.body;
  console.log('Updating class:', id, class_name, program_id);

  try {
    const result = await pool.query(
      'UPDATE class SET class_name = $1, program_id = $2, update_date = CURRENT_TIMESTAMP WHERE id = $3',
      [class_name, program_id, id]
    );

    console.log('Rows affected:', result.rowCount);

    if (result.rowCount > 0) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'No class updated. ID may be incorrect.' });
    }
  } catch (err) {
    console.error('DB Error:', err);
    res.json({ success: false, message: 'Database error.' });
  }
});


// app.post('/classes/update', async (req, res) => {
//   const { id, class_name, program_id } = req.body;
//   console.log(id, class_name, program_id)
//   try {
//     await pool.query(
//       'UPDATE class SET class_name = $1, program_id = $2, update_date = CURRENT_TIMESTAMP WHERE id = $3',
//       [class_name, program_id, id]
//     );
//     res.json({ success: true });
//   } catch (err) {
//     console.error(err);
//     res.json({ success: false });
//   }
// });

// Save new class
app.post('/classes/create', async (req, res) => {
  const { class_name, program_id } = req.body;

  try {
    await pool.query(
      'INSERT INTO class (class_name, program_id) VALUES ($1, $2)',
      [class_name, program_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});




// app.post('/saveAppointment', async (req, res) => {
//     const { title, student_id, counselor_id, appointment_date, isOnlineAppointment } = req.body;

//     // Default status
//     const status = req.body.status || 'pending';

//     // Format date
//     const formattedAppointmentDate = moment(appointment_date).format('YYYY-MM-DD HH:mm:ss');
//     const todayFormatted = moment().format('YYYYMMDD');

//     // Generate 6-digit random number
//     const randomDigits = Math.floor(100000 + Math.random() * 900000); // 6-digit random number

//     // Generate appointment number
//     const appointmentNumber = `${randomDigits}${todayFormatted}${student_id}${counselor_id}`;

//     try {
//         // Insert appointment into DB
//         const result = await pool.query(
//             `INSERT INTO appointment 
//               (title, student_id, counselor_id, status, appointment_date, is_online_appointment, appointment_number, create_date, update_date)
//              VALUES 
//               ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
//              RETURNING id`,
//             [title, student_id, counselor_id, status, formattedAppointmentDate, isOnlineAppointment, appointmentNumber]
//         );

//         const appointmentId = result.rows[0].id;

//         // Log and redirect
//         console.log("Appointment created successfully");
//         res.redirect('/student-app');
//     } catch (error) {
//         console.error('Error saving appointment:', error);
//         res.status(500).json({ error: 'Internal Server Error' });
//     }
// });


app.post('/saveAppointment', authenticateToken, async (req, res) => {
  const { student_id, title, isOnlineAppointment, counselor_id, appointment_date, appointment_start_time, appointment_end_time } = req.body;
  console.log("Saving appointment:", {
    student_id,
    counselor_id,
    appointment_date,
    appointment_start_time,
    appointment_end_time,
  });

  try {
    const appointmentDay = new Date(appointment_date).toLocaleString('en-US', { weekday: 'long' });

    

    const resultStudent = await pool.query(
        `SELECT CONCAT_WS(' ', first_name, middle_name, last_name) AS full_name
        FROM student
        WHERE id = $1`,
        [student_id]
      );

    const fullName = resultStudent.rows[0]?.full_name;


    createNotification(counselor_id, "counselor", fullName + " has boooked an appointment on " 
      + appointment_date + " from " + appointment_start_time + " to " + appointment_end_time, type = "appointment")


    // 1. Get counselor availability for that day
    const availabilityQuery = `
      SELECT start_time, end_time FROM counselor_availability
      WHERE counselor_id = $1 AND available_day = $2
    `;
    const availabilityResult = await pool.query(availabilityQuery, [counselor_id, appointmentDay]);

    if (availabilityResult.rowCount === 0) {
      console.log("Counselor is not available on this day.")
      return res.status(400).json({ message: "Counselor is not available on this day." });

    }



    // Format date
    const formattedAppointmentDate = moment(appointment_date).format('YYYY-MM-DD HH:mm:ss');
    const todayFormatted = moment().format('YYYYMMDD');

    // Generate 6-digit random number
    const randomDigits = Math.floor(100000 + Math.random() * 900000); // 6-digit random number

    // Generate appointment number
    const appointmentNumber = `${randomDigits}${todayFormatted}${student_id}${counselor_id}`;

    const { start_time, end_time } = availabilityResult.rows[0];

    // 2. Ensure appointment time is within availability
    if (
      appointment_start_time < start_time ||
      appointment_end_time > end_time ||
      appointment_start_time >= appointment_end_time
    ) {
      console.log("Appointment time is outside counselor's availability.")
      return res.status(400).json({ message: "Appointment time is outside counselor's availability." });
    }

    // 3. Check for overlapping appointments
    const conflictQuery = `
      SELECT * FROM appointment
      WHERE counselor_id = $1
      AND appointment_date = $2
      AND (
        (start_time, end_time) OVERLAPS ($3::time, $4::time)
      )
    `;
    const conflictResult = await pool.query(conflictQuery, [
      counselor_id,
      appointment_date,
      appointment_start_time,
      appointment_end_time,
    ]);

    if (conflictResult.rowCount > 0) {
      console.log("This time slot is already booked.")
      return res.status(400).send({ message: "This time slot is already booked."});
    }

    // 4. Save appointment
    const insertQuery = `
      INSERT INTO appointment (
        student_id,
        counselor_id,
        appointment_date,
        start_time,
        end_time,
        title,
        is_online_appointment,
        status,
        appointment_number,
        turn_to_approve
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    await pool.query(insertQuery, [
      student_id,
      counselor_id,
      appointment_date,
      appointment_start_time,
      appointment_end_time,
      title,
      isOnlineAppointment,
      "pending",
      appointmentNumber,
      "counselor",
    ]);

    res.status(200).json({ success: true, message: 'Appointment saved successfully.' });

  } catch (err) {
    console.error('Error saving appointment:', err);
    res.status(500).send('Internal server error while saving appointment.');
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











// app.post('/admin/students/import', upload.single('csvFile'), async (req, res) => {
//   const filePath = path.join(__dirname, '..', req.file.path);
//   const students = [];

//   fs.createReadStream(filePath)
//     .pipe(csv())
//     .on('data', (row) => {
//       students.push(row);
//     })
//     .on('end', async () => {
//       try {
//         for (const student of students) {
//           await pool.query(`
//             INSERT INTO student (
//               username, password, email, first_name, middle_name, last_name,
//               middle_initial, id_num, department, program, year_level,
//               sex, contact_number, address, class_id
//             ) VALUES (
//               $1, $2, $3, $4, $5, $6,
//               $7, $8, $9, $10, $11,
//               $12, $13, $14, $15
//             )
//           `, [
//             student.username,
//             student.password,
//             student.email,
//             student.first_name,
//             student.middle_name,
//             student.last_name,
//             student.middle_initial,
//             student.id_num,
//             student.department,
//             student.program,
//             student.year_level,
//             student.sex,
//             student.contact_number,
//             student.address,
//             student.class_id
//           ]);
//         }

//         fs.unlinkSync(filePath);
//         res.send('Students imported successfully!');
//       } catch (err) {
//         console.error('Error inserting students:', err);
//         res.status(500).send('Server Error');
//       }
//     });
// });



app.post('/admin/students/import', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const students = [];

  try {
    const readable = new stream.Readable();
    readable._read = () => {}; // No-op
    readable.push(req.file.buffer);
    readable.push(null); // End of stream

    readable
      .pipe(csv())
      .on('data', (row) => {
        students.push(row);
      })
      .on('end', async () => {
        try {
          for (const student of students) {
            await pool.query(
              `INSERT INTO student (
                username, password, email, first_name, middle_name, last_name,
                is_class_mayor, class_id, create_date, update_date, student_id_image,
                id_num, middle_initial, year_level, sex, contact_number, address,
                department_id, program_id, is_verified
              ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14, $15, $16, $17,
                $18, $19, $20
              )`,
              [
                student.username,
                student.password,
                student.email,
                student.first_name,
                student.middle_name || null,
                student.last_name,
                student.is_class_mayor?.toLowerCase() === 'true',
                parseInt(student.class_id) || null,
                student.create_date || new Date(),
                student.update_date || new Date(),
                student.student_id_image,
                student.id_num,
                student.middle_initial || null,
                parseInt(student.year_level) || null,
                student.sex,
                student.contact_number,
                student.address,
                parseInt(student.department_id) || null,
                parseInt(student.program_id) || null,
                student.is_verified?.toLowerCase() === 'true'
              ]
            );
            
          }
          res.redirect('/import');
          //return res.json({ success: true, processed: students.length });
        } catch (err) {
          console.error('Error inserting students:', err);
          return res.status(500).json({ success: false, message: 'Database insert failed' });
        }
      })
      .on('error', (err) => {
        console.error('CSV parsing error:', err);
        return res.status(400).json({ success: false, message: 'Invalid CSV format' });
      });
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});




app.get("/student/verify", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send("Verification token is missing.");
  }

  try {
    // Step 1: Find the token in the database
    const tokenResult = await pool.query(
      "SELECT student_id FROM verification_tokens WHERE token = $1",
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).send("Invalid or expired verification token.");
    }

    const studentId = tokenResult.rows[0].student_id;

    // Step 2: Update the student's is_verified field
    await pool.query(
      "UPDATE student SET is_verified = true WHERE id = $1",
      [studentId]
    );

    // Step 3: Optionally, delete the used token
    await pool.query("DELETE FROM verification_tokens WHERE token = $1", [token]);

    // Step 4: Send a success response (could redirect to frontend)
    res.render('verified');
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error while verifying email.");
  }
});


// app.get('/counselor/psycho-tests', authenticateTokenCounselor, async (req, res) => {
//   try {
//     const counselorId = req.user.user.id;

//     const query = `
//       SELECT 
//         pt.*,
//         s.first_name AS student_first_name,
//         s.last_name AS student_last_name
//       FROM psycho_tests pt
//       JOIN student s ON pt.student_id = s.id
//       WHERE pt.counselor_id = $1
//       ORDER BY pt.test_date DESC
//     `;
    
//     const { rows } = await pool.query(query, [counselorId]);
    
//     res.render('counselorPages/psycho-tests-counselor', { 
//       title: 'Psychological Tests',
//       psychoTests: rows,
//       user: req.user.user, 
//     });
    
//   } catch (err) {
//     console.error('Error fetching psycho tests:', err);
//     res.status(500).send('Server Error');
//   }
// });


app.post('/psycho-tests/reschedule', async (req, res) => {
  const { test_id, new_date } = req.body;

  try {
    await pool.query(
      `UPDATE psycho_tests
       SET test_date = $1,
           turn_to_approve = 'counselor',
           updated_at = NOW()
       WHERE id = $2`,
      [new_date, test_id]
    );

    res.redirect('/psychotests'); // Adjust this path to your actual view route
  } catch (error) {
    console.error('Error rescheduling test:', error);
    res.status(500).send('Internal Server Error');
  }
});

function toIntOrNull(value) {
  const parsed = parseInt(value);
  return isNaN(parsed) ? null : parsed;
}

app.post('/admin/students/upload', upload.single('csvFile'), async (req, res) => {
  const fileRows = [];

  try {
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (row) => fileRows.push(row))
      .on('end', async () => {
        for (const student of fileRows) {
          const {
            username,
            password,
            email,
            first_name,
            middle_name,
            last_name,
            is_class_mayor,
            class_id,
            create_date,
            update_date,
            student_id_image,
            id_num,
            middle_initial,
            year_level,
            sex,
            contact_number,
            address,
            department_id,
            program_id,
            is_verified
          } = student;

          await pool.query(
            `INSERT INTO student (
              username, password, email, first_name, middle_name, last_name,
              is_class_mayor, class_id, create_date, update_date, student_id_image,
              id_num, middle_initial, year_level, sex, contact_number, address,
              department_id, program_id, is_verified
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11,
              $12, $13, $14, $15, $16, $17,
              $18, $19, $20
            )`,
            [
              username,
              password,
              email,
              first_name,
              middle_name,
              last_name,
              is_class_mayor?.toLowerCase() === 'true',
              toIntOrNull(class_id),
              create_date || new Date(),
              update_date || new Date(),
              student_id_image,
              id_num,
              middle_initial,
              toIntOrNull(year_level),
              sex,
              contact_number,
              address,
              toIntOrNull(department_id),
              toIntOrNull(program_id),
              is_verified?.toLowerCase() === 'true'
            ]
          );
          
        }

        fs.unlinkSync(req.file.path); // Delete uploaded file after processing
        res.redirect('/import');
      });
  } catch (error) {
    console.error('Error uploading student CSV:', error);
    res.status(500).send('Internal Server Error');
  }
});




app.post('/counselor/psycho-tests/:id/reschedule', async (req, res) => {
  const test_id = req.params.id;
  const { reschedule_date } = req.body; // or rename this to new_date to be consistent

  try {
    await pool.query(
      `UPDATE psycho_tests
       SET test_date = $1,
           turn_to_approve = 'student',
           updated_at = NOW()
       WHERE id = $2`,
      [reschedule_date, test_id]
    );

    res.redirect('/counselor/psycho-tests');
  } catch (error) {
    console.error('Error rescheduling test:', error);
    res.status(500).send('Internal Server Error');
  }
});

// app.get('/counselor/psycho-tests', authenticateTokenCounselor, async (req, res) => {
//   try {
//     const counselorId = req.user.user.id;

//     const query = `
//       SELECT 
//           pt.id,
//           c.class_name AS class_name,
//           pt.test_title,
//           pt.status,
//           pt.test_date,
//           pt.test_number,
//           mayor.first_name AS mayor_first_name,
//           mayor.last_name AS mayor_last_name,
//           counselor.first_name AS counselor_first_name,
//           counselor.last_name AS counselor_last_name,
//           s.first_name AS student_first_name,
//           s.last_name AS student_last_name
//       FROM psycho_tests pt
//       JOIN student s ON pt.student_id = s.id
//       JOIN counselor ON pt.counselor_id = counselor.id
//       JOIN class c ON pt.class_id = c.id
//       LEFT JOIN student AS mayor ON mayor.class_id = c.id AND mayor.is_class_mayor = true
//       WHERE pt.counselor_id = $1
//       ORDER BY pt.test_date DESC
//     `;

//     const { rows } = await pool.query(query, [counselorId]);

//     res.render('counselorPages/psycho-tests-counselor', { 
//       title: 'Psychological Tests by Class',
//       psychoTests: rows,
//       user: req.user.user,
//     });

//   } catch (err) {
//     console.error('Error fetching psycho tests:', err);
//     res.status(500).send('Server Error');
//   }
// });



app.get('/counselor/psycho-tests', authenticateTokenCounselor, async (req, res) => {
  try {
    const counselorId = req.user.user.id;

    const query = `
      SELECT 
          pt.id,
          c.class_name AS class_name,
          pt.test_title,
          pt.status,
          pt.test_date,
          pt.test_number,
          pt.turn_to_approve,
          pt.is_online_test,
          pt.remark,
          counselor.first_name AS counselor_first_name,
          counselor.last_name AS counselor_last_name
      FROM psycho_tests pt
      JOIN counselor ON pt.counselor_id = counselor.id
      JOIN class c ON pt.class_id = c.id
      WHERE pt.counselor_id = $1
      ORDER BY pt.test_date DESC
    `;

    const { rows } = await pool.query(query, [counselorId]);

    res.render('counselorPages/psycho-tests-counselor', { 
      title: 'Psychological Tests by Class',
      psychoTests: rows,
      user: req.user.user,
    });

  } catch (err) {
    console.error('Error fetching psycho tests:', err);
    res.status(500).send('Server Error');
  }
});

app.post('/psycho-tests/:id/accept', authenticateTokenCounselor, async (req, res) => {
  const testId = req.params.id;

  try {
    await pool.query(
      `UPDATE psycho_tests
       SET status = 'approved', turn_to_approve = 'student', updated_at = NOW()
       WHERE id = $1`,
      [testId]
    );

    res.redirect('/psychotests');
  } catch (error) {
    console.error('Error accepting test:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/counselor/psycho-tests/:id/accept', authenticateTokenCounselor, async (req, res) => {
  const testId = req.params.id;

  try {
    await pool.query(
      `UPDATE psycho_tests
       SET status = 'approved', turn_to_approve = 'student', updated_at = NOW()
       WHERE id = $1`,
      [testId]
    );

    res.redirect('/counselor/psycho-tests');
  } catch (error) {
    console.error('Error accepting test:', error);
    res.status(500).send('Internal Server Error');
  }
});




app.get('/psycho-tests/complete/:id', authenticateTokenCounselor, async (req, res) => {
  const testId = req.params.id;

  try {
    await pool.query(
      `UPDATE psycho_tests
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1`,
      [testId]
    );

    res.redirect('/counselor/psycho-tests'); // Redirect back to the psycho tests page
  } catch (error) {
    console.error('Error completing test:', error);
    res.status(500).send('Internal Server Error');
  }
});


app.post('/psycho-tests/:id/feedback', authenticateTokenCounselor, async (req, res) => {
  const testId = req.params.id;
  const { feedback_test_date } = req.body;

  try {
    // 1. Fetch original test
    const result = await pool.query(
      `SELECT * FROM psycho_tests WHERE id = $1`,
      [testId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Test not found.');
    }

    const test = result.rows[0];

    // 2. Check if eligible for feedback session
    if (test.status !== 'completed') {
      return res.status(400).send('Feedback can only be created for completed tests.');
    }

    if (test.already_added_new_session) {
      return res.status(400).send('Feedback session already created for this test.');
    }

    // 3. Create new test number with a unique suffix
    const feedbackTestNumber = `${test.test_number}-FB`;

    // 4. Insert feedback test
    await pool.query(
      `INSERT INTO psycho_tests 
        (test_title, student_id, counselor_id, test_date, test_number, is_online_test, status, created_at, updated_at, class_id, turn_to_approve)
       VALUES 
        ($1, $2, $3, $4, $5, $6, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7, $8)`,
      [
        test.test_title + ' - Feedback',
        test.student_id,
        test.counselor_id,
        feedback_test_date || new Date(), // fallback if not passed
        feedbackTestNumber,
        test.is_online_test,
        test.class_id,
        'student' // or whatever logic fits your system
      ]
    );

    // 5. Mark original test as already used for feedback
    await pool.query(
      `UPDATE psycho_tests SET already_added_new_session = true WHERE id = $1`,
      [testId]
    );

    res.redirect('/counselor/psycho-tests');
  } catch (error) {
    console.error('Error creating feedback test:', error);
    res.status(500).send('Server error while creating feedback test.');
  }
});








app.get('/counselor/psycho-tests/start/:id', authenticateTokenCounselor, async (req, res) => {
  try {
    const testId = req.params.id;

    const query = `
      SELECT 
        pt.*,
        s.first_name AS student_first_name,
        s.last_name AS student_last_name
      FROM psycho_tests pt
      JOIN student s ON pt.student_id = s.id
      WHERE pt.id = $1
    `;

    const { rows } = await pool.query(query, [testId]);

    if (rows.length === 0) {
      return res.status(404).send('Test not found');
    }

    res.redirect('/counselor/psycho-tests');

  } catch (err) {
    console.error('Error loading test:', err);
    res.status(500).send('Server Error');
  }
});

app.post('/counselor/psycho-tests/:id/cancel', authenticateTokenCounselor, async (req, res) => {
  const testId = req.params.id;
  const { remark } = req.body;
  try {
    await pool.query(
      `UPDATE psycho_tests
       SET status = 'cancelled', remark = $1 ,updated_at = NOW()
       WHERE id = $2`,
      [remark, testId]
    );

    res.redirect('/counselor/psycho-tests');
  } catch (error) {
    console.error('Error canceling test:', error);
    res.status(500).send('Internal Server Error');
  }
});
app.post('/psycho-tests/:id/cancel', authenticateTokenCounselor, async (req, res) => {
  const testId = req.params.id;
  const { remark } = req.body;
  try {
    await pool.query(
      `UPDATE psycho_tests
       SET status = 'cancelled', remark = $1, updated_at = NOW()
       WHERE id = $2`,
      [remark, testId]
    );

    res.redirect('/psychotests');
  } catch (error) {
    console.error('Error canceling test:', error);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/counselor/psycho-tests/cancel/:id', authenticateTokenCounselor, async (req, res) => {
  try {
    const testId = req.params.id;

    const updateQuery = `
      UPDATE psycho_tests
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;

    await pool.query(updateQuery, [testId]);

    // Redirect back to the tests page
    res.redirect('/counselor/psycho-tests');
    
  } catch (err) {
    console.error('Error cancelling psycho test:', err);
    res.status(500).send('Server Error');
  }
});



// app.get('/notifications', authenticateToken, async (req, res) => {
//   const id = req.user.user.id;
//   const role = "student";
//   try {
//     const result = await pool.query(`
//       SELECT * FROM notifications
//       WHERE user_id = $1 AND recipient_type = $2
//       ORDER BY created_at DESC
//     `, [id, role]);

//     res.render('notifications', {
//       notifications: result.rows,
//       user: req.user.user
//     });
//   } catch (err) {
//     console.error(err.message);
//     res.status(500).send('Error retrieving notifications');
//   }
// });

function formatTimeAgo(timestamp) {
  const now = new Date();
  const created = new Date(timestamp);
  const seconds = Math.floor((now - created) / 1000);

  const intervals = [
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
  }

  return 'just now';
}

const getNotificationIcon = (type) => {
  switch (type) {
    case 'message': return 'bx-message';
    case 'appointment': return 'bx-calendar';
    case 'alert': return 'bx-error';
    case 'announcement': return 'bx-bullhorn';
    default: return 'bx-bell';
  }
};

app.get('/notifications', authenticateToken, async (req, res) => {
  const id = req.user.user.id;
  const role = "student";

  try {
    const result = await pool.query(`
      SELECT * FROM notifications
      WHERE user_id = $1 AND recipient_type = $2
      ORDER BY id DESC
    `, [id, role]);

    const notifications = result.rows.map(n => ({
      ...n,
      timeAgo: formatTimeAgo(n.created_at)
    }));

    res.render('notifications', {
      notifications,
      user: req.user.user,
      getNotificationIcon
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error retrieving notifications');
  }
});


app.get('/counselor/notifications', authenticateTokenCounselor, async (req, res) => {
  const id = req.user.user.id;
  const role = "counselor";

  try {
    const result = await pool.query(`
      SELECT * FROM notifications
      WHERE user_id = $1 AND recipient_type = $2
      ORDER BY id DESC
    `, [id, role]);

    const notifications = result.rows.map(n => ({
      ...n,
      timeAgo: formatTimeAgo(n.created_at)
    }));

    res.render('counselorPages/notifications-counselor', {
      notifications,
      user: req.user.user,
      getNotificationIcon
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error retrieving notifications');
  }
});




app.get('/notifications/mark-read/:id', authenticateToken, async (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.user.id;

  try {
    await pool.query(
      `UPDATE notifications SET read_status = TRUE, updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    res.redirect('/notifications');
  } catch (err) {
    console.error('Error marking notification as read:', err.message);
    res.status(500).send('Failed to update notification.');
  }
});

app.get('/notifications/mark-unread/:id', authenticateToken, async (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.user.id;

  try {
    await pool.query(
      `UPDATE notifications SET read_status = FALSE, updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    res.redirect('/notifications');
  } catch (err) {
    console.error('Error marking notification as unread:', err.message);
    res.status(500).send('Failed to update notification.');
  }
});

app.get('/notifications/delete/:id', authenticateToken, async (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.user.id;

  try {
    await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    res.redirect('/notifications');
  } catch (err) {
    console.error('Error deleting notification:', err.message);
    res.status(500).send('Failed to delete notification.');
  }
});


  app.post('/upload-csv', upload.single('csvFile'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
  
    const filePath = req.file.path;
    console.log(`Processing file at: ${filePath}`);
  
    try {
      // Verify file exists
      await fs.access(filePath);
  
      const results = [];
      const errors = [];
  
      // Process CSV file
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            try {
              // Validate required fields
              if (!row.username || !row.password || !row.email || !row.first_name || !row.last_name) {
                errors.push(`Missing required fields in row: ${JSON.stringify(row)}`);
                return;
              }
  
              // Transform data types
              const processedRow = {
                ...row,
                is_class_mayor: row.is_class_mayor === 'TRUE',
                year_level: parseInt(row.year_level) || 1
              };
  
              results.push(processedRow);
            } catch (parseError) {
              errors.push(`Error processing row: ${parseError.message}`);
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });
  
      if (errors.length > 0) {
        console.error('CSV processing errors:', errors);
        return res.status(400).json({
          success: false,
          message: 'CSV contained errors',
          errors: errors.slice(0, 10) // Return first 10 errors
        });
      }
  
      // Insert into database
      await pool.query('BEGIN');
      
      for (const row of results) {
        try {
          const hashedPassword = await bcrypt.hash(row.password, 10);
          
          await pool.query(
            `INSERT INTO students (
              username, password, email, first_name, middle_name, last_name, 
              is_class_mayor, class_id, student_id_image, id_num, middle_initial, 
              department, program, year_level, sex, contact_number, address
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              row.username, hashedPassword, row.email, row.first_name, row.middle_name, row.last_name,
              row.is_class_mayor, row.class_id, row.student_id_image, row.id_num, row.middle_initial,
              row.department, row.program, row.year_level, row.sex, row.contact_number, row.address
            ]
          );
        } catch (dbError) {
          errors.push(`Error inserting ${row.username}: ${dbError.message}`);
        }
      }
  
      if (errors.length > 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Some records failed to import',
          errors: errors.slice(0, 10),
          successful: results.length - errors.length
        });
      }
  
      await pool.query('COMMIT');
  
      // Clean up file
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        console.error('Error deleting temp file:', cleanupError);
      }
  
      return res.json({
        success: true,
        imported: results.length,
        message: 'Students imported successfully'
      });
  
    } catch (error) {
      console.error('Upload processing error:', error);
      try {
        await pool.query('ROLLBACK');
        if (filePath) await fs.unlink(filePath).catch(console.error);
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
      
      return res.status(500).json({
        success: false,
        message: 'Error processing CSV file',
        error: error.message
      });
    }
  });
  
















app.get('/psycho-tests/approve/:id', authenticateTokenAdmin, async (req, res) => {
  const testId = req.params.id;

  try {
    const updateQuery = `
      UPDATE psycho_tests
      SET status = 'approved'
      WHERE id = $1
      RETURNING *;
    `;

    const { rows } = await pool.query(updateQuery, [testId]);

    if (rows.length === 0) {
      return res.status(404).send('Psychological test not found');
    }

    res.redirect('/admin/psycho-testing'); // or wherever you want to redirect
  } catch (err) {
    console.error('Error approving psycho test:', err);
    res.status(500).send('Server Error');
  }
});

app.get('/psycho-tests/reject/:id', authenticateTokenAdmin, async (req, res) => {
  const testId = req.params.id;

  try {
    const updateQuery = `
      UPDATE psycho_tests
      SET status = 'rejected'
      WHERE id = $1
      RETURNING *;
    `;

    const { rows } = await pool.query(updateQuery, [testId]);

    if (rows.length === 0) {
      return res.status(404).send('Psychological test not found');
    }

    res.redirect('/admin/psycho-testing'); // Adjust as needed
  } catch (err) {
    console.error('Error rejecting psycho test:', err);
    res.status(500).send('Server Error');
  }
});

app.get('/admin/check-username', async (req, res) => {
  const { username } = req.query;

  try {
    const result = await pool.query(
      'SELECT 1 FROM counselor WHERE username = $1 LIMIT 1', [username]
    );

    if (result.rows.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  } catch (err) {
    console.error('Error checking username:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/admin/check-username/edit', async (req, res) => {
  const { username, counselor_id } = req.query;

  try {
    // Query to check if the username exists, excluding the counselor being edited
    const result = await pool.query(
      'SELECT 1 FROM counselor WHERE username = $1 AND id != $2 LIMIT 1', [username, counselor_id]
    );

    if (result.rows.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  } catch (err) {
    console.error('Error checking username:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});




app.get('/import', authenticateTokenAdmin, (req,res) => {
  res.render('adminPages/importPage', {user: req.user.user});
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


app.get('/admin-summary', async (req, res) => {
  try {
    const today = moment().startOf('day').toDate();
    const thisWeek = moment().startOf('isoWeek').toDate();
    const thisMonth = moment().startOf('month').toDate();

    // Summary
    const summaryQuery = `
      SELECT
        COUNT(*) FILTER (WHERE appointment_date >= $1) AS today,
        COUNT(*) FILTER (WHERE appointment_date >= $2) AS thisWeek,
        COUNT(*) FILTER (WHERE appointment_date >= $3) AS thisMonth
      FROM appointment
      WHERE status != 'cancelled'
    `;
    const { rows: [summary] } = await pool.query(summaryQuery, [today, thisWeek, thisMonth]);

    // Per Counselor
    const counselorQuery = `
      SELECT
        c.id,
        CONCAT(c.first_name, ' ', c.last_name) AS name,
        COUNT(a.*) AS total
      FROM counselor c
      LEFT JOIN appointment a ON a.counselor_id = c.id AND a.status != 'cancelled'
      GROUP BY c.id
      ORDER BY name
    `;
    const { rows: counselorStats } = await pool.query(counselorQuery);

    // Chart data: daily counts for current week
    const dailyCounts = [];
    const dayLabels = [];
    for (let i = 0; i < 7; i++) {
      const day = moment().startOf('isoWeek').add(i, 'days');
      const start = day.startOf('day').toDate();
      const end = day.endOf('day').toDate();
      const result = await pool.query(`
        SELECT COUNT(*) FROM appointment
        WHERE appointment_date BETWEEN $1 AND $2 AND status != 'cancelled'
      `, [start, end]);
      dayLabels.push(day.format('ddd'));
      dailyCounts.push(parseInt(result.rows[0].count));
    }

    // Pie chart: counselor counts
    const counselorNames = counselorStats.map(c => c.name);
    const counselorCounts = counselorStats.map(c => parseInt(c.total));

    res.render('adminPages/admin-reports', {
      summary,
      counselorStats,
      chartData: {
        days: dayLabels,
        dailyCounts,
        counselorNames,
        counselorCounts
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load reports');
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
