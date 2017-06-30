const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');
const moment = require('moment-timezone');

let transporter;
let TZ;
let crud;

module.exports = {
    transporter,
    init,
    send: {
        creationNotice: sendBookingCreationNotice
    }
};

function init(apiKey, domain, timeZone, db) {
    const mailgunAuth = {
        auth: {
            api_key: apiKey,
            domain: domain
        }
    };

    TZ = timeZone;
    crud = db;

    transporter = nodemailer.createTransport(mg(mailgunAuth));
}

async function getAdminEmails() {
    let admins = await crud.User.findAll({
        where: {
            isAdmin: true
        }
    });

    let emails = [];

    admins.forEach(admin => emails.push(admin.email));

    return emails.join(', ');
}

function sendBookingCreationNotice(booking) {
    return new Promise(async (resolve, reject) => {

        let admins = await getAdminEmails();

        let mailOptions = {
            from: '"Car Booker" <info@piikl.com>',
            bcc: admins,
            to: (booking.user.name + ' <' + booking.user.email + '>'),
            subject: ('Confirmation: ' + booking.vehicle.name + ' for ' + booking.user.name + ' @ ' + moment.tz(booking.startTime, TZ).format('LLL')),
            text: 'This is a car booking. Nicer emails will be made in the future'
        };

        transporter.sendMail(mailOptions, (err, info) => {
            if(err)
                reject(err);
            else
                resolve(info);
        })
    });
}

