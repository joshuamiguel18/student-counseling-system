const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendVerificationEmail = async (email, token) => {
  const verificationLink = `${process.env.BASE_URL}/student/verify?token=${token}`;
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: email,
    subject: "Welcome to EagleMind – Verify Your Email",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; background-color: #f4f8fb;">
        <h2 style="color: #2c3e50; text-align: center;">Welcome to EagleMind 🦅</h2>
        <p style="color: #34495e; font-size: 16px;">
          Thank you for joining <strong>EagleMind</strong>, your personal support system for student mental wellness and growth.
        </p>
        <p style="color: #34495e; font-size: 16px;">
          Please verify your email to activate your account and start exploring resources, booking appointments, and connecting with counselors.
        </p>
        
        <div style="text-align: center; margin: 25px 0;">
          <a href="${verificationLink}" style="background-color: #3498db; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-size: 16px;">Verify My Email</a>
        </div>

        <p style="color: #7f8c8d; font-size: 14px;">If you didn’t sign up for EagleMind, please ignore this email. No action is needed.</p>
        
        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
        
        <p style="color: #95a5a6; font-size: 12px; text-align: center;">
          Questions? Reach out to our support team at 
          <a href="mailto:support@eaglemind.app" style="color: #2980b9;">support@eaglemind.app</a>
        </p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendVerificationEmail;
