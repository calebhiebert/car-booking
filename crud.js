const Sequelize = require('sequelize');

const sequelize = new Sequelize('cars', 'user', 'pass', {
    host: 'localhost',
    dialect: 'sqlite',

    pool: {
        max: 5,
        min: 0,
        idle: 10000
    },

    storage: './cars2.db'
});

const User = sequelize.define('user', {
    resourceName: {
        type: Sequelize.STRING,
        primaryKey: true
    },
    email: {
        type: Sequelize.STRING
    },
    name: {
        type: Sequelize.STRING
    },
    isAdmin: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
    }
});

const Vehicle = sequelize.define('vehicle', {
    vid: {
        type: Sequelize.INTEGER,
        primaryKey: true
    },
    name: {
        type: Sequelize.STRING
    },
    type: {
        type: Sequelize.STRING
    },
    numSeats: {
        type: Sequelize.INTEGER
    },
    isAdmin: {
        type: Sequelize.BOOLEAN
    }
});

const Booking = sequelize.define('booking', {
    id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    function: {
        type: Sequelize.STRING
    },
    numPeople: {
        type: Sequelize.INTEGER
    },
    startTime: {
        type: Sequelize.STRING
    },
    returnTime: {
        type: Sequelize.STRING
    },
    reason: {
        type: Sequelize.STRING
    },
    notes: {
        type: Sequelize.STRING
    },
    calendarId: {
        type: Sequelize.STRING
    }
});

Booking.belongsTo(User);
Booking.belongsTo(Vehicle);
User.hasMany(Booking);
Vehicle.hasMany(Booking);

sequelize
    .authenticate()
    .then(() => sequelize.sync())
    .then(async () => {
        let testBookings = await Booking.findAll({
            include: [Vehicle]
        });
    });