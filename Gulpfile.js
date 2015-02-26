var batch = require("gulp-batch");
var browserify = require("browserify");
var buffer = require("vinyl-buffer");
var glob = require("glob-all");
var gulp = require("gulp-help")(require("gulp"));
var livereload = require("gulp-livereload");
var plumber = require("gulp-plumber");
var source = require("vinyl-source-stream");
var sourcemaps = require("gulp-sourcemaps");
var stylus = require("gulp-stylus");
var sweetify = require("sweetify");

// Styles

function compileStylus() {
  console.log("compiling stylus...");
  return gulp.src("stylus/**/*.stylus")
  .pipe(sourcemaps.init())
  .pipe(plumber())
  .pipe(stylus())
  .pipe(sourcemaps.write("."))
  .pipe(gulp.dest("stylus"));
}
gulp.task("stylus", "Compile stylus files to CSS.", compileStylus);

gulp.task("watch-stylus", "Watch stylus files for changes.", ["stylus"], function() {
  livereload.listen();
  return gulp.watch("stylus/**/*.stylus", batch(function(events) {
    return compileStylus()
    .pipe(livereload());
  }));
});

// JS Bundles

var editorSources = ["src/editor/**/*.js"];
var editorDeps = ["react/addons", "lodash", "lodash-deep"];
var macroSources = ["src/**/*.sjs"];

function bundle(name, files, opts) {
  var bundler = browserify({
    debug: true
  })
  .add(files, {expose: true});
  bundler.transform(sweetify, {
    extensions: /.+\.(js|sjs)$/,
    formatIndent: 2,
    readableNames: true
  });

  if(opts) {
    for(var key in opts) {
      if(opts[key]) {
        for(var i = 0; i < opts[key].length; i++) {
          bundler[key](opts[key]);
        }
      }
    }
  }

  return bundler.bundle()
  .on('error', function(err){
    console.log("[bundle] Error:", err.message);
    this.end();
  })

  .pipe(source(name))
  .pipe(gulp.dest("build"))
  .on("end", function() {
    bundler.reset();
  });
}
gulp.task("build-editor", "Build the editor bundle.", function() {
  bundle("editor.js", ["./src/editor/bootstrap.js"], {external: ["react/addons"]});
  bundle("editor-deps.js", [], {require: editorDeps});
});

gulp.task("build-worker", "Build the worker bundle.", function() {
  bundle("worker.js", ["./src/worker.js"]);
});

gulp.task("build", "Build all the things.", ["stylus", "build-editor", "build-worker"]);

// Watch tasks

gulp.task("watch-editor", "Watch editor related files for changes.", ["build-editor"], function() {
  return gulp.watch(editorSources.concat(macroSources), function(events) {
    console.log("Recompiling editor");
    return bundle("editor.js", ["./src/editor/bootstrap.js"], {external: editorDeps});
  });
});

gulp.task("watch-worker", "Watch worker related files for changes.", ["build-worker"], function() {
  return gulp.watch(editorSources.concat(macroSources), function(events) {
    console.log("Recompiling worker");
    return bundle("worker.js", ["./src/worker.js"]);
  });
});


// Run the server.
gulp.task("run-server", "Run the eve server.", function() {
  require('./server');
});

gulp.task("watch", "Watch all the things.", ["watch-stylus", "watch-editor", "watch-worker", "run-server"]);
