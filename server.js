/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";
/* jshint node:true */

// Add the express web framework
const express = require("express");
const app = express();
const fs = require("fs");
const url = require("url");

// Use body-parser to handle the PUT data
const bodyParser = require("body-parser");
app.use(
    bodyParser.urlencoded({
        extended: false
    })
);

// Util is handy to have around, so thats why that's here.
const util = require('util')
// and so is assert
const assert = require('assert');

// We want to extract the port to publish our app on
let port = process.env.PORT || 8080;

// Then we'll pull in the database client library
const mysql = require("mysql");

// Now lets get cfenv and ask it to parse the environment variable
let cfenv = require('cfenv');

// load local VCAP configuration  and service credentials
let vcapLocal;
try {
  vcapLocal = require('./vcap-local.json');
  console.log("Loaded local VCAP");
} catch (e) { 
    // console.log(e)
}

const appEnvOpts = vcapLocal ? { vcap: vcapLocal} : {}
const appEnv = cfenv.getAppEnv(appEnvOpts);

// Within the application environment (appenv) there's a services object
let services = appEnv.services;

// The services object is a map named by service so we extract the one for PostgreSQL
let mysql_services = services["compose-for-mysql"];

// This check ensures there is a services for MySQL databases
assert(!util.isUndefined(mysql_services), "Must be bound to compose-for-mysql services");

// We now take the first bound MongoDB service and extract it's credentials object
let credentials = mysql_services[0].credentials;

let connectionString = credentials.uri;

// First we need to parse the connection string. Although we could pass
// the URL directly, that doesn't allow us to set an SSL certificate.

let mysqlurl = new url.URL(connectionString);
let options = {
    host: mysqlurl.hostname,
    port: mysqlurl.port,
    user: mysqlurl.username,
    password: mysqlurl.password,
    database: mysqlurl.pathname.split("/")[1]
};

// If the path to the certificate is set, we assume SSL.
// Therefore we read the cert and set the options for a validated SSL connection
if (credentials.ca_certificate_base64) {
  var ca = new Buffer(credentials.ca_certificate_base64, 'base64');
  options.ssl = { ca: ca };
  options.flags = "--ssl-mode=REQUIRED";
}

// set up a new connection using our config details
let connection = mysql.createConnection(options);

connection.connect(function(err) {
    // Uncomment the following lines to confirm the connection is TLS encrypted
    // connection.query("show session status like 'ssl_cipher'",function(err,result) {
    //   if(err) {
    //     console.log(err);
    //   } else {
    //     console.log(result);
    //   }
    // });
    if (err) {
        console.log(err);
    } else {
        connection.query(
            "CREATE TABLE IF NOT EXISTS words (id int auto_increment primary key, word varchar(256) NOT NULL, definition varchar(256) NOT NULL)",
            function(err, result) {
                if (err) {
                    console.log(err);
                }
            }
        );
    }
});

// We can now set up our web server. First up we set it to serve static pages
app.use(express.static(__dirname + "/public"));

// Add a word to the database
function addWord(word, definition) {
    return new Promise(function(resolve, reject) {
        let queryText = "INSERT INTO words(word,definition) VALUES(?, ?)";
        connection.query(
            queryText, [word, definition],
            function(error, result) {
                if (error) {
                    console.log(error);
                    reject(error);
                } else {
                    resolve(result);
                }
            }
        );
    });
}

// Get words from the database
function getWords() {
    return new Promise(function(resolve, reject) {
        // execute a query on our database
        connection.query("SELECT * FROM words ORDER BY word ASC", function(
            err,
            result
        ) {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

// The user has clicked submit to add a word and definition to the database
// Send the data to the addWord function and send a response if successful
app.put("/words", function(request, response) {
    addWord(request.body.word, request.body.definition)
        .then(function(resp) {
            response.send(resp);
        })
        .catch(function(err) {
            console.log(err);
            response.status(500).send(err);
        });
});

// Read from the database when the page is loaded or after a word is successfully added
// Use the getWords function to get a list of words and definitions from the database
app.get("/words", function(request, response) {
    getWords()
        .then(function(words) {
            response.send(words);
        })
        .catch(function(err) {
            console.log(err);
            response.status(500).send(err);
        });
});

// Listen for a connection.
app.listen(port, function() {
    console.log("Server is listening on port " + port);
});
