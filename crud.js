const Sequelize = require('sequelize');

const sequelize = new Sequelize('cars', 'user', 'pass', {
    host: 'localhost',
    dialect: 'sqlite',
    logging() {

    },

    pool: {
        max: 5,
        min: 0,
        idle: 10000
    },

    storage: './cars2.db'
});

let User, Vehicle, Booking;

module.exports = {
    init
};

function init() {
    return new Promise((resolve, reject) => {
        try {
            User = sequelize.define('user', {
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

            Vehicle = sequelize.define('vehicle', {
                vid: {
                    type: Sequelize.INTEGER,
                    primaryKey: true
                },
                name: {
                    type: Sequelize.STRING,
                    notNull: true
                },
                type: {
                    type: Sequelize.STRING,
                    notNull: true
                },
                numSeats: {
                    type: Sequelize.INTEGER,
                    notNull: true
                },
                isAdmin: {
                    type: Sequelize.BOOLEAN,
                    notNull: true
                }
            });

            Booking = sequelize.define('booking', {
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

            sequelize.sync();

            module.exports.User = User;
            module.exports.Vehicle = Vehicle;
            module.exports.Booking = Booking;

            resolve();
        } catch (err) {
            reject(err);
        }
    })
}