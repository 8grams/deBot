// create express application
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();
const PORT = process.env.APP_PORT || 3025;

module.exports = main;

app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.use(cors());

function main(context) {

    app.get('/', (req,res) => {
        res.send('Hello World');
    })

    app.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
    })
}

if(require.main === module) {
    main();
}
