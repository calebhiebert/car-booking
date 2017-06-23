const PORT = 80;

const express = require('express');
const app = express();
const serveStatic = require('serve-static');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const db = new sqlite3.Database('cars.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, () => initDatabase());

app.set('view engine', 'ejs');

app.use(serveStatic(path.join(__dirname, 'dist')));
app.use(bodyParser.urlencoded({extended: true}));

app.get('/', function (req, res) {
    res.render('index');
});

app.get('/create_car', (req, res) => {
    res.render('newcar', {validation: {}, input: {}});
});

app.post('/create_car', (req, res) => {
    console.log(req.body);

    let vehicle = new Vehicle(req.body.car_name, req.body.car_type, req.body.car_num_seats, req.body.car_notes);
    let validation = vehicle.validate();

    if(validation.valid) {
        console.log(vehicle);
        res.render('newcar', { validation: {}, input: {} })
    } else {
        res.render('newcar', {validation, input: req.body})
    }
});

app.listen(PORT, () => console.log('server running on port ') + PORT);

function initDatabase() {
    db.run('CREATE TABLE IF NOT EXISTS cars (' +
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
        'reason TEXT' +
        'notes TEXT)');

    console.log('database initilized');
}

function createVehicle() {

}

class Vehicle {
    constructor(name, type, numSeats, notes) {
        this.name = name;
        this.type = type;
        this.numSeats = numSeats;
        this.notes = notes;
    }

    validate() {
        let validation = {valid: true};

        let v_car_name = validateText(this.name);
        if(v_car_name !== undefined)
            validation.car_name = v_car_name;

        let v_car_type = validateText(this.type);
        if(v_car_type!== undefined)
            validation.car_type = v_car_type;

        if(this.numSeats === undefined || this.numSeats === null) {
            validation.car_num_seats = 'This field is required';
        } else if(isNaN(this.numSeats)) {
            validation.car_num_seats = 'This field must be a number';
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