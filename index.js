const PORT = 80;
const TZ = 'America/Winnipeg';
const MAILGUN_API_KEY = 'key-74a852390f4b035e5b486433519d326a';
const MAILGUN_DOMAIN = 'mail.piikl.com';
const GOOGLE_CLIENT_ID = '801316837381-7d1vd6bi6v3c2do02tdqlis0i5b7dsdi.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'IgJsH0JuizQLXxrrTQEWGU0x';
const GOOGLE_REDIRECT_URL = 'http://localhost/auth';
const PROD_REDIRECT_URL = 'https://booker.luigi.piikl.com/auth';

// Import modules
const express = require('express');
const app = express();
const serveStatic = require('serve-static');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqstore = require('connect-sqlite3')(session);
const moment = require('moment-timezone');
const Promise = require('bluebird');
const db2 = require('sqlite');
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');
const fs = require('fs');
const ical = require('ical-generator');
const localizer = require('./localizer');

const google = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const people = google.people('v1');
const calendar = google.calendar('v3');

let prod = process.argv[2] === 'prod';

let oauth2Client = new OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    prod ? PROD_REDIRECT_URL : GOOGLE_REDIRECT_URL
);

google.options({
    auth: oauth2Client
});

const mailgunAuth = {
    auth: {
        api_key: MAILGUN_API_KEY,
        domain: MAILGUN_DOMAIN
    }
};

const mailTransporter = nodemailer.createTransport(mg(mailgunAuth));

// Load lacales
Promise.resolve(localizer.load()).then(langs => console.log('[Loaded %s locales]', Object.keys(langs).length));

Promise.resolve()
    .then(() => db2.open('./cars.db', { Promise }))
    .then(() => initDatabase())
    .then(() => console.log('[Database initialized]'))
    .catch(err => console.error(err));

// set settings
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

// tell the app to serve static files from the dist directory
app.use(serveStatic(path.join(__dirname, 'dist')));

// allow the app to parse urlencoded POST requests
app.use(bodyParser.urlencoded({extended: true}));

// setup the session manager
app.use(session({
    secret: 'secret',
    resave: true,
    store: new sqstore({table: 'sessions', dir: '.'}),
    saveUninitialized: true,
    cookie: { }
}));

// all of these variables will be available in the templates
app.locals = {
    moment,
    GOOGLE_CLIENT_ID,
    TZ,
    genAuthUrl() {
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/user.emails.read',
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/calendar'
            ]
        });
    }
};

// authenticate
// make sure user data is cached
app.use(async (req, res, next) => {
    res.locals.sess = req.session;

    if(req.session.tokens !== undefined && req.session.userCache === undefined) {
        oauth2Client.setCredentials(req.session.tokens);

        // cache name data
        people.people.get({resourceName: 'people/me', personFields: 'names,emailAddresses'}, async (err, person) => {
            if(err) {
                console.log(err);
                res.send('there was an error! <br/><pre>' + JSON.stringify(err) + '</pre>' );
            } else {
                req.session.userCache = {
                    name: person.names[0].displayName,
                    resourceName: person.resourceName,
                    email: person.emailAddresses[0].value
                };

                const usr = await Promise.resolve(db2.get('SELECT email, name FROM users WHERE resource_name = ? OR email = ?', req.session.userCache.resourceName, req.session.userCache.email));

                if(usr === undefined) {
                    const res = await Promise.resolve(
                        db2.prepare('INSERT INTO users (resource_name, email, name, is_admin) VALUES (?, ?, ?, ?)'))
                        .then(stmt => stmt.run([person.resourceName, person.emailAddresses[0].value, person.names[0].displayName, false]));

                    console.log('[User %s (%s) logged in for the first time]',
                        person.names[0].displayName, person.emailAddresses[0].value);

                    next();
                } else {
                    req.session.user = await getUser(req.session.userCache.resourceName);
                    next();
                }
            }
        });
    } else if(req.session.tokens !== undefined) {
        req.session.user = await getUser(req.session.userCache.resourceName);
        next();
    } else {
        next();
    }

    async function getUser(resourceName) {
        return await Promise.resolve(db2.get('SELECT resource_name, email, name, is_admin FROM users WHERE resource_name = ?', resourceName));
    }
});

// Make sure user is logged in
app.use((req, res, next) => {
    const publicPaths = ['/', '/auth', '/setlang', '/form'];
    const authPaths = ['/dash', '/no_cars', '/booking_proposal', '/accept_booking', '/logout', '/create_booking', '/booking', '/request_perms'];
    const adminPaths = ['/admin', '/revoke_admin', '/grant_admin', '/add_vehicle', '/edit_vehicle', '/vehicles'];

    let contains = (arr, value) => {
        let c = false;

        arr.forEach(e => {
            if(value.includes(e))
                c = true;
        });

        return c;
    };
    let eq = (arr, value) => {
        let c = false;

        arr.forEach(e => {
            if(e === value)
                c = true;
        });

        return c;
    };

    if(req.session.language === undefined) {
        req.session.language = 'english';
    }

    res.locals.lang = localizer.lang(req.session.language);

    let publicPage = eq(publicPaths, req.path);
    let authPage = contains(authPaths, req.path) && !publicPage;
    let adminPage = contains(adminPaths, req.path);

    res.locals.adminPage = adminPage;

    if(!publicPage && req.session.tokens === undefined) {
        res.render('please_sign_in');
    } else if (adminPage && !req.session.user.is_admin) {
        res.render('no_perms');
    } else {
        next();
    }
});

app.get('/', function (req, res) {
    if(req.session.tokens !== undefined) {
        res.redirect('/dash');
    } else {
        res.render('index');
    }
});

app.post('/form', async (req, res) => {
    frm.handle(req, {
        success() {
            console.log('success!');
        },
        other(form) {
            res.render('frm', { formHtml: form.toHTML() })
        }
    })
});

app.get('/setlang/:lang', (req, res) => {

    let lang = req.params.lang;

    if(lang !== 'english' || lang !== 'french')
        lang = 'english';

    req.session.language = req.params.lang;

    let backUrl = req.header('Referer') || '/';
    res.redirect(backUrl);
});

app.get('/calendar', async (req, res) => {
    let calendar = google.calendar('v3');

    oauth2Client.setCredentials(req.session.tokens);

    calendar.events.list({
        calendarId: 'primary',
        timeMin: (new Date()).toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime'
    }, (err, response) => {
        if(err) {
            console.log(err);
        } else {
            console.log(response);
            let events = response.items;
        }

        res.send('ok');
    });
});

app.get('/dash', async (req, res) => {
    if(req.session.tokens !== undefined) {
        const bookings = await Promise.resolve(db2.prepare('SELECT bookings.rowid AS id, users.name AS name, function, num_of_people AS numPeople, start_time AS startTime, return_time AS returnTime, reason, notes, vehicle FROM bookings JOIN users ON bookings.user = users.resource_name WHERE start_time > ? OR return_time > ? ORDER BY start_time, return_time ASC'))
            .then(stmt => stmt.all([moment().tz(TZ).unix(), moment().tz(TZ).unix()]));

        for (let booking of bookings) {

            booking.startTime = moment(booking.startTime).tz(TZ);
            booking.returnTime = moment(booking.returnTime).tz(TZ);

            booking.vehicle = await Promise.resolve(db2.prepare('SELECT vid, name, type, num_seats AS numSeats, notes FROM vehicles WHERE vid = ?'))
                .then(stmt => stmt.get([booking.vehicle]));
        }

        res.render('dash', {bookings});
    }
});

app.get('/no_cars', async (req, res) => {
    if(req.session.bookingRequest === undefined) {
        res.send('no booking request exists!');
    } else {
        res.render('no_cars', { booking: req.session.bookingRequest });
    }
});

app.get('/booking_proposal', async (req, res) => {
    if(req.session.proposedBooking === undefined) {
        res.redirect('/dash');
    } else {
        res.render('booking_proposal', { booking: req.session.proposedBooking });
    }
});

app.get('/accept_booking', async (req, res) => {
    if(req.session.proposedBooking === undefined) {
        res.send('You do not have a booking proposal to accept!');
    } else {
        let booking = req.session.proposedBooking;

        let valid = await Promise.resolve(processBooking(booking));

        if(valid.valid) {

            let result = await Promise.resolve(saveBooking(booking));
            let bookingId = result.stmt.lastID;

            //sendEmail(booking, req.session.user.email);

            createCalendarEvent(booking, req.session.tokens, async (err, cal) => {
                if(err) {
                    console.log(err);
                } else {
                    let r = await Promise.resolve(db2.run('UPDATE bookings SET calendarId = ? WHERE rowid = ?', cal.id, bookingId));

                    console.log('[Successfully added booking for %s to their calendar. id %s]',
                        req.session.user.email, cal.id)
                }

                delete req.session.proposedBooking;
                delete req.session.bookingRequest;

                console.log('[User %s (%s) Created a booking for %s from %s to %s]',
                    req.session.user.name, req.session.user.email,
                    booking.vehicle.name, booking.pickup, booking.return);

                res.redirect('/dash');
            });
        } else {
            res.send('You took too long to accept this booking, it is no longer valid!');
        }
    }
});

app.get('/auth', (req, res) => {
    if(req.session.tokens !== undefined) {
        res.redirect('/');
    } else {
        getTokens(req.query.code, (err, tokens) => {
            if(err) {
                res.send(JSON.stringify(err));
            } else {
                req.session.tokens = tokens;
                res.redirect('/');
            }
        });
    }
});

app.get('/logout', async (req, res) => {
    delete req.session.tokens;
    delete req.session.userCache;

    res.redirect('/');
});

app.get('/create_booking', (req, res) => {
    res.render('create_booking', { bookingRequest: req.session.bookingRequest || {}, validation: {} });
});

app.post('/create_booking', async (req, res) => {
    delete req.session.proposedBooking;

    let booking = req.session.bookingRequest = req.body;
    booking.user = req.session.userCache.resourceName;
    
    let validation = basicBookingValidation(booking);

    if(validation.valid) {
        let result = await Promise.resolve(processBooking(booking));

        if (result.valid) {
            req.session.proposedBooking = result.proposedBooking;
            res.redirect('/booking_proposal');
        } else {
            res.redirect('/no_cars');
        }
    } else {
        res.render('create_booking', { bookingRequest: req.session.bookingRequest || {}, validation })
    }
});

app.get('/vehicles', async (req, res) => {
    const vehicles = await Promise.resolve(
        db2.all('SELECT vid, name, type, num_seats AS numSeats, notes FROM vehicles')
    );

    res.render('cars', { vehicles });
});

app.get('/add_vehicle', (req, res) => {
    req.session.operation = 'create';
    res.render('vehicle_CU', {validation: {}, input: {}, operation: 'create'});
});

app.get('/edit_vehicle/:id', async (req, res) => {
    req.session.operation = 'edit';

    const vehicle = await Promise.resolve(db2.prepare('SELECT vid, name, type, num_seats AS numSeats, notes FROM vehicles WHERE vid = $vid'))
        .then(stmt => stmt.get({$vid: req.params.id}));

    if(vehicle !== undefined) {
        res.render('vehicle_CU', {validation: {}, input: vehicle, operation: req.session.operation});
    } else {
        res.redirect('/');
    }
});

app.post('/add_vehicle', async (req, res) => {
    let vehicle = new Vehicle(req.body.name, req.body.type, req.body.numSeats, req.body.notes).setId(req.body.id);
    let validation = vehicle.validate();

    if (validation.valid) {
        let id = await Promise.resolve(saveVehicle(vehicle));
        res.redirect('/vehicles');
    } else {
        res.render('vehicle_CU', {validation, input: req.body, operation: req.session.operation})
    }
});

app.get('/admin', async (req, res) => {
    const users = await Promise.resolve(db2.all('SELECT resource_name, email, name, is_admin FROM users'));

    res.render('admin', { users });
});

app.get('/revoke_admin', async (req, res) => {
    let resource = req.query.resource;
    const user = await Promise.resolve(db2.get('SELECT resource_name, name, email FROM users WHERE resource_name = ?', resource));

    if(user !== undefined) {
        const res = await Promise.resolve(db2.run('UPDATE users SET is_admin = 0 WHERE resource_name = ?', resource));

        console.log('[%s revoked admin access for %s (%s)]',
            req.session.user.name, user.name, user.email);
    }

    res.redirect('/admin');
});

app.get('/grant_admin', async (req, res) => {
    let resource = req.query.resource;
    const user = await Promise.resolve(db2.get('SELECT resource_name, name, email FROM users WHERE resource_name = ?', resource));

    if(user !== undefined) {
        const res = await Promise.resolve(db2.run('UPDATE users SET is_admin = 1 WHERE resource_name = ?', resource));

        console.log('[%s granted admin access to %s (%s)]',
            req.session.user.name, user.name, user.email);
    }

    res.redirect('/admin');
});

app.get('/booking/:id', async (req, res) => {
    const booking = await Promise.resolve(db2.get('SELECT rowid AS id, function, num_of_people, start_time, return_time, reason, notes, user, vehicle, calendarId FROM bookings WHERE bookings.rowid = ?', req.params.id));

    if(booking !== undefined) {
        booking.vehicle = await Promise.resolve(db2.get('SELECT vid, name, type, num_seats AS numSeats, notes FROM vehicles WHERE vid = ?', booking.vehicle));
        booking.user = await Promise.resolve(db2.get('SELECT resource_name, email, name FROM users WHERE resource_name = ?', booking.user));

        getCalendarEvent(booking.calendarId, req.session.tokens, (err, cal) => {
            if(err) {
                console.log(err);
                res.render('booking', { booking, event: {} });
            } else {
                res.render('booking', { booking, event: { calendarUrl: cal.htmlLink }} );
            }
        });
    } else {
        res.redirect('/');
    }
});

app.get('/booking/:id/cancel', async(req, res) => {
    const booking = await Promise.resolve(db2.get('SELECT function, num_of_people, start_time, return_time, reason, notes, user, vehicle, calendarId FROM bookings WHERE bookings.rowid = ?', req.params.id));

    if(booking === undefined) {
        res.redirect('/');
    } else {
        if (req.session.user.is_admin || req.session.user.resource_name === booking.user) {
            const result = await Promise.resolve(db2.run('DELETE FROM bookings WHERE rowid = ?', req.params.id));

            cancelCalendarEvent(booking.calendarId, req.session.tokens, (err, cal) => {
                if(err)
                    console.log(err);

                console.log('[User %s sucessfully cancelled their booking for %s]',
                    req.session.user.name, moment.tz(booking.start_time, TZ).format('LLL'));

                res.redirect('/');
            });
        }
    }
});

app.listen(PORT, () => console.log('[Server started on port %s]', PORT));

// create tables
async function initDatabase() {
    return new Promise(async (resolve, reject) => {
        try {
            const [vErr, bErr] = await Promise.all([
                db2.exec('CREATE TABLE IF NOT EXISTS vehicles (' +
                    'vid INTEGER PRIMARY KEY,' +
                    'name TEXT NOT NULL,' +
                    'type TEXT NOT NULL,' +
                    'num_seats INT NOT NULL,' +
                    'notes TEXT' +
                    ')'),

                db2.exec('CREATE TABLE IF NOT EXISTS bookings (' +
                    'user TEXT NOT NULL,' +
                    'function TEXT NOT NULL,' +
                    'num_of_people INTEGER NOT NULL,' +
                    'start_time TEXT NOT NULL,' +
                    'return_time TEXT NOT NULL,' +
                    'reason TEXT NOT NULL,' +
                    'notes TEXT,' +
                    'vehicle INTEGER NOT NULL,' +
                    'calendarId TEXT,' +
                    'CONSTRAINT bookings_vehicle_fk FOREIGN KEY (vehicle) REFERENCES vehicles(vid),' +
                    'CONSTRAINT bookings_user_fk FOREIGN KEY (user) REFERENCES users(resource_name))'),

                db2.exec('CREATE TABLE IF NOT EXISTS users (' +
                    'resource_name TEXT PRIMARY KEY,' +
                    'email TEXT NOT NULL,' +
                    'name TEXT NOT NULL,' +
                    'is_admin INT NOT NULL' +
                    ') WITHOUT ROWID;')
            ]);
        } catch (err) {
            reject(err);
        }

        resolve();
    });
}

// save a vehicle to the database
async function saveVehicle(vehicle) {
    if(vehicle.vid === undefined) {
        const insert = await Promise.resolve(db2.prepare('INSERT INTO vehicles (name, type, num_seats, notes) VALUES (?, ?, ?, ?)'))
            .then(stmt => stmt.run([vehicle.name, vehicle.type, vehicle.numSeats, vehicle.notes]));

        return insert.stmt.lastID;
    } else {
        const insert = await Promise.resolve(
            db2.prepare('UPDATE vehicles SET name = ?, type = ?, num_seats = ?, notes = ? WHERE vid = ?'))
            .then(stmt => stmt.run([vehicle.name, vehicle.type, vehicle.numSeats, vehicle.notes, vehicle.vid]));

        return vehicle.vid;
    }
}

function cancelCalendarEvent(id, userTokens, callback) {
    oauth2Client.setCredentials(userTokens);

    calendar.events.delete({
        calendarId: 'primary',
        eventId: id
    }, callback)
}

function getCalendarEvent(id, userTokens, callback) {
    oauth2Client.setCredentials(userTokens);

    calendar.events.get({
        calendarId: 'primary',
        eventId: id
    }, callback)
}

function createCalendarEvent(booking, userTokens, callback) {
    oauth2Client.setCredentials(userTokens);

    let event = {
        summary: 'Car Booking',
        location: 'Parkade',
        description: 'You have booked ' + booking.vehicle.name,
        start: {
            dateTime: moment.tz(booking.pickup, TZ).format(),
            timeZone: TZ
        },
        end: {
            dateTime: moment.tz(booking.return, TZ).format(),
            timeZone: TZ
        }
    };

    calendar.events.insert({
        calendarId: 'primary',
        resource: event
    }, (err, event) => {
        if(err) {
            callback(err);
        } else {
            callback(null, event);
        }
    });
}

// save a booking to the database
async function saveBooking(booking) {
    return await Promise.resolve(db2.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'))
        .then(stmt => stmt.run([booking.user, booking.function, booking.numPeople, booking.pickup, booking.return, booking.reason, booking.notes, booking.vehicle.vid, null]));
}

function basicBookingValidation(booking) {
    validation = { valid: true };
    
    functionValid = validateText(booking.function);
    if(functionValid !== undefined)
        validation.name = nameValid;
    
    numPeopleValid = validateNumber(booking.numPeople);
    if(numPeopleValid !== undefined)
        validation.numPeople = numPeopleValid;

    startDateValid = validateDate(booking.startDate);
    if(startDateValid !== undefined)
        validation.startDate = startDateValid;

    returnDateValid = validateDate(booking.returnDate);
    if(returnDateValid !== undefined)
        validation.returnDate = returnDateValid;

    startTimeValid = validateTime(booking.startTime);
    if(startTimeValid !== undefined)
        validation.startTime = startTimeValid;

    returnTimeValid = validateTime(booking.returnTime);
    if(returnTimeValid !== undefined)
        validation.returnTime = returnTimeValid;

    if(startDateValid === undefined && returnDateValid === undefined && startTimeValid === undefined && returnTimeValid === undefined) {
        let startTime = moment.tz(booking.startDate + ' ' + booking.startTime, TZ);
        let returnTime = moment.tz(booking.returnDate + ' ' + booking.returnTime, TZ);

        let now = moment().tz(TZ);

        if(startTime.isSameOrBefore(now, 'minutes')) {
            validation.startDate = 'The date cannot be in the past';
        } else if (returnTime.isSameOrBefore(now, 'minutes')) {
            validation.returnDate = 'The date cannot be in the past';
        }

        let diff = returnTime.diff(startTime, 'minutes');

        if(diff < 0) {
            validation.startTime = 'Start time cannot be after return time';
        } else if (diff < 30) {
            validation.returnTime = 'The minimum booking time is 30 minutes';
        }
    }

    reasonValid = validateText(booking.reason);
    if(reasonValid !== undefined)
        validation.reason = reasonValid;

    if(Object.keys(validation).length > 1) {
        validation.valid = false;
    }

    return validation;
}

// process a booking object
async function processBooking(booking) {

    let requestedStart;
    let requestedReturn;

    if(booking.pickup !== undefined)
        requestedStart = moment.tz(booking.pickup, TZ);

    if(booking.return !== undefined)
        requestedReturn = moment.tz(booking.return, TZ);

    if(booking.startDate !== undefined && booking.startTime !== undefined)
        requestedStart = moment.tz(booking.startDate + ' ' + booking.startTime, TZ);

    if(booking.returnDate !== undefined && booking.returnTime !== undefined)
        requestedReturn = moment.tz(booking.returnDate + ' ' + booking.returnTime, TZ);

    booking.pickup = requestedStart.format();
    booking.return = requestedReturn.format();

    const bookings = await Promise.resolve(db2.all('SELECT * FROM bookings'));

    let busyVehicles = [];

    for (let booking of bookings) {
        let bookingStart = moment.tz(booking.start_time, TZ);
        let bookingReturn = moment.tz(booking.return_time, TZ);

        if(requestedStart.isBetween(bookingStart, bookingReturn, null, '(]') || bookingStart.isBetween(requestedStart, requestedReturn, null, '[]')) {
            busyVehicles.push(booking.vehicle);
        }
    }

    let paramsQs = '';

    for(let i = 0; i < busyVehicles.length; i++)
        i === 0 ? paramsQs += '?' : paramsQs += ', ?';

    const availableVehicles = await Promise.resolve(db2.prepare('SELECT vid, name, num_seats AS numSeats, notes FROM vehicles WHERE vid NOT IN (' + paramsQs + ') ORDER BY num_seats ASC'))
        .then(stmt => stmt.all(busyVehicles));

    let optimalVehicle = null;

    availableVehicles.some(v => {
        if (v.numSeats >= booking.numPeople) {
            optimalVehicle = v;
            return true;
        } else return false;
    });

    if(optimalVehicle === null) {
        // there is no car available
        //TODO check if something is available with less seats
        return { valid: false };
    } else {
        let proposedBooking = { user: booking.user, function: booking.function, numPeople: booking.numPeople, pickup: booking.pickup, return: booking.return, reason: booking.reason, notes: booking.notes, vehicle: optimalVehicle };

        return { valid: true, proposedBooking };
    }
}

function sendEmail(booking, email) {
    let cal = generateCalendar(booking);

    let mailOptions = {
        from: '"Car Booker", <calebkhiebert@gmail.com>',
        to: booking.name + ' <' + email + '>',
        subject: 'Car Booking',
        text: 'This is your car booking event',
        html: '',
        attachments: [
            {
                filename: 'booking.ics',
                content: cal.toString()
            }
        ]
    };

    mailTransporter.sendMail(mailOptions, (err, info) => {
        console.log(err);
        console.log(info);
    });
}

function generateCalendar(booking) {
    let cal = ical({
        domain: 'piikl.com',
        events: [
            {
                start: moment(booking.unixStartTime * 1000).format('LLL'),
                end: moment(booking.unixReturnTime * 1000).format('LLL'),
                summary: 'Car Booking',
                description: 'You have booked ' + booking.vehicle.name,
                location: 'Millenium Library parkade',
                organizer: 'Car Booker <carbooker@piikl.com>'
            }
        ]
    });

    return cal;
}

function getTokens(code, callback) {
    oauth2Client.getToken(code, (err, tokens) => {
        callback(err, tokens);
    });
}

class Vehicle {
    constructor(name, type, numSeats, notes) {
        this.name = name;
        this.type = type;
        this.numSeats = numSeats;
        this.notes = notes;
    }

    setId(id) {
        this.vid = id;
        return this;
    }

    validate() {
        let validation = {valid: true};

        let v_car_name = validateText(this.name);
        if(v_car_name !== undefined)
            validation.name = v_car_name;

        let v_car_type = validateText(this.type);
        if(v_car_type!== undefined)
            validation.type = v_car_type;

        if(this.numSeats === undefined || this.numSeats === null) {
            validation.numSeats = 'This field is required';
        } else if(isNaN(this.numSeats)) {
            validation.numSeats = 'This field must be a number';
        }

        if(Object.keys(validation).length > 1)
            validation.valid = false;

        return validation;
    }
}

function validateText(value, minChars = 3, maxChars = 60, nullErr = 'This field must not be blank', lengthErr = 'This field must be between 3 and 60 characters long') {
    if(value === undefined || value === null) {
        return nullErr;
    } else if (value.length < minChars || value.length > maxChars) {
        return lengthErr;
    }
}

function validateNumber(value, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, nullErr = 'This field must not be blank') {
    if(value === undefined || value === null)
        return nullErr;
    else if (isNaN(value))
        return 'Please enter a number';
    else if (value < min || value > max)
        return 'Must be in range ' + min + ' to ' + max;
}

function validateDate(value, nullErr = 'This field must not be blank') {
    if(value === undefined || value === null)
        return nullErr;
    else if (!moment(value).isValid())
        return 'Please enter a valid date';
}

function validateTime(value, nullErr = 'This field must not be blank') {
    let timeRegex = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

    if(value === undefined || value === null)
        return nullErr;
    else if (!timeRegex.test(value))
        return 'Must be a valid time';
}