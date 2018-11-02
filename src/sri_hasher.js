const files = {
  bootstrap: { path: './src/dist/bootstrap.min.js', integrity: null },
  datepicker: { path: './src/dist/bootstrap-datepicker.min.js', integrity: null },
  datepair: { path: './src/dist/jquery.datepair.min.js', integrity: null },
  timepicker: { path: './src/dist/jquery.timepicker.min.js', integrity: null },
  jquery: { path: './src/dist/jquery-3.2.1.min.js', integrity: null },
  moment: { path: './src/dist/moment.min.js', integrity: null },
  momentTz: { path: './src/dist/moment-timezone-with-data-2012-2022.min.js', integrity: null },
  tether: { path: './src/dist/tether.min.js', integrity: null },
  vis: { path: './src/dist/vis.min.js', integrity: null },
};

let sri = require('sri-toolbox');
let fs = require('fs');

module.exports = {
  init,
  files,
};

function init() {
  try {
    Object.keys(files).forEach((file) => {
      let data = fs.readFileSync(files[file].path, 'utf8');

      files[file].integrity = sri.generate(
        {
          algorithms: ['sha256'],
        },
        data,
      );
    });
  } catch (err) {
    console.log(err);
  }
}
