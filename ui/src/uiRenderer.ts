/// <reference path="./microReact.ts" />
/// <reference path="./indexer.ts" />
/// <reference path="./api.ts" />
module uiRenderer {
  type Id = string;
  type RowTokeyFn = (row:{[key:string]: any}) => string;

  interface Element extends microReact.Element {
    __elemId:string
  }

  api.ixer.addIndex("ui parent to elements", "uiElement", Indexing.create.collector(["uiElement: parent"]));
  api.ixer.addIndex("ui element to attributes", "uiAttribute", Indexing.create.collector(["uiAttribute: element"]));
  api.ixer.addIndex("ui element to attribute bindings", "uiAttributeBinding", Indexing.create.collector(["uiAttributeBinding: element"]));

  export class UiRenderer {
    constructor(public renderer:microReact.Renderer) {

    }

    // @NOTE: In the interests of performance, roots will not be checked for ancestry --
    // instead of being a noop, specifying a child of a root as another root results in undefined behavior.
    // If this becomes a problem, it can be changed in the loop that initially populates compiledElements.
    compile(roots:Id[]):microReact.Element[] {
      let elementToChildren = api.ixer.index("ui parent to elements", true);
      let elementToAttrs = api.ixer.index("ui element to attributes", true);
      let elementToAttrBindings = api.ixer.index("ui element to attribute bindings", true);

      let stack:Element[] = [];
      let compiledElements:{[id:string]: microReact.Element} = {};
      let compiledKeys:{[id:string]: string} = {};
      let keyToRow:{[key:string]: any} = {};
      for(let root of roots) {
        let elem = {__elemId: root, id: root};
        compiledElements[root] = elem;
        stack.push(elem);
      }

      while(stack.length > 0) {
        let elem = stack.shift();
        let elemId = elem.__elemId;

        let fact = api.ixer.selectOne("uiElement", {element: elemId});
        let attrs = elementToAttrs[elemId];
        let boundAttrs = elementToAttrBindings[elemId];
        let childrenIds = elementToChildren[elemId];

        // Handle meta properties.
        elem.t = fact["uiElement: tag"];

        let elems = [elem];
        let binding = api.ixer.selectOne("uiElementBinding", {element: elemId});
        if(binding) {
          // If the element is bound, the children must be repeated for each row.
          var boundView = binding["uiElementBinding: view"];
          var rowToKey = this.generateRowToKeyFn(boundView);
          let key = compiledKeys[elem.id];
          var boundRows = this.getBoundRows(boundView, key);
          elems = [];
          let ix = 0;
          for(let row of boundRows) {
            elems.push({t: elem.t, parent: elem.id, id: `${elem.id}.${ix}`, __elemId: elemId}); // We need an id unique per row for bound elements.
            ix++;
          }
        }

        let rowIx = 0;
        for(let elem of elems) {
          // Get bound key and rows if applicable.
          let row, key;
          if(binding) {
            row = boundRows[rowIx];
            key = rowToKey(row);
          } else {
            key = compiledKeys[elem.id];
            row = keyToRow[key];
          }

          // Handle static properties.
          let properties = [];
          if(attrs) {
            for(let attr of attrs) {
              let {"uiAttribute: property": prop, "uiAttribute: value": val} = attr;
              properties.push(prop);
              elem[prop] = val;
            }
          }

          // Handle bound properties.
          if(boundAttrs) {
            for(let attr of boundAttrs) {
              let {"uiAttributeBinding: property": prop, "uiAttributeBinding: field": field} = attr;
              properties.push(prop);
              elem[prop] = row[field];
            }
          }

          // Handle any compiled properties here.
          // @NOTE: Disabled because custom element compilation probably covers all the use cases much more efficiently.
          // @NOTE: if this is a perf issue, isolating compiled properties can be hoisted out of the loop.
          // for(let prop of properties) {
          //   let propertyCompiler = propertyCompilers[prop];
          //   if(propertyCompiler) {
          //     propertyCompiler(elem, elem[prop], prop);
          //   }
          // }

          // Prep children and add them to the stack.
          if(childrenIds) {
            let children = elem.children = [];
            for(let childId of childrenIds) {
              let childElem = {parent: elem.id, __elemId: childId, id: `${elem.id}.${childId}`, debug: `${elem.id}.${childId}`};
              compiledKeys[childElem.id] = key;
              children.push(childElem);
              stack.push(childElem);
            }
          }

          // Handle compiled element tags.
          let elementCompiler = elementCompilers[elem.t];
          if(elementCompiler) {
            elementCompiler(elem);
          }

          rowIx++;
        }

        if(binding) {
          elem.children = elems;
        }
      }

      return roots.map((root) => compiledElements[root]);
    }

    // Generate a unique key for the given row based on the structure of the given view.
    generateRowToKeyFn(viewId:Id):RowTokeyFn {
      var keys = api.ixer.getKeys(viewId);

      if(keys.length > 1) {
        return (row:{}) => {
          return `${viewId}: ${row[keys[0]]}`;
        }
      } else if(keys.length > 0) {
        return (row:{}) => {
          return `${viewId}: ${keys.map((key) => row[key]).join(",")}`;
        }
      } else {
        return (row:{}) => `${viewId}: ${JSON.stringify(row)}`;
      }
    }

    // Get only the rows of view matching the key (if specified) or all rows from the view if not.
    getBoundRows(viewId:Id, key?:any): any[] {
      var keys = api.ixer.getKeys(viewId);
      if(key && keys.length === 1) {
        return api.ixer.select(viewId, {[api.code.name(keys[0])]: key});
      } else if(key && keys.length > 0) {
        let rowToKey = this.generateRowToKeyFn(viewId);
        return api.ixer.select(viewId, {}).filter((row) => rowToKey(row) === key);
      } else {
        return api.ixer.select(viewId, {});
      }
    }
  }

  export type PropertyCompiler = (elem:microReact.Element, val:any, prop:string) => void;
  export var propertyCompilers:{[property:string]:PropertyCompiler} = {};
  export function addPropertyCompiler(prop:string, compiler:PropertyCompiler) {
    if(propertyCompilers[prop]) {
      throw new Error(`Refusing to overwrite existing compiler for property: "${prop}"`);
    }
    propertyCompilers[prop] = compiler;
  }

  export type ElementCompiler = (elem:microReact.Element) => void;
  export var elementCompilers:{[tag:string]: ElementCompiler} = {};
  export function addElementCompiler(tag:string, compiler:ElementCompiler) {
    if(elementCompilers[tag]) {
      throw new Error(`Refusing to overwrite existing compilfer for tag: "${tag}"`);
    }
    elementCompilers[tag] = compiler;
  }

}