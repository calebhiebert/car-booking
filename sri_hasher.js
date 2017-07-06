const files = {
    bootstrap: {path: './dist/bootstrap.min.js', integrity: null},
    datepicker: {path: './dist/bootstrap-datepicker.min.js', integrity: null},
    datepair: {path: './dist/jquery.datepair.min.js', integrity: null},
    timepicker: {path: './dist/jquery.timepicker.min.js', integrity: null},
    jquery: {path: './dist/jquery-3.2.1.min.js', integrity: null},
    moment: {path: './dist/moment.min.js', integrity: null},
    momentTz: {path: './dist/moment-timezone-with-data-2012-2022.min.js', integrity: null},
    tether: {path: './dist/tether.min.js', integrity: null},
    vis: {path: './dist/vis.min.js', integrity: null},
};

let sri = require('sri-toolbox');
let fs = require('fs');

module.exports = {
    init,
    files
};

function init() {
    try {
        Object.keys(files).forEach(file => {
            let data = fs.readFileSync(files[file].path, 'utf8');

            files[file].integrity = sri.generate({
                algorithms: ['sha256']
            }, data);
        });
    } catch (err) {
        console.log(err);
    }
}