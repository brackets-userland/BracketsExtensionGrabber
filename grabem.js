/*jslint node: true, nomen: true */
/*eslint-env node*/
/*eslint no-console: 0 */

"use strict";

var request       = require("request"),
    DecompressZip = require("decompress-zip"),
    fs            = require("fs"),
    path          = require("path"),
    async         = require("async"),
    rimraf        = require("rimraf"),
    _             = require("lodash");

var REGISTRY_BASE = "https://s3.amazonaws.com/extend.brackets",
    REGISTRY_URL  = REGISTRY_BASE + "/registry.json",
    lastRegistry  = {},
    DOWNLOADS     = "downloads",
    ZIPS          = path.join(DOWNLOADS, "zips"),
    REGISTRY      = path.join(DOWNLOADS, "registry.json");

if (!fs.existsSync(DOWNLOADS)) {
    console.log("Creating downloads directory");
    fs.mkdirSync(DOWNLOADS);
    fs.mkdirSync(ZIPS);
}

if (fs.existsSync(REGISTRY)) {
    console.log("Reading previously downloaded registry");
    lastRegistry = JSON.parse(fs.readFileSync(REGISTRY));
}

console.log("Downloading latest registry");

function getZipPath(name, version) {
    return path.join(ZIPS, name + "-" + version + ".zip");
}

function doExpansion(source, destination, complete) {
    console.log("Unpacking", source);
    var unzipper = new DecompressZip(source);
    unzipper.on("error", function (err) {
        console.error("Problem unpacking", source);
        console.error(err);
        complete();
    });
    
    unzipper.on("extract", function () {
        console.log("Extraction complete");
        complete();
    });
    unzipper.extract({
        path: destination
    });
}

function deleteOldAndExpand(name, version, complete) {
    var source = getZipPath(name, version),
        destination = path.join(DOWNLOADS, name);
    
    if (fs.existsSync(destination)) {
        console.log("Erasing old ", destination);
        rimraf(destination, function (err) {
            if (err) {
                console.error("Problem erasing ", destination);
                complete();
                return;
            }
            doExpansion(source, destination, complete);
        });
    } else {
        doExpansion(source, destination, complete);
    }
}

function downloadAndExpand(name, version, complete) {
    var url         = REGISTRY_BASE + "/" + name + "/" + name + "-" + version + ".zip",
        destination = getZipPath(name, version);
    
    console.log("Downloading", url);
    
    request.get(url)
        .on("error", function (err) {
            console.log("Error downloading", url);
            console.error(err);
            complete();
            return;
        })
        .pipe(fs.createWriteStream(destination))
        .on("finish", function () {
            deleteOldAndExpand(name, version, complete);
        });
}

function saveRegistry(registry, complete) {
    console.log("Saving registry");
    fs.writeFile(REGISTRY, JSON.stringify(registry), complete);
}

request.get({
    url: REGISTRY_URL,
    gzip: true,
    json: true
}, function (err, response, registry) {
    if (err) {
        console.log("Error downloading registry");
        console.error(err);
        return;
    }
    
    var tasks = [];
    
    if (response.statusCode !== 200) {
        console.log("Unexpected response", response.statusCode);
        console.log(registry);
        return;
    }
    Object.keys(registry).forEach(function (name) {
        var version = registry[name].metadata.version,
            zipfile = getZipPath(name, version),
            zipExists = fs.existsSync(zipfile);
        if (!lastRegistry[name] || lastRegistry[name].metadata.version !== version || !zipExists) {
            if (zipExists) {
                tasks.push(_.partial(deleteOldAndExpand, name, version));
            } else {
                tasks.push(_.partial(downloadAndExpand, name, version));
            }
        }
    });
    
    console.log(tasks.length, "packages to update");
    
    async.series(tasks, function () {
        saveRegistry(registry, function () {
            console.log("Update complete");
        });
    });
});