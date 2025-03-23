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


// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//       cb(null, "uploads/");
//     },
//     filename: (req, file, cb) => {
//       cb(null, Date.now() + "-" + file.originalname);
//     },
//   });
const storage = multer.memoryStorage();
const upload = multer({ storage });




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


// GO TO VIEW FORM EDIT WITH SPECIFIC ID
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

// SUBMIT QUESTIONS
app.post("/form/submit/:id", async (req, res) => {
    const formId = req.params.id;
    const { questions, types, options, scale_min, scale_max, rating_max, date, time, grid_rows, grid_columns } = req.body;

    if (!questions || !Array.isArray(questions)) {
        return res.status(400).send("Invalid form submission");
    }

    try {
        for (let i = 0; i < questions.length; i++) {
            // Insert question into the database
            const result = await pool.query(
                "INSERT INTO form_questions (form_id, question, type) VALUES ($1, $2, $3) RETURNING id",
                [formId, questions[i], types[i]]
            );

            const questionId = result.rows[0].id;

            // Handle different field types
            if (options && options[i] && ["radio", "checkbox", "select"].includes(types[i])) {
                // Insert options for multiple choice, checkboxes, or dropdown
                for (const option of options[i]) {
                    await pool.query(
                        "INSERT INTO form_options (question_id, option_value) VALUES ($1, $2)",
                        [questionId, option]
                    );
                }
            } else if (types[i] === "scale") {
                // Insert scale range
                await pool.query(
                    "INSERT INTO form_scale (question_id, min_value, max_value) VALUES ($1, $2, $3)",
                    [questionId, scale_min[i], scale_max[i]]
                );
            } else if (types[i] === "rating") {
                // Insert max rating
                await pool.query(
                    "INSERT INTO form_rating (question_id, max_stars) VALUES ($1, $2)",
                    [questionId, rating_max[i]]
                );
            } else if (types[i] === "date") {
                // Insert date type
                await pool.query(
                    "INSERT INTO form_date (question_id, default_value) VALUES ($1, $2)",
                    [questionId, date[i] || null]
                );
            } else if (types[i] === "time") {
                // Insert time type
                await pool.query(
                    "INSERT INTO form_time (question_id, default_value) VALUES ($1, $2)",
                    [questionId, time[i] || null]
                );
            } else if (types[i] === "grid") {
                // Insert grid rows and columns
                if (grid_rows[i] && grid_columns[i]) {
                    const rows = grid_rows[i].split(",");
                    const columns = grid_columns[i].split(",");

                    for (const row of rows) {
                        for (const column of columns) {
                            await pool.query(
                                "INSERT INTO form_grid (question_id, row_value, column_value) VALUES ($1, $2, $3)",
                                [questionId, row.trim(), column.trim()]
                            );
                        }
                    }
                }
            }
        }

        res.redirect(`/form/view/${formId}`);
    } catch (error) {
        console.error("Error saving form:", error);
        res.status(500).send("Internal Server Error");
    }
});


// LET THE ADMIN VIEW THE QUESTION ADDED TO A FORM
app.get("/form/view/:id", async (req, res) => {
    const formId = req.params.id;

    try {
        // Get form details
        const formResult = await pool.query("SELECT * FROM forms WHERE id = $1", [formId]);
        const form = formResult.rows[0];

        if (!form) {
            return res.status(404).send("Form not found");
        }

        // Get questions for this form
        const questionsResult = await pool.query("SELECT * FROM form_questions WHERE form_id = $1", [formId]);
        const questions = questionsResult.rows;

        for (let question of questions) {
            switch (question.type) {
                case "radio":
                case "checkbox":
                case "select":
                    // Fetch options for multiple choice, checkboxes, or dropdown
                    const optionsResult = await pool.query("SELECT * FROM form_options WHERE question_id = $1", [question.id]);
                    question.options = optionsResult.rows;
                    break;

                case "scale":
                    // Fetch scale range
                    const scaleResult = await pool.query("SELECT * FROM form_scale WHERE question_id = $1", [question.id]);
                    question.scale = scaleResult.rows[0]; // Expecting a single result
                    break;

                case "rating":
                    // Fetch max rating value
                    const ratingResult = await pool.query("SELECT * FROM form_rating WHERE question_id = $1", [question.id]);
                    question.rating = ratingResult.rows[0]; // Expecting a single result
                    break;

                case "date":
                    // Fetch default date value
                    const dateResult = await pool.query("SELECT * FROM form_date WHERE question_id = $1", [question.id]);
                    question.date = dateResult.rows[0]; // Expecting a single result
                    break;

                case "time":
                    // Fetch default time value
                    const timeResult = await pool.query("SELECT * FROM form_time WHERE question_id = $1", [question.id]);
                    question.time = timeResult.rows[0]; // Expecting a single result
                    break;

                case "grid":
                    // Fetch grid rows and columns
                    const gridResult = await pool.query("SELECT * FROM form_grid WHERE question_id = $1", [question.id]);
                    question.grid = gridResult.rows;
                    break;
            }
        }

        // Render the form view page
        res.render("form-view", { form, questions });
    } catch (error) {
        console.error("Error fetching form:", error);
        res.status(500).send("Internal Server Error");
    }
});




// VIEW TO ANSWER FORM
app.get("/form/answer/:id", async (req, res) => {
    const formId = req.params.id;

    try {
        // Fetch form details
        const formResult = await pool.query("SELECT * FROM forms WHERE id = $1", [formId]);

        if (formResult.rows.length === 0) {
            return res.status(404).send("Form not found");
        }

        const form = formResult.rows[0];
        console.log("Form Details:", form); // Log form details

        // Fetch all questions for this form
        const questionsResult = await pool.query(
            "SELECT * FROM form_questions WHERE form_id = $1 ORDER BY id ASC", 
            [formId]
        );

        const questions = questionsResult.rows;
        const questionIds = questions.map(q => q.id);

        console.log("Questions Fetched:", JSON.stringify(questions, null, 2)); // Log all questions
        console.log("Question IDs:", questionIds); // Log question IDs

        if (questionIds.length > 0) {
            // Fetch options for multiple-choice, checkboxes, and dropdowns
            const optionsResult = await pool.query(
                "SELECT * FROM form_options WHERE question_id = ANY($1::int[])",
                [questionIds]
            );

            // Fetch scale range
            const scaleResult = await pool.query(
                "SELECT * FROM form_scale WHERE question_id = ANY($1::int[])",
                [questionIds]
            );

            // Fetch rating max value
            const ratingResult = await pool.query(
                "SELECT * FROM form_rating WHERE question_id = ANY($1::int[])",
                [questionIds]
            );

            // Fetch date defaults
            const dateResult = await pool.query(
                "SELECT * FROM form_date WHERE question_id = ANY($1::int[])",
                [questionIds]
            );

            // Fetch time defaults
            const timeResult = await pool.query(
                "SELECT * FROM form_time WHERE question_id = ANY($1::int[])",
                [questionIds]
            );

            // Fetch grid rows and columns
            const gridResult = await pool.query(
                "SELECT * FROM form_grid WHERE question_id = ANY($1::int[])",
                [questionIds]
            );

            // Group data by question_id
            const optionsMap = {}, scaleMap = {}, ratingMap = {}, dateMap = {}, timeMap = {}, gridMap = {};

            optionsResult.rows.forEach(opt => {
                if (!optionsMap[opt.question_id]) optionsMap[opt.question_id] = [];
                optionsMap[opt.question_id].push(opt);
            });

            scaleResult.rows.forEach(s => { scaleMap[s.question_id] = s; });
            ratingResult.rows.forEach(r => { 
                ratingMap[r.question_id] = r.max_stars || 5;  // Ensure default value of 5
            });
            
            dateResult.rows.forEach(d => { dateMap[d.question_id] = d; });
            timeResult.rows.forEach(t => { timeMap[t.question_id] = t; });

            gridResult.rows.forEach(g => {
                if (!gridMap[g.question_id]) gridMap[g.question_id] = [];
                gridMap[g.question_id].push(g);
            });

            // Assign data to questions
            questions.forEach(q => {
                if (["radio", "checkbox", "select"].includes(q.type)) {
                    q.options = optionsMap[q.id] || [];
                    console.log(`Options for Question ID ${q.id}:`, q.options); // Log options for each question
                } else if (q.type === "scale") {
                    q.scale = scaleMap[q.id] || { min_value: 1, max_value: 10 };
                    console.log(`Scale for Question ID ${q.id}:`, q.scale); // Log scale for each question
                } else if (q.type === "rating") {
                    q.rating = ratingMap[q.id] || 5; // Default to 5 if no database value
                    console.log(`Rating for Question ID ${q.id}:`, q.rating); // Log rating for each question
                } else if (q.type === "date") {
                    q.date = dateMap[q.id] || { default_value: null };
                    console.log(`Date for Question ID ${q.id}:`, q.date); // Log date for each question
                } else if (q.type === "time") {
                    q.time = timeMap[q.id] || { default_value: null };
                    console.log(`Time for Question ID ${q.id}:`, q.time); // Log time for each question
                } else if (q.type === "grid") {
                    q.grid = gridMap[q.id] || [];
                    console.log(`Grid for Question ID ${q.id}:`, q.grid); // Log grid for each question
                }
            });
        }

        // Render the answerable form page
        console.log("Final Questions Data:", JSON.stringify(questions, null, 2)); // Log final questions data
        res.render("form-answer", { form, questions });
    } catch (error) {
        console.error("Error fetching form:", error);
        res.status(500).send("Internal Server Error");
    }
});




app.post("/form/edit/:id", async (req, res) => {
  const formId = req.params.id;
  const { question, type, options } = req.body;
    console.log("OPTIONS", options);
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
    const answers = req.body.answers; // Array of objects with question_id and answer
    const userId = 1; // Replace with actual user session management

    console.log("📨 Submitting answers for Form ID:", formId);
    console.log("Received Answers:", JSON.stringify(answers, null, 2)); // Log the answers array

    try {
        // Check if the form exists
        const formCheck = await pool.query("SELECT id FROM forms WHERE id = $1", [formId]);
        if (formCheck.rows.length === 0) {
            console.log("❌ Form not found, ID:", formId);
            return res.status(404).json({ error: "Form not found" });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN"); // Start transaction

            for (const answerData of answers) {
                const questionId = answerData.question_id; // Extract question_id
                let answerValue = answerData.answer; // Extract answer

                console.log(`Processing Question ID: ${questionId} with Answer:`, answerValue);

                // Validate question ID exists in `form_questions`
                const questionCheck = await client.query(
                    "SELECT id, type FROM form_questions WHERE id = $1 AND form_id = $2",
                    [questionId, formId]
                );

                if (questionCheck.rows.length === 0) {
                    console.log(`⚠️ Skipping invalid question_id: ${questionId}. No matching question found.`);
                    continue; // Skip invalid question_id
                }

                const questionType = questionCheck.rows[0].type;
                console.log(`✅ Valid Question ID: ${questionId} | Type: ${questionType}`);

                // Handle different question types
                if (Array.isArray(answerValue)) {
                    answerValue = answerValue.join(", "); // Convert multiple selections to a comma-separated string
                }

                // Handle rating, scale, date, and time as numeric values
                if (["rating", "scale"].includes(questionType)) {
                    answerValue = parseInt(answerValue, 10); // Ensure integer values
                }

                if (["date", "time"].includes(questionType)) {
                    answerValue = answerValue.trim(); // Ensure proper formatting
                }

                // Handle grid responses separately
                if (questionType === "grid" && typeof answerValue === "object" && answerValue !== null) {
                    for (const row in answerValue) {
                        console.log(`📊 Inserting grid answer for Question ID: ${questionId}, Row: ${row}, Answer: ${answerValue[row]}`);
                        await client.query(
                            "INSERT INTO form_answers (form_id, question_id, user_id, answer, row_id) VALUES ($1, $2, $3, $4, $5)",
                            [formId, questionId, userId, answerValue[row], row]
                        );
                    }
                    continue; // Skip general insert for this question
                }

                // Insert answer into form_answers table
                console.log(`💾 Inserting Answer: Question ID: ${questionId}, Answer: ${answerValue}`);
                await client.query(
                    "INSERT INTO form_answers (form_id, question_id, user_id, answer) VALUES ($1, $2, $3, $4)",
                    [formId, questionId, userId, answerValue]
                );
            }

            await client.query("COMMIT"); // Commit transaction
            console.log("✅ Successfully saved answers for Form ID:", formId);
            res.redirect(`/form/view/${formId}?success=true`);
        } catch (error) {
            await client.query("ROLLBACK"); // Rollback if an error occurs
            console.error("❌ Error saving answers, rolling back transaction:", error);
            res.status(500).send("Internal Server Error");
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("❌ Error processing answers:", error);
        res.status(500).send("Internal Server Error");
    }
});






app.post("/form/submit/:id", async (req, res) => {
    const formId = req.params.id;
    const { questions, types, options, rating_max, scale_min, scale_max, grid_rows, grid_columns } = req.body;

    if (!questions || !Array.isArray(questions)) {
        return res.status(400).send("Invalid form submission");
    }

    try {
        const client = await pool.connect();
        await client.query("BEGIN"); // Start a transaction

        for (let i = 0; i < questions.length; i++) {
            const questionText = questions[i];
            const questionType = types[i];

            // Insert question into `form_questions`
            const questionResult = await client.query(
                "INSERT INTO form_questions (form_id, question, type) VALUES ($1, $2, $3) RETURNING id",
                [formId, questionText, questionType]
            );

            const questionId = questionResult.rows[0].id;

            // Handle multiple-choice options
            if (["radio", "checkbox", "select"].includes(questionType) && options && options[i]) {
                let optionValues = options[i];

                // Convert string to array if needed
                if (typeof optionValues === "string") {
                    optionValues = optionValues.split(",").map(opt => opt.trim());
                }

                // Insert each option
                for (const option of optionValues) {
                    await client.query(
                        "INSERT INTO form_options (question_id, option_value) VALUES ($1, $2)",
                        [questionId, option]
                    );
                }
            }

            // Handle rating type
            if (questionType === "rating") {
                const maxStars = rating_max && rating_max[i] ? parseInt(rating_max[i]) : 5; // Default to 5
                await client.query(
                    "INSERT INTO form_rating (question_id, max_stars) VALUES ($1, $2)",
                    [questionId, maxStars]
                );
            }

            // Handle scale (slider) type
            if (questionType === "scale") {
                const minVal = scale_min && scale_min[i] ? parseInt(scale_min[i]) : 1; // Default min = 1
                const maxVal = scale_max && scale_max[i] ? parseInt(scale_max[i]) : 10; // Default max = 10
                await client.query(
                    "INSERT INTO form_scale (question_id, min_value, max_value) VALUES ($1, $2, $3)",
                    [questionId, minVal, maxVal]
                );
            }

            // Handle grid (matrix) type
            if (questionType === "grid") {
                let rowValues = grid_rows[i] ? grid_rows[i].split(",").map(row => row.trim()) : [];
                let colValues = grid_columns[i] ? grid_columns[i].split(",").map(col => col.trim()) : [];

                for (const row of rowValues) {
                    for (const col of colValues) {
                        await client.query(
                            "INSERT INTO form_grid (question_id, row_label, column_label) VALUES ($1, $2, $3)",
                            [questionId, row, col]
                        );
                    }
                }
            }
        }

        await client.query("COMMIT"); // Commit the transaction
        res.redirect(`/form/view/${formId}`);
    } catch (error) {
        await pool.query("ROLLBACK"); // Rollback in case of failure
        console.error("Error saving form:", error);
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


app.get("/form/analytics/:id", async (req, res) => {
    const formId = req.params.id;

    try {
        console.log(`📊 Fetching analytics for form ID: ${formId}`);

        // Get form details
        const formResult = await pool.query("SELECT * FROM forms WHERE id = $1", [formId]);
        if (formResult.rows.length === 0) {
            console.log("❌ Form not found.");
            return res.status(404).send("Form not found");
        }
        const form = formResult.rows[0];

        // Get questions
        const questionsResult = await pool.query(
            "SELECT * FROM form_questions WHERE form_id = $1 ORDER BY id ASC",
            [formId]
        );
        const questions = questionsResult.rows;

        console.log("📝 Questions:", questions);

        for (let question of questions) {
            console.log(`🔍 Fetching analytics for Question ID: ${question.id}, Type: ${question.type}`);

            if (["radio", "checkbox", "select"].includes(question.type)) {
                // Count responses for multiple-choice questions
                const answersResult = await pool.query(
                    `SELECT answer, COUNT(*) as count 
                     FROM form_answers WHERE question_id = $1 
                     GROUP BY answer ORDER BY count DESC`,
                    [question.id]
                );
                question.analytics = answersResult.rows || [];

            } else if (question.type === "rating") {
                // Get rating distribution
                const ratingResult = await pool.query(
                    `SELECT answer, COUNT(*) as count 
                     FROM form_answers WHERE question_id = $1 
                     GROUP BY answer ORDER BY answer ASC`,
                    [question.id]
                );
                question.analytics = ratingResult.rows || [];

                // Calculate average rating
                const avgRatingResult = await pool.query(
                    `SELECT COALESCE(AVG(answer::int), 0) as avg_rating 
                     FROM form_answers WHERE question_id = $1`,
                    [question.id]
                );
                question.avg_rating = parseFloat(avgRatingResult.rows[0].avg_rating || 0).toFixed(2);

            } else if (question.type === "scale") {
                // Get min and max scale values
                const scaleResult = await pool.query(
                    `SELECT min_value, max_value FROM form_scale WHERE question_id = $1`,
                    [question.id]
                );
                question.scale = scaleResult.rows[0] || { min_value: 1, max_value: 10 };

            } else if (question.type === "grid") {
                // Corrected query: Join form_answers with form_grid to get row/column labels
                const gridResult = await pool.query(
                    `SELECT fg.row_value AS row_label, fg.column_value AS column_label, COUNT(fa.answer) as count
                     FROM form_answers fa
                     JOIN form_grid fg ON fa.row_id = fg.id
                     WHERE fa.question_id = $1
                     GROUP BY fg.row_value, fg.column_value
                     ORDER BY count DESC`,
                    [question.id]
                );
                question.analytics = gridResult.rows || [];
            }
             else if (["text", "textarea"].includes(question.type)) {
                // Count occurrences of identical short/long text responses
                const textResult = await pool.query(
                    `SELECT answer, COUNT(*) as count 
                     FROM form_answers WHERE question_id = $1 
                     GROUP BY answer ORDER BY count DESC`,
                    [question.id]
                );
                question.analytics = textResult.rows || [];
            }
        }

        console.log("✅ Final Data Sent to Frontend:", { form, questions });
        res.render("form-analytics", { form, questions });
    } catch (error) {
        console.error("❌ Error fetching analytics:", error);
        res.status(500).send("Internal Server Error");
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

    try {
        const result = await pool.query('SELECT * FROM customerusers WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            return res.render('customerLogin', { error: 'Invalid username or password', username });
        }

        const user = result.rows[0];

        // Check if the user is verified
        if (!user.is_verified) {
            return res.render('customerLogin', { error: 'Please verify your email before logging in.', username });
        }

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
    const verification_document = req.file ? req.file.originalname : "";  // Just save the filename

    if (!first_name || !last_name || !organization_type || !username || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
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
        res.render('emailSent', { email: email})
        //res.json({ message: "Registration successful! Please check your email for verification." });
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
