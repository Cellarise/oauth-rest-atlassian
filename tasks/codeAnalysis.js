"use strict";

/**
 * A module to add gulp tasks which execute static code analysis.
 * @exports tasks/codeAnalysisTasks
 * @param {Gulp} gulp - The gulp module
 * @param {Object} context - An object containing the following properties:
 * @param {String} context.cwd - The current working directory
 * @param {Object} context.package - The package.json for the module
 * @param {Array} context.argv - The arguments past to the gulp task
 * @param {bunyan} context.logger - A logger matching the bunyan API
 */
module.exports = function codeAnalysisTasks(gulp, context) {
  var eslint = require("gulp-eslint");

  /**
   * A gulp build task to execute static code analysis on the files at `package.json:directories.lib`.
   * The report results are saved to `package.json:directories.reports`
   * @member {Gulp} code_analysis
   * @return {through2} stream
   */
  gulp.task("code_analysis", function codeAnalysisTask() {
    var cwd = context.cwd;
    var pkg = context.package;
    var directories = pkg.directories;
    var reportPath = cwd + "/" + pkg.directories.reports;
    var mkdirp = require("mkdirp");
    var srcArr = [directories.lib + "/**/*.js", directories.tasks + "/**/*.js", directories.test + "/**/*.js"];
    if (directories.client) {
      srcArr.push(directories.client + "/source/**/*.js");
      srcArr.push(directories.client + "/source/**/*.jsx");
    }
    if (directories.server) {
      srcArr.push(directories.server + "/**/*.js");
    }
    if (directories.common) {
      srcArr.push(directories.common + "/**/*.js");
    }
    if (directories.functions) {
      directories.functions.forEach(function eachDir(dir) {
        srcArr.push(dir + "/**/*.js");
      });
    }
    mkdirp.sync(reportPath);
    return gulp.src(srcArr)
      // eslint() attaches the lint output to the eslint property
      // of the file object so it can be used by other modules.
      .pipe(eslint())
      // eslint.format() outputs the lint results to the console.
      // Alternatively use eslint.formatEach() (see Docs).
      .pipe(eslint.format())
      // To have the process exit with an error code (1) on
      // lint error, return the stream and pipe to failOnError last.
      .pipe(eslint.failOnError());
  });
};
