import { scopeSiteTree, prettifyName } from "/Users/alex/Projects/arrmatura-books/src/siteTree";
const data = JSON.parse(require("fs").readFileSync("/tmp/jsd.json","utf8"));
const nodes = scopeSiteTree(data, "docs");
const dump = (ns:any[], d=0) => ns.forEach(n=>{console.log(" ".repeat(d*2)+`[${n.type}] id=${n.id} name="${n.name}"`+(n.doc?` doc=${n.doc}`:""));n.nodes&&dump(n.nodes,d+1)});
dump(nodes);
console.log("--- empty scope top level ---");
scopeSiteTree(JSON.parse(require("fs").readFileSync("/tmp/jsd.json","utf8")), "").forEach((n:any)=>console.log(n.type,n.id,n.name));
