const {Pool} = require('pg');


// PostgreSQL configuration
const pool = new Pool({
  user: 'postgres',
  password: '123',
  database: 'pet-support',
  host: 'localhost',
  port: 5432, 
});

// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,

// });


// CREATE TABLE customer_user (
//   id SERIAL PRIMARY KEY,
//   username VARCHAR(255) NOT NULL UNIQUE,
//   password VARCHAR(255) NOT NULL,
//   email VARCHAR(255) NOT NULL UNIQUE,
//   mobile_number VARCHAR(15),
//   disabled BOOLEAN DEFAULT FALSE,
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );

// CREATE TABLE transactions (
//   id SERIAL PRIMARY KEY,
//   customer_id INT NOT NULL,
//   pet_id INT NOT NULL,
//   rider_id INT NOT NULL,
//   amount NUMERIC(10, 2) NOT NULL,
//   rating INT CHECK (rating BETWEEN 1 AND 5), -- Ratings between 1 and 5
//   comment TEXT,
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   FOREIGN KEY (customer_id) REFERENCES customer_user(id) ON DELETE CASCADE,
//   FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE,
//   FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE
// );



// CREATE TABLE pets (
//   id SERIAL PRIMARY KEY,
//   name VARCHAR(255) NOT NULL,
//   type VARCHAR(50) NOT NULL,  -- Example: Dog, Cat, Bird, etc.
//   breed VARCHAR(100),         -- Optional: Breed of the pet
//   age INT,                    -- Optional: Age of the pet
//   gender VARCHAR(10),         -- Optional: Male, Female, etc.
  
//   -- Owner's Details
//   owner_name VARCHAR(255) NOT NULL,   -- Owner's Full Name
//   owner_contact VARCHAR(20) NOT NULL, -- Owner's Contact Number
//   owner_address TEXT NOT NULL,        -- Owner's Address

//   -- Pet Documents
//   vaccination_doc VARCHAR(255),        -- File name/path for vaccination record
//   health_certificate_doc VARCHAR(255), -- File name/path for health certificate
//   ownership_certificate_doc VARCHAR(255), -- File name/path for pet ownership certificate
  
//   -- Pet Profile
//   profile_image VARCHAR(255), -- File name/path for pet profile image
  
//   customer_id INT NOT NULL,   -- Foreign key referencing customer_user
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

//   FOREIGN KEY (customer_id) REFERENCES customer_user (id)
//       ON DELETE CASCADE -- Deletes pet records if the associated customer is deleted
//       ON UPDATE CASCADE -- Updates foreign key if customer_user ID changes
// );



// CREATE TABLE otp_storage (
//   id SERIAL PRIMARY KEY, -- Auto-incrementing unique ID
//   username VARCHAR(255) NOT NULL, -- Username associated with the OTP
//   otp VARCHAR(6) NOT NULL, -- OTP code (6 characters)
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Timestamp when the OTP was created
//   expires_at TIMESTAMP  -- Expiration time for the OTP
// );

// CREATE TABLE admin_users (
//   id SERIAL PRIMARY KEY,
//   username VARCHAR(255) UNIQUE NOT NULL,
//   email VARCHAR(255) UNIQUE NOT NULL,
//   password TEXT NOT NULL,
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );




// CREATE TABLE riders (
//   id SERIAL PRIMARY KEY,
//   username VARCHAR(255) NOT NULL UNIQUE,
//   password VARCHAR(255) NOT NULL,
//   email VARCHAR(255) NOT NULL UNIQUE,
//   mobile_number VARCHAR(15) NOT NULL,
//   is_verified BOOLEAN DEFAULT FALSE,
//   disabled BOOLEAN DEFAULT FALSE,
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );



module.exports = pool;