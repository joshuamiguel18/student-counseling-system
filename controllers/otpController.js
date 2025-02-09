const twilio = require('twilio');

// Replace these with your Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;  // Replace with your Twilio Account SID
const authToken = process.env.TWILIO_AUTH_TOKEN;    // Replace with your Twilio Auth Token
exports.client = twilio(accountSid, authToken);

