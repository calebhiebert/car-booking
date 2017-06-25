const fs = require('fs');

const locales = [
    {
        lang: 'english',
        file: './dist/locale_en.json'
    },
    {
        lang: 'french',
        file: './dist/locale_fr.json'
    }
];

let dict = {};

module.exports = {
    load() {
        for (locale of locales) {
            dict[locale.lang] = JSON.parse(fs.readFileSync(locale.file, {encoding: 'utf-8'}));
        }

        console.log('Loaded ' + locales.length + ' locales');
    },
    lang(lang) {
        return dict[lang].phrases;
    }
};