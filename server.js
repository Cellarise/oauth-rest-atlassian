"use strict";

var express = require('express');
var http = require('http');
var https = require('https');
var errorHandler = require('errorhandler');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var app = module.exports = express();
var OAuth = require('./lib/oauth').OAuth;
var fs = require('fs');

//get config
var config = require(process.cwd() + "/config.json");
config.protocol = config.protocol || "http";
config.port = config.port || "80";
var appConfigJira = config.applications.jira;
var appConfigBamboo = config.applications.bamboo;

//JIRA
//setup consumer_secret if not already set to private key
if (appConfigJira.oauth.consumer_secret === "") {
    appConfigJira.oauth.consumer_secret = fs.readFileSync(process.cwd() + config.consumerPrivateKeyFile, "utf8");
    config.applications.jira = appConfigJira;
    fs.writeFileSync(process.cwd() + '/config.json', JSON.stringify(config, null, 2));
}
var basePathJira = appConfigJira.protocol + "://" + appConfigJira.host + ":" + appConfigJira.port;
//oauth consumerJira object
var consumerJira =
    new OAuth(
            basePathJira + appConfigJira.paths['request-token'],
            basePathJira + appConfigJira.paths['access-token'],
        appConfigJira.oauth.consumer_key,
        appConfigJira.oauth.consumer_secret,
        "1.0",
        config.protocol + "://localhost:" + config.port + "/jira/callback/",
        "RSA-SHA1");


//Bamboo
//setup consumer_secret if not already set to private key
if (appConfigBamboo.oauth.consumer_secret === "") {
    appConfigBamboo.oauth.consumer_secret = fs.readFileSync(process.cwd() + config.consumerPrivateKeyFile, "utf8");
    config.applications.bamboo = appConfigBamboo;
    fs.writeFileSync(process.cwd() + '/config.json', JSON.stringify(config, null, 2));
}
var basePathBamboo = appConfigBamboo.protocol + "://" + appConfigBamboo.host + ":" + appConfigBamboo.port;
//oauth consumerBambooobject
var consumerBamboo =
    new OAuth(
            basePathBamboo + appConfigBamboo.paths['request-token'],
            basePathBamboo + appConfigBamboo.paths['access-token'],
        appConfigBamboo.oauth.consumer_key,
        appConfigBamboo.oauth.consumer_secret,
        "1.0",
        config.protocol + "://localhost:" + config.port + "/bamboo/callback/",
        "RSA-SHA1");


//setup express
app.use(errorHandler({ dumpExceptions: true, showStack: true }));
app.use(logger('combined'));
app.use(cookieParser());
app.use(session({
    secret: appConfigJira.oauth.consumer_secret,
    resave: true,
    saveUninitialized: true
}));


function getAccessToken(consumer, appConfig, basePath, request, response){
    consumer.getOAuthRequestToken(
        function (error, oauthToken, oauthTokenSecret) {
            if (error) {
                console.log(error.data);
                response.send('Error getting OAuth access token');
            }
            else {
                request.session.oauthRequestToken = oauthToken;
                request.session.oauthRequestTokenSecret = oauthTokenSecret;
                response.redirect(basePath + appConfig.paths.authorize + "?oauth_token=" + request.session.oauthRequestToken);
            }
        }
    );
}

function callback(consumer, appConfig, app, request, response){
    consumer.getOAuthAccessToken(request.session.oauthRequestToken, request.session.oauthRequestTokenSecret, request.query.oauth_verifier,
        function (error, oauthAccessToken, oauthAccessTokenSecret) {
            if (error) {
                console.log(error.data);
                response.send("Error getting access token");
            }
            else {
                appConfig.oauth.access_token = oauthAccessToken;
                appConfig.oauth.access_token_secret = oauthAccessTokenSecret;
                //save to config file
                config.applications[app] = appConfig;
                fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
                response.send("Successfully saved new OAuth access token");
            }
        }
    );
}

function rest(consumer, appConfig, basePath, request, response){
    consumer.get(basePath + "/rest/api/latest/" + request.query.req,
        appConfig.oauth.access_token,
        appConfig.oauth.access_token_secret,
        function (error, data) {
            data = JSON.parse(data);
            response.send(JSON.stringify(data, null, 2));
        }
    );
}

//get new access token
app.get('/jira', function (request, response) {
    getAccessToken(consumerJira, appConfigJira, basePathJira, request, response);
});
app.get('/bamboo', function (request, response) {
    getAccessToken(consumerBamboo, appConfigBamboo, basePathBamboo, request, response);
});

//oauth dance callback
app.get('/jira/callback', function (request, response) {
    callback(consumerJira, appConfigJira, 'jira', request, response);
});
app.get('/bamboo/callback', function (request, response) {
    callback(consumerBamboo, appConfigBamboo, 'bamboo', request, response);
});

//access rest api
app.get('/jira/rest', function (request, response) {
    rest(consumerJira, appConfigJira, basePathJira, request, response);
});
app.get('/bamboo/rest', function (request, response) {
    rest(consumerBamboo, appConfigBamboo, basePathBamboo, request, response);
});

if(config.protocol === "https") {
    var privateKey  = fs.readFileSync(config.SSLPrivateKey, 'utf8');
    var certificate = fs.readFileSync(config.SSLCertificate, 'utf8');
    var credentials = {key: privateKey, cert: certificate};
    https.createServer(credentials, app).listen(config.port);
} else {
    http.createServer(app).listen(config.port);
}
