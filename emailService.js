const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});



const sendVerificationEmail = async (email, token) => {
    const verificationLink = `${process.env.BASE_URL}/verify?token=${token}`;

    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email,
        subject: "Verify Your Email - RateSmart",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; background-color: #f9f9f9;">
                <h2 style="color: #333; text-align: center;">Welcome to RateSmart!</h2>
                <p style="color: #555; font-size: 16px;">You're almost there! Click the button below to verify your email and activate your account.</p>
                
                <div style="text-align: center; margin: 20px 0;">
                    <a href="${verificationLink}" style="background-color: #007bff; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-size: 16px;">Verify Email</a>
                </div>

                <p style="color: #555; font-size: 14px;">If you did not sign up for a RateSmart account, you can safely ignore this email.</p>
                
                <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                
                <p style="color: #777; font-size: 12px; text-align: center;">
                    Need help? Contact our support team at <a href="mailto:support@ratesmart.com">support@ratesmart.com</a>.
                </p>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
};

  
  module.exports = sendVerificationEmail;