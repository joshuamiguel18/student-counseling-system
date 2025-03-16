const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const pool = require('./db')
const app = express();
const multer = require("multer");
const crypto = require("crypto");
const sendVerificationEmail = require("./emailService");


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


app.get('/dashboard', (req, res) => {
    res.render('index');
});

app.get('/verified', (req, res) => {
    res.render('verified')

});


// Routes
// Fetch and display forms
app.get("/forms", async (req, res) => {
  try {
      const result = await pool.query("SELECT * FROM forms ORDER BY id DESC");
      res.render("forms", { forms: result.rows }); // Pass data to EJS
  } catch (error) {
      console.error(error);
      res.status(500).send("Server error");
  }
});



app.get("/form/edit/:id", async (req, res) => {
  const formId = req.params.id;

  try {
      const formResult = await pool.query("SELECT * FROM forms WHERE id = $1", [formId]);
      if (formResult.rows.length === 0) return res.status(404).send("Form not found");

      const questionsResult = await pool.query(
          "SELECT * FROM form_questions WHERE form_id = $1", 
          [formId]
      );

      for (const question of questionsResult.rows) {
          const optionsResult = await pool.query(
              "SELECT * FROM form_options WHERE question_id = $1", 
              [question.id]
          );
          question.options = optionsResult.rows;
      }

      res.render("form-edit", { form: formResult.rows[0], questions: questionsResult.rows });
  } catch (error) {
      console.error("Error fetching form:", error);
      res.status(500).send("Internal Server Error");
  }
});





app.post("/form/submit/:id", async (req, res) => {
  const formId = req.params.id;
  const { questions, types, options } = req.body;

  if (!questions || !Array.isArray(questions)) {
      return res.status(400).send("Invalid form submission");
  }

  try {
      for (let i = 0; i < questions.length; i++) {
          const result = await pool.query(
              "INSERT INTO form_questions (form_id, question, type) VALUES ($1, $2, $3) RETURNING id",
              [formId, questions[i], types[i]]
          );

          const questionId = result.rows[0].id;

          if (options && options[i] && (types[i] === "radio" || types[i] === "checkbox" || types[i] === "select")) {
              for (const option of options[i]) {
                  await pool.query(
                      "INSERT INTO form_options (question_id, option_value) VALUES ($1, $2)",
                      [questionId, option]
                  );
              }
          }
      }

      res.redirect(`/form/view/${formId}`);
  } catch (error) {
      console.error("Error saving form:", error);
      res.status(500).send("Internal Server Error");
  }
});


app.get("/form/view/:id", async (req, res) => {
  const formId = req.params.id;

  try {
      // Get form details
      const formResult = await pool.query("SELECT * FROM forms WHERE id = $1", [formId]);
      const form = formResult.rows[0];

      // Get questions for this form
      const questionsResult = await pool.query("SELECT * FROM form_questions WHERE form_id = $1", [formId]);
      const questions = questionsResult.rows;

      for (let question of questions) {
          if (["radio", "checkbox", "select"].includes(question.type)) {
              const optionsResult = await pool.query("SELECT * FROM form_options WHERE question_id = $1", [question.id]);
              question.options = optionsResult.rows;
          }
      }

      res.render("form-view", { form, questions }); // Renders the view-only page
  } catch (error) {
      console.error("Error fetching form:", error);
      res.status(500).send("Internal Server Error");
  }
});




app.get("/form/edit/:id", async (req, res) => {
  const formId = req.params.id;

  try {
      // Get form details
      const formResult = await pool.query("SELECT * FROM forms WHERE id = $1", [formId]);
      const form = formResult.rows[0];

      res.render("editForm", { form });
  } catch (error) {
      console.error("Error fetching form for editing:", error);
      res.status(500).send("Internal Server Error");
  }
});





app.get("/form/answer/:id", async (req, res) => {
  const formId = req.params.id;

  try {
      // Fetch form details
      const formResult = await pool.query("SELECT * FROM forms WHERE id = $1", [formId]);
      const form = formResult.rows[0];

      // Fetch all questions for this form
      const questionsResult = await pool.query(
          "SELECT * FROM form_questions WHERE form_id = $1", 
          [formId]
      );
      const questions = questionsResult.rows;

      // Fetch options for multiple-choice, checkboxes, and dropdowns
      for (let question of questions) {
          if (["radio", "checkbox", "select"].includes(question.type)) {
              const optionsResult = await pool.query(
                  "SELECT * FROM form_options WHERE question_id = $1",
                  [question.id]
              );
              question.options = optionsResult.rows;
          }
      }

      // Render the answerable form page
      res.render("form-answer", { form, questions });
  } catch (error) {
      console.error("Error fetching form:", error);
      res.status(500).send("Internal Server Error");
  }
});











app.post("/form/edit/:id", async (req, res) => {
  const formId = req.params.id;
  const { question, type, options } = req.body;

  try {
      const questionResult = await pool.query(
          "INSERT INTO form_questions (form_id, question, type) VALUES ($1, $2, $3) RETURNING id",
          [formId, question, type]
      );

      const questionId = questionResult.rows[0].id;

      if (["radio", "checkbox", "select"].includes(type) && options) {
          const optionsArray = options.split(",").map(opt => opt.trim());
          for (const option of optionsArray) {
              await pool.query(
                  "INSERT INTO form_options (question_id, option_value) VALUES ($1, $2)",
                  [questionId, option]
              );
          }
      }

      res.redirect(`/form/view/${formId}`);
  } catch (error) {
      console.error("Error updating form:", error);
      res.status(500).send("Internal Server Error");
  }
});


app.post("/form/submit-answers/:id", async (req, res) => {
  const formId = req.params.id;
  const answers = req.body.answers; // Contains question IDs as keys

  try {
      for (const questionId in answers) {
          const answerValue = Array.isArray(answers[questionId]) 
              ? answers[questionId].join(", ") // Join multiple checkboxes
              : answers[questionId];

          await pool.query(
              "INSERT INTO form_answers (form_id, question_id, answer) VALUES ($1, $2, $3)",
              [formId, questionId, answerValue]
          );
      }

      res.redirect(`/form/view/${formId}?success=true`);
  } catch (error) {
      console.error("Error saving answers:", error);
      res.status(500).send("Internal Server Error");
  }
});


app.post("/form/submit/:id", async (req, res) => {
  const formId = req.params.id;
  const { questions, types } = req.body;

  if (!questions || !Array.isArray(questions)) {
      return res.status(400).send("Invalid form submission");
  }

  try {
      for (let i = 0; i < questions.length; i++) {
          await pool.query(
              "INSERT INTO form_questions (form_id, question, type) VALUES ($1, $2, $3)",
              [formId, questions[i], types[i]]
          );
      }

      res.redirect(`/form/view/${formId}`);
  } catch (error) {
      console.error("Error saving questions:", error);
      res.status(500).send("Internal Server Error");
  }
});




app.post('/form/save', async (req, res) => {
  try {
      const { formName, questions, types, options } = req.body;

      if (!formName || !questions || !types) {
          return res.status(400).json({ message: 'Missing required fields' });
      }

      const client = await pool.connect();

      // Insert form into `forms` table
      const formResult = await client.query(
          'INSERT INTO forms (name) VALUES ($1) RETURNING id',
          [formName]
      );
      const formId = formResult.rows[0].id;

      // Insert questions into `questions` table
      for (let i = 0; i < questions.length; i++) {
          const questionText = questions[i];
          const type = types[i];

          const questionResult = await client.query(
              'INSERT INTO questions (form_id, text, type) VALUES ($1, $2, $3) RETURNING id',
              [formId, questionText, type]
          );

          const questionId = questionResult.rows[0].id;

          // Insert options if applicable
          if (["radio", "checkbox", "select"].includes(type) && options && options[i]) {
              for (const option of options[i]) {
                  await client.query(
                      'INSERT INTO options (question_id, value) VALUES ($1, $2)',
                      [questionId, option]
                  );
              }
          }
      }

      client.release();
      res.redirect('/forms'); // Redirect back to the forms list page
  } catch (error) {
      console.error('Error saving form:', error);
      res.status(500).json({ message: 'Server error' });
  }
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



//FORMS
app.post("/form/create", async (req, res) => {
  const { formName } = req.body;

  if (!formName) {
    return res.status(400).json({ message: "Form Name is required" });
  }

  try {
    const query = "INSERT INTO forms (name) VALUES ($1) RETURNING *";
    const values = [formName];

    const result = await pool.query(query, values);
    res.redirect('/forms')
    //res.status(201).json({ message: "Form created successfully", form: result.rows[0] });
  } catch (error) {
    console.error("Error saving form:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
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
    const verification_document = req.file ? req.file.filename : "";
  
    if (!first_name || !last_name || !organization_type || !username || !email || !password) {
      return res.status(400).json({ error: "All fields are requireds" });
    }
  
    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Generate verification token
      const verificationToken = Math.random().toString(36).substring(2, 15);
  
      // Insert user into database
      const result = await pool.query(
        "INSERT INTO customerusers (first_name, middle_name, last_name, organization_name, verification_document, username, email, password, verification_token, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
        [first_name, middle_name, last_name, organization_type, verification_document, username, email, hashedPassword, verificationToken, false]
      );
  
      // Send verification email
      await sendVerificationEmail(email, verificationToken);
  
      res.json({ message: "Registration successful! Please check your email for verification." });
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
  


// Start server
const PORT = process.env.PORT || 8181;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
