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

let User, Vehicle, Booking, Settings;

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
                    type: Sequelize.STRING,
                    allowNull: false
                },
                name: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                isAdmin: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: true,
                    allowNull: false
                }
            });

            Vehicle = sequelize.define('vehicle', {
                vid: {
                    type: Sequelize.INTEGER,
                    primaryKey: true,
                    allowNull: false
                },
                name: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                type: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                numSeats: {
                    type: Sequelize.INTEGER,
                    allowNull: false
                },
                notes: {
                    type: Sequelize.STRING
                },
                isReserved: {
                    type: Sequelize.BOOLEAN,
                    allowNull: false,
                    defaultValue: false
                }
            });

            Booking = sequelize.define('booking', {
                id: {
                    type: Sequelize.INTEGER,
                    primaryKey: true,
                    autoIncrement: true
                },
                function: {
                    type: Sequelize.STRING,
                    allowNull: false,
                    validate: {
                        notEmpty: true
                    }
                },
                numPeople: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    validate: {
                        isInt: true,
                        min: 1
                    }
                },
                startTime: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                returnTime: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                reason: {
                    type: Sequelize.STRING,
                    allowNull: false
                },
                notes: {
                    type: Sequelize.STRING
                },
                calendarId: {
                    type: Sequelize.STRING
                },
                status: {
                    type: Sequelize.ENUM,
                    values: ['ACTIVE', 'RESERVED', 'CANCELLED', 'EXPIRED'],
                    allowNull: false,
                    validate: {
                        isIn: [['ACTIVE', 'RESERVED', 'CANCELLED', 'EXPIRED']]
                    }
                },
                vehicleMatch: {
                    type: Sequelize.ENUM,
                    values: ['OPTIMAL', 'WRONG_SEATS', 'WRONG_TYPE', 'WRONG'],
                    allowNull: false,
                    validate: {
                        isIn: [['OPTIMAL', 'WRONG_SEATS', 'WRONG_TYPE', 'WRONG']]
                    }
                }
            });

            Settings = sequelize.define('setting', {
                emailForNewBooking: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: true,
                    allowNull: false
                },
                emailForUpdatedBooking: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: true,
                    allowNull: false
                },
                emailForRemovedBooking: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: true,
                    allowNull: false
                },
                adminEmailForNewBookings: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: true,
                    allowNull: false
                },
                adminEmailForCancelledBookings: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: true,
                    allowNull: false
                },
                language: {
                    type: Sequelize.STRING,
                    defaultValue: 'english',
                    allowNull: false,
                    validate: {
                        isIn: [['english', 'french']]
                    }
                }
            });

            Booking.belongsTo(User);
            Booking.belongsTo(Vehicle);
            User.hasMany(Booking);
            User.hasOne(Settings);
            Vehicle.hasMany(Booking);
            Settings.belongsTo(User);

            sequelize.sync();

            module.exports.User = User;
            module.exports.Vehicle = Vehicle;
            module.exports.Booking = Booking;
            module.exports.Settings = Settings;

            resolve();
        } catch (err) {
            reject(err);
        }
    })
}