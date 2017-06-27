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
const goog = require('./googlestuff');
const crud = require('./crud');

let prod = process.argv[2] === 'prod';

goog.init(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, prod ? PROD_REDIRECT_URL : GOOGLE_REDIRECT_URL);
let oauth2Client = goog.oauth2Client;

//TODO make a module to deal with email stuff
//const mail = require('./mailer');

const mailgunAuth = {
    auth: {
        api_key: MAILGUN_API_KEY,
        domain: MAILGUN_DOMAIN
    }
};

const mailTransporter = nodemailer.createTransport(mg(mailgunAuth));

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
    genAuthUrl: goog.genAuthUrl
};

app.use(async (req, res, next) => {

    if(req.session.language === undefined)
        req.session.language = 'english';

    res.locals.sess = req.session;
    res.locals.lang = localizer.lang(req.session.language);
    next();
});

app.use(async (req, res, next) => {
    if(req.session.tokens !== undefined && req.session.userCache === undefined) {
        try {
            const me = await Promise.resolve(goog.people.getMe(req.session.tokens));

            req.session.userCache = {
                name: me.names[0].displayName,
                resourceName: me.resourceName,
                email: me.emailAddresses[0].value
            };
        } catch (err) {
            wipeTokens(req.session);
        }
    }

    next();
});

app.use(async (req, res, next) => {
    if(req.session.tokens) {
        const usr = crud.user.find(req.session.userCache.resourceName, req.session.userCache.email);

        if (usr === undefined) {
            const usr = req.session.userCache;
            const res = crud.user.create(usr.resourceName, usr.name, usr.email, false);

            console.log('[User %s (%s) logged in for the first time]',
                usr.name, usr.email);
        }

        req.session.user = await Promise.resolve(db2.get('SELECT resource_name, email, name, is_admin FROM users WHERE resource_name = ?', usr.resource_name));

        next();
    } else {
        next();
    }
});

app.use(async (req, res, next) => {
    if(req.session.tokens === undefined) {
        delete req.session.user;
        delete req.session.userCache;
        req.session.signedIn = false;
    } else {
        req.session.signedIn = true;
    }

    next();
});

// Check admin paths
app.use(async (req, res, next) => {
    const adminPaths = ['/admin', '/revoke_admin', '/grant_admin', '/add_vehicle', '/edit_vehicle', '/vehicles'];
    const path = req.path;

    let isAdminPath = elementStartsWith(adminPaths, path);
    res.locals.adminPage = isAdminPath;

    if(isAdminPath) {
        if(req.session.signedIn && req.session.user.is_admin)
            next();
        else
            res.render('no_perms');
    } else {
        next();
    }
});

// Check Authed Pages
app.use(async (req, res, next) => {
    const authedPaths = ['/dash', '/no_cars', '/booking_proposal', '/accept_booking', '/logout', '/create_booking', '/booking', '/request_perms'];
    const path = req.path;

    let isAuthedPath = elementStartsWith(authedPaths, path);

    if(isAuthedPath) {
        if(req.session.signedIn)
            next();
        else
            res.render('please_sign_in');
    } else {
        next();
    }
});

app.get('/', function (req, res) {
    if(req.session.signedIn) {
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

app.get('/dash', async (req, res) => {
    const bookings = await Promise.resolve(db2.prepare('SELECT bookings.rowid AS id, users.name AS name, users.email AS email, function, num_of_people AS numPeople, start_time AS startTime, return_time AS returnTime, reason, notes, vehicle FROM bookings JOIN users ON bookings.user = users.resource_name WHERE start_time > ? OR return_time > ? ORDER BY start_time, return_time ASC'))
        .then(stmt => stmt.all([moment().tz(TZ).unix(), moment().tz(TZ).unix()]));

    let visData = [];

    for (let booking of bookings) {

        booking.startTime = moment(booking.startTime).tz(TZ);
        booking.returnTime = moment(booking.returnTime).tz(TZ);

        booking.vehicle = await Promise.resolve(db2.prepare('SELECT vid, name, type, num_seats AS numSeats, notes FROM vehicles WHERE vid = ?'))
            .then(stmt => stmt.get([booking.vehicle]));

        visData.push({id: booking.id, start: booking.startTime, end: booking.returnTime, content: (booking.name + ' (' + booking.email + ') with ' + booking.vehicle.name)})
    }

    res.render('dash', {bookings, visData});
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

            const cal = await createCalendarEvent(booking, req.session.tokens);

            let dbUpdate = await Promise.resolve(db2.run('UPDATE bookings SET calendarId = ? WHERE rowid = ?', cal.id, bookingId));

            console.log('[Successfully added booking for %s to their calendar. id %s]',
                req.session.user.email, cal.id);

            delete req.session.proposedBooking;
            delete req.session.bookingRequest;

            console.log('[User %s (%s) Created a booking for %s from %s to %s]',
                req.session.user.name, req.session.user.email,
                booking.vehicle.name, booking.pickup, booking.return);

            res.redirect('/dash');

        } else {
            res.send('You took too long to accept this booking, it is no longer valid!');
        }
    }
});

app.get('/auth', async (req, res) => {
    if(req.session.signedIn) {
        res.redirect('/');
    } else {
        Promise.resolve(goog.getToken(req.query.code))
            .then(token => req.session.tokens = token)
            .catch(err => console.log('[Something went wrong while getting a user token]'))
            .finally(() => res.redirect('/'));
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

        try {
            const cal = await Promise.resolve(goog.calendar.getCalendarEvent({
                calendarId: 'primary',
                eventId: booking.calendarId
            }, req.session.tokens));

            res.render('booking', { booking, event: { calendarUrl: cal.htmlLink } })

        } catch (err) {
            console.log(err);
            res.render('booking', { booking, event: { } });
        }
    } else {
        res.redirect('/');
    }
});

app.get('/booking/:id/cancel', async(req, res) => {
    const booking = await Promise.resolve(db2.get('SELECT function, num_of_people, start_time, return_time, reason, notes, user, vehicle, calendarId FROM bookings WHERE bookings.rowid = ?', req.params.id));

    if(booking === undefined) {
        res.redirect('/');
    } else {
        const bookingName = await Promise.resolve(db2.get('SELECT name, email FROM users WHERE resource_name = ?', booking.user));

        if (req.session.user.is_admin || req.session.user.resource_name === booking.user) {
            try {
                const dbDelete = await Promise.resolve(db2.run('DELETE FROM bookings WHERE rowid = ?', req.params.id));
                const caDelete = await Promise.resolve(goog.calendar.deleteCalendarEvent({
                    calendarId: 'primary',
                    eventId: id
                }));
            } catch (err) {
                if(err.code !== undefined && err.code === 410) {
                    console.log('[Tried to delete the calendar entry for %s\'s booking, but it was already deleted]',
                        bookingName.name);
                } else {
                    console.log('[Encountered an unexpected error (code %s) while trying to delete a calendar event]', err.code);
                }
            }

            console.log('[User %s (%s) removed %s\'s (%s) booking for %s]',
                req.session.user.name, req.session.user.email, bookingName.name,
                bookingName.email, moment.tz(booking.start_time, TZ).format('LLL'));

            res.redirect('/');
        }
    }
});

/**
 * BEGIN APP INITIALIZATION
 */
Promise.resolve()
    .then(() => crud.init())
    .then(() => console.log('[Database initialized]'))
    .then(() => localizer.load())
    .then(langs => console.log('[Loaded %s locales]', Object.keys(langs).length))
    .then(() => startServer())
    .then(() => console.log('[Server started on port %s]', PORT))
    .catch(err => console.log(err));

function startServer() {
    return new Promise((resolve, reject) => {
        try {
            app.listen(PORT, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
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

async function createCalendarEvent(booking, userToken) {
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

    return await Promise.resolve(
        goog.calendar.createCalendarEvent({
            calendarId: 'primary',
            resource: event
        }, userToken)
    )
        .catch(err => console.log(err));
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
        validation.function = functionValid;
    
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

function contains(arr, value) {
    let c = false;

    arr.forEach(e => {
        if(e.includes(value))
            c = true;
    });

    return c;
}

function wipeTokens(session) {
    console.log('[Wiping tokens for a user due to an unknown error]');
    delete session.tokens;
}

function elementStartsWith(arr, value) {
    let esw = false;

    arr.forEach(ele => {
        if(value.startsWith(ele))
            esw = true;
    });

    return esw;
}