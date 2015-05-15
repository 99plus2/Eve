use std::collections::BitSet;
use std::mem::replace;
use std::cell::{RefCell, Ref, RefMut};

use value::{Id, Value};
use relation::{Change, Relation};
use view::{View, Table};
use compiler;

#[derive(Clone, Debug)]
pub struct Node {
    pub id: Id,
    pub view: View,
    pub upstream: Vec<usize>,
    pub downstream: Vec<usize>,
}

pub type Changes = Vec<(Id, Change)>;

#[derive(Clone, Debug)]
pub struct Flow {
    pub nodes: Vec<Node>,
    pub outputs: Vec<RefCell<Relation>>,
    pub dirty: BitSet,
}

impl Flow {
    pub fn new() -> Self {
        let flow = Flow {
            nodes: Vec::new(),
            outputs: Vec::new(),
            dirty: BitSet::new(),
        };
        compiler::bootstrap(flow)
    }

    pub fn get_ix(&self, id: &str) -> Option<usize> {
        self.nodes.iter().position(|node| &node.id[..] == id)
    }

    pub fn get_output(&self, id: &str) -> Ref<Relation> {
        self.outputs[self.get_ix(id).unwrap()].borrow()
    }

    pub fn get_output_mut(&self, id: &str) -> RefMut<Relation> {
        self.outputs[self.get_ix(id).unwrap()].borrow_mut()
    }

    pub fn set_output(&mut self, id: &str, output: RefCell<Relation>) {
        let ix = self.get_ix(id).unwrap();
        self.outputs[ix] = output;
    }

    pub fn change(&mut self, changes: Changes) {
        for (id, changes) in changes.into_iter() {
            match self.get_ix(&*id) {
                Some(ix) => match self.nodes[ix].view {
                    View::Table(_) => {
                        // TODO should we be checking diffs after the fact?
                        self.outputs[ix].borrow_mut().change(changes);
                        for ix in self.nodes[ix].downstream.iter() {
                            self.dirty.insert(*ix);
                        }
                    }
                    _ => panic!("Tried to insert into a non-table view with id: {:?}", id),
                },
                None => panic!("Tried to insert into a non-existent view with id: {:?}", id),
            }
        }
    }

    pub fn as_changes(&self) -> Changes {
        (0..self.nodes.len()).map(|ix|
            (
                self.nodes[ix].id.clone(),
                self.outputs[ix].borrow().as_insert()
            )
        ).collect()
    }

    pub fn changes_from(&self, old_self: Self) -> Changes {
        let mut changes = Vec::new();
        for (ix, node) in self.nodes.iter().enumerate() {
            match old_self.get_ix(&node.id[..]) {
                Some(old_ix) => {
                    let output = self.outputs[ix].borrow();
                    let old_output = old_self.outputs[old_ix].borrow();
                    if output.fields == old_output.fields {
                        let change = self.outputs[ix].borrow().change_from(&*old_self.outputs[old_ix].borrow());
                        changes.push((node.id.clone(), change));
                    } else {
                        changes.push((node.id.clone(), output.as_insert()));
                        changes.push((node.id.clone(), output.as_remove()));
                    }
                }
                None => {
                    let output = self.outputs[ix].borrow();
                    changes.push((node.id.clone(), output.as_insert()));
                }
            }
        }
        for (old_ix, old_node) in old_self.nodes.iter().enumerate() {
            match self.get_ix(&old_node.id[..]) {
                Some(new_ix) => {
                    () // already handled above
                }
                None => {
                    let old_output = old_self.outputs[old_ix].borrow();
                    changes.push((old_node.id.clone(), old_output.as_remove()));
                }
            }
        }
        changes
    }

    pub fn recalculate(&mut self) {
        let Flow{ref nodes, ref mut outputs, ref mut dirty, ..} = *self;
        while let Some(ix) = dirty.iter().next() {
            dirty.remove(&ix);
            let node = &nodes[ix];
            let new_output = {
                let upstream = node.upstream.iter().map(|&ix| outputs[ix].borrow()).collect::<Vec<_>>();
                let inputs = upstream.iter().map(|borrowed| &**borrowed).collect();
                node.view.run(&*outputs[ix].borrow(), inputs)
            };
            match new_output {
                None => (), // view does not want to update
                Some(new_output) => {
                    let change = new_output.change_from(&*outputs[ix].borrow());
                    if (change.insert.len() != 0) || (change.remove.len() != 0) {
                        for ix in node.downstream.iter() {
                            dirty.insert(*ix);
                        }
                    }
                    outputs[ix] = RefCell::new(new_output);
                }
            }
        }
    }

    pub fn tick(&mut self) -> bool {
        let mut changed = false;
        for (ix, node) in self.nodes.iter().enumerate() {
            match node.view {
                View::Table(Table{ref insert, ref remove}) => {
                    let mut inserts = match *insert {
                        Some((ix, ref select)) => select.select(&*self.outputs[node.upstream[ix]].borrow()),
                        None => vec![],
                    };
                    let mut removes = match *remove {
                        Some((ix, ref select)) => select.select(&*self.outputs[node.upstream[ix]].borrow()),
                        None => vec![],
                    };
                    inserts.sort();
                    removes.sort();
                    inserts.retain(|insert| removes.binary_search(&insert).is_err());
                    removes.retain(|remove| inserts.binary_search(&remove).is_err());
                    let mut output = self.outputs[ix].borrow_mut();
                    let mut index = &mut output.index;
                    for insert in inserts {
                        changed = changed || index.insert(insert);
                    }
                    for remove in removes {
                        changed = changed || !index.remove(&remove);
                    }
                }
                _ => () // only tables tick
            }
        }
        changed
    }

    pub fn quiesce(mut self, changes: Changes) -> Self {
        self.change(changes);
        loop {
            // TODO if compiler::needs_recompile...
            self = compiler::recompile(self);
            self.recalculate();
            let changed = self.tick();
            if !changed {
                break
            }
        }
        self
    }
}
