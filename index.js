const PORT = 80;

const express = require('express');
const app = express();
const serveStatic = require('serve-static');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');
const moment = require('moment');
const db = new sqlite3.Database('cars.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, () => initDatabase());

app.set('view engine', 'ejs');

app.use(serveStatic(path.join(__dirname, 'dist')));
app.use(bodyParser.urlencoded({extended: true}));
app.use(session({
    secret: 'secret',
    cookie: { secure: true }
}));

app.get('/', function (req, res) {
    res.render('index');
});

app.get('/create_booking', (req, res) => {
    delete req.session.operation;

    res.render('create_booking.ejs')
});

app.post('/create_booking', (req, res) => {
    console.log(req.body);

    let booking = req.body;

    let start = moment(req.body.startDate + ' ' + req.body.startTime);
    let end = moment(req.body.returnDate + ' ' + req.body.returnTime);

    console.log(start.format());
    console.log(end.format());

    booking.startTime = start.unix();
    booking.returnTime = end.unix();

    saveBooking(booking);

    res.send('hi there');
});

app.get('/vehicles', (req, res) => {
    db.all('SELECT rowid AS id, name, type, num_seats AS numSeats, notes FROM vehicles', (err, rows) => {
        if(err) {
            console.log(err);
        } else {
            res.render('cars', { vehicles: rows });
        }
    });
});

app.get('/add_vehicle', (req, res) => {
    req.session.operation = 'create';
    res.render('vehicle_CU', { validation: {}, input: {}, operation: 'create' });
});

app.get('/edit_vehicle/:id', (req, res) => {
    req.session.operation = 'edit';
    db.prepare('SELECT rowid AS id, name, type, num_seats AS numSeats, notes FROM vehicles WHERE rowid = ?').get(req.params.id, (err, vehicle) => {
        console.log(vehicle);
        res.render('vehicle_CU', {validation: {}, input: vehicle, operation: req.session.operation})
    });
});

app.post('/add_vehicle', (req, res) => {
    console.log(req.body);

    let vehicle = new Vehicle(req.body.name, req.body.type, req.body.numSeats, req.body.notes).setId(req.body.id);
    let validation = vehicle.validate();

    if(validation.valid) {
        saveVehicle(vehicle);
        res.redirect('/vehicles');
    } else {
        res.render('newcar', { validation, input: req.body, operation: req.session.operation})
    }
});

app.listen(PORT, () => console.log('server running on port ') + PORT);

function initDatabase() {
    db.run('CREATE TABLE IF NOT EXISTS vehicles (' +
        'name TEXT,' +
        'type TEXT,' +
        'num_seats NUMBER,' +
        'notes TEXT' +
        ')');

    db.run('CREATE TABLE IF NOT EXISTS bookings (' +
        'name TEXT,' +
        'function TEXT,' +
        'num_of_people NUMBER,' +
        'start_time NUMBER,' +
        'return_time NUMBER,' +
        'reason TEXT,' +
        'notes TEXT,' +
        'vehicle NUMBER)');

    console.log('database initilized');
}

function saveVehicle(vehicle) {
    if(vehicle.id === undefined) {
        db.prepare('INSERT INTO vehicles VALUES (?, ?, ?, ?)')
            .run([vehicle.name, vehicle.type, vehicle.numSeats, vehicle.notes], e => console.log(e));
    } else {
        db.prepare('UPDATE vehicles SET name = ?, type = ?, num_seats = ?, notes = ? WHERE rowid = ?')
            .run([vehicle.name, vehicle.type, vehicle.numSeats, vehicle.notes, vehicle.id], e => console.log(e));
    }
}

function saveBooking(booking) {
    db.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run([booking.name, booking.function, booking.numPeople, booking.startTime, booking.returnTime, booking.reason, booking.notes, 1], () => console.log('Booking saved!'));
}

class Vehicle {
    constructor(name, type, numSeats, notes) {
        this.name = name;
        this.type = type;
        this.numSeats = numSeats;
        this.notes = notes;
    }

    setId(id) {
        this.id = id;
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