const PORT = 80;
const SECRET_PASSWORD = 'Welcome123';

const express = require('express');
const app = express();
const serveStatic = require('serve-static');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqstore = require('connect-sqlite3')(session);
const moment = require('moment');

const Promise = require('bluebird');
const db2 = require('sqlite');

Promise.resolve()
    .then(() => db2.open('./cars.db', { Promise }))
    .catch(err => console.error(err))
    .finally(() => initDatabase());

app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use(serveStatic(path.join(__dirname, 'dist')));
app.use(bodyParser.urlencoded({extended: true}));
app.use(session({
    secret: 'secret',
    resave: true,
    store: new sqstore({table: 'sessions', dir: '.'}),
    saveUninitialized: true,
    cookie: { }
}));

app.get('/', function (req, res) {
    res.render('index');
});

app.get('/no_cars', async (req, res) => {
    if(req.session.bookingRequest === undefined) {
        res.send('no booking request exists!');
    } else {
        res.render('no_cars', { booking: req.session.bookingRequest, moment });
    }
});

app.get('/booking_proposal', async (req, res) => {
    if(req.session.proposedBooking === undefined) {
        res.send('You do not have a booking proposal, please leave');
    } else if (req.query.email !== undefined) {
        req.session.email = req.query.email;
        res.redirect('/accept_booking');
    } else {
        res.render('booking_proposal', { booking: req.session.proposedBooking, moment });
    }
});

app.get('/accept_booking', async (req, res) => {
    if(req.session.proposedBooking === undefined) {
        res.send('You do not have a booking proposal to accept!');
    } else if (req.session.email === undefined) {
        console.log('Missing Email!');
        res.redirect('/booking_proposal');
    } else {
        let booking = req.session.proposedBooking;

        let valid = await Promise.resolve(processBooking(booking));

        if(valid.valid) {

            let result = await Promise.resolve(saveBooking(booking));

            delete req.session.proposedBooking;
            delete req.session.bookingRequest;

            res.send('booking saved!');
        } else {
            res.send('You took too long to accept this booking, it is no longer valid!');
        }
    }
});

app.get('/auth', (req, res) => {
    if(req.session.authenticated) {
        res.redirect('/');
    } else {
        res.render('auth', {method: 'get'});
    }
});

app.post('/auth', (req, res) => {
    if(req.body.password === SECRET_PASSWORD) {
        req.session.authenticated = true;

        if(req.session.returnTo !== undefined)
            res.redirect(req.session.returnTo);
        else
            res.redirect('/');
    } else {
        res.render('auth', {authenticated: false, method: 'post'})
    }

});

app.get('/create_booking', (req, res) => {
    res.render('create_booking', { bookingRequest: req.session.bookingRequest || {} });
});

app.post('/create_booking', async (req, res) => {
    delete req.session.proposedBooking;

    let booking = req.session.bookingRequest = req.body;

    let result = await Promise.resolve(processBooking(booking));
    console.log(result);

    if(result.valid) {
        req.session.proposedBooking = result.proposedBooking;
        res.redirect('/booking_proposal');
    } else {
        res.redirect('/no_cars');
    }
});

app.get('/vehicles', async (req, res) => {
    if(req.session.authenticated) {
        const vehicles = await Promise.resolve(
            db2.all('SELECT vid, name, type, num_seats AS numSeats, notes FROM vehicles')
        );

        res.render('cars', { vehicles });
    } else {
        req.session.returnTo = '/vehicles';
        res.redirect('/auth');
    }
});

app.get('/add_vehicle', (req, res) => {
    if(req.session.authenticated) {
        req.session.operation = 'create';
        res.render('vehicle_CU', {validation: {}, input: {}, operation: 'create'});
    } else {
        res.redirect('/auth');
    }
});

app.get('/edit_vehicle/:id', async (req, res) => {
    if(req.session.authenticated) {
        req.session.operation = 'edit';

        const vehicle = await Promise.resolve(db2.prepare('SELECT vid, name, type, num_seats AS numSeats, notes FROM vehicles WHERE vid = $vid'))
            .then(stmt => stmt.get({$vid: req.params.id}));

        res.render('vehicle_CU', { validation: {}, input: vehicle, operation: req.session.operation});
    } else {
        res.redirect('/auth');
    }
});

app.post('/add_vehicle', async (req, res) => {
    if(req.session.authenticated) {
        let vehicle = new Vehicle(req.body.name, req.body.type, req.body.numSeats, req.body.notes).setId(req.body.id);
        let validation = vehicle.validate();

        if (validation.valid) {
            let id = await Promise.resolve(saveVehicle(vehicle));
            res.redirect('/vehicles');
        } else {
            res.render('vehicle_CU', {validation, input: req.body, operation: req.session.operation})
        }
    } else {
        res.redirect('/auth');
    }
});

app.listen(PORT, () => console.log('server running on port ') + PORT);

async function initDatabase() {
    try {
        const [vErr, bErr] = await Promise.all([
            db2.exec('CREATE TABLE IF NOT EXISTS vehicles (' +
                'vid INTEGER PRIMARY KEY,' +
                'name TEXT,' +
                'type TEXT,' +
                'num_seats INT,' +
                'notes TEXT' +
                ')'),

            db2.exec('CREATE TABLE IF NOT EXISTS bookings (' +
                'name TEXT,' +
                'function TEXT,' +
                'num_of_people INTEGER,' +
                'start_time NUMBER,' +
                'return_time NUMBER,' +
                'reason TEXT,' +
                'notes TEXT,' +
                'vehicle INTEGER,' +
                'FOREIGN KEY (vehicle) REFERENCES vehicles(vid))')
        ]);
    } catch (err) {
        console.error(err);
    }

    console.log('Database Ready!');
}

async function saveVehicle(vehicle) {
    if(vehicle.id === undefined) {
        const insert = await Promise.resolve(db2.prepare('INSERT INTO vehicles (name, type, num_seats, notes) VALUES (?, ?, ?, ?)'))
            .then(stmt => stmt.run([vehicle.name, vehicle.type, vehicle.numSeats, vehicle.notes]));

        return insert.stmt.lastID;
    } else {
        const insert = await Promise.resolve(
            db2.prepare('UPDATE vehicles SET name = ?, type = ?, num_seats = ?, notes = ? WHERE vid = ?'))
            .then(stmt => stmt.run([vehicle.name, vehicle.type, vehicle.numSeats, vehicle.notes, vehicle.vid]));

        return vehicle.id;
    }
}

async function saveBooking(booking) {
    return await Promise.resolve(db2.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?, ?)'))
        .then(stmt => stmt.run([booking.name, booking.function, booking.numPeople, booking.unixStartTime, booking.unixReturnTime, booking.reason, booking.notes, booking.vehicle.vid]));
}

async function processBooking(booking) {

    let requestedStart;
    let requestedReturn;

    if(booking.unixStartTime !== undefined)
        requestedStart = moment(booking.unixStartTime * 1000);

    if(booking.unixReturnTime !== undefined)
        requestedReturn = moment(booking.unixStartTime * 1000);

    if(booking.startDate !== undefined && booking.startTime !== undefined)
        requestedStart = moment(booking.startDate + ' ' + booking.startTime);

    if(booking.returnDate !== undefined && booking.returnTime !== undefined)
        requestedReturn = moment(booking.returnDate + ' ' + booking.returnTime);

    booking.unixStartTime = requestedStart.unix();
    booking.unixReturnTime = requestedReturn.unix();

    const bookings = await Promise.resolve(db2.all('SELECT * FROM bookings'));

    let busyVehicles = [];

    for (let booking of bookings) {
        let bookingStart = moment(booking.start_time * 1000);
        let bookingReturn = moment(booking.return_time * 1000);

        if(requestedStart.isBetween(bookingStart, bookingReturn, null, '(]') || bookingStart.isBetween(requestedStart, requestedReturn, null, '[]')) {
            busyVehicles.push(booking.vehicle);
        }
    }

    let paramsQs = '';

    for(let i = 0; i < busyVehicles.length; i++)
        i === 0 ? paramsQs += '?' : paramsQs += ', ?';

    const availableVehicles = await Promise.resolve(db2.prepare('SELECT vid, name, num_seats AS numSeats, notes FROM vehicles WHERE vid NOT IN (' + paramsQs + ') ORDER BY num_seats ASC'))
        .then(stmt => stmt.all(busyVehicles));

    console.log(busyVehicles);
    console.log(availableVehicles);

    let optimalVehicle = null;

    availableVehicles.some(v => {
        if (v.numSeats >= booking.numPeople) {
            optimalVehicle = v;
            return true;
        } else return false;
    });

    if(optimalVehicle === null) {
        // there is no car available
        // check if something is available with less seats
        return { valid: false };
    } else {
        let proposedBooking = { name: booking.name, function: booking.function, numPeople: booking.numPeople, unixStartTime: booking.unixStartTime, unixReturnTime: booking.unixReturnTime, reason: booking.reason, notes: booking.notes, vehicle: optimalVehicle };

        return { valid: true, proposedBooking };
    }
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