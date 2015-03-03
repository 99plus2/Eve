import macros from "../../macros.sjs";

var document = global.document;
var _ = require("lodash");
var React = require("react/addons");
var bootstrap = require("../bootstrap");
var grid = require("../grid");
var helpers = require("../helpers");
var JSML = require("../jsml");



//---------------------------------------------------------
// Globals
//---------------------------------------------------------

var tileGrid;
var indexer;
var dispatch;
var defaultSize = [6,3];
module.exports.defaultSize = defaultSize;
var aggregateFuncs = ["sum", "count", "avg", "maxBy"];
var KEYCODES = {
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  ENTER: 13,
  ESCAPE: 27
};

//---------------------------------------------------------
// React helpers
//---------------------------------------------------------

function init(_indexer, dispatcher) {
  module.exports.indexer = indexer = _indexer;
  module.exports.dispatch = dispatch = dispatcher;
  React.unmountComponentAtNode(document.body);
  var dims = document.body.getBoundingClientRect();
  tileGrid = grid.makeGrid(document.body, {
    dimensions: [dims.width - 100, dims.height - 110],
    gridSize: [12, 12],
    marginSize: [10,10]
  });
};
module.exports.init = init;

function render() {
  React.render(Root(), document.body);
}
module.exports.render = render;

function reactFactory(obj) {
  return React.createFactory(React.createClass(obj));
}
module.exports.reactFactory = reactFactory;

// Parse the most specific interpretation of a string into a JS value.
function parseValue(value) {
  //if there are non-numerics then it can't be a number
  if(value.match(new RegExp("[^\\d\\.-]"))) {
    return value;
  } else if(value.indexOf(".")) {
    //it's a float
    return parseFloat(value);
  }
  return parseInt(value);
}
module.exports.parseValue = parseValue;

// Destructively merges wrapper into attrs.
function mergeAttrs(attrs, wrapper) {
  forattr(key, val of wrapper) {
    if(!(key in attrs)) {
      attrs[key] = val;

    } else if(key === "className") {
      attrs[key] += " " + val;

    } else if(typeof val === "function") {
      var oldFn = attrs[key];
      attrs[key] = function() {
        oldFn.apply(null, arguments);
        val.apply(null, arguments);
      };
    } else {
      attrs[key] = val;
    }
  }

  return attrs;
}
module.exports.mergeAttrs = mergeAttrs;

//---------------------------------------------------------
// Mixins
//---------------------------------------------------------

var mixin = {
  contentEditable: {
    getInitialState: function() {
      return {editing: false, edit: null};
    },
    startEditing: function(e) {
      this.setState({editing: true});
      e.currentTarget.focus();
      e.stopPropagation();
    },
    stop: function(e) {
      e.stopPropagation();
    },
    maybeStopEditing: function(e) {
      //handle pressing enter
      if(e.keyCode === KEYCODES.ENTER) {
        this.state.force = true;
        e.currentTarget.blur();
        e.preventDefault();
      }
    },
    updateEdit: function(e) {
      this.state.edit = parseValue(e.target.textContent);
    },
    stopEditing: function() {
      this.setState({editing: false});
      var commitSuccessful = this.commit(this.state.force);
      this.state.force = false;
      if(commitSuccessful) {
        this.setState({edit: ""});
      }
    },
    wrapEditable: function(attrs, content) {
      var wrapper = {
        contentEditable: this.state.editin,
        className: this.state.editing ? "selected" : "",
        onClick: this.startEditing,
        onDoubleClick: this.stop,
        onKeyDown: this.maybeStopEditing,
        onInput: this.updateEdit,
        onBlur: this.stopEditing,
        dangerouslySetInnerHTML: {__html: this.state.edit || content }
      };
      return mergeAttrs(attrs, wrapper);
    }
  }
};
mixin.input = _.clone(mixin.contentEditable);
mixin.input.updateEdit = function(e) {
  this.state.edit = e.target.value;
};
mixin.input.wrapEditable = function(attrs, content) {
  var wrapper = {
    className: this.state.editing ? "selected" : "",
    onClick: this.startEditing,
    onKeyDown: this.maybeStopEditing,
    onInput: this.updateEdit,
    onBlur: this.stopEditing,
    value: this.state.edit || content
  };
  return mergeAttrs(attrs, wrapper);
};
module.exports.mixin = mixin;


//---------------------------------------------------------
// Stand alone components
//---------------------------------------------------------

var ProgramLoader = reactFactory({
  getInitialState: function() {
    var programs = Object.keys(bootstrap.taskManager.list());
    var current = bootstrap.taskManager.current().name;
    return {programs: programs, current: current};
  },
  change: function(e) {
    bootstrap.taskManager.run(e.target.value);
  },
  render: function() {
    var current = this.state.current;
    var options = [];
    foreach(ix, name of this.state.programs) {
      options.push(["option", {value: name}, name]);
    }
    return JSML.react(["select", {className: "program-loader", onChange: this.change, value: current}, options]);
  }
});

var searchMethod = {
  view: function searchForView(needle) {
    var results = [];
    var names = indexer.index("displayName", "lookup", [0, 1]);
    var name;
    foreach(view of indexer.facts("view")) {
      unpack [id] = view;
      name = names[id] ? names[id].toString() : false;
      if(name && name.toLowerCase().indexOf(needle.toLowerCase()) > -1) {
        results.push([id, name]);
      }
    }
    return results;
  },

  field: function searchForField(needle, searchOpts) {
    searchOpts = searchOpts || {};
    var results = [];
    var names = indexer.index("displayName", "lookup", [0, 1]);
    var name;
    var fields = indexer.index("field", "collector", [1])[searchOpts.view];
    if(!fields) {
      fields = indexer.facts("field");
    }
    foreach(field of fields) {
      unpack [id, view, ix] = field;
      name = names[id];
      if(name && name.toLowerCase().indexOf(needle.toLowerCase()) > -1) {
        results.push([id, name]);
      }
    }
    return results;
  }
};

var Searcher = reactFactory({
  getInitialState: function() {
    var search = searchMethod[this.props.type];
    if(!search) throw new Error("No search function defined for type: '" + this.props.type + "'.");
    return {active: false, index: undefined,
            current: "", value: "",
            max: this.props.max || 10,
            possible: search('', this.props.searchOpts),
            search: search};
  },

  input: function(e) {
    this.setState({
      active: true,
      index: undefined,
      value: e.target.value,
      current: e.target.value,
      possible: this.state.search(e.target.value, this.props.searchOpts)
    });
  },

  focus: function(e) { this.setState({active: true}); },
  blur: function(e) {},
  select: function(ix) {
    var cur = this.state.possible[ix];
    if(cur) {
      dispatch([this.props.event, {selected: cur, id: this.props.id}]);
    }
    var state = this.getInitialState();
    this.setState(state);
  },

  keydown: function(e) {
    var max = Math.min(this.state.possible.length, this.state.max);

    // FIXME: stupid 1 access to grab the name.
    switch (e.keyCode) {
      case KEYCODES.DOWN:
        e.preventDefault();
        if (this.state.index === undefined) {
          var newindex = 0;
          this.setState({index: newindex, value: this.state.possible[newindex][1]});
        } else if (this.state.index !== max) {
          var newindex = this.state.index + 1;
          this.setState({index: newindex, value: this.state.possible[newindex][1]});
        }
      break;
      case KEYCODES.UP:
        e.preventDefault();
        if (this.state.index === 0) {
          this.setState({index: undefined, value: this.state.current});
        } else if (this.state.index !== undefined) {
          var newindex = this.state.index - 1;
          this.setState({index: newindex, value: this.state.possible[newindex][1]});
        }
      break;
      case KEYCODES.ENTER:
        this.select(this.state.index || 0);
      break;
      case KEYCODES.ESCAPE:
        this.setState(this.getInitialState());
      break;
    }
  },

  render: function() {
    var cx = React.addons.classSet;
    var possible = this.state.possible;
    var possiblelength = possible.length;
    var results = [];
    for(var i = 0; i < this.state.max && i < possiblelength; i++) {
      results.push(SearcherItem({searcher: this, focus: this.state.index === i, ix: i, item: possible[i], select: this.select}));
    }
    return JSML.react(["div", {"className": cx({"searcher": true,
                                                "active": this.state.active})},
                       ["input", {"type": "text",
                                  className: "full-input",
                                  "placeholder": this.props.placeholder || "Search",
                                  "value": this.state.value,
                                  "onFocus": this.focus,
                                  "onBlur": this.blur,
                                  "onKeyDown": this.keydown,
                                  "onInput": this.input}],
                       ["ul", {},
                        results]]);
  }
});

var SearcherItem = reactFactory({
  click: function() {
    this.props.select(this.props.ix);
  },
  render: function() {
    var focus = this.props.focus ? "focused" : "";
    var name = this.props.item ? this.props.item[1] : "";
    return JSML.react(["li", {"onClick": this.click, className: "menu-item " + focus}, name]);
  }
});

var ContextMenuItems = {
  text: reactFactory({
    click: function() {
      dispatch([this.props.event, this.props.id]);
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item", onClick: this.click}, this.props.text]);
    }
  }),
  input: reactFactory({
    mixins: [mixin.input],
    commit: function(force) {
      dispatch([this.props.event, {id: this.props.id, text: this.state.edit, force: force}]);
      return true;
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item"},
                         ["input", this.wrapEditable({className: "full-input", type: "text", placeholder: this.props.text})]
                        ]);
    }
  }),
  viewSearcher: reactFactory({
    click: function(e) {
      e.stopPropagation();
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item", onClick: this.click},
                         Searcher({event: this.props.event, placeholder: this.props.text, id: this.props.id, type: "view"})]);
    }
  }),
  fieldSearcher: reactFactory({
    click: function(e) {
      e.stopPropagation();
    },
    render: function() {
      return JSML.react(["div", {className: "menu-item", onClick: this.click},
                         Searcher({event: this.props.event, placeholder: this.props.text,
                                        id: this.props.id, type: "field",
                                        searchOpts: {view: indexer.index("field", "lookup", [0, 1])[this.props.id]}})]);
    }
  })
};

var ContextMenu = reactFactory({
  clear: function() {
    dispatch(["clearContextMenu"]);
  },
  render: function() {
    var items = indexer.facts("contextMenuItem").map(function(cur) {
      unpack [pos, type, text, event, id] = cur;
      return ContextMenuItems[type]({pos: pos, text: text, event: event, id: id});
    });
    return JSML.react(["div", {className: "menu-shade", onClick: this.clear},
                       ["div", {className: "menu", style: {top: this.props.y, left: this.props.x}},
                        items]]);
  }
});

//---------------------------------------------------------
// Root
//---------------------------------------------------------
var gridSize = [6, 2];

var Root = React.createFactory(React.createClass({
  adjustPosition: function(activeTile, cur) {
    unpack [tile, type, width, height, row, col] = cur;
    unpack [atile, atype, awidth, aheight, activeRow, activeCol] = activeTile;
    var rowOffset = row - activeRow;
    var colOffset = col - activeCol;
    // @FIXME: Why is this -2 here?
    var rowEdge = rowOffset > 0 ? tileGrid.rows + 1 : (rowOffset < 0 ? -2 * height : row);
    var colEdge = colOffset > 0 ? tileGrid.cols + 1 : (colOffset < 0 ? -2 * width : col);
    return [rowEdge, colEdge];
  },
  render: function() {
    var tiles = indexer.facts("gridTile").map(function(cur, ix) {
      unpack [tile, type, width, height, row, col] = cur;
      var gridItem = {
        tile: tile,
        size: [width, height],
        pos: [row, col]
      };
      if(!tileComponent[type]) {
        throw new Error("Unknown tile type: '" + type + "' for gridItem: " + JSON.stringify(gridItem));
      }
      return tileComponent[type](gridItem);
    });

    var menu = indexer.first("contextMenu");
    var gridContainer = ["div", {"id": "cards", "onClick": this.click}, tiles];

    var gridItems = indexer.getTileFootprints();
    while(true) {
      var slot = grid.firstGap(tileGrid, gridItems, defaultSize);
      if(!slot) { break; }
      var gridItem = {size: defaultSize, pos: slot};
      gridItems.push(gridItem);
      gridContainer.push(tileComponent.add(gridItem));
    }

    return JSML.react(
      ["div",
       ["canvas", {id: "clear-pixel", width: 1, height: 1}],
       ProgramLoader(),
       gridContainer,
       menu ? ContextMenu({x: menu[0], y: menu[1]}) : null]
    );
  }
}));

//---------------------------------------------------------
// tiles
//---------------------------------------------------------

  // Consistent wrapper component for all tiles.
  // Requires: {content: JSML}
  // Accepts: {navigable:Bool=false, selectable:Bool=false, controls:Bool=true}
var tileWrapper = reactFactory({
  enterTile: function() {
    dispatch(["enterTile", this.props.tile]);
  },
  closeTile: function(e) {
    dispatch(["deselectTile", this.props.tile]);
    dispatch(["closeTile", this.props.tile]);
    e.stopPropagation();
  },
  render: function() {
    var controls = "";
    if(this.props.controls !== false) {
      controls = ["div", {className: "tile-controls"},
                  ["button", {className: "tile-control close-btn", onClick: this.closeTile}, "X"]];
    }
    return JSML.react(
      ["div", {className: "card " + (this.props.class || ""),
               key: this.props.tile,
               onDrop: this.props.drop,
               onDragOver: this.props.dragOver,
               onContextMenu: this.props.contextMenu || undefined,
               onClick: (this.props.selectable) ? this.selectTile : undefined,
               onDoubleClick: (this.props.navigable) ? this.enterTile : undefined,
               style: grid.getSizeAndPosition(tileGrid, this.props.size, this.props.pos)},
       controls,
       this.props.content]
    );
  }
});
module.exports.tileWrapper = tileWrapper;

var tileComponent = {
  // Tile content placeholder
  add: reactFactory({
    click: function(e) {
      e.preventDefault();
      e.stopPropagation();
      dispatch(["setActivePosition", [this.props.size[0], this.props.size[1], this.props.pos[0], this.props.pos[1]]]);
      dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                items: [
                                  [0, "text", "New Table", "addTableTile", ""],
                                  [1, "text", "New View", "addViewTile", ""],
                                  [2, "text", "New UI", "addUI", ""],
                                  [3, "viewSearcher", "Existing table or view", "openView", ""]
                                ]}]);
    },
    render: function() {
      var className = "add-tile" + (this.props.active ? " selected" : "");
      var content = JSML.react(["div", {onClick: this.click, onContextMenu: this.click}, "+"]);
      return tileWrapper({pos: this.props.pos, size: this.props.size, id: "addTile", class: className, content: content, controls: false, selectable: false});
    }
  })
};

function registerTile(type, tile) {
  console.log("registering", type, tile);
  tileComponent[type] = tile;
};
module.exports.registerTile = registerTile;

// Require tiles.
var programUI = require("./program");
var viewUI = require("./view");
