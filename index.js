const PORT = process.env.PORT || 8080;
const TZ = process.env.TIMEZONE || 'America/Winnipeg';
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URL = process.env.GOOGLE_REDIRECT_URL || 'http://localhost/auth';
const BOOKING_EXPIRY_MINS = process.env.BOOKING_EXPIRY_MINS || 10;

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
const Joi = require('joi');
const pino = require('pino');

const localizer = require('./src/localizer');
const goog = require('./googlestuff');
const crud = require('./src/crud');
const mailer = require('./src/mailer');
const hasher = require('./src/sri_hasher');

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'index' });

goog.init(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URL);

// set settings
app.set('view engine', 'ejs');
app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'src', 'views'));

// tell the app to serve static files from the dist directory
app.use(serveStatic(path.join(__dirname, 'src', 'dist')));

// allow the app to parse urlencoded POST requests
app.use(bodyParser.urlencoded({ extended: true }));

// setup the session manager
app.use(
  session({
    secret: 'secret',
    resave: true,
    store: new sqstore({ table: 'sessions', dir: '.' }),
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' },
  }),
);

// all of these variables will be available in the templates
app.locals = {
  moment,
  GOOGLE_CLIENT_ID,
  BOOKING_EXPIRY_MINS,
  TZ,
  genAuthUrl: goog.genAuthUrl,
  sri: hasher.files,
};

app.use(async (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' fonts.googleapis.com; img-src 'self' data:; " +
      "font-src fonts.gstatic.com fonts.googleapis.com; form-action 'self'; frame-ancestors 'none'",
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(async (req, res, next) => {
  if (crud.isConnected) next();
  else res.render('db_err');
});

app.use(async (req, res, next) => {
  if (req.session['language'] === undefined) req.session['language'] = 'english';

  res.locals.sess = req.session;
  res.locals.lang = localizer.lang(req.session['language']);
  next();
});

app.use(async (req, res, next) => {
  if (req.session['tokens'] !== undefined && req.session.userCache === undefined) {
    try {
      const me = await Promise.resolve(goog.people.getMe(req.session['tokens']));

      req.session.userCache = {
        name: me.names[0].displayName,
        resourceName: me.resourceName,
        email: me.emailAddresses[0].value,
      };
    } catch (err) {
      logger.error('GOOG ERR', err);
      wipeTokens(req.session);
    }
  }

  next();
});

app.use(async (req, res, next) => {
  if (req.session['tokens']) {
    let usr = await crud.User.findOne({ where: { resourceName: req.session.userCache.resourceName } });

    if (usr === undefined || usr === null) {
      const usrCache = req.session.userCache;

      await crud.User.create(
        {
          resourceName: usrCache.resourceName,
          email: usrCache.email,
          name: usrCache.name,
          token: JSON.stringify(req.session['tokens']),
          setting: {
            language: req.session['language'],
          },
        },
        {
          include: [crud.Settings],
        },
      );

      usr = await crud.User.findOne({ where: { resourceName: req.session.userCache.resourceName } });

      logger.info('User %s (%s) logged in for the first time', usr.name, usr.email);
    }

    if (usr.token !== JSON.stringify(req.session['tokens'])) {
      usr.token = JSON.stringify(req.session['tokens']);
      await usr.save();
    }

    req.session.user = usr.dataValues;

    next();
  } else {
    next();
  }
});

app.use(async (req, res, next) => {
  if (req.session.tokens === undefined) {
    delete req.session.user;
    delete req.session.userCache;
    req.session.signedIn = false;
  } else {
    req.session.signedIn = true;
  }

  next();
});

app.use(async (req, res, next) => {
  const adminPaths = [
    '/admin',
    '/vehicle',
    '/revoke_admin',
    '/grant_admin',
    '/add_vehicle',
    '/edit_vehicle',
    '/vehicles',
  ];
  const path = req.path;

  let isAdminPath = elementStartsWith(adminPaths, path);
  res.locals.adminPage = isAdminPath;

  if (isAdminPath) {
    if (req.session.signedIn && req.session.user.isAdmin) next();
    else res.render('no_perms');
  } else {
    next();
  }
});

app.use(async (req, res, next) => {
  const authedPaths = [
    '/dash',
    '/my_bookings',
    '/settings',
    '/no_cars',
    '/booking_proposal',
    '/accept_booking',
    '/logout',
    '/create_booking',
    '/booking',
    '/request_perms',
  ];
  const path = req.path;

  let isAuthedPath = elementStartsWith(authedPaths, path);

  if (isAuthedPath) {
    if (req.session.signedIn) next();
    else res.render('please_sign_in');
  } else {
    next();
  }
});

app.get('/', function(req, res) {
  if (req.session.signedIn) {
    res.redirect('/dash');
  } else {
    res.render('index');
  }
});

app.get('/setlang/:lang', (req, res) => {
  let lang = req.params.lang;

  if (lang !== 'english' || lang !== 'french') lang = 'english';

  req.session.language = lang;

  let backUrl = req.header('Referer') || '/';
  res.redirect(backUrl);
});

app.get('/dash', async (req, res) => {
  let bookings = await crud.Booking.findAll({
    include: [crud.User, crud.Vehicle],

    where: {
      startTime: {
        $gte: moment()
          .tz(TZ)
          .unix(),
      },
      returnTime: {
        $gte: moment()
          .tz(TZ)
          .unix(),
      },
      status: 'ACTIVE',
    },
  });

  let visData = [];

  for (let booking of bookings) {
    booking.startTime = moment(booking.startTime).tz(TZ);
    booking.returnTime = moment(booking.returnTime).tz(TZ);

    visData.push({
      id: booking.id,
      start: booking.startTime,
      end: booking.returnTime,
      content: booking.user.name + ' (' + booking.user.email + ') with ' + booking.vehicle.name,
    });
  }

  res.render('dash', { bookings: bookings, visData });
});

app.get('/no_cars', async (req, res) => {
  if (req.session.bookingRequest === undefined) {
    res.send('no booking request exists!');
  } else {
    res.render('no_cars', { booking: req.session.bookingRequest });
  }
});

app.get('/booking_proposal', async (req, res) => {
  const bk = await crud.Booking.findOne({
    include: [crud.User, crud.Vehicle],
    where: { userResourceName: req.session.user.resourceName, status: 'RESERVED' },
  });

  if (bk === null) {
    res.redirect('/dash');
  } else {
    res.render('booking_proposal', { booking: bk });
  }
});

app.get('/accept_booking', async (req, res) => {
  const bk = await crud.Booking.findOne({
    where: {
      userResourceName: req.session.user.resourceName,
      status: 'RESERVED',
    },
    include: [crud.User, crud.Vehicle],
  });

  if (bk === null) {
    res.redirect('/');
  } else {
    bk.status = 'ACTIVE';
    await bk.save();
    logger.info(
      'User %s (%s) Created a booking for %s from %s to %s',
      req.session.user.name,
      req.session.user.email,
      bk.vehicle.name,
      bk.startTime,
      bk.returnTime,
    );

    try {
      const cal = await createCalendarEvent(bk, req.session.tokens);
      bk.calendarId = cal.id;
      bk.save();
      logger.info('Successfully added booking for %s to their calendar. id %s', req.session.user.email, cal.id);
    } catch (err) {
      if (err instanceof TypeError) {
        logger.error('Tried to update the booking entry with a calendar ID but the event does not exist!');
      } else {
        logger.error('Something went wrong when creating a calendar event for a booking %O', err);
      }
    }

    res.redirect('/');
  }
});

app.get('/auth', async (req, res) => {
  if (req.session.signedIn) {
    res.redirect('/');
  } else {
    Promise.resolve(goog.getToken(req.query.code))
      .then((token) => (req.session.tokens = token))
      .catch((err) => logger.error('Something went wrong while getting a user token'))
      .finally(() => res.redirect('/'));
  }
});

app.get('/logout', async (req, res) => {
  delete req.session.tokens;
  delete req.session.userCache;

  res.redirect('/');
});

app.get('/create_booking', async (req, res) => {
  const bk = await crud.Booking.findOne({
    where: { userResourceName: req.session.user.resourceName, status: 'RESERVED' },
  });

  if (bk === null) {
    const vehicleTypes = await crud.Vehicle.aggregate('type', 'DISTINCT', { plain: false });
    res.render('create_booking', { bookingRequest: req.session.bookingRequest || {}, validation: {}, vehicleTypes });
  } else {
    res.redirect('/booking_proposal');
  }
});

app.post('/create_booking', async (req, res) => {
  const bk = await crud.Booking.findOne({
    where: { userResourceName: req.session.user.resourceName, status: 'RESERVED' },
  });

  if (bk !== null) {
    res.redirect('/booking_proposal');
  } else {
    const booking = {
      function: req.body.function,
      numPeople: req.body.numPeople,
      startDate: req.body.startDate,
      returnDate: req.body.returnDate,
      startTime: req.body.startTime,
      returnTime: req.body.returnTime,
      reason: req.body.reason,
      typeRequest: req.body.typeRequest,
      notes: req.body.notes,
    };

    req.session.bookingRequest = booking;

    let validation = basicBookingValidation(booking);

    if (validation.error === null) {
      let bk = await processBooking(booking);

      if (bk.valid) {
        await crud.Booking.create({
          function: bk.proposedBooking.function,
          numPeople: bk.proposedBooking.numPeople,
          startTime: bk.proposedBooking.pickup,
          returnTime: bk.proposedBooking.return,
          reason: bk.proposedBooking.reason,
          notes: bk.proposedBooking.notes,
          userResourceName: req.session.user.resourceName,
          vehicleVid: bk.proposedBooking.vehicle.vid,
          status: 'RESERVED',
          vehicleMatch: bk.proposedBooking.vehicleMatch,
        });

        delete req.session.bookingRequest;

        res.redirect('/booking_proposal');
      } else {
        res.redirect('/no_cars');
      }
    } else {
      let errMsg = {};
      errMsg[validation.error.path] = validation.error.message;
      const vehicleTypes = await crud.Vehicle.aggregate('type', 'DISTINCT', { plain: false });
      res.render('create_booking', {
        bookingRequest: req.session.bookingRequest || {},
        vehicleTypes,
        validation: errMsg,
      });
    }
  }
});

app.get('/vehicles', async (req, res) => {
  const vehicles = await crud.Vehicle.findAll();

  res.render('cars', { vehicles });
});

app.get('/add_vehicle', (req, res) => {
  req.session.operation = 'create';
  res.render('vehicle_CU', { validation: {}, input: {}, operation: 'create' });
});

app.get('/edit_vehicle/:id', async (req, res) => {
  req.session.operation = 'edit';

  const vehicle = await crud.Vehicle.findById(req.params.id);

  if (vehicle !== null) {
    res.render('vehicle_CU', { validation: {}, input: vehicle, operation: req.session.operation });
  } else {
    res.redirect('/');
  }
});

app.post('/add_vehicle', async (req, res) => {
  let vehicle = {
    vid: req.body.vid,
    name: req.body.name.trim(),
    type: req.body.type.trim().toLowerCase(),
    numSeats: req.body.numSeats,
    notes: req.body.notes.trim(),
    isReserved: req.body.isReserved || false,
  };

  const validation = validateVehicle(vehicle);

  if (validation.error === null) {
    await crud.Vehicle.upsert(vehicle);
    res.redirect('/vehicles');
  } else {
    let details = validation.error.details[0];
    let errMsg = {};
    errMsg[details.path] = details.message;
    res.render('vehicle_CU', { validation: errMsg, input: req.body, operation: req.session.operation });
  }
});

app.get('/admin', async (req, res) => {
  const users = await crud.User.findAll();

  res.render('admin', { users });
});

app.get('/revoke_admin', async (req, res) => {
  const user = await crud.User.findById(req.query.resource);

  if (user !== undefined && user !== null) {
    user.isAdmin = false;

    await user.save();

    logger.info('%s revoked admin access for %s (%s)', req.session.user.name, user.name, user.email);
  }

  res.redirect('/admin');
});

app.get('/grant_admin', async (req, res) => {
  const user = await crud.User.findById(req.query.resource);

  if (user !== undefined && user !== null) {
    user.isAdmin = true;

    await user.save();

    logger.info('%s granted admin access to %s (%s)', req.session.user.name, user.name, user.email);
  }

  res.redirect('/admin');
});

app.get('/booking/:id', async (req, res) => {
  const booking = await crud.Booking.findOne({ where: { id: req.params.id }, include: [crud.User, crud.Vehicle] });

  if (booking !== null) {
    if (booking.status === 'RESERVED') {
      res.redirect('/booking_proposal');
    } else {
      try {
        const cal = await goog.calendar.getCalendarEvent(
          {
            calendarId: 'primary',
            eventId: booking.calendarId,
          },
          req.session.tokens,
        );

        res.render('booking', { booking, event: { calendarUrl: cal.htmlLink } });
      } catch (err) {
        logger.error('CALENDAR ERR %O', err);
        res.render('booking', { booking, event: {} });
      }
    }
  } else {
    res.redirect('/');
  }
});

app.get('/booking/:id/cancel', async (req, res) => {
  const bk = await crud.Booking.findOne({ where: { id: req.params.id }, include: [crud.User, crud.Vehicle] });

  if (bk === null) {
    res.redirect('/');
  } else {
    if (req.session.user.isAdmin || req.session.user.resourceName === bk.user.resourceName) {
      if (bk.status === 'ACTIVE') {
        bk.status = 'CANCELLED';
        await bk.save();

        logger.info(
          "User %s (%s) removed %s's (%s) booking for %s",
          req.session.user.name,
          req.session.user.email,
          bk.user.name,
          bk.user.email,
          moment.tz(bk.startTime, TZ).format('LLL'),
        );

        try {
          await goog.calendar.deleteCalendarEvent(
            {
              calendarId: 'primary',
              eventId: bk.calendarId,
            },
            req.session.tokens,
          );
        } catch (err) {
          if (err.code !== undefined && err.code === 410) {
            logger.warn(
              "Tried to delete the calendar entry for %s's booking, but it was already deleted",
              bk.user.name,
            );
          } else {
            logger.error('Encountered an unexpected error (code %s) while trying to delete a calendar event', err.code);
          }
        }
      } else if (bk.status === 'RESERVED') {
        bk.status = 'EXPIRED';
        await bk.save();
      }

      res.redirect('/');
    }
  }
});

app.get('/booking/:id/details', async (req, res) => {
  const bk = await crud.Booking.findOne({
    where: {
      id: req.params.id,
    },
  });

  if (bk !== null) {
    res.render('booking_details', { bk, validation: {} });
  } else {
    res.redirect('/');
  }
});

app.post('/booking/:id/details', async (req, res) => {
  let bk = await crud.Booking.findOne({
    where: {
      id: req.params.id,
    },
  });

  const details = {
    dDepartureTime: req.body.departureTime,
    dReturnTime: req.body.returnTime,
    dKMStart: req.body.kmStart,
    dKMFInish: req.body.kmFinish,
    dBorP: req.body.bOrP,
    dWasClean: req.body.vehicleClean === 'on',
    dFuelStationName: req.body.fuelStationName,
    dFuelAmount: req.body.fuelAmount,
    dIncidentReport: req.body.incidentReport === 'on',
  };

  let validation = validateBookingDetails(details);
  let val = {};

  if (validation.error !== null) {
    val[validation.error.path] = validation.error.message;
  } else {
    bk.dDepartureTime = req.body.departureTime || null;
    bk.dReturnTime = req.body.timeOfReturn || null;
    bk.dKMStart = req.body.kmStart || null;
    bk.dKMFinish = req.body.kmFinish || null;
    bk.dBorP = req.body.bOrP || null;
    bk.dWasClean = req.body.vehicleClean || null;
    bk.dFuelStationName = req.body.fuelStationName || null;
    bk.dFuelAmount = req.body.fuelAmount || null;
    bk.dIncidentReport = req.body.incidentReport || null;

    bk = await bk.save();
    res.redirect('/');
  }

  if (bk !== null) {
    res.render('booking_details', { bk, validation: val });
  } else {
    res.redirect('/');
  }
});

app.get('/settings', async (req, res) => {
  const user = await crud.User.findOne({
    where: {
      resourceName: req.session.user.resourceName,
    },
    include: [crud.Settings],
  });

  if (user === null) {
    res.redirect('/');
  } else {
    res.render('settings', { s: user.setting, saved: false });
  }
});

app.post('/settings', async (req, res) => {
  const user = await crud.User.findOne({
    where: {
      resourceName: req.session.user.resourceName,
    },
    include: [crud.Settings],
  });

  user.setting = {
    emailForNewBooking: req.body.emailForNewBooking || false,
    emailForUpdatedBooking: req.body.emailForUpdatedBooking || false,
    emailForRemovedBooking: req.body.emailForRemovedBooking || false,
    adminEmailForNewBookings: req.body.adminEmailForNewBookings || false,
    adminEmailForCancelledBookings: req.body.adminEmailForCancelledBookings || false,
    adminAddEventsToCalendar: req.body.adminAddEventsToCalendar || false,
  };

  await user.save();

  res.render('settings', { s: user.setting, saved: true });
});

app.get('/my_bookings', async (req, res) => {
  const bookings = await crud.Booking.findAll({
    where: {
      userResourceName: req.session.user.resourceName,
    },
    include: [crud.User, crud.Vehicle],
  });

  res.render('my_bookings', { bookings });
});

app.get('/vehicle/:id', async (req, res) => {
  let vehicle = await crud.Vehicle.findOne({
    where: {
      vid: req.params.id,
    },
    include: [
      {
        model: crud.Booking,
        where: {
          status: {
            $in: ['ACTIVE', 'FINISHED'],
          },
        },
        include: [crud.User],
        order: [['returnTime', 'DESC']],
      },
    ],
  });

  if (vehicle === null) vehicle = await crud.Vehicle.findOne({ where: { vid: req.params.id } });

  if (vehicle === null) {
    res.redirect('/');
  } else {
    res.render('vehicle', { vehicle });
  }
});

app.get('/dash.vis.js', (req, res) => {
  res.setHeader('Content-Type', 'text/javascript');
  res.render('dash_vis_js');
});

app.get('/create.booking.js', (req, res) => {
  res.setHeader('Content-Type', 'text/javascript');
  res.render('create_booking_js');
});

app.use(async (req, res, next) => {
  res.render('404');
});

/**
 * BEGIN APP INITIALIZATION
 */
Promise.resolve()
  .then(crud.init())
  .then(() => logger.info('Loaded Database'))
  .then(() => localizer.load())
  .then((langs) => logger.info('Loaded %s locales', Object.keys(langs).length))
  .then(() => mailer.init(MAILGUN_API_KEY, MAILGUN_DOMAIN, TZ, crud))
  .then(() => logger.info('Started mailing engines'))
  .then(() => hasher.init())
  .then(() => startServer())
  .then(() => logger.info('Server started on port %s', PORT))
  .then(() => setInterval(cleanExpiredBookings, 1000 * 60))
  .then(() => setInterval(checkCalendarEvents, 1000 * 60))
  .then(() => checkCalendarEvents())
  .catch((err) => {
    throw err;
  });

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

async function createCalendarEvent(booking, userToken) {
  let event = {
    summary: 'Car Booking',
    location: 'Parkade',
    description: 'You have booked ' + booking.vehicle.name,
    start: {
      dateTime: moment.tz(booking.startTime, TZ).format(),
      timeZone: TZ,
    },
    end: {
      dateTime: moment.tz(booking.returnTime, TZ).format(),
      timeZone: TZ,
    },
    attendees: [
      {
        email: booking.user.email,
        displayName: booking.user.displayName,
        responseStatus: 'accepted',
        additionalGuests: booking.numPeople - 1,
      },
    ],
  };

  const admins = await crud.User.findAll({
    where: {
      isAdmin: true,
    },
    include: [crud.Settings],
  });

  admins.forEach((admin) => {
    if (admin.setting.adminAddEventsToCalendar && admin.email !== booking.user.email) {
      event.attendees.push({
        email: admin.email,
        displayName: admin.name,
        resposeStatus: 'declined',
      });
    }
  });

  return await Promise.resolve(
    goog.calendar.createCalendarEvent(
      {
        params: { sendNotifications: true },
        calendarId: 'primary',
        resource: event,
      },
      userToken,
    ),
  ).catch((err) => {
    logger.error('Something went wrong when creating a calendar event for a booking %s', JSON.stringify(err));
  });
}

function validateVehicle(vehicle) {
  const schema = Joi.object().keys({
    vid: Joi.number().integer(),
    name: Joi.string()
      .min(3)
      .max(30)
      .required(),
    type: Joi.string()
      .min(2)
      .max(30)
      .required(),
    numSeats: Joi.number()
      .integer()
      .min(1)
      .required(),
    notes: Joi.string().allow(''),
    isReserved: Joi.any(),
  });

  return Joi.validate(vehicle, schema);
}

function validateBookingDetails(details) {
  let schema = Joi.object().keys({
    dDepartureTime: Joi.string().allow(''),
    dReturnTime: Joi.string().allow(''),
    dKMStart: Joi.number()
      .integer()
      .greater(0)
      .allow(''),
    dKMFInish: Joi.number()
      .integer()
      .greater(0)
      .allow(''),
    dBorP: Joi.string().allow(''),
    dWasClean: Joi.boolean().allow(''),
    dFuelStationName: Joi.string().allow(''),
    dFuelAmount: Joi.number()
      .precision(2)
      .greater(0)
      .allow(''),
    dIncidentReport: Joi.boolean().allow(''),
  });

  jErr = Joi.validate(details, schema);

  if (jErr.error !== null) {
    return niceifyJOIErrors(jErr.error);
  }

  let e = {
    error: {},
  };

  let departure = moment.tz(details.dDepartureTime, 'h:mm A', TZ);
  if (!departure.isValid() && details.dDepartureTime !== '') {
    e.error = { path: 'dDepartureTime', message: 'You must enter a valid time' };
    return e;
  }

  let dReturn = moment.tz(details.dReturnTime, 'h:mm A', TZ);
  if (!dReturn.isValid() && details.dReturnTime !== '') {
    e.error = { path: 'dReturnTime', message: 'You must enter a valid time.' };
  }

  return { error: null };
}

function basicBookingValidation(booking) {
  const schema = Joi.object().keys({
    function: Joi.string()
      .min(3)
      .max(60)
      .required(),
    numPeople: Joi.number()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .required(),
    startDate: Joi.any().required(),
    returnDate: Joi.any().required(),
    startTime: Joi.any().required(),
    returnTime: Joi.any().required(),
    reason: Joi.string()
      .min(3)
      .required(),
  });

  jErr = Joi.validate(booking, schema, { allowUnknown: true });

  if (jErr.error !== null) {
    return niceifyJOIErrors(jErr.error);
  }

  booking.startTime = moment.tz(booking.startTime, 'h:mm A', TZ);
  booking.returnTime = moment.tz(booking.returnTime, 'h:mm A', TZ);

  booking.startDate = moment.tz(booking.startDate, 'YYYY-MM-DD', TZ);
  booking.returnDate = moment.tz(booking.returnDate, 'YYYY-MM-DD', TZ);

  let error = {
    error: {},
  };

  if (!booking.startTime.isValid()) {
    error.error.path = 'startTime';
    error.error.message = 'Please submit a valid time';
    return error;
  }

  if (!booking.returnTime.isValid()) {
    error.error.path = 'returnTime';
    error.error.message = 'Please submit a valid time';
    return error;
  }

  if (!booking.startDate.isValid()) {
    error.error.path = 'startDate';
    error.error.message = 'Please submit a valid date';
    return error;
  }

  if (!booking.returnDate.isValid()) {
    error.error.path = 'returnDate';
    error.error.message = 'Please submit a valid date';
    return error;
  }

  booking.pickup = moment.tz(
    booking.startDate.format('YYYY-MM-DD') + ' ' + booking.startTime.format('HH:mm'),
    'YYYY-MM-DD HH:mm',
    TZ,
  );
  booking.return = moment.tz(
    booking.returnDate.format('YYYY-MM-DD') + ' ' + booking.returnTime.format('HH:mm'),
    'YYYY-MM-DD HH:mm',
    TZ,
  );

  let now = moment().tz(TZ);

  if (booking.pickup.isSameOrBefore(now, 'minutes')) {
    error.error.path = 'startDate';
    error.error.message = 'The start date cannot be in the past';
    return error;
  }

  if (booking.return.isSameOrBefore(now, 'minutes')) {
    error.error.path = 'returnDate';
    error.error.message = 'The return date cannot be in the past';
    return error;
  }

  let diff = booking.return.diff(booking.pickup, 'minutes');

  if (diff < 0) {
    error.error.path = 'returnTime';
    error.error.message = 'The return time cannot be before the start time';
    return error;
  } else if (diff < 30) {
    return { error: { path: 'returnTime', message: 'The minimum booking time is 30 minutes' } };
  }

  booking.pickup = booking.pickup.format();
  booking.return = booking.return.format();

  return { error: null };
}

function niceifyJOIErrors(joiError) {
  return {
    error: { path: joiError.details[0].path, message: joiError.details[0].message },
  };
}

// process a booking object
async function processBooking(booking) {
  let requestedStart = moment.tz(booking.pickup, TZ);
  let requestedReturn = moment.tz(booking.return, TZ);

  const bookings = await crud.Booking.findAll({
    where: {
      status: {
        $in: ['ACTIVE', 'RESERVED'],
      },
    },
    include: [crud.User, crud.Vehicle],
  });

  let busyVehicles = [];

  for (let booking of bookings) {
    let bookingStart = moment.tz(booking.startTime, TZ);
    let bookingReturn = moment.tz(booking.returnTime, TZ);

    if (
      requestedStart.isBetween(bookingStart, bookingReturn, null, '()') ||
      bookingStart.isBetween(requestedStart, requestedReturn, null, '[]')
    ) {
      busyVehicles.push(booking.vehicle.vid);
    }
  }

  let availableVehicles = await crud.Vehicle.findAll({
    where: { vid: { $notIn: busyVehicles } },
    order: [['numSeats', 'ASC']],
  });

  let vehicles = {
    optimal: [],
    wrongSeats: [],
    wrongType: [],
    wrong: [],
  };

  let typeRequested = booking.typeRequest !== 'none';

  availableVehicles.forEach((v) => {
    if (v.numSeats >= booking.numPeople && ((!typeRequested && !v.isReserved) || v.type === booking.typeRequest)) {
      vehicles.optimal.push(v);
    } else if (
      v.numSeats < booking.numPeople &&
      ((!typeRequested && !v.isReserved) || v.type === booking.typeRequest)
    ) {
      vehicles.wrongSeats.push(v);
    } else if (v.numSeats >= booking.numPeople && !v.isReserved) {
      vehicles.wrongType.push(v);
    } else if (!v.isReserved) {
      vehicles.wrong.push(v);
    }
  });

  let chosenOne = null;
  let vehicleMatch;

  if (vehicles.optimal.length > 0) {
    chosenOne = vehicles.optimal[0];
    vehicleMatch = 'OPTIMAL';
  } else if (vehicles.wrongSeats.length > 0) {
    chosenOne = vehicles.wrongSeats[0];
    vehicleMatch = 'WRONG_SEATS';
  } else if (vehicles.wrongType.length > 0) {
    chosenOne = vehicles.wrongType[0];
    vehicleMatch = 'WRONG_TYPE';
  } else if (vehicles.wrong.length > 0) {
    chosenOne = vehicles.wrong[0];
    vehicleMatch = 'WRONG';
  }

  if (chosenOne === null) {
    return { valid: false };
  } else {
    let proposedBooking = {
      vehicleMatch: vehicleMatch,
      function: booking.function,
      numPeople: booking.numPeople,
      pickup: booking.pickup,
      return: booking.return,
      reason: booking.reason,
      notes: booking.notes,
      vehicle: chosenOne,
    };

    return { valid: true, proposedBooking };
  }
}

function wipeTokens(session) {
  delete session.tokens;
}

function elementStartsWith(arr, value) {
  let esw = false;

  arr.forEach((ele) => {
    if (value.startsWith(ele)) esw = true;
  });

  return esw;
}

async function cleanExpiredBookings() {
  try {
    const bookings = await crud.Booking.findAll({ include: [crud.User], where: { status: 'RESERVED' } });

    for (let booking of bookings) {
      let bookingCreateTime = moment.tz(booking.createdAt, TZ);
      let now = moment().tz(TZ);

      if (now.diff(bookingCreateTime, 'minutes') > BOOKING_EXPIRY_MINS) {
        booking.status = 'EXPIRED';
        await booking.save();
        logger.info("%s's (%s) Booking expired", booking.user.name, booking.user.email);
      }
    }
  } catch (err) {
    logger.warn('Expired Booking Clean Operation Error %O', err);
  }
}

async function checkCalendarEvents() {
  if (!crud.isConnected) {
    return;
  }

  try {
    const bookings = await crud.Booking.findAll({
      include: [crud.User, crud.Vehicle],
      where: {
        status: 'ACTIVE',
        calendarId: null,
      },
    });

    for (let bk of bookings) {
      try {
        const cal = await createCalendarEvent(bk, JSON.parse(bk.user.token));
        if (cal !== null) {
          bk.calendarId = cal.id;
          await bk.save();
          logger.info(
            "Created missing calendar event for %s's (%s) booking. ID %s",
            bk.user.name,
            bk.user.email,
            cal.id,
          );
        }
      } catch (err) {
        logger.info('Something went wrong while creating a calendar event!', err);
      }
    }
  } catch (err) {
    logger.warn('Calendar Event Check Error %O', err);
    throw err;
  }
}
