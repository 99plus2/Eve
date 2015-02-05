//---------------------------------------------------------
// utils
//---------------------------------------------------------

var now = function() {
  if(typeof window !== "undefined" && window.performance) {
    return window.performance.now();
  } else if(typeof performance !== "undefined") {
    return performance.now();
  }
  return (new Date()).getTime();
};

function errorsToFacts(application, errors) {
  if(!errors) return [];

  return errors.map(function(cur) {
    if(typeof cur === "string") {
      cur = {message: cur};
    }
    return [application.runNumber, cur.message, cur.stack || "", cur.line || "N/A"];
  });
}

function diffArray(neue, old) {
  var adds = [];
  var removes = [];
  for(var i = 0, len = neue.length; i < len; i++) {
    if(old.indexOf(neue[i]) === -1) {
      adds.push(neue[i]);
    }
  }
  for(var i = 0, len = old.length; i < len; i++) {
    if(neue.indexOf(old[i]) === -1) {
      removes.push(old[i]);
    }
  }
  return {adds: adds, removes: removes};
}

function diffTables(neue, old) {
  var adds = [];
  var removes = [];
  if(old && neue) {
    try {
      neue.diff(old, adds, removes);
    } catch(e) {
      adds = neue.getFacts();
      removes = old.getFacts();
    }
  } else if(neue) {
    adds = neue.getFacts();
  }
  return {adds: adds, removes: removes};
}

function diffSystems(neue, old, tables) {
  var final = {};
  if(!old) {
    old = System.empty({});
    old.update(commonViews(), []);
    old.recompile();
  }
  if(!tables) {
    tables = neue.getStore("view").getFacts().map(function(cur) {
      return cur[0];
    });
  }
  for(var i = 0, len = tables.length; i < len; i++) {
    var table = tables[i];
    var diff = diffTables(neue.getStore(table), old.getStore(table));
    if(diff.adds.length || diff.removes.length) {
      final[table] = diff;
    }
  }
  return final;
}

function applyDiff(application, table, diff) {
  if(diff.adds.length || diff.removes.length) {
    application.system.updateStore(table, diff.adds, diff.removes);
  }
}

function applySystemDiff(application, diffs) {
  for(var table in diffs) {
    applyDiff(application, table, diffs[table]);
  }
  return application;
}

//---------------------------------------------------------
// functions
//---------------------------------------------------------

function interval(start, end) {
  return new Interval(start, end);
}

function hours(ms) {
  return (new Date(ms)).getHours();
}

function minutes(ms) {
  return (new Date(ms)).getMinutes();
}

function seconds(ms) {
  return (new Date(ms)).getSeconds();
}

function milliseconds(ms) {
  return (new Date(ms)).getMilliseconds();
}

var sin = Math.sin;
var cos = Math.cos;
var tan = Math.tan;

//---------------------------------------------------------
// aggregates
//---------------------------------------------------------

function sum(arr) {
  return arr.reduce(function (a,b) {return a+b;}, 0);
}

function count(arr) {
  return arr.length;
}

function avg(arr) {
  var c = count(arr);
  if(c === 0) {
    return 0;
  } else {
    return sum(arr) / c;
  }
}

function maxBy(desired, sort, otherwise) {
  var max = -Infinity;
  var maxIx;
  for(var i = sort.length; i >= 0; i--) {
    if(sort[i] > max) {
      max = sort[i];
      maxIx = i;
    }
  }
  if (maxIx !== undefined) return desired[maxIx];
  if (otherwise !== undefined) return otherwise;
  assert(false);
}

function lastBefore(desired, sort, limit, otherwise) {
  var max = -Infinity;
  var maxIx;
  for(var i = sort.length; i >= 0; i--) {
    if((sort[i] > max) && (sort[i] < limit)) {
      max = sort[i];
      maxIx = i;
    }
  }
  if (maxIx !== undefined) return desired[maxIx];
  if (otherwise !== undefined) return otherwise;
  assert(false);
}

function firstAfter(desired, sort, limit, otherwise) {
  var max = Infinity;
  var maxIx;
  for(var i = sort.length; i >= 0; i--) {
    if((sort[i] < max) && (sort[i] > limit)) {
      max = sort[i];
      maxIx = i;
    }
  }
  if (maxIx !== undefined) return desired[maxIx];
  if (otherwise !== undefined) return otherwise;
  assert(false);
}

//---------------------------------------------------------
// Filters
//---------------------------------------------------------
// Returns all items in desired where the interval or point represented by sort is contained within [start, end]
function contains(desired, sort, start, end) {
  assert(desired.length === sort.length, "Desired and sort fields must both be of the same length. Did you remember to filter them both?");
  // start is actually an interval
  if(end === undefined && typeof start === 'object') {
    end = start.end;
    start = start.start;
  }
  if(end === 'undefined') {
    end = Infinity;
  }

  var results = [];
  for(var i = 0, len = sort.length; i < len; i++) {
    var v = sort[i];
    var type = typeof v;
    if(type === "number") {
      v = {start: v, end: v};
    }
    assert(typeof v === "object", "Contains sort field must contain intervals or numbers.");

    if(v.start >= start && v.end <= end)  {
      results.push(desired[i]);
    }
  }
  return results;
}

// Sorts desired by sort ascending
function sort(desired, sort) {
  assert(desired.length === sort.length, "Desired and sort fields must both be of the same length. Did you remember to filter them both?");

  var len = sort.length;
  // Allocate an array of the indexes.
  var results = new Array(len)
  for(var i = 0; i < len; i++) {
    results[i] = i;
  }
  // Sort the index array into the desired order.
  results.sort(function(a, b) {
    if(sort[a] > sort[b]) { return 1; }
    if(sort[a] < sort[b]) { return -1; }
    return 0;
  });

  // Overwrite the indexes with the desired values.
  for(i = 0; i < len; i++) {
    results[i] = desired[results[i]];
  }

  return results;
}

//---------------------------------------------------------
// Program
//---------------------------------------------------------

var Application = function(system, opts) {
  this.eventId = 1;
  this.system = system || System.empty({name: "unknown"});
  this.storage = {"uiWatcher": {},
                  "timerWatcher": {},
                  "compilerWatcher": {},
                  "remoteWatcher": {},
                  "programInfo": {},
                  };
  this.runNumber = 0;
  this.running = true;
  this.system.update(commonViews(), []);
  this.system.recompile();
}

Application.prototype.totalFacts = function() {
  var numFacts = 0;
  for (var table in this.system.nameToIx) {
    var store = this.system.getStore(table);
    if(store) numFacts += store.facts.length;
  }
  return numFacts;
};

Application.prototype.updateSystem = function(system) {
  this.system = system;
};

Application.prototype.run = function(facts, removes) {
  if(!this.running) return;

  this.runNumber++;
  var start = now();
  try {
    this.system.updateStore("error", [], this.system.getStore("error").getFacts());
    this.system.update(facts, removes || []);
    var errors = [];
    this.system.refresh(errors);
    this.compileWatcher(this, this.storage["compilerWatcher"], this.system);
    this.timerWatcher(this, this.storage["timerWatcher"], this.system);
    this.uiWatcher(this, this.storage["uiWatcher"], this.system);
    //errors
    if(errors.length) {
      this.system.updateStore("error", errorsToFacts(errors), []);
    }
    this.system.updateStore("profile", [[this.runNumber, "runtime", now() - start]], []);
  } catch(e) {
    this.system.updateStore("error", errorsToFacts([e]), []);
  }
  start = now();
  this.remoteWatcher(this, this.storage["remoteWatcher"], this.system);
  this.system.updateStore("profile", [[this.runNumber, "remoteWatcher", now() - start]], []);

  return errors;
};

function app(system, opts) {
  return new Application(system, opts);
}

//---------------------------------------------------------
// helpers
//---------------------------------------------------------

var compilerTables = ["view", "field", "query", "constantConstraint", "functionConstraint", "functionConstraintInput", "constantConstraint",
                      "viewConstraint", "viewConstraintBinding", "aggregateConstraint", "aggregateConstraintBinding", "aggregateConstraintSolverInput",
                      "aggregateConstraintAggregateInput", "isInput", "isCheck"];

var addedTables = {};

function pushAll(arr, things) {
  Array.prototype.push.apply(arr, things);
  return arr;
}

function view(name, fields) {
  addedTables[name] = true;
  var facts = [["view", name]];
  for(var i = 0; i < fields.length; i++) {
    var field = fields[i];
    var munged = name + "|field=" + field;
    facts.push(["displayName", munged, field]);
    facts.push(["field", munged, name, i]);
  }
  return facts;
}

function inputView(name, fields) {
  var final = view(name, fields);
  final.push(["isInput", name]);
  return final;
}

function commonViews() {
  var facts = [];
  pushAll(facts, inputView("workspaceView", ["view"]));
  pushAll(facts, inputView("rawEvent", ["eid", "label", "key", "value"]));
  pushAll(facts, inputView("eventTime", ["tick", "time"]));
  pushAll(facts, inputView("mousePosition", ["eid","x","y"]));
  pushAll(facts, inputView("keyboard", ["eid","keyCode","eventType"]));
  pushAll(facts, inputView("time", ["time"]));
  pushAll(facts, inputView("timer", ["id", "event", "rate"]));
  pushAll(facts, inputView("error", ["run", "error", "stack", "line"]));
  pushAll(facts, inputView("profile", ["run", "event", "time"]));
  pushAll(facts, view("subscription", ["view"]));
  pushAll(facts, view("uiElem", ["id", "type"]));
  pushAll(facts, view("uiText", ["id", "text"]));
  pushAll(facts, view("uiChild", ["parent", "pos", "child"]));
  pushAll(facts, view("uiAttr", ["id", "attr", "value"]));
  pushAll(facts, view("uiStyle", ["id", "attr", "value"]));
  pushAll(facts, view("uiEvent", ["id", "event", "label", "key"]));
  return facts;
}
