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
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');
const ical = require('ical-generator');
const Joi = require('joi');

const localizer = require('./localizer');
const goog = require('./googlestuff');
const crud = require('./crud');

let prod = process.argv[2] === 'prod';

goog.init(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, prod ? PROD_REDIRECT_URL : GOOGLE_REDIRECT_URL);

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

    if(req.session['language'] === undefined)
        req.session['language'] = 'english';

    res.locals.sess = req.session;
    res.locals.lang = localizer.lang(req.session['language']);
    next();
});

app.use(async (req, res, next) => {
    if(req.session['tokens'] !== undefined && req.session.userCache === undefined) {
        try {
            const me = await Promise.resolve(goog.people.getMe(req.session['tokens']));

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

        let usr = await crud.User.findOne({ where: { resourceName: req.session.userCache.resourceName }, raw: true });

        if (usr === undefined || usr === null) {
            const usrCache = req.session.userCache;

            await crud.User.create({
                resourceName: usrCache.resourceName,
                email: usrCache.email,
                name: usrCache.name
            });

            usr = await crud.User.findOne({ where: { resourceName: req.session.userCache.resourceName }, raw: true});

            console.log('[User %s (%s) logged in for the first time]',
                usr.name, usr.email);
        }

        req.session.user = usr;

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
        if(req.session.signedIn && req.session.user.isAdmin)
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

app.get('/setlang/:lang', (req, res) => {

    let lang = req.params.lang;

    if(lang !== 'english' || lang !== 'french')
        lang = 'english';

    req.session.language = req.params.lang;

    let backUrl = req.header('Referer') || '/';
    res.redirect(backUrl);
});

app.get('/dash', async (req, res) => {
    let bookings = await crud.Booking.findAll({
        include: [crud.User, crud.Vehicle],

        where: {
            startTime: { $gte: moment().tz(TZ).unix() },
            returnTime: { $gte: moment().tz(TZ).unix() }
        }
    });

    let visData = [];

    for (let booking of bookings) {

        booking.startTime = moment(booking.startTime).tz(TZ);
        booking.returnTime = moment(booking.returnTime).tz(TZ);

        visData.push({id: booking.id, start: booking.startTime, end: booking.returnTime, content: (booking.user.name + ' (' + booking.user.email + ') with ' + booking.vehicle.name)})
    }

    res.render('dash', {bookings: bookings, visData});
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
            let result = await saveBooking(booking);

            // sendEmail(booking, req.session.user.email);

            const cal = await createCalendarEvent(booking, req.session.tokens);

            result.calendarId = cal.id;
            result.save();

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
    booking.user = req.session.user;
    
    let validation = basicBookingValidation(booking);

    if(validation.error === null) {
        let result = await processBooking(booking);

        if (result.valid) {
            req.session.proposedBooking = result.proposedBooking;
            res.redirect('/booking_proposal');
        } else {
            res.redirect('/no_cars');
        }
    } else {
        let details = validation.error.details[0];
        let errMsg = {};
        errMsg[details.path] = details.message;

        res.render('create_booking', { bookingRequest: req.session.bookingRequest || {}, validation: errMsg })
    }
});

app.get('/vehicles', async (req, res) => {
    const vehicles = await crud.Vehicle.findAll();

    res.render('cars', { vehicles });
});

app.get('/add_vehicle', (req, res) => {
    req.session.operation = 'create';
    res.render('vehicle_CU', {validation: {}, input: {}, operation: 'create'});
});

app.get('/edit_vehicle/:id', async (req, res) => {
    req.session.operation = 'edit';

    const vehicle = await crud.Vehicle.findById(req.params.id);

    if(vehicle !== null) {
        res.render('vehicle_CU', {validation: {}, input: vehicle, operation: req.session.operation});
    } else {
        res.redirect('/');
    }
});

app.post('/add_vehicle', async (req, res) => {
    let vehicle = {
        vid: req.body.vid,
        name: req.body.name,
        type: req.body.type,
        numSeats: req.body.numSeats,
        notes: req.body.notes
    };

    const validation = validateVehicle(vehicle);

    if (validation.error === null) {
        await crud.Vehicle.upsert(vehicle);
        res.redirect('/vehicles');
    } else {
        let details = validation.error.details[0];
        let errMsg = {};
        errMsg[details.path] = details.message;
        res.render('vehicle_CU', {validation: errMsg, input: req.body, operation: req.session.operation})
    }
});

app.get('/admin', async (req, res) => {
    const users = await crud.User.findAll();

    res.render('admin', { users });
});

app.get('/revoke_admin', async (req, res) => {
    const user = await crud.User.findById(req.query.resource);

    if(user !== undefined && user !== null) {
        user.isAdmin = false;

        await user.save();

        console.log('[%s revoked admin access for %s (%s)]',
            req.session.user.name, user.name, user.email);
    }

    res.redirect('/admin');
});

app.get('/grant_admin', async (req, res) => {
    const user = await crud.User.findById(req.query.resource);

    if(user !== undefined && user !== null) {
        user.isAdmin = true;

        await user.save();

        console.log('[%s granted admin access to %s (%s)]',
            req.session.user.name, user.name, user.email);
    }

    res.redirect('/admin');
});

app.get('/booking/:id', async (req, res) => {
    const booking = await crud.Booking.findOne({ where: { id: req.params.id }, include: [crud.User, crud.Vehicle] });

    if(booking !== undefined) {
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
    const booking = await crud.Booking.findOne({ where: { id: req.params.id }, include: [crud.User, crud.Vehicle] });

    if(booking === null) {
        res.redirect('/');
    } else {
        if (req.session.user.isAdmin || req.session.user.resourceName === booking.user.resourceName) {
            let data = {name: booking.user.name, email: booking.user.email, time: booking.startTime, calId: booking.calendarId};

            try {
                await booking.destroy();

                const caDelete = await Promise.resolve(goog.calendar.deleteCalendarEvent({
                    calendarId: 'primary',
                    eventId: data.calId
                }, req.session.tokens));
            } catch (err) {
                if(err.code !== undefined && err.code === 410) {
                    console.log('[Tried to delete the calendar entry for %s\'s booking, but it was already deleted]',
                        booking.user.name);
                } else {
                    console.log('[Encountered an unexpected error (code %s) while trying to delete a calendar event]', err.code);
                }
            }

            console.log('[User %s (%s) removed %s\'s (%s) booking for %s]',
                req.session.user.name, req.session.user.email, data.name,
                data.email, moment.tz(data.time, TZ).format('LLL'));

            res.redirect('/');
        }
    }
});

/**
 * BEGIN APP INITIALIZATION
 */

Promise.resolve()
    .then(crud.init())
    .then(() => console.log('[Loaded Database]'))
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
   crud.Vehicle
        .upsert(vehicle)
        .then(vehicle => console.log(vehicle));
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
    return await crud.Booking.create({
        function: booking.function,
        numPeople: booking.numPeople,
        startTime: booking.pickup,
        returnTime: booking.return,
        reason: booking.reason,
        notes: booking.notes,
        userResourceName: booking.user.resourceName,
        vehicleVid: booking.vehicle.vid
    });
}

function validateVehicle(vehicle) {
     const schema = Joi.object().keys({
         vid: Joi.number().integer(),
         name: Joi.string().min(3).max(30).required(),
         type: Joi.string().min(2).max(30).required(),
         numSeats: Joi.number().integer().min(1).required(),
         notes: Joi.string().allow('')
     });

     return Joi.validate(vehicle, schema);
}

function basicBookingValidation(booking) {
    const schema = Joi.object().keys({
        function: Joi.string().min(3).max(60).required(),
        numPeople: Joi.number().min(1).required(),
        startDate: Joi.string().required(),
        returnDate: Joi.string().required(),
        startTime: Joi.string().required(),
        returnTime: Joi.string().required(),
        reason: Joi.string().min(3).required()
    });

    return Joi.validate(booking, schema, { allowUnknown: true });

    // if(startDateValid === undefined && returnDateValid === undefined && startTimeValid === undefined && returnTimeValid === undefined) {
    //     let startTime = moment.tz(booking.startDate + ' ' + booking.startTime, TZ);
    //     let returnTime = moment.tz(booking.returnDate + ' ' + booking.returnTime, TZ);
    //
    //     let now = moment().tz(TZ);
    //
    //     if(startTime.isSameOrBefore(now, 'minutes')) {
    //         validation.startDate = 'The date cannot be in the past';
    //     } else if (returnTime.isSameOrBefore(now, 'minutes')) {
    //         validation.returnDate = 'The date cannot be in the past';
    //     }
    //
    //     let diff = returnTime.diff(startTime, 'minutes');
    //
    //     if(diff < 0) {
    //         validation.startTime = 'Start time cannot be after return time';
    //     } else if (diff < 30) {
    //         validation.returnTime = 'The minimum booking time is 30 minutes';
    //     }
    // }

    // reasonValid = validateText(booking.reason);
    // if(reasonValid !== undefined)
    //     validation.reason = reasonValid;
    //
    // if(Object.keys(validation).length > 1) {
    //     validation.valid = false;
    // }
    //
    // return validation;
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

    const bookings = await crud.Booking.findAll();

    let busyVehicles = [];

    for (let booking of bookings) {
        let bookingStart = moment.tz(booking.startTime, TZ);
        let bookingReturn = moment.tz(booking.returnTime, TZ);

        if(requestedStart.isBetween(bookingStart, bookingReturn, null, '(]') || bookingStart.isBetween(requestedStart, requestedReturn, null, '[]')) {
            busyVehicles.push(booking.vehicle);
        }
    }

    const availableVehicles = await crud.Vehicle.findAll({ where: { vid: { $notIn: busyVehicles } }, order: [['numSeats', 'ASC']] });

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
        let proposedBooking = {
            user: booking.user,
            function: booking.function,
            numPeople: booking.numPeople,
            pickup: booking.pickup,
            return: booking.return,
            reason: booking.reason,
            notes: booking.notes,
            vehicle: optimalVehicle
        };

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