const sgMail = require('@sendgrid/mail');
const ejs = require('ejs');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async (template, payload) => {
  try {
    const html = await ejs.renderFile(template, { payload: payload });

    const msg = {
      to: payload.email,
      from: {
        name: process.env.MAIL_FROM_NAME || "SoTaySinhVien",
        email: process.env.MAIL_FROM
      },
      subject: payload.subject,
      html: html,
    };

    const info = await sgMail.send(msg);
    return info;

  } catch (error) {
    console.error("Lỗi khi gửi email qua SendGrid:", error);
    if (error.response) {
      console.error(error.response.body);
    }
    throw error;
  }
};