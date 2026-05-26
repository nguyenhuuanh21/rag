const nodemailer = require("nodemailer");
const ejs = require('ejs');
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: process.env.MAIL_SECURE,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

module.exports = async (template,payload) => {
    const html=await ejs.renderFile(template,{payload:payload})
    const info = await transporter.sendMail({
    from: process.env.MAIL_FROM, // sender address
    to: payload.email,
    subject: payload.subject,
    html:html, // HTML body
  });
};
