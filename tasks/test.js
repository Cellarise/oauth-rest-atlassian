"use strict";
/**
 * A module to add gulp tasks which run test steps.
 * @exports tasks/testTasks
 * @param {Gulp} gulp - The gulp module
 * @param {Object} context - An object containing the following properties:
 * @param {String} context.cwd - The current working directory
 * @param {Object} context.package - The package.json for the module
 * @param {Array} context.argv - The arguments past to the gulp task
 * @param {bunyan} context.logger - A logger matching the bunyan API
 */
module.exports = function testTasks(gulp, context) {
  var mocha = require("gulp-mocha");
  var mkdirp = require("mkdirp");
  var gutil = require("gulp-util");
  var glob = require("glob");
  var path = require("path");
  var fs = require("fs");
  var R = require("ramda");
  var istanbul = require("gulp-istanbul");
  var babel = require("babel-core/register");
  var logger = context.logger;
  var COVERAGE_VAR = "__cpmCoverage__";

  var lowerCaseFirstLetter = function lowerCaseFirstLetter(str) {
    return str.slice(0, 1).toLowerCase() + str.slice(1);
  };
  var mergeFileCoverage = function mergeFileCoverage(first, second) {
    var ret = JSON.parse(JSON.stringify(first)), i;
    delete ret.l; //remove derived info
    Object.keys(second.s).forEach(function processkeys(k) {
      ret.s[k] += second.s[k];
    });
    Object.keys(second.f).forEach(function processkeys(k) {
      ret.f[k] += second.f[k];
    });
    Object.keys(second.b).forEach(function processkeys(k) {
      var retArray = ret.b[k],
        secondArray = second.b[k];
      for (i = 0; i < retArray.length; i += 1) {
        retArray[i] += secondArray[i];
      }
    });
    return ret;
  };
  var processCoverage = function processCoverage(coverageData) {
    if (!global.__cpmCoverage__) {
      global.__cpmCoverage__ = {};
    }
    R.mapObjIndexed(
      function mapMergedCov(fileCov, filePath) {
        if (global.__cpmCoverage__.hasOwnProperty(filePath)
          && !coverageData.hasOwnProperty(filePath)) {
          //nothing
        } else if (!global.__cpmCoverage__.hasOwnProperty(filePath)
          && coverageData.hasOwnProperty(filePath)) {
          global.__cpmCoverage__[filePath] = coverageData[filePath];
        } else {
          global.__cpmCoverage__[filePath] =
            mergeFileCoverage(global.__cpmCoverage__[filePath], coverageData[filePath]);
        }
      },
      R.merge(coverageData, global.__cpmCoverage__)
    );
  };

  var handleError = function handleError(err) {
    logger.error(err.toString());
    if (process.env.CI) {
      throw new gutil.PluginError({
        "plugin": "Gulp Mocha",
        "message": err.toString()
      });
    }
    this.emit("end"); //jshint ignore:line
  };


  var test = function test(reporter, outputCoverageReports) {
    var cwd = context.cwd;
    var pkg = context.package;
    var directories = pkg.directories;
    var sourceGlobStr = directories.lib + "/**/*.js";
    var scriptPath;
    var outputDir = path.join(cwd, directories.reports, "code-coverage"
      + (process.env.SELENIUM_PORT ? "-" + process.env.SELENIUM_PORT : ""));

    //make sure Temp folder exists before test
    mkdirp.sync(path.join(cwd, "Temp"));

    //require all library scripts to ensure istanbul picks up
    R.forEach(function eachSourceGlobStrFN(value) {
      scriptPath = path.resolve(process.cwd(), value);
      try {
        require(scriptPath); // Make sure all files are loaded to get accurate coverage data
        logger.info("Loaded: " + scriptPath);
      } catch (err) {
        logger.warn("Could not load: " + scriptPath);
      }
    }, glob.sync(sourceGlobStr));

    //set YADDA_FEATURE_GLOB if argv[2]
    if (context.argv.length === 2) {
      process.env.YADDA_FEATURE_GLOB = context.argv[1];
      logger.info("Set process.env.YADDA_FEATURE_GLOB=" + process.env.YADDA_FEATURE_GLOB);
    }

    if (outputCoverageReports) {
      return gulp.src(path.resolve(process.cwd(), directories.test + "/test.js"), {"read": false})
        .pipe(mocha({
          "compilers": {
            "js": babel
          },
          "bail": process.env.hasOwnProperty("bamboo_working_directory"),
          "reporter": reporter,
          "timeout": 600000
        }))
        .on("error", handleError)
        .pipe(istanbul.writeReports({
          "dir": outputDir,
          "coverageVariable": COVERAGE_VAR,
          "reporters": ["html", "lcov", require("istanbul-reporter-clover-limits"), "json-summary"],
          "reportOpts": {
            "dir": outputDir,
            "watermarks": pkg.config.coverage.watermarks
          }
        }))
        .pipe(istanbul.enforceThresholds({
          "coverageVariable": COVERAGE_VAR,
          "thresholds": {
            "each": {
              "statements": pkg.config.coverage.watermarks.statements[0],
              "branches": pkg.config.coverage.watermarks.branches[0],
              "lines": pkg.config.coverage.watermarks.lines[0],
              "functions": pkg.config.coverage.watermarks.functions[0]
            }
          }
        }));
    }
    return gulp.src(path.resolve(process.cwd(), directories.test + "/test.js"), {"read": false})
      .pipe(mocha({
        "compilers": {
          "js": babel
        },
        "bail": true,
        "reporter": reporter,
        "timeout": 600000
      }))
      .on("error", function onError(err) {
        //logger.error(err.toString());
        throw new gutil.PluginError({
          "plugin": "Gulp Mocha",
          "message": err.toString()
        });
      });
  };

  /**
   * A gulp build task to instrument files.
   * Istanbul will override the node require() function to redirect to the instrumented files.
   * @member {Gulp} instrument
   * @return {through2} stream
   */
  gulp.task("instrument", function instrumentTask() {
    var pkg = context.package;
    var directories = pkg.directories;
    var sourceGlobStr = directories.lib + "/**/*.js";
    /**
     * Istanbul code coverage will not work if there are tasks containing local references.
     * For example, var x = require("../../lib/index");
     * Note: that if gulpfile.js contains `gulp.loadTasks(__dirname);` then all tasks will be loaded
     * in gulp modules and the tasks directory.
     * Make sure all these tasks do not require local references as defined above.
     */
    return gulp.src(sourceGlobStr)
      .pipe(istanbul({
        "coverageVariable": COVERAGE_VAR,
        "includeUntested": true
      }))
      .pipe(istanbul.hookRequire()); // Force `require` to return covered files
    // Covering files - note: finish event called when finished (not end event)
  });

  /**
   * A gulp build task to run test steps and calculate test coverage.
   * Test steps results will be output using mocha-bamboo-reporter-bgo reporter.
   * This task executes the Instrument task as a prerequisite.
   * @member {Gulp} test_cover
   * @return {through2} stream
   */
  gulp.task("test_cover", ["instrument"], function testCoverTask() {
    var cwd = context.cwd;
    var pkg = context.package;
    var directories = pkg.directories;
    var MOCHA_FILE_NAME = 'unit-mocha-tests' + (process.env.SELENIUM_PORT ? "-" + process.env.SELENIUM_PORT : "");

    //results file path for mocha-bamboo-reporter-bgo
    process.env.MOCHA_FILE = path.join(cwd, directories.reports, MOCHA_FILE_NAME + ".json");
    //make sure the Reports directory exists - required for mocha-bamboo-reporter-bgo
    mkdirp.sync(path.join(cwd, directories.reports));
    if (process.env.CI) {
      return test("spec", true);
    }
    return test("mocha-bamboo-reporter-bgo", true);
  });

  /**
   * A gulp build task to run test steps and calculate test coverage (but not output test coverage to prevent
   * gulp-istanbul issues with webdriverIO).
   * Test steps results will be output using mocha-bamboo-reporter-bgo reporter.
   * This task executes the Instrument task as a prerequisite.
   * @member {Gulp} test_cover
   * @return {through2} stream
   */
  gulp.task("test_cover_no_cov_report", function testCoverNoCovReportTask() {
    var cwd = context.cwd;
    var pkg = context.package;
    var directories = pkg.directories;
    var MOCHA_FILE_NAME = 'unit-mocha-tests' + (process.env.SELENIUM_PORT ? "-" + process.env.SELENIUM_PORT : "");

    //results file path for mocha-bamboo-reporter-bgo
    process.env.MOCHA_FILE = path.join(cwd, directories.reports, MOCHA_FILE_NAME + ".json");
    //make sure the Reports directory exists - required for mocha-bamboo-reporter-bgo
    mkdirp.sync(path.join(cwd, directories.reports));
    if (process.env.CI) {
      return test("spec", false);
    }
    return test("mocha-bamboo-reporter-bgo", false);
  });

  /**
   * A gulp build task to run test steps and calculate test coverage (but not output test coverage to prevent
   * gulp-istanbul issues with webdriverIO).
   * Test steps results will be output using mocha-bamboo-reporter-bgo reporter.
   * This task executes the Instrument task as a prerequisite.
   * @member {Gulp} test_cover
   * @return {through2} stream
   */
  gulp.task("test_cover_save_cov", ["test_cover_no_cov_report"], function testCoverTask(cb) {
    var cwd = context.cwd;
    var cwdForwardSlash = lowerCaseFirstLetter(cwd).replace("/", "\\");
    var pkg = context.package;
    var directories = pkg.directories;
    var outputDir = path.join(cwd, directories.reports, "code-coverage");
    var localPathCoverage = R.pipe(
      R.toPairs,
      R.map(function mapObjPair(objPair) {
        var filePath = lowerCaseFirstLetter(objPair[0]);
        return [filePath.replace(cwdForwardSlash, ""), objPair[1]];
      }),
      R.fromPairs
    )(global[COVERAGE_VAR]);
    //make sure outputDir exists and save the raw coverage file for future use
    mkdirp.sync(outputDir);
    fs.writeFile(
      path.join(outputDir, 'coverage' + (process.env.SELENIUM_PORT ? "-" + process.env.SELENIUM_PORT : "") + '.json'),
      JSON.stringify(localPathCoverage), 'utf8',
      cb
    );
  });

  /**
   * A gulp build task to write coverage.
   * @member {Gulp} write_coverage
   * @return {through2} stream
   */
  gulp.task("write_coverage", function testWriteCoverage() {
    var cwd = context.cwd;
    var pkg = context.package;
    var directories = pkg.directories;
    var outputDir = path.join(cwd, directories.reports, "code-coverage");
    var outputDirs = [
      path.join(cwd, directories.reports, "1", "code-coverage"),
      path.join(cwd, directories.reports, "2",  "code-coverage"),
      path.join(cwd, directories.reports, "3",  "code-coverage"),
      path.join(cwd, directories.reports, "4",  "code-coverage"),
      path.join(cwd, directories.reports, "5",  "code-coverage"),
      path.join(cwd, directories.reports, "6",  "code-coverage"),
      path.join(cwd, directories.reports, "7",  "code-coverage"),
      path.join(cwd, directories.reports, "8",  "code-coverage"),
      path.join(cwd, directories.reports, "9",  "code-coverage"),
      path.join(cwd, directories.reports, "10",  "code-coverage"),
      path.join(cwd, directories.reports, "11",  "code-coverage"),
      path.join(cwd, directories.reports, "12",  "code-coverage"),
      path.join(cwd, directories.reports, "13",  "code-coverage"),
      path.join(cwd, directories.reports, "14",  "code-coverage"),
      path.join(cwd, directories.reports, "15",  "code-coverage"),
      path.join(cwd, directories.reports, "16",  "code-coverage"),
      path.join(cwd, directories.reports, "17",  "code-coverage"),
      path.join(cwd, directories.reports, "18",  "code-coverage"),
      path.join(cwd, directories.reports, "19",  "code-coverage"),
      path.join(cwd, directories.reports, "20",  "code-coverage"),
      path.join(cwd, directories.reports, "NFR", "code-coverage")
    ];
    var coverageFileNames = [
      'coverage-4441.json',
      'coverage-4442.json',
      'coverage-4443.json'
    ];
    var fileContents;
    //read all coverage files and add to global[COVERAGE_VAR]
    R.forEach(
      function forEachOutputDir(reportDir) {
        R.forEach(
          function forEachFile(fileName) {
            try {
              fileContents = fs.readFileSync(path.join(reportDir, fileName));
              logger.info("Loaded: " + reportDir + fileName);
              //add find and replace for bamboo build server remote agents
              processCoverage(
                JSON.parse(fileContents
                  .toString('utf-8')
                  .replace(
                    /(C:|D:|c:|d:)\\\\bamboo.*?\\\\xml-data\\\\build-dir\\\\.*?\\\\.*?\\\\/g,
                    cwd.replace(/\\/g, "\\\\") + "\\\\"
                  )
                )
              );
            } catch (err) {
              logger.info("Write coverage failed for: " + reportDir + fileName);
              return false;
            }
          },
          coverageFileNames
        );
      },
      outputDirs
    );

    //clean coverage
    delete global[COVERAGE_VAR].class;
    delete global[COVERAGE_VAR].hCode;
    delete global[COVERAGE_VAR].sessionId;
    delete global[COVERAGE_VAR].state;
    delete global[COVERAGE_VAR].status;
    delete global[COVERAGE_VAR].value;

    //copy path to file key
    global[COVERAGE_VAR] = R.pipe(
      R.toPairs,
      R.map(function mapObjPair(objPair) {
        var filePath = lowerCaseFirstLetter(objPair[0]);
        if (objPair[1].path) {
          filePath = lowerCaseFirstLetter(objPair[1].path);
        }
        return [filePath, objPair[1]];
      }),
      R.fromPairs
    )(global[COVERAGE_VAR]);


    return gulp.src(outputDir, {"read": false})
      .pipe(istanbul.writeReports({
        "dir": outputDir,
        "coverageVariable": COVERAGE_VAR,
        "reporters": ["html", "lcov", require("istanbul-reporter-clover-limits"), "json-summary"],
        "reportOpts": {
          "dir": outputDir,
          "watermarks": pkg.config.coverage.watermarks
        }
      }))
      .pipe(istanbul.enforceThresholds({
        "coverageVariable": COVERAGE_VAR,
        "thresholds": {
          "each": {
            "statements": pkg.config.coverage.watermarks.statements[0],
            "branches": pkg.config.coverage.watermarks.branches[0],
            "lines": pkg.config.coverage.watermarks.lines[0],
            "functions": pkg.config.coverage.watermarks.functions[0]
          }
        }
      }));
  });

  /**
   * A gulp build task to run test steps and calculate test coverage.
   * Test steps results will be output using spec reporter.
   * @member {Gulp} test
   * @return {through2} stream
   */
  gulp.task("test", function testTask() {
    return test("spec", true);
  });
};
