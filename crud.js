const db = require('sqlite');
const Promise = require('bluebird');

module.exports = {
    init,
    user: {
        find: findUser,
        create: createUser
    }
};

function init() {
    return new Promise((resolve, reject) => {
        db.open('./cars.db', { Promise })
            .then(createTables)
            .then(resolve)
            .catch(reject);
    });
}

function createTables() {
    return new Promise(async (resolve, reject) => {
        try {
            const [vErr, bErr] = await Promise.all([
                db.exec('CREATE TABLE IF NOT EXISTS vehicles (' +
                    'vid INTEGER PRIMARY KEY,' +
                    'name TEXT NOT NULL,' +
                    'type TEXT NOT NULL,' +
                    'num_seats INT NOT NULL,' +
                    'notes TEXT' +
                    ')'),

                db.exec('CREATE TABLE IF NOT EXISTS bookings (' +
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

                db.exec('CREATE TABLE IF NOT EXISTS users (' +
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

async function findUser(resourceName, email) {
    return await Promise.resolve(db.get('SELECT resource_name, email, name, is_admin FROM users WHERE resource_name = ? OR email = ?', resourceName, email));
}

async function createUser(resourceName, name, email, is_admin) {
    return await Promise.resolve(db.run('INSERT INTO users (resource_name, email, name, is_admin) VALUES (?, ?, ?, ?)',
        resourceName, email, name, is_admin));
}